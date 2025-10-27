import React from 'react';

interface AdvancedPanelProps {
  showToolCalls: boolean;
  onShowToolCallsChange: (value: boolean) => void;
}

export function AdvancedPanel({
  showToolCalls,
  onShowToolCallsChange
}: AdvancedPanelProps) {
  const isDevelopment = import.meta.env.DEV;

  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">Advanced Settings</h3>
        <p className="provider-panel-description">
          Advanced configuration options for AI features.
        </p>
      </div>

      {isDevelopment ? (
        <div className="provider-panel-section">
          <h4 className="provider-panel-section-title">Developer Options</h4>
          <p className="provider-panel-hint">
            These options are only available in development mode.
          </p>

          <div className="setting-item">
            <label className="setting-label">
              <input
                type="checkbox"
                checked={showToolCalls}
                onChange={(e) => onShowToolCallsChange(e.target.checked)}
                className="setting-checkbox"
              />
              <div className="setting-text">
                <span className="setting-name">Show All Tool Calls</span>
                <span className="setting-description">
                  Display all MCP tool calls in the AI chat sidebar, including Edit/applyDiff calls.
                  When disabled, edit operations are shown without the underlying tool call details to reduce clutter.
                  Useful for debugging and understanding exactly what tools the AI is using.
                </span>
              </div>
            </label>
          </div>
        </div>
      ) : (
        <div className="provider-panel-section">
          <p className="provider-panel-hint">
            Advanced settings are only available in development mode.
          </p>
        </div>
      )}
    </div>
  );
}
