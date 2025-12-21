/**
 * Permission Engine for Agentic Tool Calls
 *
 * Combines command parsing, directory scope checking, and pattern matching
 * to evaluate whether a tool call should be allowed, denied, or require user approval.
 */

import {
  parseCommand,
  isReadOnlyAllowed,
  type ParsedAction,
  type ParsedCommand,
} from './commandParser';
import {
  isPathWithinWorkspace,
  isSensitivePath,
  checkCommandPaths,
} from './directoryScope';
import {
  isDestructiveCommand,
  isRiskyCommand,
  getCommandWarnings,
  getCommandSeverity,
  type PatternSeverity,
} from './dangerousPatterns';

/**
 * Permission decision types
 */
export type PermissionDecision = 'allow' | 'deny' | 'ask';

/**
 * Scope for permission grants
 */
export type PermissionScope = 'once' | 'session' | 'always';

/**
 * A stored permission rule
 */
export interface PermissionRule {
  /** Pattern identifier, e.g., 'git:push', 'npm:run:build' */
  pattern: string;
  /** Human-readable display name */
  displayName: string;
  /** Timestamp when this rule was added */
  addedAt: number;
}

/**
 * Permission mode for the workspace
 */
export type PermissionMode = 'ask' | 'allow-all';

/**
 * An additional directory the agent has access to outside the workspace
 */
export interface AdditionalDirectory {
  /** The absolute path to the directory */
  path: string;
  /** Whether the agent can write to this directory */
  canWrite: boolean;
  /** When this directory was added */
  addedAt: number;
}

/**
 * A URL pattern that the agent is allowed to access
 */
export interface AllowedUrlPattern {
  /** The URL pattern (e.g., "*.github.com", "api.example.com", "https://docs.anthropic.com/*") */
  pattern: string;
  /** Human-readable description */
  description: string;
  /** When this pattern was added */
  addedAt: number;
}

/**
 * Workspace-level permission settings (persisted)
 */
export interface WorkspacePermissions {
  /** Patterns that are always allowed in this workspace */
  allowedPatterns: PermissionRule[];
  /** Patterns that are always denied in this workspace */
  deniedPatterns: PermissionRule[];
  /** Whether the workspace is trusted for agent operations */
  isTrusted: boolean;
  /** Timestamp when trust was granted */
  trustedAt?: number;
  /** Permission mode: 'ask' prompts for each command, 'allow-all' auto-approves */
  permissionMode: PermissionMode;
  /** Additional directories outside workspace that the agent can access */
  additionalDirectories: AdditionalDirectory[];
  /** URL patterns the agent is allowed to fetch/access */
  allowedUrlPatterns: AllowedUrlPattern[];
}

/**
 * Session-level permissions (in-memory only)
 */
export interface SessionPermissions {
  /** Session ID this belongs to */
  sessionId: string;
  /** Patterns allowed for this session only */
  allowedPatterns: Set<string>;
  /** Patterns denied for this session only */
  deniedPatterns: Set<string>;
}

/**
 * Result of evaluating a single action
 */
export interface ActionEvaluation {
  /** The parsed action */
  action: ParsedAction;
  /** The decision for this action */
  decision: PermissionDecision;
  /** Why this decision was made */
  reason: string;
  /** Whether this action is destructive */
  isDestructive: boolean;
  /** Whether this action is risky */
  isRisky: boolean;
  /** Whether this is a read-only command (ls, cat, grep, find, etc.) */
  isReadOnly: boolean;
  /** Warnings about this action */
  warnings: string[];
  /** Paths that are outside the workspace */
  outsidePaths: string[];
  /** Paths that are sensitive */
  sensitivePaths: string[];
}

/**
 * Result of evaluating a full command
 */
export interface CommandEvaluation {
  /** The original parsed command */
  command: ParsedCommand;
  /** Evaluations for each action */
  evaluations: ActionEvaluation[];
  /** Overall decision (deny if any deny, ask if any ask, allow only if all allow) */
  overallDecision: PermissionDecision;
  /** Actions that need user approval */
  actionsNeedingApproval: ActionEvaluation[];
  /** Whether any action is destructive */
  hasDestructiveActions: boolean;
}

/**
 * Request for user permission
 */
export interface PermissionRequest {
  /** Unique ID for this request */
  id: string;
  /** The tool that triggered this request */
  toolName: string;
  /** The raw command string */
  rawCommand: string;
  /** Evaluations for actions needing approval */
  actionsNeedingApproval: ActionEvaluation[];
  /** Whether any action is destructive */
  hasDestructiveActions: boolean;
  /** Timestamp when this request was created */
  createdAt: number;
}

/**
 * User's response to a permission request
 */
export interface PermissionResponse {
  /** The request ID this is responding to */
  requestId: string;
  /** The decision made */
  decision: 'allow' | 'deny';
  /** The scope of this decision */
  scope: PermissionScope;
}

/**
 * The main permission engine class
 */
export class PermissionEngine {
  private workspacePath: string;
  private workspacePermissions: WorkspacePermissions;
  private sessionPermissions: Map<string, SessionPermissions> = new Map();

  constructor(workspacePath: string, workspacePermissions?: WorkspacePermissions) {
    this.workspacePath = workspacePath;
    // Deep clone to avoid shared state issues
    this.workspacePermissions = workspacePermissions
      ? {
          allowedPatterns: [...workspacePermissions.allowedPatterns],
          deniedPatterns: [...workspacePermissions.deniedPatterns],
          isTrusted: workspacePermissions.isTrusted,
          trustedAt: workspacePermissions.trustedAt,
          permissionMode: workspacePermissions.permissionMode ?? 'ask',
          additionalDirectories: [...(workspacePermissions.additionalDirectories ?? [])],
          allowedUrlPatterns: [...(workspacePermissions.allowedUrlPatterns ?? [])],
        }
      : {
          allowedPatterns: [],
          deniedPatterns: [],
          isTrusted: false,
          permissionMode: 'ask',
          additionalDirectories: [],
          allowedUrlPatterns: [],
        };
  }

  /**
   * Update workspace permissions (e.g., after loading from storage)
   */
  setWorkspacePermissions(permissions: WorkspacePermissions): void {
    this.workspacePermissions = permissions;
  }

  /**
   * Get current workspace permissions
   */
  getWorkspacePermissions(): WorkspacePermissions {
    return { ...this.workspacePermissions };
  }

  /**
   * Check if the workspace is trusted
   */
  isWorkspaceTrusted(): boolean {
    return this.workspacePermissions.isTrusted;
  }

  /**
   * Trust the workspace
   */
  trustWorkspace(): void {
    this.workspacePermissions.isTrusted = true;
    this.workspacePermissions.trustedAt = Date.now();
  }

  /**
   * Revoke workspace trust
   */
  revokeWorkspaceTrust(): void {
    this.workspacePermissions.isTrusted = false;
    this.workspacePermissions.trustedAt = undefined;
  }

  /**
   * Get the permission mode
   */
  getPermissionMode(): PermissionMode {
    return this.workspacePermissions.permissionMode;
  }

  /**
   * Set the permission mode
   */
  setPermissionMode(mode: PermissionMode): void {
    this.workspacePermissions.permissionMode = mode;
  }

  /**
   * Get additional directories
   */
  getAdditionalDirectories(): AdditionalDirectory[] {
    return [...this.workspacePermissions.additionalDirectories];
  }

  /**
   * Add an additional directory
   */
  addAdditionalDirectory(path: string, canWrite: boolean): void {
    // Check if already exists
    const existing = this.workspacePermissions.additionalDirectories.find(d => d.path === path);
    if (existing) {
      existing.canWrite = canWrite;
    } else {
      this.workspacePermissions.additionalDirectories.push({
        path,
        canWrite,
        addedAt: Date.now(),
      });
    }
  }

  /**
   * Remove an additional directory
   */
  removeAdditionalDirectory(path: string): void {
    this.workspacePermissions.additionalDirectories =
      this.workspacePermissions.additionalDirectories.filter(d => d.path !== path);
  }

  /**
   * Update an additional directory's write permission
   */
  updateAdditionalDirectoryWriteAccess(path: string, canWrite: boolean): void {
    const dir = this.workspacePermissions.additionalDirectories.find(d => d.path === path);
    if (dir) {
      dir.canWrite = canWrite;
    }
  }

  /**
   * Get allowed URL patterns
   */
  getAllowedUrlPatterns(): AllowedUrlPattern[] {
    return [...this.workspacePermissions.allowedUrlPatterns];
  }

  /**
   * Add an allowed URL pattern
   */
  addAllowedUrlPattern(pattern: string, description: string): void {
    // Check if already exists
    const existing = this.workspacePermissions.allowedUrlPatterns.find(u => u.pattern === pattern);
    if (existing) {
      existing.description = description;
    } else {
      this.workspacePermissions.allowedUrlPatterns.push({
        pattern,
        description,
        addedAt: Date.now(),
      });
    }
  }

  /**
   * Remove an allowed URL pattern
   */
  removeAllowedUrlPattern(pattern: string): void {
    this.workspacePermissions.allowedUrlPatterns =
      this.workspacePermissions.allowedUrlPatterns.filter(u => u.pattern !== pattern);
  }

  /**
   * Check if a URL matches any allowed pattern
   */
  isUrlAllowed(url: string): boolean {
    if (this.workspacePermissions.allowedUrlPatterns.length === 0) {
      return false;
    }

    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;
      const fullUrl = parsedUrl.href;

      for (const { pattern } of this.workspacePermissions.allowedUrlPatterns) {
        if (this.matchUrlPattern(pattern, hostname, fullUrl)) {
          return true;
        }
      }
    } catch {
      // Invalid URL, check patterns against raw string
      for (const { pattern } of this.workspacePermissions.allowedUrlPatterns) {
        if (this.matchUrlPattern(pattern, url, url)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Match a URL against a pattern
   * Supports wildcards: *.example.com, https://api.example.com/*, etc.
   */
  private matchUrlPattern(pattern: string, hostname: string, fullUrl: string): boolean {
    // Normalize pattern
    const normalizedPattern = pattern.toLowerCase().trim();
    const normalizedHostname = hostname.toLowerCase();
    const normalizedUrl = fullUrl.toLowerCase();

    // Handle wildcard patterns
    if (normalizedPattern.startsWith('*.')) {
      // *.example.com matches subdomain.example.com and example.com
      const baseDomain = normalizedPattern.slice(2);
      return normalizedHostname === baseDomain || normalizedHostname.endsWith('.' + baseDomain);
    }

    if (normalizedPattern.endsWith('/*')) {
      // https://api.example.com/* matches any path
      const baseUrl = normalizedPattern.slice(0, -2);
      return normalizedUrl.startsWith(baseUrl);
    }

    if (normalizedPattern.includes('*')) {
      // Convert glob pattern to regex
      const regexPattern = normalizedPattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(normalizedHostname) || regex.test(normalizedUrl);
    }

    // Exact match (hostname or full URL)
    return normalizedHostname === normalizedPattern || normalizedUrl === normalizedPattern;
  }

  /**
   * Extract URLs from a command or description
   */
  extractUrlsFromText(text: string): string[] {
    const urls: string[] = [];

    // Match URLs with protocol
    const urlRegex = /https?:\/\/[^\s"'<>]+/gi;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      urls.push(match[0]);
    }

    // Match curl commands and extract URLs
    const curlRegex = /curl\s+(?:[^"'\s]+\s+)*["']?([^"'\s]+)["']?/gi;
    while ((match = curlRegex.exec(text)) !== null) {
      const potentialUrl = match[1];
      if (potentialUrl.startsWith('http://') || potentialUrl.startsWith('https://')) {
        urls.push(potentialUrl);
      }
    }

    return [...new Set(urls)];
  }

  /**
   * Get or create session permissions
   */
  private getSessionPermissions(sessionId: string): SessionPermissions {
    let session = this.sessionPermissions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        allowedPatterns: new Set(),
        deniedPatterns: new Set(),
      };
      this.sessionPermissions.set(sessionId, session);
    }
    return session;
  }

  /**
   * Clear session permissions (called when session ends)
   */
  clearSessionPermissions(sessionId: string): void {
    this.sessionPermissions.delete(sessionId);
  }

  /**
   * Add a pattern to workspace allowed list
   */
  allowPatternAlways(pattern: string, displayName: string): void {
    // Remove from denied if present
    this.workspacePermissions.deniedPatterns = this.workspacePermissions.deniedPatterns.filter(
      (r) => r.pattern !== pattern
    );
    // Add to allowed if not present
    if (!this.workspacePermissions.allowedPatterns.some((r) => r.pattern === pattern)) {
      this.workspacePermissions.allowedPatterns.push({
        pattern,
        displayName,
        addedAt: Date.now(),
      });
    }
  }

  /**
   * Add a pattern to workspace denied list
   */
  denyPatternAlways(pattern: string, displayName: string): void {
    // Remove from allowed if present
    this.workspacePermissions.allowedPatterns = this.workspacePermissions.allowedPatterns.filter(
      (r) => r.pattern !== pattern
    );
    // Add to denied if not present
    if (!this.workspacePermissions.deniedPatterns.some((r) => r.pattern === pattern)) {
      this.workspacePermissions.deniedPatterns.push({
        pattern,
        displayName,
        addedAt: Date.now(),
      });
    }
  }

  /**
   * Remove a pattern from workspace rules
   */
  removePatternRule(pattern: string): void {
    this.workspacePermissions.allowedPatterns = this.workspacePermissions.allowedPatterns.filter(
      (r) => r.pattern !== pattern
    );
    this.workspacePermissions.deniedPatterns = this.workspacePermissions.deniedPatterns.filter(
      (r) => r.pattern !== pattern
    );
  }

  /**
   * Allow a pattern for the current session only
   */
  allowPatternForSession(sessionId: string, pattern: string): void {
    const session = this.getSessionPermissions(sessionId);
    session.deniedPatterns.delete(pattern);
    session.allowedPatterns.add(pattern);
  }

  /**
   * Deny a pattern for the current session only
   */
  denyPatternForSession(sessionId: string, pattern: string): void {
    const session = this.getSessionPermissions(sessionId);
    session.allowedPatterns.delete(pattern);
    session.deniedPatterns.add(pattern);
  }

  /**
   * Check if a pattern is allowed at workspace level
   */
  private isPatternAllowedByWorkspace(pattern: string): boolean {
    return this.workspacePermissions.allowedPatterns.some((r) => r.pattern === pattern);
  }

  /**
   * Check if a pattern is denied at workspace level
   */
  private isPatternDeniedByWorkspace(pattern: string): boolean {
    return this.workspacePermissions.deniedPatterns.some((r) => r.pattern === pattern);
  }

  /**
   * Check if a pattern is allowed for a session
   */
  private isPatternAllowedBySession(sessionId: string, pattern: string): boolean {
    const session = this.sessionPermissions.get(sessionId);
    return session?.allowedPatterns.has(pattern) ?? false;
  }

  /**
   * Check if a pattern is denied for a session
   */
  private isPatternDeniedBySession(sessionId: string, pattern: string): boolean {
    const session = this.sessionPermissions.get(sessionId);
    return session?.deniedPatterns.has(pattern) ?? false;
  }

  /**
   * Evaluate a single action
   */
  evaluateAction(action: ParsedAction, sessionId: string): ActionEvaluation {
    const command = action.command;
    const pattern = action.pattern;

    // Check paths (including additional directories)
    const pathCheck = checkCommandPaths(
      action.referencedPaths,
      this.workspacePath,
      this.workspacePermissions.additionalDirectories
    );

    // Get pattern info
    const isDestructive = isDestructiveCommand(command) || action.isDestructive;
    const isRisky = isRiskyCommand(command);
    const warnings = getCommandWarnings(command);
    const isReadOnly = isReadOnlyAllowed(action);

    // Build the evaluation result (we'll set decision and reason below)
    const evaluation: ActionEvaluation = {
      action,
      decision: 'ask',
      reason: '',
      isDestructive,
      isRisky,
      isReadOnly,
      warnings,
      outsidePaths: pathCheck.outsidePaths,
      sensitivePaths: pathCheck.sensitivePaths,
    };

    // Evaluation order:
    // 1. Check workspace denied patterns -> deny
    // 2. Check session denied patterns -> deny
    // 3. Check if paths are outside workspace -> ask (or deny for sensitive)
    // 4. Check read-only allowlist -> allow (if within workspace)
    // 5. Check workspace allowed patterns -> allow
    // 6. Check session allowed patterns -> allow
    // 7. No match -> ask

    // 1. Workspace denied
    if (this.isPatternDeniedByWorkspace(pattern)) {
      evaluation.decision = 'deny';
      evaluation.reason = 'Pattern is denied in workspace settings';
      return evaluation;
    }

    // 2. Session denied
    if (this.isPatternDeniedBySession(sessionId, pattern)) {
      evaluation.decision = 'deny';
      evaluation.reason = 'Pattern was denied for this session';
      return evaluation;
    }

    // 3. Check paths
    if (pathCheck.outsidePaths.length > 0) {
      evaluation.decision = 'ask';
      evaluation.reason = `Command references paths outside workspace: ${pathCheck.outsidePaths.join(', ')}`;
      return evaluation;
    }

    if (pathCheck.sensitivePaths.length > 0) {
      evaluation.decision = 'ask';
      evaluation.reason = `Command references sensitive paths: ${pathCheck.sensitivePaths.join(', ')}`;
      return evaluation;
    }

    // 4. Read-only allowlist (only if all paths are within workspace)
    if (isReadOnlyAllowed(action) && pathCheck.allAllowed) {
      evaluation.decision = 'allow';
      evaluation.reason = 'Read-only command within workspace';
      return evaluation;
    }

    // 5. Workspace allowed
    if (this.isPatternAllowedByWorkspace(pattern)) {
      evaluation.decision = 'allow';
      evaluation.reason = 'Pattern is allowed in workspace settings';
      return evaluation;
    }

    // 6. Session allowed
    if (this.isPatternAllowedBySession(sessionId, pattern)) {
      evaluation.decision = 'allow';
      evaluation.reason = 'Pattern was allowed for this session';
      return evaluation;
    }

    // 7. No match - ask
    evaluation.decision = 'ask';
    evaluation.reason = 'Requires user approval';
    return evaluation;
  }

  /**
   * Evaluate a full command (may contain multiple actions)
   */
  evaluateCommand(rawCommand: string, sessionId: string): CommandEvaluation {
    // First check workspace trust
    if (!this.workspacePermissions.isTrusted) {
      const parsed = parseCommand(rawCommand);
      return {
        command: parsed,
        evaluations: [],
        overallDecision: 'deny',
        actionsNeedingApproval: [],
        hasDestructiveActions: false,
      };
    }

    // Parse the command
    const parsed = parseCommand(rawCommand);

    // Evaluate each action
    const evaluations = parsed.actions.map((action) => this.evaluateAction(action, sessionId));

    // Determine overall decision
    let overallDecision: PermissionDecision = 'allow';
    const actionsNeedingApproval: ActionEvaluation[] = [];
    let hasDestructiveActions = false;

    for (const evaluation of evaluations) {
      if (evaluation.isDestructive) {
        hasDestructiveActions = true;
      }

      if (evaluation.decision === 'deny') {
        overallDecision = 'deny';
        break;
      }

      if (evaluation.decision === 'ask') {
        // In allow-all mode, auto-approve 'ask' decisions (but still respect 'deny')
        if (this.workspacePermissions.permissionMode === 'allow-all') {
          evaluation.decision = 'allow';
          evaluation.reason = 'Auto-approved (allow-all mode)';
        } else {
          overallDecision = 'ask';
          actionsNeedingApproval.push(evaluation);
        }
      }
    }

    return {
      command: parsed,
      evaluations,
      overallDecision,
      actionsNeedingApproval,
      hasDestructiveActions,
    };
  }

  /**
   * Evaluate any tool call (Bash or non-Bash)
   * For Bash, parses the command. For other tools, creates a simple action.
   */
  evaluateTool(
    toolName: string,
    toolDescription: string,
    sessionId: string
  ): CommandEvaluation {
    // For Bash, use the existing command parser
    if (toolName === 'Bash') {
      return this.evaluateCommand(toolDescription, sessionId);
    }

    // Check workspace trust for non-Bash tools too
    if (!this.workspacePermissions.isTrusted) {
      return {
        command: {
          raw: toolDescription,
          actions: [],
          isCompound: false,
        },
        evaluations: [],
        overallDecision: 'deny',
        actionsNeedingApproval: [],
        hasDestructiveActions: false,
      };
    }

    // For non-Bash tools, create a simpler evaluation
    // Generate a pattern based on the tool name
    const pattern = this.generateToolPattern(toolName, toolDescription);
    // Display name is human-readable - just the tool name for simple tools
    const displayName = this.getToolDisplayName(toolName);

    // Extract any paths from the description for path checking
    const paths = this.extractPathsFromDescription(toolDescription);
    const pathCheck = checkCommandPaths(
      paths,
      this.workspacePath,
      this.workspacePermissions.additionalDirectories
    );

    // Create a synthetic action for the tool
    const action: ParsedAction = {
      pattern,
      displayName,
      command: toolDescription,
      isDestructive: this.isToolDestructive(toolName, toolDescription),
      referencedPaths: paths,
      hasRedirection: false,
    };

    // Evaluate the action
    const evaluation = this.evaluateAction(action, sessionId);

    // In allow-all mode, auto-approve 'ask' decisions (but still respect 'deny')
    let finalDecision = evaluation.decision;
    if (evaluation.decision === 'ask' && this.workspacePermissions.permissionMode === 'allow-all') {
      evaluation.decision = 'allow';
      evaluation.reason = 'Auto-approved (allow-all mode)';
      finalDecision = 'allow';
    }

    return {
      command: {
        raw: toolDescription,
        actions: [action],
        isCompound: false,
      },
      evaluations: [evaluation],
      overallDecision: finalDecision,
      actionsNeedingApproval: finalDecision === 'ask' ? [evaluation] : [],
      hasDestructiveActions: evaluation.isDestructive,
    };
  }

  /**
   * Generate a permission pattern for a non-Bash tool
   */
  private generateToolPattern(toolName: string, _description: string): string {
    // Simplified patterns - just use the tool name
    // Users approve "Edit" which covers editing any file in the project
    // Path-based restrictions are handled by the directory scope check, not patterns
    return toolName.toLowerCase();
  }

  /**
   * Get a human-readable display name for a tool pattern
   */
  private getToolDisplayName(toolName: string): string {
    const toolDisplayNames: Record<string, string> = {
      'edit': 'Edit files in project',
      'write': 'Create files in project',
      'read': 'Read files',
      'glob': 'Search for files',
      'grep': 'Search file contents',
      'webfetch': 'Fetch web pages',
      'websearch': 'Search the web',
      'bash': 'Run shell commands',
      'task': 'Run background tasks',
      'todowrite': 'Update task list',
    };

    const lowerTool = toolName.toLowerCase();
    if (toolDisplayNames[lowerTool]) {
      return toolDisplayNames[lowerTool];
    }

    // Handle MCP tools: mcp__server-name__tool_name -> "Server Name: Tool Name"
    if (lowerTool.startsWith('mcp__')) {
      const parts = toolName.split('__');
      if (parts.length >= 3) {
        const serverName = parts[1]
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        const mcpToolName = parts[2]
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        return `${serverName}: ${mcpToolName}`;
      }
    }

    return toolName;
  }

  /**
   * Extract file paths from a tool description
   */
  private extractPathsFromDescription(description: string): string[] {
    const paths: string[] = [];

    // Match common path patterns
    // Supports both quoted and unquoted paths
    // For quoted paths: matches content between quotes
    // For unquoted paths: stops at whitespace
    const pathPatterns = [
      // Quoted paths after command words (handles spaces in paths)
      /(?:read|write|edit|fetch|glob|grep)\s+"([^"]+)"/gi,
      /(?:read|write|edit|fetch|glob|grep)\s+'([^']+)'/gi,
      // Unquoted paths after command words
      /(?:read|write|edit|fetch|glob|grep)\s+([^\s"']+)/gi,
      // Quoted absolute paths
      /"(\/[^"]+)"/g,
      /'(\/[^']+)'/g,
      // Unquoted absolute paths (at start or after whitespace)
      /(?:^|\s)(\/[^\s"']+)/g,
      // Windows paths
      /(?:^|\s)([a-zA-Z]:\\[^\s"']+)/g,
    ];

    for (const pattern of pathPatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const potentialPath = match[1].trim();
        // Filter out URLs
        if (potentialPath && !potentialPath.includes('://')) {
          paths.push(potentialPath);
        }
      }
    }

    return [...new Set(paths)]; // Deduplicate
  }

  /**
   * Determine if a tool call is potentially destructive
   */
  private isToolDestructive(toolName: string, description: string): boolean {
    const destructiveTools = ['write', 'multiedit'];
    const lowerTool = toolName.toLowerCase();

    if (destructiveTools.includes(lowerTool)) {
      return true;
    }

    // Check description for destructive keywords
    const destructiveKeywords = ['delete', 'remove', 'overwrite', 'truncate', 'drop'];
    const lowerDesc = description.toLowerCase();
    return destructiveKeywords.some(keyword => lowerDesc.includes(keyword));
  }

  /**
   * Create a permission request for actions that need approval
   */
  createPermissionRequest(
    toolName: string,
    rawCommand: string,
    evaluation: CommandEvaluation
  ): PermissionRequest | null {
    if (evaluation.overallDecision !== 'ask' || evaluation.actionsNeedingApproval.length === 0) {
      return null;
    }

    return {
      id: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      toolName,
      rawCommand,
      actionsNeedingApproval: evaluation.actionsNeedingApproval,
      hasDestructiveActions: evaluation.hasDestructiveActions,
      createdAt: Date.now(),
    };
  }

  /**
   * Apply a user's permission response
   */
  applyPermissionResponse(
    response: PermissionResponse,
    request: PermissionRequest,
    sessionId: string
  ): void {
    for (const evaluation of request.actionsNeedingApproval) {
      const pattern = evaluation.action.pattern;
      const displayName = evaluation.action.displayName;

      if (response.decision === 'allow') {
        switch (response.scope) {
          case 'once':
            // Nothing to store - single use
            break;
          case 'session':
            this.allowPatternForSession(sessionId, pattern);
            break;
          case 'always':
            this.allowPatternAlways(pattern, displayName);
            break;
        }
      } else if (response.decision === 'deny') {
        switch (response.scope) {
          case 'once':
            // Nothing to store - single use
            break;
          case 'session':
            this.denyPatternForSession(sessionId, pattern);
            break;
          case 'always':
            this.denyPatternAlways(pattern, displayName);
            break;
        }
      }
    }
  }

  /**
   * Check if a command should be allowed (quick check, returns boolean)
   */
  isCommandAllowed(rawCommand: string, sessionId: string): boolean {
    const evaluation = this.evaluateCommand(rawCommand, sessionId);
    return evaluation.overallDecision === 'allow';
  }

  /**
   * Get all allowed patterns (workspace level)
   */
  getAllowedPatterns(): PermissionRule[] {
    return [...this.workspacePermissions.allowedPatterns];
  }

  /**
   * Get all denied patterns (workspace level)
   */
  getDeniedPatterns(): PermissionRule[] {
    return [...this.workspacePermissions.deniedPatterns];
  }

  /**
   * Reset workspace permissions to defaults
   */
  resetToDefaults(): void {
    this.workspacePermissions.allowedPatterns = [];
    this.workspacePermissions.deniedPatterns = [];
    // Keep trust status
  }
}

/**
 * Default workspace permissions
 */
export const DEFAULT_WORKSPACE_PERMISSIONS: WorkspacePermissions = {
  allowedPatterns: [],
  deniedPatterns: [],
  isTrusted: false,
  permissionMode: 'ask',
  additionalDirectories: [],
  allowedUrlPatterns: [],
};

/**
 * Serialize workspace permissions for storage
 */
export function serializeWorkspacePermissions(permissions: WorkspacePermissions): object {
  return {
    allowedPatterns: permissions.allowedPatterns.map((r) => ({ ...r })),
    deniedPatterns: permissions.deniedPatterns.map((r) => ({ ...r })),
    isTrusted: permissions.isTrusted,
    trustedAt: permissions.trustedAt,
    permissionMode: permissions.permissionMode,
    additionalDirectories: permissions.additionalDirectories.map((d) => ({ ...d })),
    allowedUrlPatterns: permissions.allowedUrlPatterns.map((u) => ({ ...u })),
  };
}

/**
 * Deserialize workspace permissions from storage
 */
export function deserializeWorkspacePermissions(data: unknown): WorkspacePermissions {
  if (!data || typeof data !== 'object') {
    return { ...DEFAULT_WORKSPACE_PERMISSIONS };
  }

  const obj = data as Record<string, unknown>;

  return {
    allowedPatterns: Array.isArray(obj.allowedPatterns)
      ? obj.allowedPatterns
          .filter((r: any) => r && typeof r === 'object')
          .map((r: any) => ({
            pattern: String(r.pattern ?? ''),
            displayName: String(r.displayName ?? ''),
            addedAt: Number(r.addedAt ?? Date.now()),
          }))
      : [],
    deniedPatterns: Array.isArray(obj.deniedPatterns)
      ? obj.deniedPatterns
          .filter((r: any) => r && typeof r === 'object')
          .map((r: any) => ({
            pattern: String(r.pattern ?? ''),
            displayName: String(r.displayName ?? ''),
            addedAt: Number(r.addedAt ?? Date.now()),
          }))
      : [],
    isTrusted: Boolean(obj.isTrusted),
    trustedAt: typeof obj.trustedAt === 'number' ? obj.trustedAt : undefined,
    permissionMode: obj.permissionMode === 'allow-all' ? 'allow-all' : 'ask',
    additionalDirectories: Array.isArray(obj.additionalDirectories)
      ? obj.additionalDirectories
          .filter((d: any) => d && typeof d === 'object' && typeof d.path === 'string')
          .map((d: any) => ({
            path: String(d.path),
            canWrite: Boolean(d.canWrite),
            addedAt: Number(d.addedAt ?? Date.now()),
          }))
      : [],
    allowedUrlPatterns: Array.isArray(obj.allowedUrlPatterns)
      ? obj.allowedUrlPatterns
          .filter((u: any) => u && typeof u === 'object' && typeof u.pattern === 'string')
          .map((u: any) => ({
            pattern: String(u.pattern),
            description: String(u.description ?? ''),
            addedAt: Number(u.addedAt ?? Date.now()),
          }))
      : [],
  };
}
