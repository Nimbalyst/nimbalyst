import React from 'react';

interface AdvancedPanelProps {
  showToolCalls: boolean;
  onShowToolCallsChange: (value: boolean) => void;
  aiDebugLogging: boolean;
  onAiDebugLoggingChange: (value: boolean) => void;
  diffViewEnabled: boolean;
  onDiffViewEnabledChange: (value: boolean) => void;
}

export function AdvancedPanel({
  showToolCalls,
  onShowToolCallsChange,
  aiDebugLogging,
  onAiDebugLoggingChange,
  diffViewEnabled,
  onDiffViewEnabledChange
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

      <div className="provider-panel-section">
        <h4 className="provider-panel-section-title">AI Editing</h4>

        <div className="setting-item">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={diffViewEnabled}
              onChange={(e) => onDiffViewEnabledChange(e.target.checked)}
              className="setting-checkbox"
            />
            <div className="setting-text">
              <span className="setting-name">Enable Diff View (alpha)</span>
              <span className="setting-description">
                Show a diff view with Accept/Reject buttons when AI makes changes to documents.
                When disabled, AI changes are applied directly to the editor without review prompts.
              </span>
            </div>
          </label>
        </div>
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

          <div className="setting-item">
            <label className="setting-label">
              <input
                type="checkbox"
                checked={aiDebugLogging}
                onChange={(e) => onAiDebugLoggingChange(e.target.checked)}
                className="setting-checkbox"
              />
              <div className="setting-text">
                <span className="setting-name">Enable AI Debug Logging</span>
                <span className="setting-description">
                  Capture detailed logs of all AI editing operations including LLM requests/responses,
                  diff applications, and streaming operations. Logs are saved per session in your
                  application support directory for troubleshooting integration issues.
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
