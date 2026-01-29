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
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  // Selected extension
  const selectedExtension = useMemo(() => {
    return extensions.find(ext => ext.id === selectedId) || null;
  }, [extensions, selectedId]);

  // Load extensions and their enabled state
  useEffect(() => {
    loadExtensions();
    loadClaudeCodeSettings();
  }, []);

  // Auto-select first extension when loaded
  useEffect(() => {
    if (extensions.length > 0 && !selectedId) {
      setSelectedId(extensions[0].id);
    }
  }, [extensions, selectedId]);

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

      // Sort alphabetically by name
      extensionsWithState.sort((a, b) =>
        a.manifest.name.localeCompare(b.manifest.name)
      );

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
    <div className="provider-panel flex flex-col absolute inset-0 p-6">
      {/* Header */}
      <div className="provider-panel-header mb-5 pb-4 border-b border-[var(--nim-border)] flex-shrink-0">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">Installed Extensions</h3>

      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] text-[var(--nim-error)] flex-shrink-0">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Claude Code Commands Section - Compact horizontal layout */}
      {/*<div className="mb-5 pb-4 border-b border-[var(--nim-border)]">*/}
      {/*  <h4 className="text-sm font-semibold mb-3 text-[var(--nim-text)]">Claude Code Commands</h4>*/}
      {/*  <div className="flex gap-3">*/}
      {/*    <div className="flex-1 flex items-center justify-between p-3 rounded-lg bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]">*/}
      {/*      <div className="flex items-center gap-2">*/}
      {/*        <span className="material-symbols-outlined text-base text-[var(--nim-text-muted)]">folder</span>*/}
      {/*        <span className="text-sm font-medium text-[var(--nim-text)]">Project Commands</span>*/}
      {/*      </div>*/}
      {/*      <label className="provider-toggle">*/}
      {/*        <input*/}
      {/*          type="checkbox"*/}
      {/*          checked={projectCommandsEnabled}*/}
      {/*          onChange={(e) => handleProjectCommandsToggle(e.target.checked)}*/}
      {/*          disabled={commandsLoading}*/}
      {/*        />*/}
      {/*        <span className="provider-toggle-slider"></span>*/}
      {/*      </label>*/}
      {/*    </div>*/}
      {/*    <div className="flex-1 flex items-center justify-between p-3 rounded-lg bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]">*/}
      {/*      <div className="flex items-center gap-2">*/}
      {/*        <span className="material-symbols-outlined text-base text-[var(--nim-text-muted)]">person</span>*/}
      {/*        <span className="text-sm font-medium text-[var(--nim-text)]">User Commands</span>*/}
      {/*      </div>*/}
      {/*      <label className="provider-toggle">*/}
      {/*        <input*/}
      {/*          type="checkbox"*/}
      {/*          checked={userCommandsEnabled}*/}
      {/*          onChange={(e) => handleUserCommandsToggle(e.target.checked)}*/}
      {/*          disabled={commandsLoading}*/}
      {/*        />*/}
      {/*        <span className="provider-toggle-slider"></span>*/}
      {/*      </label>*/}
      {/*    </div>*/}
      {/*  </div>*/}
      {/*</div>*/}

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
        /* Main content: List + Details split view */
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Left: Extension list */}
          <div className="w-[260px] flex-shrink-0 flex flex-col bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-lg overflow-hidden">
            <div className="px-3 py-2.5 border-b border-[var(--nim-border)] flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-semibold text-[var(--nim-text-muted)] uppercase tracking-wide">Extensions</span>
              <span className="text-xs text-[var(--nim-text-faint)]">{enabledCount} of {totalCount} enabled</span>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {extensions.map((ext) => (
                <div
                  key={ext.id}
                  className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer border-b border-[var(--nim-border)] transition-colors ${
                    selectedId === ext.id
                      ? 'bg-[rgba(38,139,210,0.15)] border-l-2 border-l-[var(--nim-primary)] pl-2.5'
                      : 'hover:bg-[var(--nim-bg-hover)]'
                  } ${!ext.enabled ? 'opacity-50' : ''}`}
                  onClick={() => setSelectedId(ext.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--nim-text)] truncate">{ext.manifest.name}</div>
                    <div className="text-xs text-[var(--nim-text-faint)]">{ext.manifest.author || 'Unknown'}</div>
                  </div>
                  <label className="provider-toggle flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={ext.enabled}
                      onChange={(e) => handleToggle(ext.id, e.target.checked)}
                      disabled={processingId === ext.id}
                    />
                    <span className="provider-toggle-slider"></span>
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Extension details */}
          <div className="flex-1 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-lg overflow-hidden flex flex-col">
            {selectedExtension ? (
              <>
                {/* Details header */}
                <div className="p-4 border-b border-[var(--nim-border)] flex-shrink-0">
                  <div className="text-base font-semibold text-[var(--nim-text)]">{selectedExtension.manifest.name}</div>
                  <div className="text-xs text-[var(--nim-text-muted)]">
                    by {selectedExtension.manifest.author || 'Unknown'}
                    <span className="text-[var(--nim-text-faint)] ml-2">v{selectedExtension.manifest.version}</span>
                  </div>
                  <div className="text-sm text-[var(--nim-text-muted)] mt-2 leading-relaxed">
                    {selectedExtension.manifest.description || 'No description provided'}
                  </div>
                </div>

                {/* Details body - scrollable */}
                <div className="flex-1 overflow-y-auto min-h-0 p-4">
                  {/* Extension configuration if available */}
                  {selectedExtension.manifest.contributions?.configuration && selectedExtension.enabled && (
                      <div className="mb-5">
                        <ExtensionConfigPanel
                            extensionId={selectedExtension.id}
                            manifest={selectedExtension.manifest}
                            scope={scope}
                            workspacePath={workspacePath}
                        />
                      </div>
                  )}

                  {/* Claude Plugin */}
                  {selectedExtension.manifest.contributions?.claudePlugin && (
                    <div className="mb-5">
                      <div className="text-xs font-semibold text-[var(--nim-text-muted)] uppercase tracking-wide mb-2.5">Claude Agent Plugin</div>
                      <div className="bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--nim-text)]">
                            <span className="material-symbols-outlined text-base text-[var(--nim-primary)]">smart_toy</span>
                            {selectedExtension.manifest.contributions.claudePlugin.displayName || 'Claude Plugin'}
                          </div>
                          <label className="provider-toggle">
                            <input
                              type="checkbox"
                              checked={selectedExtension.claudePluginEnabled ?? true}
                              onChange={(e) => handleClaudePluginToggle(selectedExtension.id, e.target.checked)}
                              disabled={processingId === selectedExtension.id || !selectedExtension.enabled}
                            />
                            <span className="provider-toggle-slider"></span>
                          </label>
                        </div>
                        <div className="text-xs text-[var(--nim-text-muted)] mb-2.5">
                          {selectedExtension.manifest.contributions.claudePlugin.description || 'No description'}
                        </div>
                        {selectedExtension.manifest.contributions.claudePlugin.commands && selectedExtension.manifest.contributions.claudePlugin.commands.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {selectedExtension.manifest.contributions.claudePlugin.commands.map((cmd, idx) => (
                              <span key={idx} className="px-2 py-0.5 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] font-mono" title={cmd.description}>
                                /{cmd.name}
                              </span>
                            ))}
                          </div>
                        )}
                        {!selectedExtension.enabled && (
                          <div className="mt-2 text-xs text-[var(--nim-text-faint)] italic">
                            Enable the extension to use this plugin
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Extension Info */}
                  <div className="mb-5">
                    <div className="text-xs font-semibold text-[var(--nim-text-muted)] uppercase tracking-wide mb-2.5">Extension Info</div>
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        <span className="text-xs text-[var(--nim-text-faint)] w-10">ID</span>
                        <span className="text-xs text-[var(--nim-text-muted)] font-mono">{selectedExtension.id}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-xs text-[var(--nim-text-faint)] w-10">Path</span>
                        <span className="text-xs text-[var(--nim-text-muted)] font-mono truncate" title={selectedExtension.path}>
                          {selectedExtension.path.replace(/^.*?\/extensions\//, '~/extensions/')}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Contributions */}
                  {selectedExtension.manifest.contributions && (
                    <div className="mb-5">
                      <div className="text-xs font-semibold text-[var(--nim-text-muted)] uppercase tracking-wide mb-2.5">Contributions</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedExtension.manifest.contributions.customEditors?.map((editor, idx) => (
                          <span key={`editor-${idx}`} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]">
                            <span className="material-symbols-outlined text-sm">edit_document</span>
                            {editor.displayName}
                          </span>
                        ))}
                        {selectedExtension.manifest.contributions.aiTools?.map((tool, idx) => {
                          const toolName = typeof tool === 'string' ? tool : (tool as { name: string }).name;
                          return (
                            <span key={`tool-${idx}`} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]">
                              <span className="material-symbols-outlined text-sm">smart_toy</span>
                              AI Tool: {toolName}
                            </span>
                          );
                        })}
                        {selectedExtension.manifest.contributions.slashCommands?.map((cmd, idx) => (
                          <span key={`slash-${idx}`} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] font-mono">
                            /{cmd.title}
                          </span>
                        ))}
                        {selectedExtension.manifest.contributions.nodes?.map((node, idx) => (
                          <span key={`node-${idx}`} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]">
                            <span className="material-symbols-outlined text-sm">widgets</span>
                            {node}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Permissions */}
                  {selectedExtension.manifest.permissions && (
                    <div className="mb-5">
                      <div className="text-xs font-semibold text-[var(--nim-text-muted)] uppercase tracking-wide mb-2.5">Permissions</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedExtension.manifest.permissions.filesystem && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]">
                            <span className="material-symbols-outlined text-sm">folder</span>
                            File System
                          </span>
                        )}
                        {selectedExtension.manifest.permissions.ai && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]">
                            <span className="material-symbols-outlined text-sm">psychology</span>
                            AI Tools
                          </span>
                        )}
                        {selectedExtension.manifest.permissions.network && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]">
                            <span className="material-symbols-outlined text-sm">cloud</span>
                            Network
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Custom settings panel if extension provides one */}
                  {selectedExtension.enabled && extensionSettingsPanels.has(selectedExtension.id) && (() => {
                    const SettingsComponent = extensionSettingsPanels.get(selectedExtension.id)!;
                    const storage = createExtensionStorage(selectedExtension.id);
                    return (
                      <div className="pt-4 border-t border-[var(--nim-border)]">
                        <SettingsComponent storage={storage} theme={theme} />
                      </div>
                    );
                  })()}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-[var(--nim-text-muted)] text-center p-5">
                <span className="material-symbols-outlined text-5xl opacity-50 mb-3">extension</span>
                <div className="text-sm font-medium text-[var(--nim-text)]">No Extension Selected</div>
                <div className="text-xs">Select an extension from the list to view details</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
