import React, { useCallback, useMemo, useState } from 'react';

interface ActionEvaluation {
  action: {
    pattern: string;
    displayName: string;
    command: string;
    isDestructive: boolean;
    referencedPaths: string[];
    hasRedirection: boolean;
  };
  decision: 'allow' | 'deny' | 'ask';
  reason: string;
  isDestructive: boolean;
  isRisky: boolean;
  warnings: string[];
  outsidePaths: string[];
  sensitivePaths: string[];
}

interface PermissionRequest {
  id: string;
  toolName: string;
  rawCommand: string;
  actionsNeedingApproval: ActionEvaluation[];
  hasDestructiveActions: boolean;
  createdAt: number;
}

export interface ToolPermissionData {
  requestId: string;
  sessionId: string;
  workspacePath: string;
  request: PermissionRequest;
  timestamp: number;
}

export type PermissionScope = 'once' | 'session' | 'always' | 'always-all';

interface ToolPermissionConfirmationProps {
  data: ToolPermissionData;
  onSubmit: (
    requestId: string,
    sessionId: string,
    response: { decision: 'allow' | 'deny'; scope: PermissionScope }
  ) => void;
  onCancel: (requestId: string, sessionId: string) => void;
}

/**
 * Inline confirmation component shown when Claude wants to execute a tool
 * that requires user approval.
 */
export const ToolPermissionConfirmation: React.FC<ToolPermissionConfirmationProps> = ({
  data,
  onSubmit,
  onCancel
}) => {
  const { request } = data;
  const actions = request.actionsNeedingApproval;
  const hasDestructive = request.hasDestructiveActions;
  const toolName = request.toolName;
  const [showTooltip, setShowTooltip] = useState(false);
  const [isAllowingAllDomains, setIsAllowingAllDomains] = useState(false);

  // Get the human-readable display name for the pattern being approved
  const getPatternDisplayName = (pattern: string): string => {
    // Handle compound commands - these get unique patterns and shouldn't be cached
    if (pattern.startsWith('Bash:compound:')) {
      return 'this compound command (one-time only)';
    }

    // Handle Bash patterns like "Bash(git commit:*)" -> "git commit commands"
    const bashMatch = pattern.match(/^Bash\(([^:]+):\*\)$/);
    if (bashMatch) {
      return `${bashMatch[1]} commands`;
    }
    if (pattern === 'Bash') {
      return 'Run shell commands';
    }

    // Handle WebFetch patterns like "WebFetch(domain:example.com)" -> "Fetch from example.com"
    const webfetchMatch = pattern.match(/^WebFetch\(domain:(.+)\)$/);
    if (webfetchMatch) {
      return `Fetch from ${webfetchMatch[1]}`;
    }
    if (pattern === 'WebFetch') {
      return 'Fetch any web page';
    }

    const displayNames: Record<string, string> = {
      'Edit': 'Edit files in project',
      'Write': 'Create files in project',
      'Read': 'Read files',
      'Glob': 'Search for files',
      'Grep': 'Search file contents',
      'WebSearch': 'Search the web',
      'Task': 'Run background tasks',
      'TodoWrite': 'Update task list',
    };

    if (displayNames[pattern]) {
      return displayNames[pattern];
    }

    // Handle MCP tools: mcp__server-name__tool_name -> "Server Name: Tool Name"
    if (pattern.toLowerCase().startsWith('mcp__')) {
      const parts = pattern.split('__');
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

    return pattern;
  };

  // Collect unique patterns for display
  const uniquePatterns = useMemo(() => {
    const patterns = new Map<string, { displayName: string; isDestructive: boolean }>();
    for (const action of actions) {
      if (!patterns.has(action.action.pattern)) {
        patterns.set(action.action.pattern, {
          displayName: getPatternDisplayName(action.action.pattern),
          isDestructive: action.isDestructive
        });
      }
    }
    return Array.from(patterns.entries());
  }, [actions]);

  // Get display name for the pattern (for showing in the UI)
  const patternDisplayName = useMemo(() => {
    if (uniquePatterns.length > 0) {
      return uniquePatterns[0][1].displayName;
    }
    return toolName;
  }, [uniquePatterns, toolName]);

  // Get the raw pattern that will be saved to settings
  const rawPattern = useMemo(() => {
    if (uniquePatterns.length > 0) {
      return uniquePatterns[0][0]; // The key is the raw pattern
    }
    return toolName;
  }, [uniquePatterns, toolName]);

  // Get the raw command for display
  const rawCommand = request.rawCommand || actions[0]?.action.command || '';

  // Collect all warnings
  const allWarnings = useMemo(() => {
    const warnings: string[] = [];
    for (const action of actions) {
      warnings.push(...action.warnings);
      if (action.outsidePaths.length > 0) {
        warnings.push(`Accesses paths outside workspace: ${action.outsidePaths.join(', ')}`);
      }
      if (action.sensitivePaths.length > 0) {
        warnings.push(`Accesses sensitive paths: ${action.sensitivePaths.join(', ')}`);
      }
    }
    // Deduplicate
    return [...new Set(warnings)];
  }, [actions]);

  const handleDeny = useCallback(() => {
    onSubmit(data.requestId, data.sessionId, {
      decision: 'deny',
      scope: 'once'
    });
  }, [data.requestId, data.sessionId, onSubmit]);

  const handleAllowOnce = useCallback(() => {
    onSubmit(data.requestId, data.sessionId, {
      decision: 'allow',
      scope: 'once'
    });
  }, [data.requestId, data.sessionId, onSubmit]);

  const handleAllowSession = useCallback(() => {
    onSubmit(data.requestId, data.sessionId, {
      decision: 'allow',
      scope: 'session'
    });
  }, [data.requestId, data.sessionId, onSubmit]);

  const handleAllowAlways = useCallback(() => {
    onSubmit(data.requestId, data.sessionId, {
      decision: 'allow',
      scope: 'always'
    });
  }, [data.requestId, data.sessionId, onSubmit]);

  // Check if this is a WebFetch permission request
  const isWebFetchRequest = useMemo(() => {
    return uniquePatterns.some(([pattern]) => pattern.startsWith('WebFetch'));
  }, [uniquePatterns]);

  // Handle "Allow All Domains" - saves WebFetch wildcard and allows this request
  const handleAllowAllDomains = useCallback(async () => {
    setIsAllowingAllDomains(true);
    try {
      await window.electronAPI.invoke('permissions:allowAllUrls', data.workspacePath);
      // Now allow this specific request
      onSubmit(data.requestId, data.sessionId, {
        decision: 'allow',
        scope: 'once' // The wildcard is already saved, so we just need to allow once
      });
    } catch (error) {
      console.error('Failed to allow all domains:', error);
      setIsAllowingAllDomains(false);
    }
  }, [data.workspacePath, data.requestId, data.sessionId, onSubmit]);

  return (
    <div
      className={`tool-permission-confirmation mx-4 my-3 p-3 flex flex-col gap-2 rounded-lg border ${
        hasDestructive
          ? 'tool-permission-confirmation--destructive border-[var(--nim-error)] bg-[color-mix(in_srgb,var(--nim-error)_5%,var(--nim-bg-secondary))]'
          : 'border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]'
      }`}
    >
      {/* Header */}
      <div className="tool-permission-confirmation-header flex items-center gap-2">
        <span
          className={`tool-permission-confirmation-icon flex items-center justify-center ${
            hasDestructive
              ? 'tool-permission-confirmation-icon--destructive text-[var(--nim-error)]'
              : 'text-[var(--nim-primary)]'
          }`}
        >
          {hasDestructive ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M6.86 2.573L1.21 12.15c-.478.813.119 1.85 1.07 1.85h11.44c.951 0 1.548-1.037 1.07-1.85L9.14 2.573c-.477-.812-1.663-.812-2.14 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12.5 7H3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M5.5 4L3.5 7l2 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          )}
        </span>
        <span className="tool-permission-confirmation-title flex-1 font-semibold text-[13px] text-[var(--nim-text)]">
          Allow this tool?
        </span>
        <span
          className="tool-permission-confirmation-help relative flex items-center cursor-pointer text-[var(--nim-text-faint)] hover:text-[var(--nim-text-muted)]"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M8 11V8M8 5.5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          {showTooltip && (
            <div className="tool-permission-confirmation-tooltip absolute bottom-full right-0 mb-2 p-3 w-[300px] rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] text-[11px] leading-relaxed text-[var(--nim-text-muted)] shadow-[0_4px_12px_rgba(0,0,0,0.3)] z-[100]">
              <div className="tool-permission-confirmation-tooltip-title font-semibold text-[var(--nim-text)] mb-2">
                Permission Options
              </div>
              <div className="tool-permission-confirmation-tooltip-item mb-2">
                <span className="tool-permission-confirmation-tooltip-key font-semibold text-[var(--nim-text)]">Deny:</span> Block this request
              </div>
              <div className="tool-permission-confirmation-tooltip-item mb-2">
                <span className="tool-permission-confirmation-tooltip-key font-semibold text-[var(--nim-text)]">Allow Once:</span> Allow just this request
              </div>
              <div className="tool-permission-confirmation-tooltip-item mb-2">
                <span className="tool-permission-confirmation-tooltip-key font-semibold text-[var(--nim-text)]">Session:</span> Allow{' '}
                <span className="tool-permission-confirmation-tooltip-code font-mono text-[10px] text-[var(--nim-text-faint)] bg-[var(--nim-bg-secondary)] px-1 py-0.5 rounded">
                  {patternDisplayName}
                </span> until you close the app
              </div>
              <div className="tool-permission-confirmation-tooltip-item mb-0">
                <span className="tool-permission-confirmation-tooltip-key font-semibold text-[var(--nim-text)]">Always:</span> Save to{' '}
                <span className="tool-permission-confirmation-tooltip-code font-mono text-[10px] text-[var(--nim-text-faint)] bg-[var(--nim-bg-secondary)] px-1 py-0.5 rounded">
                  .claude/settings.local.json
                </span>
              </div>
              <div className="tool-permission-confirmation-tooltip-pattern mt-2 pt-2 border-t border-[var(--nim-border)] text-[var(--nim-text-faint)]">
                Pattern: <span className="tool-permission-confirmation-tooltip-code font-mono text-[10px] text-[var(--nim-text-faint)] bg-[var(--nim-bg-secondary)] px-1 py-0.5 rounded">{rawPattern}</span>
              </div>
            </div>
          )}
        </span>
      </div>

      {/* Warnings */}
      {allWarnings.length > 0 && (
        <div className="tool-permission-confirmation-warnings flex flex-col gap-1.5">
          {allWarnings.map((warning, i) => (
            <div key={i} className="tool-permission-confirmation-warning flex items-start gap-1.5 text-xs text-[var(--nim-warning)]">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 mt-px">
                <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {/* Command display */}
      <div className="tool-permission-confirmation-command bg-[var(--nim-bg-tertiary)] rounded p-2 max-h-[200px] overflow-x-auto">
        <code className="font-mono text-xs text-[var(--nim-text)] whitespace-pre-wrap break-all">
          {rawCommand || toolName}
        </code>
      </div>

      {/* Actions row - all buttons on one line */}
      <div className="tool-permission-confirmation-actions flex items-center gap-2 flex-wrap">
        <button
          className="tool-permission-confirmation-button tool-permission-confirmation-button--deny px-3 py-1.5 rounded-[5px] text-[11px] font-medium cursor-pointer border border-transparent bg-transparent text-[var(--nim-text-muted)] whitespace-nowrap transition-all duration-150 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)] active:opacity-80"
          onClick={handleDeny}
        >
          Deny
        </button>
        <button
          className="tool-permission-confirmation-button tool-permission-confirmation-button--once px-3 py-1.5 rounded-[5px] text-[11px] font-medium cursor-pointer border border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] whitespace-nowrap transition-all duration-150 hover:bg-[var(--nim-bg-hover)] active:opacity-80"
          onClick={handleAllowOnce}
        >
          Allow Once
        </button>
        <div className="tool-permission-confirmation-separator w-px h-5 bg-[var(--nim-border)] mx-1" />
        <button
          className="tool-permission-confirmation-button tool-permission-confirmation-button--session px-3 py-1.5 rounded-[5px] text-[11px] font-medium cursor-pointer border border-[var(--nim-primary)] bg-transparent text-[var(--nim-primary)] whitespace-nowrap transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--nim-primary)_10%,transparent)] active:opacity-80"
          onClick={handleAllowSession}
          title={`Allow ${patternDisplayName} for this session`}
        >
          Session
        </button>
        <button
          className="tool-permission-confirmation-button tool-permission-confirmation-button--always px-3 py-1.5 rounded-[5px] text-[11px] font-medium cursor-pointer border border-[var(--nim-primary)] bg-[var(--nim-primary)] text-white whitespace-nowrap transition-all duration-150 hover:opacity-90 active:opacity-80"
          onClick={handleAllowAlways}
          title={`Save ${patternDisplayName} to .claude/settings.local.json`}
        >
          Always
        </button>
        {isWebFetchRequest && (
          <>
            <div className="tool-permission-confirmation-separator w-px h-5 bg-[var(--nim-border)] mx-1" />
            <button
              className="tool-permission-confirmation-button tool-permission-confirmation-button--all-domains px-3 py-1.5 rounded-[5px] text-[11px] font-medium cursor-pointer border border-[var(--nim-primary)] bg-[var(--nim-primary)] text-white whitespace-nowrap transition-all duration-150 hover:opacity-90 active:opacity-80 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={handleAllowAllDomains}
              disabled={isAllowingAllDomains}
              title="Allow fetching from any domain without asking"
            >
              {isAllowingAllDomains ? 'Saving...' : 'All Domains'}
            </button>
          </>
        )}
      </div>

      {/* Pattern info line */}
      <div className="tool-permission-confirmation-pattern-info text-[11px] text-[var(--nim-text-faint)] mt-1 pt-2 border-t border-[var(--nim-border)]">
        Session/Always will allow: <span className="tool-permission-confirmation-pattern-badge font-medium text-[var(--nim-text-muted)] bg-[var(--nim-bg-tertiary)] px-1.5 py-0.5 rounded text-[10px]">{patternDisplayName}</span>
      </div>
    </div>
  );
};
