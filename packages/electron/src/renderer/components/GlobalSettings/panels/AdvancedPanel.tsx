import React, { useState, useEffect } from 'react';

interface AdvancedPanelProps {
  showToolCalls: boolean;
  onShowToolCallsChange: (value: boolean) => void;
  aiDebugLogging: boolean;
  onAiDebugLoggingChange: (value: boolean) => void;
  releaseChannel: 'stable' | 'alpha';
  onReleaseChannelChange: (value: 'stable' | 'alpha') => void;
  analyticsEnabled: boolean;
  onAnalyticsEnabledChange: (value: boolean) => void;
  extensionDevToolsEnabled: boolean;
  onExtensionDevToolsEnabledChange: (value: boolean) => void;
}

export function AdvancedPanel({
  showToolCalls,
  onShowToolCallsChange,
  aiDebugLogging,
  onAiDebugLoggingChange,
  releaseChannel,
  onReleaseChannelChange,
  analyticsEnabled,
  onAnalyticsEnabledChange,
  extensionDevToolsEnabled,
  onExtensionDevToolsEnabledChange
}: AdvancedPanelProps) {
  const isDevelopment = import.meta.env.DEV;
  const [showReleaseChannel, setShowReleaseChannel] = useState(false);

  const handleTitleClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      setShowReleaseChannel(true);
    }
  };

  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3
          className="provider-panel-title"
          onClick={handleTitleClick}
          style={{ cursor: 'pointer' }}
          title="Command/Ctrl-click to reveal release channel options"
        >
          Advanced Settings
        </h3>
        <p className="provider-panel-description">
          Advanced configuration options for AI features.
        </p>
      </div>

      {showReleaseChannel && (
        <div className="provider-panel-section">
          <h4 className="provider-panel-section-title">Release Channel</h4>
          <p className="provider-panel-hint">
            Choose which release channel to receive updates from.
          </p>

          <div className="setting-item">
            <div className="setting-text">
              <span className="setting-name">Update Channel</span>
              <span className="setting-description">
                <strong>Stable:</strong> Production-ready releases from GitHub (recommended for most users).<br/>
                <strong>Alpha:</strong> Early access to new features for internal testing. May be unstable.
              </span>
            </div>
            <select
              value={releaseChannel}
              onChange={(e) => onReleaseChannelChange(e.target.value as 'stable' | 'alpha')}
              className="setting-select"
              style={{ marginTop: '8px', width: '100%', padding: '8px', borderRadius: '4px' }}
            >
              <option value="stable">Stable</option>
              <option value="alpha">Alpha (Internal Testing)</option>
            </select>
          </div>
        </div>
      )}

      <div className="provider-panel-section">
        <h4 className="provider-panel-section-title">Privacy</h4>
        <p className="provider-panel-hint">
          Control how Nimbalyst collects anonymous usage data.
        </p>

        <div className="setting-item">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={analyticsEnabled}
              onChange={(e) => onAnalyticsEnabledChange(e.target.checked)}
              className="setting-checkbox"
            />
            <div className="setting-text">
              <span className="setting-name">Send Anonymous Usage Data</span>
              <span className="setting-description">
                Help improve Nimbalyst by sending anonymous usage data. No prompts, content, or personal information is ever collected.
              </span>
            </div>
          </label>
        </div>
      </div>

      <div className="provider-panel-section">
        <h4 className="provider-panel-section-title">Extension Development</h4>
        <p className="provider-panel-hint">
          Tools for building and testing Nimbalyst extensions.
        </p>

        <div className="setting-item">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={extensionDevToolsEnabled}
              onChange={(e) => onExtensionDevToolsEnabledChange(e.target.checked)}
              className="setting-checkbox"
            />
            <div className="setting-text">
              <span className="setting-name">Enable Extension Dev Tools</span>
              <span className="setting-description">
                Enables MCP tools for building, installing, and hot-reloading extensions during development.
                When enabled, Claude Code can use extension_build, extension_install, extension_reload, and
                extension_uninstall tools to develop extensions in real-time.
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
