import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePostHog } from 'posthog-js/react';
import { MaterialSymbol, createExtensionStorage } from '@nimbalyst/runtime';
import type { ExtensionManifest, SettingsPanelProps } from '@nimbalyst/runtime';
import { getExtensionLoader } from '@nimbalyst/runtime';
import { ExtensionConfigPanel } from './ExtensionConfigPanel';
import { useTheme } from '../../../hooks/useTheme';

interface InstalledExtension {
  id: string;
  path: string;
  manifest: ExtensionManifest;
}

interface ExtensionSettings {
  enabled: boolean;
  claudePluginEnabled?: boolean;
}

interface ExtensionWithState extends InstalledExtension {
  enabled: boolean;
  claudePluginEnabled?: boolean;
}

interface InstalledExtensionsPanelProps {
  scope: 'user' | 'project';
  workspacePath?: string;
}

export const InstalledExtensionsPanel: React.FC<InstalledExtensionsPanelProps> = ({
  scope,
  workspacePath,
}) => {
  const posthog = usePostHog();
  const { theme } = useTheme();
  const [extensions, setExtensions] = useState<ExtensionWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Claude Code command settings
  const [projectCommandsEnabled, setProjectCommandsEnabled] = useState(true);
  const [userCommandsEnabled, setUserCommandsEnabled] = useState(true);
  const [commandsLoading, setCommandsLoading] = useState(false);

  // Get extension settings panels from the loader
  const extensionSettingsPanels = useMemo(() => {
    const loader = getExtensionLoader();
    if (!loader) return new Map();

    const panels = new Map<string, React.ComponentType<SettingsPanelProps>>();
    for (const panel of loader.getSettingsPanels()) {
      panels.set(panel.extensionId, panel.component);
    }
    return panels;
  }, [extensions]); // Re-compute when extensions change

  // Load extensions and their enabled state
  useEffect(() => {
    loadExtensions();
    loadClaudeCodeSettings();
  }, []);

  const loadClaudeCodeSettings = async () => {
    try {
      const settings = await window.electronAPI.claudeCode.getSettings();
      setProjectCommandsEnabled(settings.projectCommandsEnabled);
      setUserCommandsEnabled(settings.userCommandsEnabled);
    } catch (err) {
      console.error('Failed to load Claude Code settings:', err);
    }
  };

  const handleProjectCommandsToggle = useCallback(async (enabled: boolean) => {
    setCommandsLoading(true);
    try {
      await window.electronAPI.claudeCode.setProjectCommandsEnabled(enabled);
      setProjectCommandsEnabled(enabled);
      posthog?.capture('claude_code_project_commands_toggled', {
        action: enabled ? 'enabled' : 'disabled',
      });
    } catch (err) {
      console.error('Failed to toggle project commands:', err);
      setError('Failed to update setting');
    } finally {
      setCommandsLoading(false);
    }
  }, [posthog]);

  const handleUserCommandsToggle = useCallback(async (enabled: boolean) => {
    setCommandsLoading(true);
    try {
      await window.electronAPI.claudeCode.setUserCommandsEnabled(enabled);
      setUserCommandsEnabled(enabled);
      posthog?.capture('claude_code_user_commands_toggled', {
        action: enabled ? 'enabled' : 'disabled',
      });
    } catch (err) {
      console.error('Failed to toggle user commands:', err);
      setError('Failed to update setting');
    } finally {
      setCommandsLoading(false);
    }
  }, [posthog]);

  const loadExtensions = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get installed extensions from main process
      const installed = await window.electronAPI.extensions.listInstalled() as InstalledExtension[];

      // Get enabled state for all extensions
      const settings = await window.electronAPI.extensions.getAllSettings() as Record<string, ExtensionSettings>;

      // Combine extension info with enabled state
      const extensionsWithState: ExtensionWithState[] = installed.map(ext => {
        const extSettings = settings[ext.id];
        const claudePlugin = ext.manifest.contributions?.claudePlugin;
        return {
          ...ext,
          enabled: extSettings?.enabled ?? true, // Default to enabled
          // Claude plugin enabled defaults to the manifest's enabledByDefault, then true
          claudePluginEnabled: extSettings?.claudePluginEnabled ?? claudePlugin?.enabledByDefault ?? true,
        };
      });

      setExtensions(extensionsWithState);
    } catch (err) {
      console.error('Failed to load extensions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load extensions');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = useCallback(async (extensionId: string, enabled: boolean) => {
    setProcessingId(extensionId);
    setError(null);

    try {
      // Update persisted state
      await window.electronAPI.extensions.setEnabled(extensionId, enabled);

      // Update runtime state in ExtensionLoader
      const loader = getExtensionLoader();
      if (enabled) {
        loader.enableExtension(extensionId);
      } else {
        loader.disableExtension(extensionId);
      }

      // Track analytics
      posthog?.capture('extension_toggled', {
        action: enabled ? 'enabled' : 'disabled',
      });

      // Update local state
      setExtensions(prev => prev.map(ext =>
        ext.id === extensionId ? { ...ext, enabled } : ext
      ));
    } catch (err) {
      console.error(`Failed to ${enabled ? 'enable' : 'disable'} extension:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${enabled ? 'enable' : 'disable'} extension`);
    } finally {
      setProcessingId(null);
    }
  }, [posthog]);

  const handleClaudePluginToggle = useCallback(async (extensionId: string, enabled: boolean) => {
    setProcessingId(extensionId);
    setError(null);

    try {
      // Update persisted state for Claude plugin
      await window.electronAPI.extensions.setClaudePluginEnabled(extensionId, enabled);

      // Track analytics
      posthog?.capture('extension_claude_plugin_toggled', {
        extensionId,
        action: enabled ? 'enabled' : 'disabled',
      });

      // Update local state
      setExtensions(prev => prev.map(ext =>
        ext.id === extensionId ? { ...ext, claudePluginEnabled: enabled } : ext
      ));
    } catch (err) {
      console.error(`Failed to ${enabled ? 'enable' : 'disable'} Claude plugin:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${enabled ? 'enable' : 'disable'} Claude plugin`);
    } finally {
      setProcessingId(null);
    }
  }, [posthog]);

  const toggleDetails = (extensionId: string) => {
    setExpandedId(expandedId === extensionId ? null : extensionId);
  };

  const enabledCount = extensions.filter(ext => ext.enabled).length;
  const totalCount = extensions.length;

  if (loading) {
    return (
      <div className="provider-panel">
        <div className="flex items-center justify-center py-12 text-[var(--nim-text-muted)]">
          <p>Loading extensions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">Installed Extensions</h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          Manage extensions that add new capabilities to Nimbalyst, such as custom file editors,
          AI tools, and editor features.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] text-[var(--nim-error)]">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Claude Code Commands Section */}
      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Claude Code Commands</h4>
        <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
          Control which Claude slash commands are available in AI sessions.
        </p>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--nim-text)]">
                <span className="material-symbols-outlined text-base">folder</span>
                Project Commands
              </div>
              <div className="text-xs text-[var(--nim-text-muted)] mt-1">
                Load commands from <code className="px-1 py-0.5 rounded bg-[var(--nim-bg-tertiary)]">.claude/commands/</code> in your workspace
              </div>
            </div>
            <label className="provider-toggle">
              <input
                type="checkbox"
                checked={projectCommandsEnabled}
                onChange={(e) => handleProjectCommandsToggle(e.target.checked)}
                disabled={commandsLoading}
              />
              <span className="provider-toggle-slider"></span>
            </label>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--nim-text)]">
                <span className="material-symbols-outlined text-base">person</span>
                User Commands
              </div>
              <div className="text-xs text-[var(--nim-text-muted)] mt-1">
                Load commands from <code className="px-1 py-0.5 rounded bg-[var(--nim-bg-tertiary)]">~/.claude/commands/</code> (your personal commands)
              </div>
            </div>
            <label className="provider-toggle">
              <input
                type="checkbox"
                checked={userCommandsEnabled}
                onChange={(e) => handleUserCommandsToggle(e.target.checked)}
                disabled={commandsLoading}
              />
              <span className="provider-toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      {totalCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-[var(--nim-text-muted)]">
          <MaterialSymbol icon="extension" size={48} />
          <h3 className="mt-4 mb-2 text-lg font-medium text-[var(--nim-text)]">No Extensions Installed</h3>
          <p className="text-sm">
            Extensions are installed in the extensions folder. Check the documentation for
            instructions on how to install extensions.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-2 rounded-full bg-[var(--nim-bg-tertiary)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--nim-primary)] transition-all"
                style={{ width: `${(enabledCount / totalCount) * 100}%` }}
              />
            </div>
            <span className="text-xs text-[var(--nim-text-muted)] whitespace-nowrap">
              {enabledCount} of {totalCount} extensions enabled
            </span>
          </div>

          <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Extensions</h4>

          <div className="flex flex-col gap-3">
            {extensions.map((ext) => (
              <div
                key={ext.id}
                className={`rounded-lg border transition-colors ${
                  ext.enabled
                    ? 'bg-[var(--nim-bg-secondary)] border-[var(--nim-border)]'
                    : 'bg-[var(--nim-bg)] border-[var(--nim-border)] opacity-60'
                }`}
              >
                <div className="flex items-center gap-3 p-4">
                  <div className="w-10 h-10 rounded-lg bg-[var(--nim-bg-tertiary)] flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[var(--nim-text-muted)]">extension</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--nim-text)]">{ext.manifest.name}</span>
                      <span className="text-xs text-[var(--nim-text-faint)]">v{ext.manifest.version}</span>
                    </div>
                    <div className="text-sm text-[var(--nim-text-muted)] truncate">
                      {ext.manifest.description || 'No description provided'}
                    </div>
                    {ext.manifest.author && (
                      <div className="text-xs text-[var(--nim-text-faint)] mt-1">
                        by {ext.manifest.author}
                      </div>
                    )}
                  </div>
                  <label className="provider-toggle">
                    <input
                      type="checkbox"
                      checked={ext.enabled}
                      onChange={(e) => handleToggle(ext.id, e.target.checked)}
                      disabled={processingId === ext.id}
                    />
                    <span className="provider-toggle-slider"></span>
                  </label>
                </div>

                <div className="border-t border-[var(--nim-border)]">
                  <button
                    className="flex items-center justify-center gap-2 w-full py-2 text-xs text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] transition-colors cursor-pointer bg-transparent border-none"
                    onClick={() => toggleDetails(ext.id)}
                  >
                    <span>{expandedId === ext.id ? 'Hide details' : 'Show details'}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points={expandedId === ext.id ? '18,15 12,9 6,15' : '6,9 12,15 18,9'} />
                    </svg>
                  </button>

                  {expandedId === ext.id && (
                    <div className="p-4 pt-0 border-t border-[var(--nim-border)]">
                      <div className="extension-details-grid grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 mb-4 pt-4">
                        <div className="extension-detail-item contents">
                          <span className="extension-detail-label text-xs text-[var(--nim-text-muted)]">ID</span>
                          <span className="extension-detail-value text-xs text-[var(--nim-text)] font-mono">{ext.id}</span>
                        </div>
                        <div className="extension-detail-item contents">
                          <span className="extension-detail-label text-xs text-[var(--nim-text-muted)]">Path</span>
                          <span className="extension-detail-value extension-path text-xs text-[var(--nim-text)] font-mono truncate">{ext.path}</span>
                        </div>
                      </div>

                      {ext.manifest.contributions && (
                        <>
                          {ext.manifest.contributions.customEditors && ext.manifest.contributions.customEditors.length > 0 && (
                            <div className="package-details-section mt-4">
                              <div className="package-details-section-title text-xs font-medium text-[var(--nim-text)] mb-2">
                                Custom Editors ({ext.manifest.contributions.customEditors.length})
                              </div>
                              <div className="package-schemas flex flex-wrap gap-1.5">
                                {ext.manifest.contributions.customEditors.map((editor, idx) => (
                                  <span key={idx} className="package-schema px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] flex items-center gap-1">
                                    <span className="material-symbols-outlined text-sm">edit_document</span>
                                    {editor.displayName}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {ext.manifest.contributions.aiTools && ext.manifest.contributions.aiTools.length > 0 && (
                            <div className="package-details-section mt-4">
                              <div className="package-details-section-title text-xs font-medium text-[var(--nim-text)] mb-2">
                                AI Tools ({ext.manifest.contributions.aiTools.length})
                              </div>
                              <div className="package-commands flex flex-wrap gap-1.5">
                                {ext.manifest.contributions.aiTools.map((tool, idx) => {
                                  // Handle both correct format (string) and incorrect format (object)
                                  if (typeof tool === 'string') {
                                    return <span key={idx} className="package-command px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] font-mono">{tool}</span>;
                                  } else if (tool && typeof tool === 'object' && 'name' in tool) {
                                    // Show warning for incorrect format
                                    return (
                                      <span key={idx} className="package-command package-command-warning px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] font-mono flex items-center" title="Manifest error: aiTools should be strings, not objects. See SDK docs.">
                                        {(tool as { name: string }).name}
                                        <span className="material-symbols-outlined text-sm ml-1 text-[var(--nim-warning)]">warning</span>
                                      </span>
                                    );
                                  }
                                  return <span key={idx} className="package-command px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] font-mono">Invalid tool format</span>;
                                })}
                              </div>
                              {ext.manifest.contributions.aiTools.some(tool => typeof tool !== 'string') && (
                                <div className="extension-manifest-warning flex items-start gap-2 mt-2 p-2 rounded bg-[var(--nim-warning)]/10 text-[var(--nim-warning)] text-xs">
                                  <span className="material-symbols-outlined text-sm">warning</span>
                                  <span>Manifest format error: <code className="bg-[var(--nim-bg-tertiary)] px-1 rounded">aiTools</code> should be an array of strings (tool names), not objects. See the Extension SDK documentation.</span>
                                </div>
                              )}
                            </div>
                          )}

                          {ext.manifest.contributions.slashCommands && ext.manifest.contributions.slashCommands.length > 0 && (
                            <div className="package-details-section mt-4">
                              <div className="package-details-section-title text-xs font-medium text-[var(--nim-text)] mb-2">
                                Slash Commands ({ext.manifest.contributions.slashCommands.length})
                              </div>
                              <div className="package-commands flex flex-wrap gap-1.5">
                                {ext.manifest.contributions.slashCommands.map((cmd, idx) => (
                                  <span key={idx} className="package-command px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] font-mono">/{cmd.title}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {ext.manifest.contributions.nodes && ext.manifest.contributions.nodes.length > 0 && (
                            <div className="package-details-section mt-4">
                              <div className="package-details-section-title text-xs font-medium text-[var(--nim-text)] mb-2">
                                Lexical Nodes ({ext.manifest.contributions.nodes.length})
                              </div>
                              <div className="package-commands flex flex-wrap gap-1.5">
                                {ext.manifest.contributions.nodes.map((node, idx) => (
                                  <span key={idx} className="package-command px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] font-mono">{node}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {ext.manifest.contributions.claudePlugin && (
                            <div className="package-details-section claude-plugin-section mt-4 p-3 rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
                              <div className="claude-plugin-header flex items-start justify-between gap-3">
                                <div className="claude-plugin-info flex-1">
                                  <div className="package-details-section-title text-xs font-medium text-[var(--nim-text)] mb-1 flex items-center gap-1.5">
                                    <span className="material-symbols-outlined text-sm">smart_toy</span>
                                    Claude Agent Plugin
                                  </div>
                                  <div className="claude-plugin-description text-xs text-[var(--nim-text-muted)]">
                                    {ext.manifest.contributions.claudePlugin.description || ext.manifest.contributions.claudePlugin.displayName}
                                  </div>
                                </div>
                                <div className="provider-enable">
                                  <label className="provider-toggle">
                                    <input
                                      type="checkbox"
                                      checked={ext.claudePluginEnabled ?? true}
                                      onChange={(e) => handleClaudePluginToggle(ext.id, e.target.checked)}
                                      disabled={processingId === ext.id || !ext.enabled}
                                    />
                                    <span className="provider-toggle-slider"></span>
                                  </label>
                                </div>
                              </div>
                              {ext.manifest.contributions.claudePlugin.commands && ext.manifest.contributions.claudePlugin.commands.length > 0 && (
                                <div className="claude-plugin-commands mt-3">
                                  <div className="claude-plugin-commands-label text-xs text-[var(--nim-text-muted)] mb-1.5">Commands:</div>
                                  <div className="package-commands flex flex-wrap gap-1.5">
                                    {ext.manifest.contributions.claudePlugin.commands.map((cmd, idx) => (
                                      <span key={idx} className="package-command px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] font-mono" title={cmd.description}>
                                        /{cmd.name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {!ext.enabled && (
                                <div className="claude-plugin-disabled-notice mt-2 text-xs text-[var(--nim-text-faint)] italic">
                                  Enable the extension to use this plugin
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {ext.manifest.permissions && (
                        <div className="package-details-section mt-4">
                          <div className="package-details-section-title text-xs font-medium text-[var(--nim-text)] mb-2">Permissions</div>
                          <div className="package-schemas flex flex-wrap gap-1.5">
                            {ext.manifest.permissions.filesystem && (
                              <span className="package-schema px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] flex items-center gap-1">
                                <span className="material-symbols-outlined text-sm">folder</span>
                                File System
                              </span>
                            )}
                            {ext.manifest.permissions.ai && (
                              <span className="package-schema px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] flex items-center gap-1">
                                <span className="material-symbols-outlined text-sm">psychology</span>
                                AI Tools
                              </span>
                            )}
                            {ext.manifest.permissions.network && (
                              <span className="package-schema px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] flex items-center gap-1">
                                <span className="material-symbols-outlined text-sm">cloud</span>
                                Network
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Extension configuration if available */}
                      {ext.manifest.contributions?.configuration && ext.enabled && (
                        <ExtensionConfigPanel
                          extensionId={ext.id}
                          manifest={ext.manifest}
                          scope={scope}
                          workspacePath={workspacePath}
                        />
                      )}

                      {/* Custom settings panel if extension provides one */}
                      {ext.enabled && extensionSettingsPanels.has(ext.id) && (() => {
                        const SettingsComponent = extensionSettingsPanels.get(ext.id)!;
                        const storage = createExtensionStorage(ext.id);
                        return (
                          <div className="extension-settings-panel mt-4 pt-4 border-t border-[var(--nim-border)]">
                            <SettingsComponent storage={storage} theme={theme} />
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
