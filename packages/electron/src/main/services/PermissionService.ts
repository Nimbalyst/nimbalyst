/**
 * Permission Service for Agent Tool Calls
 *
 * Manages permission evaluation for Bash commands executed by AI agents.
 * Uses the PermissionEngine from @nimbalyst/runtime and persists workspace
 * permissions via the store.
 */

import {
  PermissionEngine,
  DEFAULT_WORKSPACE_PERMISSIONS,
  type WorkspacePermissions,
  type PermissionRequest,
} from '@nimbalyst/runtime/ai/permissions';
import {
  getAgentPermissions,
  saveAgentPermissions,
  type AgentPermissions,
} from '../utils/store';
import { logger } from '../utils/logger';

/**
 * Convert store AgentPermissions to engine WorkspacePermissions
 */
function toWorkspacePermissions(stored: AgentPermissions | undefined): WorkspacePermissions {
  if (!stored) {
    return { ...DEFAULT_WORKSPACE_PERMISSIONS };
  }
  return {
    allowedPatterns: stored.allowedPatterns.map((r) => ({
      pattern: r.pattern,
      displayName: r.displayName,
      addedAt: r.addedAt,
    })),
    deniedPatterns: stored.deniedPatterns.map((r) => ({
      pattern: r.pattern,
      displayName: r.displayName,
      addedAt: r.addedAt,
    })),
    isTrusted: stored.isTrusted,
    trustedAt: stored.trustedAt,
    permissionMode: stored.permissionMode ?? 'ask',
    additionalDirectories: (stored.additionalDirectories ?? []).map((d) => ({
      path: d.path,
      canWrite: d.canWrite,
      addedAt: d.addedAt,
    })),
    allowedUrlPatterns: (stored.allowedUrlPatterns ?? []).map((u) => ({
      pattern: u.pattern,
      description: u.description,
      addedAt: u.addedAt,
    })),
  };
}

/**
 * Convert engine WorkspacePermissions to store AgentPermissions
 */
function toAgentPermissions(engine: WorkspacePermissions): AgentPermissions {
  return {
    allowedPatterns: engine.allowedPatterns.map((r) => ({
      pattern: r.pattern,
      displayName: r.displayName,
      addedAt: r.addedAt,
    })),
    deniedPatterns: engine.deniedPatterns.map((r) => ({
      pattern: r.pattern,
      displayName: r.displayName,
      addedAt: r.addedAt,
    })),
    isTrusted: engine.isTrusted,
    trustedAt: engine.trustedAt,
    permissionMode: engine.permissionMode,
    additionalDirectories: engine.additionalDirectories.map((d) => ({
      path: d.path,
      canWrite: d.canWrite,
      addedAt: d.addedAt,
    })),
    allowedUrlPatterns: engine.allowedUrlPatterns.map((u) => ({
      pattern: u.pattern,
      description: u.description,
      addedAt: u.addedAt,
    })),
  };
}

/**
 * Permission Service singleton
 *
 * Manages permission engines per workspace and provides the handlers
 * needed by ClaudeCodeProvider.
 */
export class PermissionService {
  private static instance: PermissionService;
  private engines: Map<string, PermissionEngine> = new Map();
  // Store pending permission requests by requestId so we can look them up when user responds
  private pendingRequests: Map<string, { workspacePath: string; sessionId: string; request: PermissionRequest }> = new Map();

  private constructor() {}

  public static getInstance(): PermissionService {
    if (!PermissionService.instance) {
      PermissionService.instance = new PermissionService();
    }
    return PermissionService.instance;
  }

  /**
   * Get or create a permission engine for a workspace
   */
  private getEngine(workspacePath: string): PermissionEngine {
    const workspaceName = workspacePath.split('/').pop() || workspacePath;
    let engine = this.engines.get(workspacePath);
    if (!engine) {
      const stored = getAgentPermissions(workspacePath);
      logger.agentSecurity.info(`[PermissionService:${workspaceName}] Loading permissions:`, {
        workspace: workspacePath,
        stored: stored ? {
          isTrusted: stored.isTrusted,
          mode: stored.permissionMode,
          additionalDirectories: stored.additionalDirectories?.map(d => d.path) || [],
          allowedUrlPatterns: stored.allowedUrlPatterns?.map(u => u.pattern) || [],
        } : 'none',
      });
      const permissions = toWorkspacePermissions(stored);
      engine = new PermissionEngine(workspacePath, permissions);
      this.engines.set(workspacePath, engine);
    }
    return engine;
  }

  /**
   * Save engine permissions to store
   */
  private saveEngine(workspacePath: string, engine: PermissionEngine): void {
    const workspaceName = workspacePath.split('/').pop() || workspacePath;
    const permissions = engine.getWorkspacePermissions();
    logger.agentSecurity.info(`[PermissionService:${workspaceName}] Saving permissions:`, {
      workspace: workspacePath,
      isTrusted: permissions.isTrusted,
      mode: permissions.permissionMode,
      additionalDirectories: permissions.additionalDirectories.map(d => d.path),
      allowedUrlPatterns: permissions.allowedUrlPatterns.map(u => u.pattern),
    });
    saveAgentPermissions(workspacePath, toAgentPermissions(permissions));
  }

  /**
   * Evaluate a tool call and return the permission decision
   * Works for both Bash commands and other tool types
   */
  public async evaluateCommand(
    workspacePath: string,
    sessionId: string,
    toolName: string,
    toolDescription: string
  ): Promise<{
    decision: 'allow' | 'deny' | 'ask';
    request?: PermissionRequest;
  }> {
    // Extract workspace name for clearer logs
    const workspaceName = workspacePath.split('/').pop() || workspacePath;

    logger.agentSecurity.info(`[PermissionService:${workspaceName}] evaluateCommand:`, {
      workspace: workspacePath,
      toolName,
      toolDescription: toolDescription.slice(0, 100),
    });

    const engine = this.getEngine(workspacePath);
    // Use evaluateTool which handles both Bash and non-Bash tools
    const evaluation = engine.evaluateTool(toolName, toolDescription, sessionId);

    // Log detailed evaluation info
    const actionDetails = evaluation.evaluations.map(e => ({
      pattern: e.action.pattern,
      displayName: e.action.displayName,
      decision: e.decision,
      reason: e.reason,
      outsidePaths: e.outsidePaths,
    }));

    logger.agentSecurity.info(`[PermissionService:${workspaceName}] evaluation:`, {
      workspace: workspacePath,
      overallDecision: evaluation.overallDecision,
      isTrusted: engine.isWorkspaceTrusted(),
      permissionMode: engine.getPermissionMode(),
      allowedPatterns: engine.getAllowedPatterns().map(p => p.pattern),
      additionalDirectories: engine.getAdditionalDirectories().map(d => d.path),
      actions: actionDetails,
    });

    if (evaluation.overallDecision === 'allow') {
      logger.agentSecurity.info(`[PermissionService:${workspaceName}] ALLOWED:`, {
        workspace: workspacePath,
        toolName,
        reason: actionDetails[0]?.reason,
      });
      return { decision: 'allow' };
    }

    if (evaluation.overallDecision === 'deny') {
      logger.agentSecurity.info(`[PermissionService:${workspaceName}] DENIED:`, {
        workspace: workspacePath,
        toolName,
        reason: actionDetails[0]?.reason,
      });
      return { decision: 'deny' };
    }

    // decision === 'ask'
    const request = engine.createPermissionRequest(toolName, toolDescription, evaluation);
    if (request) {
      // Store the pending request so we can look it up when user responds
      this.pendingRequests.set(request.id, { workspacePath, sessionId, request });
      logger.agentSecurity.info(`[PermissionService:${workspaceName}] ASKING user for approval:`, {
        workspace: workspacePath,
        requestId: request.id,
        toolName: request.toolName,
        patterns: request.actionsNeedingApproval.map(a => ({
          pattern: a.action.pattern,
          displayName: a.action.displayName,
          outsidePaths: a.outsidePaths,
        })),
      });
    }
    return {
      decision: 'ask',
      request: request ?? undefined,
    };
  }

  /**
   * Apply a permission response from the user
   */
  public applyPermissionResponse(
    workspacePath: string,
    sessionId: string,
    requestId: string,
    response: { decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' }
  ): void {
    const workspaceName = workspacePath.split('/').pop() || workspacePath;

    logger.agentSecurity.info(`[PermissionService:${workspaceName}] applyPermissionResponse:`, {
      workspace: workspacePath,
      requestId,
      decision: response.decision,
      scope: response.scope,
    });

    // Look up the pending request
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      logger.agentSecurity.warn(`[PermissionService:${workspaceName}] No pending request found for requestId: ${requestId}`);
      return;
    }

    const pendingWorkspaceName = pending.workspacePath.split('/').pop() || pending.workspacePath;

    // Log what pattern is being saved
    const patterns = pending.request.actionsNeedingApproval.map(a => ({
      pattern: a.action.pattern,
      displayName: a.action.displayName,
    }));
    logger.agentSecurity.info(`[PermissionService:${pendingWorkspaceName}] Applying response to patterns:`, {
      workspace: pending.workspacePath,
      patterns,
      decision: response.decision,
      scope: response.scope,
    });

    // Remove from pending
    this.pendingRequests.delete(requestId);

    // Get the engine for this workspace
    const engine = this.getEngine(pending.workspacePath);

    // Apply the permission response to the engine
    engine.applyPermissionResponse(
      { requestId, decision: response.decision, scope: response.scope },
      pending.request,
      pending.sessionId
    );

    // Save to persistent storage if scope is 'always'
    if (response.scope === 'always') {
      logger.agentSecurity.info(`[PermissionService:${pendingWorkspaceName}] Saving patterns permanently (scope=always):`, {
        workspace: pending.workspacePath,
        patterns: patterns.map(p => p.pattern),
      });
      this.saveEngine(pending.workspacePath, engine);

      // Verify what was saved
      const savedPatterns = engine.getAllowedPatterns();
      logger.agentSecurity.info(`[PermissionService:${pendingWorkspaceName}] Saved allowed patterns:`, {
        workspace: pending.workspacePath,
        patterns: savedPatterns.map(p => ({ pattern: p.pattern, displayName: p.displayName })),
      });
    }
  }

  /**
   * Clear session permissions when a session ends
   */
  public clearSessionPermissions(workspacePath: string, sessionId: string): void {
    const engine = this.engines.get(workspacePath);
    if (engine) {
      engine.clearSessionPermissions(sessionId);
    }
  }

  /**
   * Get permission handler for ClaudeCodeProvider
   */
  public getPermissionHandler(): (
    workspacePath: string,
    sessionId: string,
    toolName: string,
    command: string
  ) => Promise<{
    decision: 'allow' | 'deny' | 'ask';
    request?: any;
  }> {
    return this.evaluateCommand.bind(this);
  }

  /**
   * Get permission response handler for ClaudeCodeProvider
   */
  public getPermissionResponseHandler(): (
    workspacePath: string,
    sessionId: string,
    requestId: string,
    response: { decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' }
  ) => void {
    return this.applyPermissionResponse.bind(this);
  }

  /**
   * Trust a workspace (enable agent operations)
   */
  public trustWorkspace(workspacePath: string): void {
    const engine = this.getEngine(workspacePath);
    engine.trustWorkspace();
    this.saveEngine(workspacePath, engine);
  }

  /**
   * Revoke workspace trust
   */
  public revokeWorkspaceTrust(workspacePath: string): void {
    const engine = this.getEngine(workspacePath);
    engine.revokeWorkspaceTrust();
    this.saveEngine(workspacePath, engine);
  }

  /**
   * Check if a workspace is trusted
   */
  public isWorkspaceTrusted(workspacePath: string): boolean {
    const engine = this.getEngine(workspacePath);
    return engine.isWorkspaceTrusted();
  }

  /**
   * Get all allowed patterns for a workspace
   */
  public getAllowedPatterns(workspacePath: string): Array<{
    pattern: string;
    displayName: string;
    addedAt: number;
  }> {
    const engine = this.getEngine(workspacePath);
    return engine.getAllowedPatterns();
  }

  /**
   * Get all denied patterns for a workspace
   */
  public getDeniedPatterns(workspacePath: string): Array<{
    pattern: string;
    displayName: string;
    addedAt: number;
  }> {
    const engine = this.getEngine(workspacePath);
    return engine.getDeniedPatterns();
  }

  /**
   * Add an allowed pattern
   */
  public addAllowedPattern(workspacePath: string, pattern: string, displayName: string): void {
    const engine = this.getEngine(workspacePath);
    engine.allowPatternAlways(pattern, displayName);
    this.saveEngine(workspacePath, engine);
  }

  /**
   * Add a denied pattern
   */
  public addDeniedPattern(workspacePath: string, pattern: string, displayName: string): void {
    const engine = this.getEngine(workspacePath);
    engine.denyPatternAlways(pattern, displayName);
    this.saveEngine(workspacePath, engine);
  }

  /**
   * Remove a pattern rule (from both allowed and denied)
   */
  public removePatternRule(workspacePath: string, pattern: string): void {
    const engine = this.getEngine(workspacePath);
    engine.removePatternRule(pattern);
    this.saveEngine(workspacePath, engine);
  }

  /**
   * Reset permissions to defaults (keep trust status)
   */
  public resetPermissions(workspacePath: string): void {
    const engine = this.getEngine(workspacePath);
    engine.resetToDefaults();
    this.saveEngine(workspacePath, engine);
  }

  /**
   * Get the permission mode
   */
  public getPermissionMode(workspacePath: string): 'ask' | 'allow-all' {
    const engine = this.getEngine(workspacePath);
    return engine.getPermissionMode();
  }

  /**
   * Set the permission mode
   */
  public setPermissionMode(workspacePath: string, mode: 'ask' | 'allow-all'): void {
    const engine = this.getEngine(workspacePath);
    engine.setPermissionMode(mode);
    this.saveEngine(workspacePath, engine);
  }

  /**
   * Get additional directories
   */
  public getAdditionalDirectories(workspacePath: string): Array<{ path: string; canWrite: boolean; addedAt: number }> {
    const engine = this.getEngine(workspacePath);
    return engine.getAdditionalDirectories();
  }

  /**
   * Add an additional directory
   */
  public addAdditionalDirectory(workspacePath: string, dirPath: string, canWrite: boolean): void {
    const engine = this.getEngine(workspacePath);
    engine.addAdditionalDirectory(dirPath, canWrite);
    this.saveEngine(workspacePath, engine);
  }

  /**
   * Remove an additional directory
   */
  public removeAdditionalDirectory(workspacePath: string, dirPath: string): void {
    const engine = this.getEngine(workspacePath);
    engine.removeAdditionalDirectory(dirPath);
    this.saveEngine(workspacePath, engine);
  }

  /**
   * Update an additional directory's write access
   */
  public updateAdditionalDirectoryWriteAccess(workspacePath: string, dirPath: string, canWrite: boolean): void {
    const engine = this.getEngine(workspacePath);
    engine.updateAdditionalDirectoryWriteAccess(dirPath, canWrite);
    this.saveEngine(workspacePath, engine);
  }

  /**
   * Get allowed URL patterns
   */
  public getAllowedUrlPatterns(workspacePath: string): Array<{ pattern: string; description: string; addedAt: number }> {
    const engine = this.getEngine(workspacePath);
    return engine.getAllowedUrlPatterns();
  }

  /**
   * Add an allowed URL pattern
   */
  public addAllowedUrlPattern(workspacePath: string, pattern: string, description: string): void {
    const workspaceName = workspacePath.split('/').pop() || workspacePath;
    const engine = this.getEngine(workspacePath);
    logger.agentSecurity.info(`[PermissionService:${workspaceName}] addAllowedUrlPattern:`, {
      workspace: workspacePath,
      pattern,
      description,
      existingPatterns: engine.getAllowedUrlPatterns().map(p => p.pattern),
    });
    engine.addAllowedUrlPattern(pattern, description);
    this.saveEngine(workspacePath, engine);
    logger.agentSecurity.info(`[PermissionService:${workspaceName}] addAllowedUrlPattern done:`, {
      workspace: workspacePath,
      newPatterns: engine.getAllowedUrlPatterns().map(p => p.pattern),
    });
  }

  /**
   * Remove an allowed URL pattern
   */
  public removeAllowedUrlPattern(workspacePath: string, pattern: string): void {
    const engine = this.getEngine(workspacePath);
    engine.removeAllowedUrlPattern(pattern);
    this.saveEngine(workspacePath, engine);
  }

  /**
   * Check if a URL is allowed
   */
  public isUrlAllowed(workspacePath: string, url: string): boolean {
    const workspaceName = workspacePath.split('/').pop() || workspacePath;
    const engine = this.getEngine(workspacePath);
    const patterns = engine.getAllowedUrlPatterns();
    const result = engine.isUrlAllowed(url);
    logger.agentSecurity.info(`[PermissionService:${workspaceName}] isUrlAllowed:`, {
      workspace: workspacePath,
      url,
      patterns: patterns.map(p => p.pattern),
      result,
    });
    return result;
  }

  /**
   * Invalidate cached engine for a workspace (e.g., when settings change externally)
   */
  public invalidateCache(workspacePath: string): void {
    this.engines.delete(workspacePath);
  }
}

// Export singleton instance getter
export function getPermissionService(): PermissionService {
  return PermissionService.getInstance();
}
