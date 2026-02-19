import React, { useState, useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { usePostHog } from 'posthog-js/react';
import {
  advancedSettingsAtom,
  setAdvancedSettingsAtom,
  resetWalkthroughsAtom,
  aiDebugSettingsAtom,
  setAIDebugSettingsAtom,
  developerFeatureSettingsAtom,
  setDeveloperFeatureSettingsAtom,
  customPathDirsAtom,
  externalEditorSettingsAtom,
  setExternalEditorSettingsAtom,
  EXTERNAL_EDITOR_NAMES,
  DEVELOPER_FEATURES,
  areAllDeveloperFeaturesEnabled,
  enableAllDeveloperFeatures,
  disableAllDeveloperFeatures,
  type ReleaseChannel,
  type ExternalEditorType,
} from '../../../store/atoms/appSettings';
import { ALPHA_FEATURES, areAllAlphaFeaturesEnabled, enableAllAlphaFeatures as enableAllAlphaFeaturesUtil, disableAllAlphaFeatures } from '../../../../shared/alphaFeatures';

/**
 * AdvancedPanel - Self-contained settings panel for advanced options.
 *
 * All settings subscribe directly to Jotai atoms or load via IPC.
 * Developer mode is a global app setting.
 */
export function AdvancedPanel() {
  const posthog = usePostHog();
  // App-level advanced settings from Jotai atoms
  const [settings] = useAtom(advancedSettingsAtom);
  const [, updateSettings] = useAtom(setAdvancedSettingsAtom);
  const [, resetWalkthroughs] = useAtom(resetWalkthroughsAtom);

  // Current enhanced PATH (fetched from main process)
  const [enhancedPath, setEnhancedPath] = useState<string>('');
  const [showEnhancedPath, setShowEnhancedPath] = useState(false);

  // AI debug settings from Jotai atoms
  const [aiDebugSettings] = useAtom(aiDebugSettingsAtom);
  const [, updateAIDebugSettings] = useAtom(setAIDebugSettingsAtom);
  const { showToolCalls, aiDebugLogging, showPromptAdditions } = aiDebugSettings;

  // Developer feature settings from Jotai atoms
  const [developerSettings] = useAtom(developerFeatureSettingsAtom);
  const [, updateDeveloperSettings] = useAtom(setDeveloperFeatureSettingsAtom);
  const { developerMode, developerFeatures } = developerSettings;

  // External editor settings from Jotai atoms
  const [externalEditorSettings] = useAtom(externalEditorSettingsAtom);
  const [, updateExternalEditorSettings] = useAtom(setExternalEditorSettingsAtom);
  const { editorType: externalEditorType, customPath: externalEditorCustomPath } = externalEditorSettings;

  // Handle developer mode change
  const handleDeveloperModeChange = async (enabled: boolean) => {
    updateDeveloperSettings({ developerMode: enabled });

    // Track mode change in PostHog
    if (posthog) {
      posthog.capture('developer_mode_changed', {
        developer_mode: enabled,
        source: 'settings',
        is_initial: false,
      });

      // Update person property
      posthog.people.set({ developer_mode: enabled });
    }
  };

  const {
    releaseChannel,
    analyticsEnabled,
    extensionDevToolsEnabled,
    walkthroughsEnabled,
    walkthroughsViewedCount,
    walkthroughsTotalCount,
    maxHeapSizeMB,
    alphaFeatures,
    enableAllAlphaFeatures,
    customPathDirs,
    historyMaxAgeDays,
    historyMaxSnapshots,
  } = settings;
  const isDevelopment = import.meta.env.DEV;
  const [showReleaseChannel, setShowReleaseChannel] = useState(false);
  const [showFeaturesMenu, setShowFeaturesMenu] = useState(false);

  // Fetch enhanced PATH when user clicks to show it
  useEffect(() => {
    if (showEnhancedPath && !enhancedPath) {
      window.electronAPI.environment.getEnhancedPath().then(setEnhancedPath);
    }
  }, [showEnhancedPath, enhancedPath]);

  // Refresh enhanced PATH when custom paths change
  useEffect(() => {
    if (showEnhancedPath) {
      window.electronAPI.environment.getEnhancedPath().then(setEnhancedPath);
    }
  }, [customPathDirs, showEnhancedPath]);

  const handleTitleClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      setShowReleaseChannel(true);
    }
  };

  const handleModeClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      setShowFeaturesMenu(prev => !prev);
    }
  };

  return (
    <div className="provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3
          className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)] cursor-pointer"
          onClick={handleTitleClick}
          title="Command/Ctrl-click to reveal release channel options"
        >
          Advanced Settings
        </h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          Advanced configuration options for AI features.
        </p>
      </div>

      {/* Application Mode - Always shown at the top */}
      <div className="provider-panel-section">
          <h4 className="provider-panel-section-title" onClick={handleModeClick}>Application Mode</h4>
          <p className="provider-panel-hint">
            Choose between a simplified experience or full developer features for this project.
          </p>

          <div className="mode-selection" style={{ display: 'flex', flexDirection: 'row', gap: '16px', marginTop: '12px' }}>
            <label
              className={`mode-option ${!developerMode ? 'selected' : ''}`}
              onClick={() => handleDeveloperModeChange(false)}
              style={{
                display: 'flex',
                flex: 1,
                alignItems: 'flex-start',
                padding: 0,
                background: !developerMode ? 'var(--surface-hover)' : 'var(--surface-secondary)',
                border: `2px solid ${!developerMode ? 'var(--primary-color)' : 'var(--border-primary)'}`,
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                position: 'relative',
                boxShadow: !developerMode ? '0 0 0 3px rgba(88, 166, 255, 0.15)' : 'none',
              }}
            >
              <input
                type="radio"
                name="mode"
                checked={!developerMode}
                onChange={() => handleDeveloperModeChange(false)}
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  margin: 0,
                  cursor: 'pointer',
                  width: '18px',
                  height: '18px',
                  accentColor: 'var(--primary-color)',
                }}
              />
              <div style={{
                padding: '16px',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
              }}>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px',
                }}>
                  <span className="material-symbols-outlined" style={{
                    fontSize: '32px',
                    color: 'var(--primary-color)',
                  }}>
                    edit_note
                  </span>
                  <span style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                  }}>Standard Mode</span>
                </div>
                <p style={{
                  margin: 0,
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.4,
                }}>
                  Simplified interface focused on writing, editing, and AI assistance
                </p>
              </div>
            </label>

            <label
              className={`mode-option ${developerMode ? 'selected' : ''}`}
              onClick={() => handleDeveloperModeChange(true)}
              style={{
                display: 'flex',
                flex: 1,
                alignItems: 'flex-start',
                padding: 0,
                background: developerMode ? 'var(--surface-hover)' : 'var(--surface-secondary)',
                border: `2px solid ${developerMode ? 'var(--primary-color)' : 'var(--border-primary)'}`,
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                position: 'relative',
                boxShadow: developerMode ? '0 0 0 3px rgba(88, 166, 255, 0.15)' : 'none',
              }}
            >
              <input
                type="radio"
                name="mode"
                checked={developerMode}
                onChange={() => handleDeveloperModeChange(true)}
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  margin: 0,
                  cursor: 'pointer',
                  width: '18px',
                  height: '18px',
                  accentColor: 'var(--primary-color)',
                }}
              />
              <div style={{
                padding: '16px',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
              }}>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px',
                }}>
                  <span className="material-symbols-outlined" style={{
                    fontSize: '32px',
                    color: 'var(--primary-color)',
                  }}>
                    terminal
                  </span>
                  <span style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                  }}>Developer Mode</span>
                </div>
                <p style={{
                  margin: 0,
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.4,
                }}>
                  Full development environment with git worktrees, terminal access, development specific features
                </p>
              </div>
            </label>
          </div>
        </div>

      {/* Secret Features Menu - Cmd+Click on "Application Mode" title to show */}
      {showFeaturesMenu && (
        <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
          <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">
            Feature Availability
          </h4>
          <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
            See which features are available based on your current mode settings.
          </p>

          {/* Developer Features */}
          <div className="mt-4 p-3 bg-nim-secondary rounded-md border border-nim">
            {/* "All Developer Features" master toggle */}
            <div className="setting-item mb-3 pb-3 border-b border-nim">
              <label className="setting-label">
                <input
                  type="checkbox"
                  checked={areAllDeveloperFeaturesEnabled(developerFeatures)}
                  onChange={(e) => {
                    const newFeatures = e.target.checked ? enableAllDeveloperFeatures() : disableAllDeveloperFeatures();
                    updateDeveloperSettings({ developerFeatures: newFeatures });
                  }}
                  disabled={!developerMode}
                  className="setting-checkbox"
                />
                <div className="setting-text">
                  <span className="setting-name">All Developer Features</span>
                  <span className="setting-description">
                    Enable or disable all developer features at once
                  </span>
                </div>
              </label>
            </div>

            {/* Individual developer feature toggles */}
            {DEVELOPER_FEATURES.map((feature) => {
              const isAvailable = developerMode && developerFeatures[feature.tag];
              return (
                <div key={feature.tag} className="setting-item py-2">
                  <label className="setting-label">
                    <input
                      type="checkbox"
                      checked={developerFeatures[feature.tag]}
                      onChange={(e) => {
                        updateDeveloperSettings({
                          developerFeatures: {
                            ...developerFeatures,
                            [feature.tag]: e.target.checked,
                          },
                        });
                      }}
                      disabled={!developerMode}
                      className="setting-checkbox"
                    />
                    <div className="setting-text">
                      <span className="setting-name flex items-center gap-2">
                        {feature.icon && (
                          <span className="material-symbols-outlined text-sm">{feature.icon}</span>
                        )}
                        {feature.name}
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            isAvailable
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {isAvailable ? 'Available' : 'Hidden'}
                        </span>
                      </span>
                      <span className="setting-description">{feature.description}</span>
                    </div>
                  </label>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-[var(--nim-text-faint)] mt-3">
            Developer mode: {developerMode ? 'ON' : 'OFF'}
          </p>
        </div>
      )}

      {showReleaseChannel && (
        <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
          <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Release Channel</h4>
          <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
            Choose which release channel to receive updates from.
          </p>

          <div className="setting-item py-3">
            <div className="setting-text flex flex-col gap-0.5">
              <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Update Channel</span>
              <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                <strong>Stable:</strong> Production-ready releases from GitHub (recommended for most users).<br/>
                <strong>Alpha:</strong> Early access to new features for internal testing. May be unstable.
              </span>
            </div>
            <select
              value={releaseChannel}
              onChange={(e) => {
                const newChannel = e.target.value as ReleaseChannel;
                if (newChannel === 'alpha') {
                  // Auto-enable all alpha features when switching to alpha channel
                  updateSettings({
                    releaseChannel: newChannel,
                    enableAllAlphaFeatures: true,
                    alphaFeatures: enableAllAlphaFeaturesUtil(),
                  });
                  posthog?.capture('alpha_feature_toggled', {
                    feature_tag: 'all',
                    enabled: true,
                    source: 'channel_switch',
                  });
                } else {
                  // Disable all alpha features when switching back to stable
                  updateSettings({
                    releaseChannel: newChannel,
                    enableAllAlphaFeatures: false,
                    alphaFeatures: disableAllAlphaFeatures(),
                  });
                  posthog?.capture('alpha_feature_toggled', {
                    feature_tag: 'all',
                    enabled: false,
                    source: 'channel_switch',
                  });
                }
              }}
              className="setting-select mt-2 w-full py-2 px-3 pr-9 rounded-md text-sm bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M3%204.5L6%207.5L9%204.5%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center] focus:border-[var(--nim-primary)]"
            >
              <option value="stable">Stable</option>
              <option value="alpha">Alpha (Internal Testing)</option>
            </select>
          </div>

          {releaseChannel === 'alpha' && (
            <>
              <div className="mt-4 p-3 bg-nim-secondary rounded-md border border-nim">
                {/* "All Alpha Features" master toggle */}
                <div className="setting-item mb-3 pb-3 border-b border-nim">
                  <label className="setting-label">
                    <input
                      type="checkbox"
                      checked={enableAllAlphaFeatures}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        const newFeatures = enabled ? enableAllAlphaFeaturesUtil() : disableAllAlphaFeatures();
                        updateSettings({
                          enableAllAlphaFeatures: enabled,
                          alphaFeatures: newFeatures
                        });
                        posthog?.capture('alpha_feature_toggled', {
                          feature_tag: 'all',
                          enabled,
                          source: 'toggle',
                        });
                      }}
                      className="setting-checkbox"
                    />
                    <div className="setting-text">
                      <span className="setting-name">Enable All Alpha Features</span>
                      <span className="setting-description">
                        Automatically enable all current and future alpha features. Individual features can still be toggled below.
                      </span>
                    </div>
                  </label>
                </div>

                {ALPHA_FEATURES.map((feature) => (
                  <div
                    key={feature.tag}
                    className={`setting-item ${enableAllAlphaFeatures ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    <label className="setting-label">
                      <input
                        type="checkbox"
                        checked={alphaFeatures[feature.tag] ?? false}
                        onChange={(e) => {
                        updateSettings({ alphaFeatures: { ...alphaFeatures, [feature.tag]: e.target.checked } });
                        posthog?.capture('alpha_feature_toggled', {
                          feature_tag: feature.tag,
                          enabled: e.target.checked,
                          source: 'toggle',
                        });
                      }}
                        className="setting-checkbox"
                        disabled={enableAllAlphaFeatures}
                      />
                      <div className="setting-text">
                        <span className="setting-name">{feature.name}</span>
                        <span className="setting-description">
                          {feature.description}
                        </span>
                      </div>
                    </label>
                  </div>
                ))}
              </div>

              <p className="mt-3 p-2 text-[13px] text-nim-error bg-nim-secondary rounded border border-nim">
                You may need to restart Nimbalyst for these changes to take effect.
              </p>
            </>
          )}
        </div>
      )}

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Privacy</h4>
        <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
          Control how Nimbalyst collects anonymous usage data.
        </p>

        <div className="setting-item py-3">
          <label className="setting-label flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={analyticsEnabled}
              onChange={(e) => updateSettings({ analyticsEnabled: e.target.checked })}
              className="setting-checkbox w-4 h-4 mt-0.5 cursor-pointer shrink-0 accent-[var(--nim-primary)]"
            />
            <div className="setting-text flex flex-col gap-0.5">
              <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Send Anonymous Usage Data</span>
              <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                Help improve Nimbalyst by sending anonymous usage data. No prompts, content, or personal information is ever collected.
              </span>
            </div>
          </label>
        </div>
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Feature Guides</h4>
        <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
          Contextual guides that help you discover features.
          {walkthroughsTotalCount > 0 && (
            <span className="ml-2 text-[var(--nim-text-faint)]">
              ({walkthroughsViewedCount} of {walkthroughsTotalCount} viewed)
            </span>
          )}
        </p>

        <div className="setting-item py-3">
          <label className="setting-label flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={walkthroughsEnabled}
              onChange={(e) => updateSettings({ walkthroughsEnabled: e.target.checked })}
              className="setting-checkbox w-4 h-4 mt-0.5 cursor-pointer shrink-0 accent-[var(--nim-primary)]"
            />
            <div className="setting-text flex flex-col gap-0.5">
              <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Show Feature Guides</span>
              <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                Display walkthrough guides for new features and tips to help you get the most out of Nimbalyst.
              </span>
            </div>
          </label>
        </div>

        {walkthroughsViewedCount > 0 && (
          <div className="setting-item py-3 flex items-center gap-3">
            <button onClick={() => resetWalkthroughs()} className="nim-btn-secondary text-sm">
              Reset All Guides
            </button>
            <span className="text-[13px] text-[var(--nim-text-faint)]">
              Show all guides again from the beginning
            </span>
          </div>
        )}
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">External Editor</h4>
        <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
          Configure a preferred external editor to open files from the file tree context menu.
        </p>

        <div className="setting-item py-3">
          <div className="setting-text flex flex-col gap-0.5">
            <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Preferred Editor</span>
            <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
              Select an external editor for the "Open in..." context menu option.
            </span>
          </div>
          <select
            value={externalEditorType}
            onChange={(e) => updateExternalEditorSettings({ editorType: e.target.value as ExternalEditorType })}
            className="setting-select mt-2 w-full py-2 px-3 pr-9 rounded-md text-sm bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M3%204.5L6%207.5L9%204.5%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center] focus:border-[var(--nim-primary)]"
          >
            <option value="none">None</option>
            <option value="vscode">VS Code</option>
            <option value="cursor">Cursor</option>
            <option value="webstorm">WebStorm</option>
            <option value="sublime">Sublime Text</option>
            <option value="vim">Vim (opens in Terminal)</option>
            <option value="nvim">Neovim (opens in Terminal)</option>
            <option value="custom">Custom...</option>
          </select>
        </div>

        {externalEditorType === 'custom' && (
          <div className="setting-item py-3">
            <div className="setting-text flex flex-col gap-0.5 mb-2">
              <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Custom Editor Command</span>
              <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                Enter the command or path to your preferred editor executable.
                The file path will be passed as the first argument.
              </span>
            </div>
            <input
              type="text"
              value={externalEditorCustomPath || ''}
              onChange={(e) => updateExternalEditorSettings({ customPath: e.target.value })}
              placeholder={process.platform === 'win32' ? 'C:\\Program Files\\Editor\\editor.exe' : '/usr/local/bin/myeditor'}
              className="w-full py-2 px-3 rounded-md text-sm bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none focus:border-[var(--nim-primary)] font-mono"
            />
          </div>
        )}
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Extension Development</h4>
        <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
          Tools for building and testing Nimbalyst extensions.
        </p>

        <div className="setting-item py-3">
          <label className="setting-label flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={extensionDevToolsEnabled}
              onChange={(e) => updateSettings({ extensionDevToolsEnabled: e.target.checked })}
              className="setting-checkbox w-4 h-4 mt-0.5 cursor-pointer shrink-0 accent-[var(--nim-primary)]"
            />
            <div className="setting-text flex flex-col gap-0.5">
              <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Enable Extension Dev Tools</span>
              <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                Enables MCP tools for building, installing, and hot-reloading extensions during development.
                When enabled, Claude Code can use extension_build, extension_install, extension_reload, and
                extension_uninstall tools to develop extensions in real-time.
              </span>
            </div>
          </label>
        </div>
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Memory</h4>
        <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
          Configure memory limits for the application.
        </p>

        <div className="setting-item py-3">
          <div className="setting-text flex flex-col gap-0.5">
            <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Maximum Heap Size (MB)</span>
            <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
              V8 JavaScript heap memory limit. Increase if you experience out-of-memory crashes
              with large AI sessions. Default is 4096 MB (4 GB). Requires restart to take effect.
            </span>
          </div>
          <select
            value={maxHeapSizeMB}
            onChange={(e) => updateSettings({ maxHeapSizeMB: parseInt(e.target.value, 10) })}
            className="setting-select mt-2 w-full py-2 px-3 pr-9 rounded-md text-sm bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M3%204.5L6%207.5L9%204.5%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center] focus:border-[var(--nim-primary)]"
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

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Document History</h4>
        <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
          Configure how long file history snapshots are retained. Older snapshots are cleaned up on app startup.
        </p>

        <div className="setting-item py-3">
          <div className="setting-text flex flex-col gap-0.5">
            <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Retention Period</span>
            <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
              Maximum age of history snapshots before they are automatically deleted.
            </span>
          </div>
          <select
            value={historyMaxAgeDays}
            onChange={(e) => updateSettings({ historyMaxAgeDays: parseInt(e.target.value, 10) })}
            className="setting-select mt-2 w-full py-2 px-3 pr-9 rounded-md text-sm bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M3%204.5L6%207.5L9%204.5%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center] focus:border-[var(--nim-primary)]"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days (Default)</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>1 year</option>
          </select>
        </div>

        <div className="setting-item py-3">
          <div className="setting-text flex flex-col gap-0.5">
            <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Max Snapshots Per File</span>
            <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
              Maximum number of history snapshots kept per file. Oldest snapshots beyond this limit are deleted.
            </span>
          </div>
          <select
            value={historyMaxSnapshots}
            onChange={(e) => updateSettings({ historyMaxSnapshots: parseInt(e.target.value, 10) })}
            className="setting-select mt-2 w-full py-2 px-3 pr-9 rounded-md text-sm bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M3%204.5L6%207.5L9%204.5%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center] focus:border-[var(--nim-primary)]"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250 (Default)</option>
            <option value={500}>500</option>
            <option value={1000}>1,000</option>
          </select>
        </div>

        <p className="text-xs text-[var(--nim-text-faint)] mt-2">
          Changes take effect on next app restart when cleanup runs.
        </p>
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Environment</h4>
        <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
          Configure environment variables for AI tools and CLI commands.
        </p>

        <div className="setting-item py-3">
          <div className="setting-text flex flex-col gap-0.5 mb-2">
            <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Custom PATH Directories</span>
            <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
              Additional directories to add to the PATH environment variable for MCP server installation, CLI tool detection, and agent SDK operations.
              {process.platform === 'win32'
                ? ' Separate multiple directories with semicolons (;). Example: C:\\MyTools;C:\\Programs\\bin'
                : ' Separate multiple directories with colons (:). Example: /opt/mytools/bin:/usr/local/custom/bin'}
            </span>
          </div>
          <textarea
            value={customPathDirs}
            onChange={(e) => updateSettings({ customPathDirs: e.target.value })}
            placeholder={process.platform === 'win32'
              ? 'C:\\MyTools;C:\\Programs\\bin'
              : '/opt/mytools/bin:/usr/local/custom/bin'}
            rows={3}
            className="w-full py-2 px-3 rounded-md text-sm bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none focus:border-[var(--nim-primary)] font-mono resize-none"
            style={{
              minHeight: '60px',
              lineHeight: '1.5',
            }}
          />
          <div className="mt-2 space-y-1">
            <p className="text-xs text-[var(--nim-text-faint)]">
              Changes take effect immediately for new sessions. These paths are added with highest priority.
            </p>
            <p className="text-xs text-[var(--nim-text-faint)]">
              <strong>What uses this PATH:</strong> MCP server spawning (uvx, npx), Claude Code CLI detection, npm package installation.
            </p>
            <p className="text-xs text-[var(--nim-text-faint)]">
              <strong>What doesn't use this:</strong> Claude Code's Bash tool commands (those use your shell's PATH).
            </p>
          </div>

          {/* Show current PATH toggle */}
          <div className="mt-4">
            <button
              onClick={() => setShowEnhancedPath(!showEnhancedPath)}
              className="text-xs text-[var(--nim-link)] hover:text-[var(--nim-link-hover)] cursor-pointer"
            >
              {showEnhancedPath ? 'Hide current PATH' : 'Show current PATH'}
            </button>

            {showEnhancedPath && enhancedPath && (
              <div className="mt-2">
                <div className="text-xs text-[var(--nim-text-muted)] mb-1">
                  Current PATH used by Nimbalyst:
                </div>
                <div
                  className="p-2 rounded-md text-xs bg-[var(--nim-bg-tertiary)] border border-[var(--nim-border)] text-[var(--nim-text-muted)] font-mono overflow-x-auto"
                  style={{
                    maxHeight: '200px',
                    overflowY: 'auto',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {enhancedPath.split(process.platform === 'win32' ? ';' : ':').map((path, index) => (
                    <div key={index} className="py-0.5">
                      {path}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isDevelopment ? (
        <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
          <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Developer Options</h4>
          <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
            These options are only available in development mode.
          </p>

          <div className="setting-item py-3">
            <label className="setting-label flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={showToolCalls}
                onChange={(e) => updateAIDebugSettings({ showToolCalls: e.target.checked })}
                className="setting-checkbox w-4 h-4 mt-0.5 cursor-pointer shrink-0 accent-[var(--nim-primary)]"
              />
              <div className="setting-text flex flex-col gap-0.5">
                <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Show All Tool Calls</span>
                <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                  Display all MCP tool calls in the AI chat sidebar, including Edit/applyDiff calls.
                  When disabled, edit operations are shown without the underlying tool call details to reduce clutter.
                  Useful for debugging and understanding exactly what tools the AI is using.
                </span>
              </div>
            </label>
          </div>

          <div className="setting-item py-3">
            <label className="setting-label flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={aiDebugLogging}
                onChange={(e) => updateAIDebugSettings({ aiDebugLogging: e.target.checked })}
                className="setting-checkbox w-4 h-4 mt-0.5 cursor-pointer shrink-0 accent-[var(--nim-primary)]"
              />
              <div className="setting-text flex flex-col gap-0.5">
                <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Enable AI Debug Logging</span>
                <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                  Capture detailed logs of all AI editing operations including LLM requests/responses,
                  diff applications, and streaming operations. Logs are saved per session in your
                  application support directory for troubleshooting integration issues.
                </span>
              </div>
            </label>
          </div>

          <div className="setting-item py-3">
            <label className="setting-label flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={showPromptAdditions}
                onChange={(e) => updateAIDebugSettings({ showPromptAdditions: e.target.checked })}
                className="setting-checkbox w-4 h-4 mt-0.5 cursor-pointer shrink-0 accent-[var(--nim-primary)]"
              />
              <div className="setting-text flex flex-col gap-0.5">
                <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Show Prompt Additions</span>
                <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                  Display system prompt additions and user message context that Nimbalyst appends
                  to Claude Code requests. Shows as collapsible sections in the AI chat transcript.
                  Useful for debugging prompt engineering and understanding what context is being sent.
                </span>
              </div>
            </label>
          </div>
        </div>
      ) : (
        <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
          <p className="text-sm leading-relaxed text-[var(--nim-text-muted)]">
            Advanced settings are only available in development mode.
          </p>
        </div>
      )}
    </div>
  );
}
