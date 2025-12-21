import React, { useCallback, useMemo } from 'react';
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

export type PermissionScope = 'once' | 'session' | 'always';

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

  // Get the human-readable display name for the pattern being approved
  const getPatternDisplayName = (pattern: string): string => {
    const displayNames: Record<string, string> = {
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

    const lowerPattern = pattern.toLowerCase();
    if (displayNames[lowerPattern]) {
      return displayNames[lowerPattern];
    }

    // Handle MCP tools: mcp__server-name__tool_name -> "Server Name: Tool Name"
    if (lowerPattern.startsWith('mcp__')) {
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

  // Get the actual command being run (for showing what's happening now)
  const getCommandDescription = (): string => {
    if (actions.length > 0) {
      const action = actions[0].action;
      // For file operations, show the file path
      if (action.referencedPaths && action.referencedPaths.length > 0) {
        const filePath = action.referencedPaths[0];
        const fileName = filePath.split('/').pop() || filePath;
        return fileName;
      }
      // For bash commands, show a truncated version
      if (action.command && action.command.length > 0) {
        const cmd = action.command;
        return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
      }
    }
    return '';
  };

  const commandDescription = getCommandDescription();

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

  // Get title based on tool and destructiveness
  const getTitle = () => {
    if (hasDestructive) {
      return 'Potentially Destructive Action';
    }
    return `${toolName} Requires Approval`;
  };

  return (
    <div className={`tool-permission-confirmation ${hasDestructive ? 'tool-permission-confirmation--destructive' : ''}`}>
      {/* Header */}
      <div className="tool-permission-confirmation-header">
        <span className={`tool-permission-confirmation-icon ${hasDestructive ? 'tool-permission-confirmation-icon--destructive' : ''}`}>
          {hasDestructive ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 5.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M6.86 2.573L1.21 12.15c-.478.813.119 1.85 1.07 1.85h11.44c.951 0 1.548-1.037 1.07-1.85L9.14 2.573c-.477-.812-1.663-.812-2.14 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12.5 7H3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M5.5 4L3.5 7l2 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          )}
        </span>
        <div className="tool-permission-confirmation-header-text">
          <span className="tool-permission-confirmation-title">
            Agent needs permission
          </span>
        </div>
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

      {/* Group 1: Current command + Deny/Allow Once */}
      <div className="tool-permission-confirmation-group">
        <div className="tool-permission-confirmation-current-action">
          <div className="tool-permission-confirmation-current-action-label">
            This request:
          </div>
          <div className="tool-permission-confirmation-current-action-command">
            <code>{rawCommand || `${toolName}${commandDescription ? `: ${commandDescription}` : ''}`}</code>
          </div>
        </div>
        <div className="tool-permission-confirmation-actions-row">
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
        </div>
      </div>

      {/* Group 2: Pattern + Allow Session/Always */}
      <div className="tool-permission-confirmation-group">
        <div className="tool-permission-confirmation-patterns">
          <div className="tool-permission-confirmation-patterns-label">
            Allow all future:
          </div>
          <div className="tool-permission-confirmation-patterns-list">
            {uniquePatterns.map(([pattern, info]) => (
              <span
                key={pattern}
                className={`tool-permission-confirmation-pattern ${info.isDestructive ? 'tool-permission-confirmation-pattern--destructive' : ''}`}
              >
                {info.displayName}
              </span>
            ))}
          </div>
        </div>
        <div className="tool-permission-confirmation-actions-row">
          <button
            className="tool-permission-confirmation-button tool-permission-confirmation-button--session"
            onClick={handleAllowSession}
          >
            Allow Session
          </button>
          <button
            className="tool-permission-confirmation-button tool-permission-confirmation-button--always"
            onClick={handleAllowAlways}
          >
            Allow Always
          </button>
        </div>
      </div>
    </div>
  );
};
