import React, { useState, useEffect, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { ExtensionManifest } from '@nimbalyst/runtime';
import { getExtensionLoader } from '@nimbalyst/runtime';
import { ExtensionConfigPanel } from './ExtensionConfigPanel';

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
  const [extensions, setExtensions] = useState<ExtensionWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Claude Code command settings
  const [projectCommandsEnabled, setProjectCommandsEnabled] = useState(true);
  const [userCommandsEnabled, setUserCommandsEnabled] = useState(true);
  const [commandsLoading, setCommandsLoading] = useState(false);

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
      <div className="settings-panel-content">
        <div className="settings-panel-empty">
          <p>Loading extensions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-panel-content">
      <div className="settings-panel-header">
        <h2>Installed Extensions</h2>
        <p>
          Manage extensions that add new capabilities to Nimbalyst, such as custom file editors,
          AI tools, and editor features.
        </p>
      </div>

      {error && (
        <div className="settings-message error">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Claude Code Commands Section */}
      <div className="claude-commands-section">
        <div className="packages-section-title">Claude Code Commands</div>
        <p className="claude-commands-description">
          Control which Claude slash commands are available in AI sessions.
        </p>

        <div className="claude-commands-toggles">
          <div className="claude-command-toggle">
            <div className="claude-command-toggle-info">
              <div className="claude-command-toggle-title">
                <span className="material-symbols-outlined">folder</span>
                Project Commands
              </div>
              <div className="claude-command-toggle-description">
                Load commands from <code>.claude/commands/</code> in your workspace
              </div>
            </div>
            <div className="provider-enable">
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
          </div>

          <div className="claude-command-toggle">
            <div className="claude-command-toggle-info">
              <div className="claude-command-toggle-title">
                <span className="material-symbols-outlined">person</span>
                User Commands
              </div>
              <div className="claude-command-toggle-description">
                Load commands from <code>~/.claude/commands/</code> (your personal commands)
              </div>
            </div>
            <div className="provider-enable">
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
      </div>

      {totalCount === 0 ? (
        <div className="extensions-empty-state">
          <MaterialSymbol icon="extension" size={48} />
          <h3>No Extensions Installed</h3>
          <p>
            Extensions are installed in the extensions folder. Check the documentation for
            instructions on how to install extensions.
          </p>
        </div>
      ) : (
        <>
          <div className="packages-progress">
            <div className="packages-progress-bar">
              <div
                className="packages-progress-fill"
                style={{ width: `${(enabledCount / totalCount) * 100}%` }}
              />
            </div>
            <span className="packages-progress-text">
              {enabledCount} of {totalCount} extensions enabled
            </span>
          </div>

          <div className="packages-section-title">Extensions</div>

          <div className="packages-list">
            {extensions.map((ext) => (
              <div
                key={ext.id}
                className={`package-card ${ext.enabled ? 'installed' : ''}`}
              >
                <div className="package-card-header">
                  <div className="package-icon">
                    <span className="material-symbols-outlined">extension</span>
                  </div>
                  <div className="package-info">
                    <div className="package-name">
                      {ext.manifest.name}
                      <span className="package-version">v{ext.manifest.version}</span>
                    </div>
                    <div className="package-description">
                      {ext.manifest.description || 'No description provided'}
                    </div>
                    {ext.manifest.author && (
                      <div className="extension-author">
                        by {ext.manifest.author}
                      </div>
                    )}
                  </div>
                  <div className="package-actions">
                    <div className="provider-enable">
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
                  </div>
                </div>

                <div className="package-details">
                  <button
                    className="package-details-toggle"
                    onClick={() => toggleDetails(ext.id)}
                  >
                    <span>{expandedId === ext.id ? 'Hide details' : 'Show details'}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points={expandedId === ext.id ? '18,15 12,9 6,15' : '6,9 12,15 18,9'} />
                    </svg>
                  </button>

                  {expandedId === ext.id && (
                    <div className="package-details-content">
                      <div className="extension-details-grid">
                        <div className="extension-detail-item">
                          <span className="extension-detail-label">ID</span>
                          <span className="extension-detail-value">{ext.id}</span>
                        </div>
                        <div className="extension-detail-item">
                          <span className="extension-detail-label">Path</span>
                          <span className="extension-detail-value extension-path">{ext.path}</span>
                        </div>
                      </div>

                      {ext.manifest.contributions && (
                        <>
                          {ext.manifest.contributions.customEditors && ext.manifest.contributions.customEditors.length > 0 && (
                            <div className="package-details-section">
                              <div className="package-details-section-title">
                                Custom Editors ({ext.manifest.contributions.customEditors.length})
                              </div>
                              <div className="package-schemas">
                                {ext.manifest.contributions.customEditors.map((editor, idx) => (
                                  <span key={idx} className="package-schema">
                                    <span className="material-symbols-outlined">edit_document</span>
                                    {editor.displayName}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {ext.manifest.contributions.aiTools && ext.manifest.contributions.aiTools.length > 0 && (
                            <div className="package-details-section">
                              <div className="package-details-section-title">
                                AI Tools ({ext.manifest.contributions.aiTools.length})
                              </div>
                              <div className="package-commands">
                                {ext.manifest.contributions.aiTools.map((tool, idx) => (
                                  <span key={idx} className="package-command">{tool}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {ext.manifest.contributions.slashCommands && ext.manifest.contributions.slashCommands.length > 0 && (
                            <div className="package-details-section">
                              <div className="package-details-section-title">
                                Slash Commands ({ext.manifest.contributions.slashCommands.length})
                              </div>
                              <div className="package-commands">
                                {ext.manifest.contributions.slashCommands.map((cmd, idx) => (
                                  <span key={idx} className="package-command">/{cmd.title}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {ext.manifest.contributions.nodes && ext.manifest.contributions.nodes.length > 0 && (
                            <div className="package-details-section">
                              <div className="package-details-section-title">
                                Lexical Nodes ({ext.manifest.contributions.nodes.length})
                              </div>
                              <div className="package-commands">
                                {ext.manifest.contributions.nodes.map((node, idx) => (
                                  <span key={idx} className="package-command">{node}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {ext.manifest.contributions.claudePlugin && (
                            <div className="package-details-section claude-plugin-section">
                              <div className="claude-plugin-header">
                                <div className="claude-plugin-info">
                                  <div className="package-details-section-title">
                                    <span className="material-symbols-outlined">smart_toy</span>
                                    Claude Agent Plugin
                                  </div>
                                  <div className="claude-plugin-description">
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
                                <div className="claude-plugin-commands">
                                  <div className="claude-plugin-commands-label">Commands:</div>
                                  <div className="package-commands">
                                    {ext.manifest.contributions.claudePlugin.commands.map((cmd, idx) => (
                                      <span key={idx} className="package-command" title={cmd.description}>
                                        /{cmd.name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {!ext.enabled && (
                                <div className="claude-plugin-disabled-notice">
                                  Enable the extension to use this plugin
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {ext.manifest.permissions && (
                        <div className="package-details-section">
                          <div className="package-details-section-title">Permissions</div>
                          <div className="package-schemas">
                            {ext.manifest.permissions.filesystem && (
                              <span className="package-schema">
                                <span className="material-symbols-outlined">folder</span>
                                File System
                              </span>
                            )}
                            {ext.manifest.permissions.ai && (
                              <span className="package-schema">
                                <span className="material-symbols-outlined">psychology</span>
                                AI Tools
                              </span>
                            )}
                            {ext.manifest.permissions.network && (
                              <span className="package-schema">
                                <span className="material-symbols-outlined">cloud</span>
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
