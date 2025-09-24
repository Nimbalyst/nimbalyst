import React, { useState, useEffect } from 'react';
import { ProviderConfig, Model } from '../AIModelsRedesigned';
import { InstallationProgress } from './InstallationProgress';
import { CLIInstaller } from '../services/CLIInstaller';

interface OpenAICodexPanelProps {
  config: ProviderConfig;
  apiKeys: Record<string, string>;
  availableModels: Model[];
  loading: boolean;
  onToggle: (enabled: boolean) => void;
  onApiKeyChange: (key: string, value: string) => void;
  onModelToggle: (modelId: string, enabled: boolean) => void;
  onSelectAllModels: (selectAll: boolean) => void;
  onTestConnection: () => Promise<void>;
  onConfigChange: (updates: Partial<ProviderConfig>) => void;
}

const cliInstaller = new CLIInstaller();

export function OpenAICodexPanel({
  config,
  apiKeys,
  availableModels,
  loading,
  onToggle,
  onApiKeyChange,
  onModelToggle,
  onSelectAllModels,
  onTestConnection,
  onConfigChange
}: OpenAICodexPanelProps) {
  const [isChecking, setIsChecking] = useState(false);
  const [localInstallStatus, setLocalInstallStatus] = useState<{
    installed: boolean;
    version?: string;
    updateAvailable?: boolean;
    path?: string;
    latestVersion?: string;
  }>({
    installed: false
  });
  const [installationProgress, setInstallationProgress] = useState<{
    isOpen: boolean;
    status: string;
    progress: number;
    logs: string[];
  }>({
    isOpen: false,
    status: '',
    progress: 0,
    logs: []
  });

  useEffect(() => {
    checkInstallation();
  }, []);

  const checkInstallation = async () => {
    setIsChecking(true);
    try {
      console.log('[OpenAICodexPanel] Checking installation...');
      const status = await cliInstaller.checkInstallation('openai-codex');
      console.log('[OpenAICodexPanel] Installation status:', status);

      setLocalInstallStatus(status);
      onConfigChange({
        installed: status.installed,
        version: status.version,
        updateAvailable: status.updateAvailable,
        installStatus: status.installed ? 'installed' : 'not-installed'
      });
    } catch (error) {
      console.error('Failed to check OpenAI Codex installation:', error);
      setLocalInstallStatus({ installed: false });
      onConfigChange({
        installStatus: 'not-installed'
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleInstall = async () => {
    setInstallationProgress({
      isOpen: true,
      status: 'Preparing to install OpenAI Codex CLI...',
      progress: 0,
      logs: []
    });

    onConfigChange({ installStatus: 'installing' });

    try {
      await cliInstaller.install('openai-codex', {
        onProgress: (progress) => {
          setInstallationProgress(prev => ({
            ...prev,
            progress: progress.percent,
            status: progress.status,
            logs: [...prev.logs, progress.log].filter(Boolean)
          }));
        }
      });

      onConfigChange({
        installed: true,
        installStatus: 'installed'
      });

      // Re-check to get version info
      await checkInstallation();

      setInstallationProgress(prev => ({
        ...prev,
        status: 'Installation complete!',
        progress: 100
      }));

      setTimeout(() => {
        setInstallationProgress(prev => ({ ...prev, isOpen: false }));
      }, 2000);
    } catch (error: any) {
      onConfigChange({ installStatus: 'error' });
      setInstallationProgress(prev => ({
        ...prev,
        status: `Installation failed: ${error.message}`,
        progress: 0
      }));
    }
  };

  const handleUpdate = async () => {
    setInstallationProgress({
      isOpen: true,
      status: 'Preparing to update OpenAI Codex CLI...',
      progress: 0,
      logs: []
    });

    onConfigChange({ installStatus: 'installing' });

    try {
      await cliInstaller.update('openai-codex', {
        onProgress: (progress) => {
          setInstallationProgress(prev => ({
            ...prev,
            progress: progress.percent,
            status: progress.status,
            logs: [...prev.logs, progress.log].filter(Boolean).slice(-10)
          }));
        }
      });

      onConfigChange({
        installed: true,
        installStatus: 'installed',
        updateAvailable: false
      });

      // Re-check to get new version info
      await checkInstallation();

      setInstallationProgress(prev => ({
        ...prev,
        status: 'Update complete!',
        progress: 100
      }));

      setTimeout(() => {
        setInstallationProgress(prev => ({ ...prev, isOpen: false }));
      }, 2000);
    } catch (error: any) {
      onConfigChange({ installStatus: 'error' });
      setInstallationProgress(prev => ({
        ...prev,
        status: `Update failed: ${error.message}`,
        progress: 0
      }));
    }
  };

  const handleUninstall = async () => {
    if (!confirm('Are you sure you want to uninstall OpenAI Codex CLI?')) {
      return;
    }

    setIsChecking(true);
    try {
      await cliInstaller.uninstall('openai-codex');
      onConfigChange({
        installed: false,
        version: undefined,
        installStatus: 'not-installed'
      });
      await checkInstallation();
    } catch (error) {
      console.error('Failed to uninstall OpenAI Codex:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const getInstallationStatusClass = () => {
    switch (config.installStatus) {
      case 'installed': return 'installed';
      case 'installing': return 'installing';
      case 'error': return 'error';
      default: return 'not-installed';
    }
  };

  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">OpenAI Codex</h3>
        <p className="provider-panel-description">
          Advanced code generation and completion powered by OpenAI Codex models.
          Provides intelligent code suggestions and automated programming assistance.
        </p>
      </div>

      <div className="provider-enable" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="provider-enable-label">Enable OpenAI Codex</span>
        <label className="provider-toggle">
          <input
            type="checkbox"
            checked={config.enabled || false}
            onChange={(e) => {
              console.log('[OpenAICodexPanel] Toggle changed to:', e.target.checked);
              onToggle(e.target.checked);
            }}
          />
          <span className="provider-toggle-slider"></span>
        </label>
      </div>

      <div className="provider-panel-section">
        <h4 className="provider-panel-section-title">Installation Status</h4>
        <div className={`installation-status ${getInstallationStatusClass()}`}>
          {isChecking ? (
            <div className="installation-status-row">
              <span className="installation-status-label">Checking installation...</span>
            </div>
          ) : (
            <>
              <div className="installation-status-row">
                <span className="installation-status-label">Status:</span>
                <span className="installation-status-value">
                  {localInstallStatus.installed || config.installed ? 'Installed' : 'Not Installed'}
                  {config.installStatus === 'installing' && ' (Installing...)'}
                </span>
              </div>
              {(localInstallStatus.version || config.version) && (
                <div className="installation-status-row">
                  <span className="installation-status-label">Version:</span>
                  <span className="installation-status-value">{localInstallStatus.version || config.version}</span>
                </div>
              )}
              {(localInstallStatus.path) && (
                <div className="installation-status-row">
                  <span className="installation-status-label">Location:</span>
                  <span className="installation-status-value" style={{ fontSize: '11px' }}>{localInstallStatus.path}</span>
                </div>
              )}
              {(localInstallStatus.updateAvailable || config.updateAvailable) && (
                <div className="installation-status-row">
                  <span className="installation-status-label">Update:</span>
                  <span className="installation-status-value">
                    Version {localInstallStatus.latestVersion || 'new'} available
                  </span>
                </div>
              )}
              <div className="installation-actions">
                {!localInstallStatus.installed && !config.installed && (
                  <button
                    className="button-install"
                    onClick={handleInstall}
                    disabled={config.installStatus === 'installing'}
                  >
                    Install OpenAI Codex
                  </button>
                )}
                {(localInstallStatus.installed || config.installed) && (localInstallStatus.updateAvailable || config.updateAvailable) && (
                  <button
                    className="button-update"
                    onClick={handleUpdate}
                    disabled={config.installStatus === 'installing'}
                  >
                    Update
                  </button>
                )}
                {(localInstallStatus.installed || config.installed) && (
                  <button
                    className="button-uninstall"
                    onClick={handleUninstall}
                    disabled={config.installStatus === 'installing'}
                  >
                    Uninstall
                  </button>
                )}
                <button
                  className="button-refresh"
                  onClick={checkInstallation}
                  disabled={isChecking}
                >
                  Refresh Status
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {config.enabled && (localInstallStatus.installed || config.installed) && (
        <>
          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">API Configuration</h4>
            <div className="api-key-section">
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                OpenAI Codex uses the same API key as OpenAI (GPT models)
              </p>
              <div className="api-key-row">
                <input
                  type="password"
                  value={apiKeys.openai || ''}
                  onChange={(e) => onApiKeyChange('openai', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="sk-..."
                  className="api-key-input"
                />
                <button
                  className={`test-button ${config.testStatus}`}
                  onClick={onTestConnection}
                  disabled={config.testStatus === 'testing'}
                >
                  {config.testStatus === 'testing' ? 'Testing...' :
                   config.testStatus === 'success' ? '✓ Connected' :
                   config.testStatus === 'error' ? '✗ Failed' : 'Test'}
                </button>
              </div>
              {config.testMessage && config.testStatus === 'error' && (
                <div className="test-error">{config.testMessage}</div>
              )}
            </div>
          </div>

          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">Codex Configuration</h4>
            <div className="cli-config-section">
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                OpenAI Codex CLI manages its own model selection internally.
                No additional configuration required.
              </p>
            </div>
          </div>
        </>
      )}

      {installationProgress.isOpen && (
        <InstallationProgress
          title="Installing OpenAI Codex"
          status={installationProgress.status}
          progress={installationProgress.progress}
          logs={installationProgress.logs}
          onClose={() => setInstallationProgress(prev => ({ ...prev, isOpen: false }))}
        />
      )}
    </div>
  );
}