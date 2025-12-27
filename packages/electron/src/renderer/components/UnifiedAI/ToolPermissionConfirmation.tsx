import React, { useCallback, useMemo, useState } from 'react';
import './ToolPermissionConfirmation.css';

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
    <div className={`tool-permission-confirmation ${hasDestructive ? 'tool-permission-confirmation--destructive' : ''}`}>
      {/* Header */}
      <div className="tool-permission-confirmation-header">
        <span className={`tool-permission-confirmation-icon ${hasDestructive ? 'tool-permission-confirmation-icon--destructive' : ''}`}>
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
        <span className="tool-permission-confirmation-title">Allow this tool?</span>
        <span
          className="tool-permission-confirmation-help"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M8 11V8M8 5.5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          {showTooltip && (
            <div className="tool-permission-confirmation-tooltip">
              <div className="tool-permission-confirmation-tooltip-title">Permission Options</div>
              <div className="tool-permission-confirmation-tooltip-item">
                <span className="tool-permission-confirmation-tooltip-key">Deny:</span> Block this request
              </div>
              <div className="tool-permission-confirmation-tooltip-item">
                <span className="tool-permission-confirmation-tooltip-key">Allow Once:</span> Allow just this request
              </div>
              <div className="tool-permission-confirmation-tooltip-item">
                <span className="tool-permission-confirmation-tooltip-key">Session:</span> Allow{' '}
                <span className="tool-permission-confirmation-tooltip-code">{patternDisplayName}</span> until you close the app
              </div>
              <div className="tool-permission-confirmation-tooltip-item">
                <span className="tool-permission-confirmation-tooltip-key">Always:</span> Save to{' '}
                <span className="tool-permission-confirmation-tooltip-code">.claude/settings.local.json</span>
              </div>
              <div className="tool-permission-confirmation-tooltip-pattern">
                Pattern: <span className="tool-permission-confirmation-tooltip-code">{rawPattern}</span>
              </div>
            </div>
          )}
        </span>
      </div>

      {/* Warnings */}
      {allWarnings.length > 0 && (
        <div className="tool-permission-confirmation-warnings">
          {allWarnings.map((warning, i) => (
            <div key={i} className="tool-permission-confirmation-warning">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
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
      <div className="tool-permission-confirmation-command">
        <code>{rawCommand || toolName}</code>
      </div>

      {/* Actions row - all buttons on one line */}
      <div className="tool-permission-confirmation-actions">
        <button
          className="tool-permission-confirmation-button tool-permission-confirmation-button--deny"
          onClick={handleDeny}
        >
          Deny
        </button>
        <button
          className="tool-permission-confirmation-button tool-permission-confirmation-button--once"
          onClick={handleAllowOnce}
        >
          Allow Once
        </button>
        <div className="tool-permission-confirmation-separator" />
        <button
          className="tool-permission-confirmation-button tool-permission-confirmation-button--session"
          onClick={handleAllowSession}
          title={`Allow ${patternDisplayName} for this session`}
        >
          Session
        </button>
        <button
          className="tool-permission-confirmation-button tool-permission-confirmation-button--always"
          onClick={handleAllowAlways}
          title={`Save ${patternDisplayName} to .claude/settings.local.json`}
        >
          Always
        </button>
        {isWebFetchRequest && (
          <>
            <div className="tool-permission-confirmation-separator" />
            <button
              className="tool-permission-confirmation-button tool-permission-confirmation-button--all-domains"
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
      <div className="tool-permission-confirmation-pattern-info">
        Session/Always will allow: <span className="tool-permission-confirmation-pattern-badge">{patternDisplayName}</span>
      </div>
    </div>
  );
};
