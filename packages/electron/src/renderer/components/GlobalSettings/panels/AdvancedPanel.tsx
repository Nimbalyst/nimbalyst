import React, { useState, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { usePostHog } from 'posthog-js/react';
import { SettingsToggle } from '../SettingsToggle';
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
  type PreferredTerminalShell,
} from '../../../store/atoms/appSettings';
import { ALPHA_FEATURES, areAllAlphaFeaturesEnabled, enableAllAlphaFeatures as enableAllAlphaFeaturesUtil, disableAllAlphaFeatures } from '../../../../shared/alphaFeatures';
import {
  autoCommitEnabledAtom,
  setAutoCommitEnabledAtom,
} from '../../../store/atoms/autoCommitAtoms';

/** Reusable compact dropdown row */
function DropdownRow({
  value,
  onChange,
  name,
  description,
  options,
}: {
  value: string | number;
  onChange: (value: string) => void;
  name: string;
  description: string;
  options: { value: string | number; label: string }[];
}) {
  return (
    <div className="setting-item py-2">
      <div className="flex items-center justify-between gap-4">
        <div className="setting-text flex flex-col gap-0 min-w-0">
          <span className="setting-name text-sm font-medium text-[var(--nim-text)]">{name}</span>
          <span className="setting-description text-xs leading-snug text-[var(--nim-text-muted)]">
            {description}
          </span>
        </div>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="setting-select shrink-0 py-1.5 px-2 pr-7 rounded-md text-sm bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M3%204.5L6%207.5L9%204.5%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_8px_center] focus:border-[var(--nim-primary)]"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

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
  const [availableTerminalShells, setAvailableTerminalShells] = useState<Array<{
    name: string;
    path: string;
    provider?: string;
    bootstrapMode?: 'zsh' | 'bash' | 'powershell' | 'none';
    cwdMode?: 'native' | 'wsl';
  }>>([]);

  // AI debug settings from Jotai atoms
  const [aiDebugSettings] = useAtom(aiDebugSettingsAtom);
  const [, updateAIDebugSettings] = useAtom(setAIDebugSettingsAtom);
  const { showToolCalls, aiDebugLogging, showPromptAdditions } = aiDebugSettings;

  // Developer feature settings from Jotai atoms
  const [developerSettings] = useAtom(developerFeatureSettingsAtom);
  const [, updateDeveloperSettings] = useAtom(setDeveloperFeatureSettingsAtom);
  const { developerMode, developerFeatures } = developerSettings;

  // Auto-commit setting
  const autoCommitEnabled = useAtomValue(autoCommitEnabledAtom);
  const setAutoCommitEnabled = useSetAtom(setAutoCommitEnabledAtom);

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
    spellcheckEnabled,
    historyMaxAgeDays,
    historyMaxSnapshots,
    preferredTerminalShell,
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

  useEffect(() => {
    if (process.platform !== 'win32') {
      return;
    }

    window.electronAPI.terminal.getAvailableShells()
      .then((shells) => setAvailableTerminalShells(shells ?? []))
      .catch((error) => {
        console.error('[AdvancedPanel] Failed to load terminal shells:', error);
        setAvailableTerminalShells([]);
      });
  }, []);

  const terminalShellOptions: Array<{ value: PreferredTerminalShell; label: string }> = [
    { value: 'auto', label: 'Auto (Recommended)' },
  ];
  const seenShellProviders = new Set<PreferredTerminalShell>();
  for (const shell of availableTerminalShells) {
    const provider = shell.provider as PreferredTerminalShell | undefined;
    if (!provider || provider === 'auto' || seenShellProviders.has(provider)) {
      continue;
    }
    seenShellProviders.add(provider);
    const label = shell.name === provider
      ? `${shell.name} (${shell.path})`
      : `${shell.name} [${provider}] (${shell.path})`;
    terminalShellOptions.push({ value: provider, label });
  }

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

      {/* ── General ── */}
      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-2 text-[var(--nim-text)]">General</h4>

        <SettingsToggle
          checked={analyticsEnabled}
          onChange={(checked) => updateSettings({ analyticsEnabled: checked })}
          name="Send Anonymous Usage Data"
          description="Help improve Nimbalyst by sending anonymous usage data. No prompts or personal info collected."
        />

        <SettingsToggle
          checked={spellcheckEnabled}
          onChange={(checked) => updateSettings({ spellcheckEnabled: checked })}
          name="Spellcheck"
          description="Enable the system spellchecker in editors and text inputs."
        />

        <SettingsToggle
          checked={autoCommitEnabled}
          onChange={(checked) => {
            setAutoCommitEnabled(checked);
            posthog?.capture('auto_commit_toggled', { enabled: checked });
          }}
          name="Auto-approve Commits"
          description="Automatically approve when Claude proposes git commits."
        />

        <SettingsToggle
          checked={walkthroughsEnabled}
          onChange={(checked) => updateSettings({ walkthroughsEnabled: checked })}
          name="Show Feature Guides"
          description={`Walkthrough guides for new features and tips.${walkthroughsTotalCount > 0 ? ` (${walkthroughsViewedCount}/${walkthroughsTotalCount} viewed)` : ''}`}
        />

        {walkthroughsViewedCount > 0 && (
          <div className="py-1 pl-7">
            <button onClick={() => resetWalkthroughs()} className="nim-btn-secondary text-xs">
              Reset All Guides
            </button>
          </div>
        )}
      </div>

      {/* ── Tools & Environment ── */}
      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-2 text-[var(--nim-text)]">Tools & Environment</h4>

        <DropdownRow
          value={externalEditorType}
          onChange={(val) => updateExternalEditorSettings({ editorType: val as ExternalEditorType })}
          name="External Editor"
          description="Editor for the 'Open in...' context menu option."
          options={[
            { value: 'none', label: 'None' },
            { value: 'vscode', label: 'VS Code' },
            { value: 'cursor', label: 'Cursor' },
            { value: 'webstorm', label: 'WebStorm' },
            { value: 'sublime', label: 'Sublime Text' },
            { value: 'vim', label: 'Vim (Terminal)' },
            { value: 'nvim', label: 'Neovim (Terminal)' },
            { value: 'custom', label: 'Custom...' },
          ]}
        />

        {externalEditorType === 'custom' && (
          <div className="py-2 pl-7">
            <input
              type="text"
              value={externalEditorCustomPath || ''}
              onChange={(e) => updateExternalEditorSettings({ customPath: e.target.value })}
              placeholder={process.platform === 'win32' ? 'C:\\Program Files\\Editor\\editor.exe' : '/usr/local/bin/myeditor'}
              className="w-full py-1.5 px-3 rounded-md text-sm bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none focus:border-[var(--nim-primary)] font-mono"
            />
          </div>
        )}

        <SettingsToggle
          checked={extensionDevToolsEnabled}
          onChange={(checked) => updateSettings({ extensionDevToolsEnabled: checked })}
          name="Extension Dev Tools"
          description="Enable MCP tools for building, installing, and hot-reloading extensions."
        />

        <DropdownRow
          value={maxHeapSizeMB}
          onChange={(val) => updateSettings({ maxHeapSizeMB: parseInt(val, 10) })}
          name="Max Heap Size"
          description="V8 memory limit. Increase if you get out-of-memory crashes. Requires restart."
          options={[
            { value: 2048, label: '2 GB' },
            { value: 4096, label: '4 GB (Default)' },
            { value: 6144, label: '6 GB' },
            { value: 8192, label: '8 GB' },
            { value: 12288, label: '12 GB' },
            { value: 16384, label: '16 GB' },
          ]}
        />

        {process.platform === 'win32' && (
          <>
            <DropdownRow
              value={preferredTerminalShell}
              onChange={(val) => updateSettings({ preferredTerminalShell: val as PreferredTerminalShell })}
              name="Preferred Terminal Shell"
              description="Choose which detected Windows shell new terminals should open with. Auto follows the built-in priority."
              options={terminalShellOptions}
            />

            <div className="setting-item py-2">
              <div className="setting-text flex flex-col gap-0 mb-2">
                <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Detected Terminal Shells</span>
                <span className="setting-description text-xs leading-snug text-[var(--nim-text-muted)]">
                  Current Windows shell discovery results used for terminal selection and restore.
                </span>
              </div>

              <div className="select-text p-2 rounded-md text-xs bg-[var(--nim-bg-tertiary)] border border-[var(--nim-border)] text-[var(--nim-text-muted)] font-mono">
                {availableTerminalShells.length === 0 ? (
                  <div>No supported terminal shells detected.</div>
                ) : (
                  availableTerminalShells.map((shell) => (
                    <div key={`${shell.provider || shell.name}-${shell.path}`} className="py-0.5 break-all">
                      {`${shell.provider || shell.name} | ${shell.path} | bootstrap=${shell.bootstrapMode || 'none'} | cwd=${shell.cwdMode || 'native'}`}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        <DropdownRow
          value={historyMaxAgeDays}
          onChange={(val) => updateSettings({ historyMaxAgeDays: parseInt(val, 10) })}
          name="History Retention"
          description="Max age of file history snapshots before automatic cleanup."
          options={[
            { value: 7, label: '7 days' },
            { value: 14, label: '14 days' },
            { value: 30, label: '30 days (Default)' },
            { value: 60, label: '60 days' },
            { value: 90, label: '90 days' },
            { value: 180, label: '180 days' },
            { value: 365, label: '1 year' },
          ]}
        />

        <DropdownRow
          value={historyMaxSnapshots}
          onChange={(val) => updateSettings({ historyMaxSnapshots: parseInt(val, 10) })}
          name="Max Snapshots Per File"
          description="Oldest snapshots beyond this limit are deleted."
          options={[
            { value: 50, label: '50' },
            { value: 100, label: '100' },
            { value: 250, label: '250 (Default)' },
            { value: 500, label: '500' },
            { value: 1000, label: '1,000' },
          ]}
        />

        {/* Custom PATH */}
        <div className="setting-item py-2">
          <div className="setting-text flex flex-col gap-0 mb-2">
            <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Custom PATH Directories</span>
            <span className="setting-description text-xs leading-snug text-[var(--nim-text-muted)]">
              Additional directories for MCP server installation, CLI tool detection, and agent SDK operations.
            </span>
          </div>
          <textarea
            value={customPathDirs}
            onChange={(e) => updateSettings({ customPathDirs: e.target.value })}
            placeholder={process.platform === 'win32'
              ? 'C:\\MyTools;C:\\Programs\\bin'
              : '/opt/mytools/bin:/usr/local/custom/bin'}
            rows={2}
            className="w-full py-1.5 px-3 rounded-md text-sm bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none focus:border-[var(--nim-primary)] font-mono resize-none"
          />
          <div className="mt-1">
            <button
              onClick={() => setShowEnhancedPath(!showEnhancedPath)}
              className="text-xs text-[var(--nim-link)] hover:text-[var(--nim-link-hover)] cursor-pointer"
            >
              {showEnhancedPath ? 'Hide current PATH' : 'Show current PATH'}
            </button>

            {showEnhancedPath && enhancedPath && (
              <div className="mt-2">
                <div
                  className="p-2 rounded-md text-xs bg-[var(--nim-bg-tertiary)] border border-[var(--nim-border)] text-[var(--nim-text-muted)] font-mono overflow-x-auto"
                  style={{
                    maxHeight: '200px',
                    overflowY: 'auto',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {enhancedPath.split(process.platform === 'win32' ? ';' : ':').map((p, index) => (
                    <div key={index} className="py-0.5">
                      {p}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Developer Options (dev mode only) ── */}
      {isDevelopment ? (
        <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
          <h4 className="provider-panel-section-title text-base font-semibold mb-2 text-[var(--nim-text)]">Developer Options</h4>
          <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-2">
            Only available in development mode.
          </p>

          <SettingsToggle
            checked={showToolCalls}
            onChange={(checked) => updateAIDebugSettings({ showToolCalls: checked })}
            name="Show All Tool Calls"
            description="Display all MCP tool calls in the AI chat sidebar, including Edit/applyDiff calls."
          />

          <SettingsToggle
            checked={aiDebugLogging}
            onChange={(checked) => updateAIDebugSettings({ aiDebugLogging: checked })}
            name="AI Debug Logging"
            description="Capture detailed logs of all AI editing operations including LLM requests/responses."
          />

          <SettingsToggle
            checked={showPromptAdditions}
            onChange={(checked) => updateAIDebugSettings({ showPromptAdditions: checked })}
            name="Show Prompt Additions"
            description="Display system prompt additions and context that Nimbalyst appends to Claude Code requests."
          />
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
