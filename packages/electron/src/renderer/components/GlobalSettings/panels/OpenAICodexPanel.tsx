import React, { useState, useEffect } from 'react';
import { ProviderConfig, Model } from '../../Settings/SettingsView';
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
            logs: [...prev.logs, progress.log].filter((log): log is string => Boolean(log))
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
            logs: [...prev.logs, progress.log].filter((log): log is string => Boolean(log)).slice(-10)
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
    <div className="provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">OpenAI Codex</h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          Advanced code generation and completion powered by OpenAI Codex models.
          Provides intelligent code suggestions and automated programming assistance.
        </p>
      </div>

      <div className="provider-enable flex items-center justify-between gap-4 py-4 mb-4 border-b border-[var(--nim-border)]">
        <span className="provider-enable-label text-sm font-medium text-[var(--nim-text)]">Enable OpenAI Codex</span>
        <label className="provider-toggle relative inline-block w-11 h-6 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled || false}
            onChange={(e) => {
              console.log('[OpenAICodexPanel] Toggle changed to:', e.target.checked);
              onToggle(e.target.checked);
            }}
            className="opacity-0 w-0 h-0 absolute"
          />
          <span className="provider-toggle-slider absolute cursor-pointer inset-0 rounded-full transition-all bg-[var(--nim-bg-tertiary)]"></span>
        </label>
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Installation Status</h4>
        <div className={`installation-status p-4 rounded-lg ${
          getInstallationStatusClass() === 'installed' ? 'bg-[rgba(16,185,129,0.05)] border border-[rgba(16,185,129,0.2)]' :
          getInstallationStatusClass() === 'installing' ? 'bg-[rgba(245,158,11,0.05)] border border-[rgba(245,158,11,0.2)]' :
          getInstallationStatusClass() === 'error' ? 'bg-[rgba(239,68,68,0.05)] border border-[rgba(239,68,68,0.2)]' :
          'bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]'
        }`}>
          {isChecking ? (
            <div className="installation-status-row flex items-center gap-3 py-1">
              <span className="installation-status-label text-sm font-medium text-[var(--nim-text-muted)]">Checking installation...</span>
            </div>
          ) : (
            <>
              <div className="installation-status-row flex items-center gap-3 py-1">
                <span className="installation-status-label text-sm font-medium text-[var(--nim-text-muted)]">Status:</span>
                <span className="installation-status-value text-sm text-[var(--nim-text)]">
                  {localInstallStatus.installed || config.installed ? 'Installed' : 'Not Installed'}
                  {config.installStatus === 'installing' && ' (Installing...)'}
                </span>
              </div>
              {(localInstallStatus.version || config.version) && (
                <div className="installation-status-row flex items-center gap-3 py-1">
                  <span className="installation-status-label text-sm font-medium text-[var(--nim-text-muted)]">Version:</span>
                  <span className="installation-status-value text-sm text-[var(--nim-text)]">{localInstallStatus.version || config.version}</span>
                </div>
              )}
              {(localInstallStatus.path) && (
                <div className="installation-status-row flex items-center gap-3 py-1">
                  <span className="installation-status-label text-sm font-medium text-[var(--nim-text-muted)]">Location:</span>
                  <span className="installation-status-value text-xs text-[var(--nim-text)]">{localInstallStatus.path}</span>
                </div>
              )}
              {(localInstallStatus.updateAvailable || config.updateAvailable) && (
                <div className="installation-status-row flex items-center gap-3 py-1">
                  <span className="installation-status-label text-sm font-medium text-[var(--nim-text-muted)]">Update:</span>
                  <span className="installation-status-value text-sm text-[var(--nim-text)]">
                    Version {localInstallStatus.latestVersion || 'new'} available
                  </span>
                </div>
              )}
              <div className="installation-actions flex gap-2 mt-3">
                {!localInstallStatus.installed && !config.installed && (
                  <button
                    className="nim-btn-primary"
                    onClick={handleInstall}
                    disabled={config.installStatus === 'installing'}
                  >
                    Install OpenAI Codex
                  </button>
                )}
                {(localInstallStatus.installed || config.installed) && (localInstallStatus.updateAvailable || config.updateAvailable) && (
                  <button
                    className="nim-btn-primary"
                    onClick={handleUpdate}
                    disabled={config.installStatus === 'installing'}
                  >
                    Update
                  </button>
                )}
                {(localInstallStatus.installed || config.installed) && (
                  <button
                    className="nim-btn-secondary"
                    onClick={handleUninstall}
                    disabled={config.installStatus === 'installing'}
                  >
                    Uninstall
                  </button>
                )}
                <button
                  className="nim-btn-secondary"
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
          <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
            <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">API Configuration</h4>
            <div className="api-key-section mt-4">
              <p className="text-[13px] text-[var(--nim-text-muted)] mb-3">
                OpenAI Codex uses the same API key as OpenAI (GPT models)
              </p>
              <div className="api-key-row flex gap-2 items-center">
                <input
                  type="password"
                  value={apiKeys.openai || ''}
                  onChange={(e) => onApiKeyChange('openai', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="sk-..."
                  className="api-key-input flex-1 py-2 px-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-[var(--nim-text)] outline-none font-mono focus:border-[var(--nim-primary)]"
                />
                <button
                  className={`test-button inline-flex items-center justify-center py-2 px-4 rounded-md text-sm font-medium whitespace-nowrap cursor-pointer transition-all bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] border border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] ${
                    config.testStatus === 'testing' ? 'opacity-60 cursor-wait' : ''
                  } ${config.testStatus === 'success' ? 'text-[var(--nim-success)] border-[var(--nim-success)]' : ''} ${
                    config.testStatus === 'error' ? 'text-[var(--nim-error)] border-[var(--nim-error)]' : ''
                  }`}
                  onClick={onTestConnection}
                  disabled={config.testStatus === 'testing'}
                >
                  {config.testStatus === 'testing' ? 'Testing...' :
                   config.testStatus === 'success' ? '✓ Connected' :
                   config.testStatus === 'error' ? '✗ Failed' : 'Test'}
                </button>
              </div>
              {config.testMessage && config.testStatus === 'error' && (
                <div className="test-error text-xs mt-2 text-[var(--nim-error)]">{config.testMessage}</div>
              )}
            </div>
          </div>

          <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
            <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Codex Configuration</h4>
            <div className="cli-config-section">
              <p className="text-[13px] text-[var(--nim-text-muted)] mb-3">
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
