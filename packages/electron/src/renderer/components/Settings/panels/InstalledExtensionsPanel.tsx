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

interface ExtensionWithState extends InstalledExtension {
  enabled: boolean;
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

  // Load extensions and their enabled state
  useEffect(() => {
    loadExtensions();
  }, []);

  const loadExtensions = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get installed extensions from main process
      const installed = await window.electronAPI.extensions.listInstalled() as InstalledExtension[];

      // Get enabled state for all extensions
      const settings = await window.electronAPI.extensions.getAllSettings() as Record<string, { enabled: boolean }>;

      // Combine extension info with enabled state
      const extensionsWithState: ExtensionWithState[] = installed.map(ext => ({
        ...ext,
        enabled: settings[ext.id]?.enabled ?? true, // Default to enabled
      }));

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
