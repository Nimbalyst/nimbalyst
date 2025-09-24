import React, { useState, useEffect } from 'react';
import { ProviderConfig, Model } from '../AIModelsRedesigned';
import { InstallationProgress } from './InstallationProgress';
import { CLIInstaller } from '../services/CLIInstaller';

interface ClaudeCodePanelProps {
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

export function ClaudeCodePanel({
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
}: ClaudeCodePanelProps) {
  const [isChecking, setIsChecking] = useState(false);
  const [npmAvailable, setNpmAvailable] = useState<{
    available: boolean;
    version?: string;
    error?: string;
    checked: boolean;
  }>({
    available: false,
    checked: false
  });
  const [localInstallStatus, setLocalInstallStatus] = useState<{
    installed: boolean;
    version?: string;
    updateAvailable?: boolean;
    path?: string;
    latestVersion?: string;
    claudeDesktopVersion?: string;
  }>({
    installed: false
  });
  const [installationProgress, setInstallationProgress] = useState<{
    isOpen: boolean;
    status: string;
    progress: number;
    logs: string[];
    isNodeJs?: boolean;
  }>({
    isOpen: false,
    status: '',
    progress: 0,
    logs: [],
    isNodeJs: false
  });

  useEffect(() => {
    checkNpmAndInstallation();
  }, []);

  const checkNpmAndInstallation = async () => {
    console.log('[ClaudeCodePanel] Checking npm and installation...');

    // First check if npm is available
    const npmCheck = await cliInstaller.checkNpmAvailable();
    console.log('[ClaudeCodePanel] npm check result:', npmCheck);
    setNpmAvailable({ ...npmCheck, checked: true });

    // If npm is available, check installation
    if (npmCheck.available) {
      console.log('[ClaudeCodePanel] npm is available, checking claude-code installation...');
      checkInstallation();
    } else {
      console.log('[ClaudeCodePanel] npm is NOT available');
      if (npmCheck.error) {
        console.error('[ClaudeCodePanel] npm error:', npmCheck.error);
      }
    }
  };

  const checkInstallation = async () => {
    setIsChecking(true);
    try {
      console.log('[ClaudeCodePanel] Checking installation...');
      const status = await cliInstaller.checkInstallation('claude-code');
      console.log('[ClaudeCodePanel] Installation status:', status);

      setLocalInstallStatus(status);
      onConfigChange({
        installed: status.installed,
        version: status.version,
        updateAvailable: status.updateAvailable,
        installStatus: status.installed ? 'installed' : 'not-installed'
      });
    } catch (error) {
      console.error('Failed to check Claude Code installation:', error);
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
      status: 'Preparing to install Claude Code...',
      progress: 0,
      logs: []
    });

    onConfigChange({ installStatus: 'installing' });

    try {
      await cliInstaller.install('claude-code', {
        onProgress: (progress) => {
          if (!progress) return;
          setInstallationProgress(prev => ({
            ...prev,
            progress: progress.percent || 0,
            status: progress.status || '',
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

      // Parse the error message to show in the logs
      const errorMessage = error.message || 'Unknown error occurred';
      const errorDetails = error.stderr || error.stdout || '';

      setInstallationProgress(prev => ({
        ...prev,
        status: `Installation failed: ${errorMessage}`,
        progress: 0,
        logs: [
          ...prev.logs,
          '❌ Installation failed',
          errorMessage,
          ...(errorDetails ? errorDetails.split('\n').filter(Boolean) : [])
        ]
      }));
    }
  };

  const handleUpdate = async () => {
    setInstallationProgress({
      isOpen: true,
      status: 'Preparing to update Claude Code...',
      progress: 0,
      logs: []
    });

    onConfigChange({ installStatus: 'installing' });

    try {
      await cliInstaller.update('claude-code', {
        onProgress: (progress) => {
          if (!progress) return;
          setInstallationProgress(prev => ({
            ...prev,
            progress: progress.percent || 0,
            status: progress.status || '',
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

      // Parse the error message to show in the logs
      const errorMessage = error.message || 'Unknown error occurred';
      const errorDetails = error.stderr || error.stdout || '';

      setInstallationProgress(prev => ({
        ...prev,
        status: `Update failed: ${errorMessage}`,
        progress: 0,
        logs: [
          ...prev.logs,
          '❌ Update failed',
          errorMessage,
          ...(errorDetails ? errorDetails.split('\n').filter(Boolean) : [])
        ]
      }));
    }
  };

  const handleUninstall = async () => {
    if (!confirm('Are you sure you want to uninstall Claude Code CLI?')) {
      return;
    }

    setIsChecking(true);
    try {
      await cliInstaller.uninstall('claude-code');
      onConfigChange({
        installed: false,
        version: undefined,
        installStatus: 'not-installed'
      });
    } catch (error) {
      console.error('Failed to uninstall Claude Code:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const handleInstallNodeJs = async () => {
    setInstallationProgress({
      isOpen: true,
      status: 'Preparing to install Node.js...',
      progress: 0,
      logs: [],
      isNodeJs: true
    });

    try {
      await cliInstaller.installNodeJs({
        onProgress: (progress) => {
          if (!progress) return;
          setInstallationProgress(prev => ({
            ...prev,
            progress: progress.percent || 0,
            status: progress.status || '',
            logs: [...prev.logs, progress.log].filter(Boolean).slice(-10)
          }));
        }
      });

      // After successful installation, re-check npm availability
      await checkNpmAndInstallation();

      setInstallationProgress(prev => ({
        ...prev,
        status: 'Node.js installed! Please restart Preditor.',
        progress: 100
      }));
    } catch (error: any) {
      setInstallationProgress(prev => ({
        ...prev,
        status: error.message || 'Installation failed',
        progress: 0,
        logs: [
          ...prev.logs,
          error.message || 'Unknown error occurred'
        ]
      }));
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
        <h3 className="provider-panel-title">Claude Code (MCP)</h3>
        <p className="provider-panel-description">
          CLI-based Claude with Model Context Protocol (MCP) support for advanced code editing.
          Provides tool use, file editing, and session resumption capabilities.
        </p>
      </div>

      <div className="provider-enable" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="provider-enable-label">Enable Claude Code</span>
        <label className="provider-toggle">
          <input
            type="checkbox"
            checked={config.enabled || false}
            onChange={(e) => {
              console.log('[ClaudeCodePanel] Toggle changed to:', e.target.checked);
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
                      <span className="installation-status-value" style={{ fontSize: '11px' }}>
                        {localInstallStatus.path}
                      </span>
                    </div>
                  )}
                  {(localInstallStatus.claudeDesktopVersion && !localInstallStatus.installed) && (
                    <div className="installation-status-row">
                      <span className="installation-status-label">Note:</span>
                      <span className="installation-status-value" style={{ fontSize: '11px' }}>
                        Claude Desktop has v{localInstallStatus.claudeDesktopVersion} installed separately
                      </span>
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
                  {!npmAvailable.checked ? (
                    <div className="installation-status-row">
                      <span className="installation-status-label">Checking npm...</span>
                    </div>
                  ) : !npmAvailable.available ? (
                    <div className="installation-npm-warning">
                      <div className="installation-status-row">
                        <span className="installation-status-label" style={{ color: 'var(--color-error, #e74c3c)' }}>⚠️ npm not found</span>
                      </div>
                      <div style={{ fontSize: '12px', marginTop: '8px', lineHeight: '1.4' }}>
                        Claude Code requires Node.js and npm to be installed.
                      </div>
                      <div className="installation-actions" style={{ marginTop: '12px' }}>
                        <button
                          className="button-install"
                          onClick={handleInstallNodeJs}
                        >
                          Install Node.js
                        </button>
                        <button
                          className="button-uninstall"
                          onClick={checkNpmAndInstallation}
                        >
                          Refresh
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="installation-actions">
                      {!localInstallStatus.installed && !config.installed && (
                        <button
                          className="button-install"
                          onClick={handleInstall}
                          disabled={config.installStatus === 'installing' || !npmAvailable.available}
                        >
                          Install Claude Code
                        </button>
                      )}
                      {(localInstallStatus.installed || config.installed) && (localInstallStatus.updateAvailable || config.updateAvailable) && (
                        <button
                          className="button-update"
                          onClick={handleUpdate}
                          disabled={config.installStatus === 'installing' || !npmAvailable.available}
                        >
                          Update
                        </button>
                      )}
                      {(localInstallStatus.installed || config.installed) && (
                        <button
                          className="button-uninstall"
                          onClick={handleUninstall}
                          disabled={config.installStatus === 'installing' || !npmAvailable.available}
                        >
                          Uninstall
                        </button>
                      )}
                      <button
                        className="button-uninstall"
                        onClick={checkNpmAndInstallation}
                        disabled={isChecking}
                      >
                        Refresh Status
                      </button>
                    </div>
                  )}
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
                    Claude Code uses the same API key as Claude (Anthropic)
                  </p>
                  <div className="api-key-row">
                    <input
                      type="password"
                      value={apiKeys.anthropic || ''}
                      onChange={(e) => onApiKeyChange('anthropic', e.target.value)}
                      onFocus={(e) => e.target.select()}
                      placeholder="sk-ant-..."
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
                <h4 className="provider-panel-section-title">MCP Configuration</h4>
                <div className="cli-config-section">
                  <div className="cli-config-row">
                    <span className="cli-config-label">Permission Mode:</span>
                    <select
                      className="cli-config-select"
                      value={config.permissionMode || 'auto'}
                      onChange={(e) => onConfigChange({ permissionMode: e.target.value })}
                    >
                      <option value="auto">Automatic</option>
                      <option value="approve">Require Approval</option>
                      <option value="bypass">Bypass (Dangerous)</option>
                    </select>
                  </div>
                  <div className="cli-config-row">
                    <label className="cli-config-checkbox">
                      <input
                        type="checkbox"
                        checked={config.mcpEnabled ?? true}
                        onChange={(e) => onConfigChange({ mcpEnabled: e.target.checked })}
                      />
                      <span>Enable MCP Tools (file editing, etc.)</span>
                    </label>
                  </div>
                </div>
              </div>
        </>
      )}

      {installationProgress.isOpen && (
        <InstallationProgress
          title={installationProgress.isNodeJs ? "Installing Node.js" : "Installing Claude Code"}
          status={installationProgress.status}
          progress={installationProgress.progress}
          logs={installationProgress.logs}
          onClose={() => setInstallationProgress(prev => ({ ...prev, isOpen: false }))}
        />
      )}
    </div>
  );
}