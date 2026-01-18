import React, { useState } from 'react';
import { useAtom } from 'jotai';
import {
  advancedSettingsAtom,
  setAdvancedSettingsAtom,
  resetWalkthroughsAtom,
  aiDebugSettingsAtom,
  setAIDebugSettingsAtom,
  type ReleaseChannel,
} from '../../../store/atoms/appSettings';

/**
 * AdvancedPanel - Self-contained settings panel for advanced options.
 *
 * All settings subscribe directly to Jotai atoms - no props needed.
 */
export function AdvancedPanel() {
  // App-level advanced settings from Jotai atoms
  const [settings] = useAtom(advancedSettingsAtom);
  const [, updateSettings] = useAtom(setAdvancedSettingsAtom);
  const [, resetWalkthroughs] = useAtom(resetWalkthroughsAtom);

  // AI debug settings from Jotai atoms
  const [aiDebugSettings] = useAtom(aiDebugSettingsAtom);
  const [, updateAIDebugSettings] = useAtom(setAIDebugSettingsAtom);
  const { showToolCalls, aiDebugLogging } = aiDebugSettings;

  const {
    releaseChannel,
    analyticsEnabled,
    extensionDevToolsEnabled,
    walkthroughsEnabled,
    walkthroughsViewedCount,
    walkthroughsTotalCount,
    maxHeapSizeMB,
  } = settings;
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
              onChange={(e) => updateSettings({ releaseChannel: e.target.value as ReleaseChannel })}
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
              onChange={(e) => updateSettings({ analyticsEnabled: e.target.checked })}
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
        <h4 className="provider-panel-section-title">Feature Guides</h4>
        <p className="provider-panel-hint">
          Contextual guides that help you discover features.
          {walkthroughsTotalCount > 0 && (
            <span style={{ marginLeft: '8px', color: 'var(--text-tertiary)' }}>
              ({walkthroughsViewedCount} of {walkthroughsTotalCount} viewed)
            </span>
          )}
        </p>

        <div className="setting-item">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={walkthroughsEnabled}
              onChange={(e) => updateSettings({ walkthroughsEnabled: e.target.checked })}
              className="setting-checkbox"
            />
            <div className="setting-text">
              <span className="setting-name">Show Feature Guides</span>
              <span className="setting-description">
                Display walkthrough guides for new features and tips to help you get the most out of Nimbalyst.
              </span>
            </div>
          </label>
        </div>

        {walkthroughsViewedCount > 0 && (
          <div className="setting-item" style={{ marginTop: '12px' }}>
            <button
              onClick={() => resetWalkthroughs()}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                background: 'var(--surface-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Reset All Guides
            </button>
            <span style={{ marginLeft: '12px', fontSize: '13px', color: 'var(--text-tertiary)' }}>
              Show all guides again from the beginning
            </span>
          </div>
        )}
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
              onChange={(e) => updateSettings({ extensionDevToolsEnabled: e.target.checked })}
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

      <div className="provider-panel-section">
        <h4 className="provider-panel-section-title">Memory</h4>
        <p className="provider-panel-hint">
          Configure memory limits for the application.
        </p>

        <div className="setting-item">
          <div className="setting-text">
            <span className="setting-name">Maximum Heap Size (MB)</span>
            <span className="setting-description">
              V8 JavaScript heap memory limit. Increase if you experience out-of-memory crashes
              with large AI sessions. Default is 4096 MB (4 GB). Requires restart to take effect.
            </span>
          </div>
          <select
            value={maxHeapSizeMB}
            onChange={(e) => updateSettings({ maxHeapSizeMB: parseInt(e.target.value, 10) })}
            className="setting-select"
            style={{ marginTop: '8px', width: '100%', padding: '8px', borderRadius: '4px' }}
          >
            <option value={2048}>2 GB</option>
            <option value={4096}>4 GB (Default)</option>
            <option value={6144}>6 GB</option>
            <option value={8192}>8 GB</option>
            <option value={12288}>12 GB</option>
            <option value={16384}>16 GB</option>
          </select>
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
                onChange={(e) => updateAIDebugSettings({ showToolCalls: e.target.checked })}
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
                onChange={(e) => updateAIDebugSettings({ aiDebugLogging: e.target.checked })}
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
