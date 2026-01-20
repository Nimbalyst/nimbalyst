import React from 'react';
import './MCPConfigChangedToast.css';

interface MCPConfigChangedToastProps {
  scope: 'user' | 'workspace';
  workspacePath?: string;
  onDismiss: () => void;
}

export function MCPConfigChangedToast({ scope, onDismiss }: MCPConfigChangedToastProps): React.ReactElement {
  const scopeText = scope === 'user' ? 'Global' : 'Workspace';

  return (
    <div className="mcp-config-toast-container">
      <div className="mcp-config-toast">
        {/* Dismiss button */}
        <button
          className="mcp-config-toast-dismiss"
          onClick={onDismiss}
          title="Dismiss"
          aria-label="Dismiss"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Header with icon and text */}
        <div className="mcp-config-toast-header">
          <div className="mcp-config-toast-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
          </div>
          <div className="mcp-config-toast-header-text">
            <div className="mcp-config-toast-title">
              MCP Servers Updated
            </div>
            <div className="mcp-config-toast-subtitle">
              {scopeText} MCP server configuration has changed. New Claude Code sessions will use the updated servers.
            </div>
          </div>
        </div>

        {/* Info note */}
        <div className="mcp-config-toast-note">
          Active sessions continue with their current servers. Start a new session to use the updated configuration.
        </div>
      </div>
    </div>
  );
}
