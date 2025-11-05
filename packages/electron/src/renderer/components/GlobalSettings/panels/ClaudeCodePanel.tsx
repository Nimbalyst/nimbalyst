import React, { useState, useEffect } from 'react';
import { ProviderConfig, Model } from '../GlobalSettingsScreen.tsx';
// Commented out for now - using built-in SDK only
// import { InstallationProgress } from './InstallationProgress';
// import { CLIInstaller } from '../services/CLIInstaller';
import {
  CLAUDE_CODE_TOOLS,
  TOOL_CATEGORIES,
  isAllToolsAllowed,
  getToolsByCategory,
  getDefaultAllowedTools
} from './claudeCodeTools';
// Import the actual SDK package.json to get the exact installed version
// @ts-ignore - importing json
import sdkPackageJson from '@anthropic-ai/claude-agent-sdk/package.json';

// Built-in SDK version (dynamically from the SDK's package.json)
const BUNDLED_SDK_VERSION = sdkPackageJson.version || 'unknown';

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

// Commented out - using built-in SDK only
// const cliInstaller = new CLIInstaller();

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
  const [loginStatus, setLoginStatus] = useState<{
    isLoggedIn: boolean;
    hasOAuthToken: boolean;
    isExpired: boolean;
    expiresAt?: string;
    scopes?: string[];
    email?: string;
    organization?: string;
    subscriptionType?: string;
    tokenSource?: string;
    apiKeySource?: string;
  } | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    checkLoginStatus();
  }, []);

  const checkLoginStatus = async () => {
    try {
      const status = await window.electronAPI.invoke('claude-code:check-login');
      setLoginStatus(status);
    } catch (error) {
      console.error('Failed to check login status:', error);
      setLoginStatus({ isLoggedIn: false, hasOAuthToken: false, isExpired: true });
    }
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await window.electronAPI.invoke('claude-code:login');
      if (result.success) {
        alert(result.message || 'Login initiated! Please complete authentication in the Terminal window, then click "Refresh Status" to verify.');
      }
    } catch (error: any) {
      alert(`Login failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      const result = await window.electronAPI.invoke('claude-code:logout');
      if (result.success) {
        alert(result.message || 'Logout initiated! Please wait for the Terminal window to complete, then click "Refresh Status" to verify.');
      }
    } catch (error: any) {
      alert(`Logout failed: ${error.message || 'Unknown error'}`);
    }
  };

  // Commented out - no longer checking local installation
  // const [isChecking, setIsChecking] = useState(false);
  // const [npmAvailable, setNpmAvailable] = useState<{
  //   available: boolean;
  //   version?: string;
  //   error?: string;
  //   checked: boolean;
  // }>({
  //   available: false,
  //   checked: false
  // });
  // const [localInstallStatus, setLocalInstallStatus] = useState<{
  //   installed: boolean;
  //   version?: string;
  //   updateAvailable?: boolean;
  //   path?: string;
  //   latestVersion?: string;
  //   claudeDesktopVersion?: string;
  // }>({
  //   installed: false
  // });
  // const [installationProgress, setInstallationProgress] = useState<{
  //   isOpen: boolean;
  //   status: string;
  //   progress: number;
  //   logs: string[];
  //   isNodeJs?: boolean;
  // }>({
  //   isOpen: false,
  //   status: '',
  //   progress: 0,
  //   logs: [],
  //   isNodeJs: false
  // });

  // useEffect(() => {
  //   checkNpmAndInstallation();
  // }, []);

  // Commented out - no longer managing installation
  // const checkNpmAndInstallation = async () => {
  //   console.log('[ClaudeCodePanel] Checking npm and installation...');
  //   const npmCheck = await cliInstaller.checkNpmAvailable();
  //   console.log('[ClaudeCodePanel] npm check result:', npmCheck);
  //   setNpmAvailable({ ...npmCheck, checked: true });
  //   if (npmCheck.available) {
  //     console.log('[ClaudeCodePanel] npm is available, checking claude-code installation...');
  //     checkInstallation();
  //   } else {
  //     console.log('[ClaudeCodePanel] npm is NOT available');
  //     if (npmCheck.error) {
  //       console.error('[ClaudeCodePanel] npm error:', npmCheck.error);
  //     }
  //   }
  // };

  // const checkInstallation = async () => {
  //   setIsChecking(true);
  //   try {
  //     console.log('[ClaudeCodePanel] Checking installation...');
  //     const status = await cliInstaller.checkInstallation('claude-code');
  //     console.log('[ClaudeCodePanel] Installation status:', status);
  //     setLocalInstallStatus(status);
  //     onConfigChange({
  //       installed: status.installed,
  //       version: status.version,
  //       updateAvailable: status.updateAvailable,
  //       installStatus: status.installed ? 'installed' : 'not-installed'
  //     });
  //   } catch (error) {
  //     console.error('Failed to check Claude Code installation:', error);
  //     setLocalInstallStatus({ installed: false });
  //     onConfigChange({
  //       installStatus: 'not-installed'
  //     });
  //   } finally {
  //     setIsChecking(false);
  //   }
  // };

  // const handleInstall = async () => { ... };
  // const handleUpdate = async () => { ... };
  // const handleUninstall = async () => { ... };
  // const handleInstallNodeJs = async () => { ... };
  // const getInstallationStatusClass = () => { ... };

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
        <h4 className="provider-panel-section-title">Claude Agent SDK</h4>
        <div className="installation-status installed">
          <div className="installation-status-row">
            <span className="installation-status-label">Version:</span>
            <span className="installation-status-value">{BUNDLED_SDK_VERSION}</span>
          </div>
          <div className="installation-status-row">
            <span className="installation-status-label">Source:</span>
            <span className="installation-status-value">Built-in (bundled with app)</span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '12px', lineHeight: '1.4' }}>
            Nimbalyst includes the Claude Agent SDK. No additional installation required.
          </p>
        </div>
      </div>

      {config.enabled && (
        <>
              <div className="provider-panel-section">
                <h4 className="provider-panel-section-title">Authentication</h4>
                <div className="api-key-section">
                  {/* Logged In State - Show success banner */}
                  {loginStatus?.isLoggedIn && (
                    <>
                      <div style={{
                        marginBottom: '16px',
                        padding: '14px 16px',
                        backgroundColor: '#10b98114',
                        border: '1px solid #10b98130',
                        borderRadius: '6px',
                        fontSize: '13px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                          <span style={{ color: '#10b981', fontSize: '20px', lineHeight: 1 }}>✓</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ color: 'var(--text-primary)', fontWeight: '600', fontSize: '14px' }}>
                              Authenticated with Claude Plan
                            </span>
                            {loginStatus.email && (
                              <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                                {loginStatus.email}
                                {loginStatus.organization && ` • ${loginStatus.organization}`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            style={{
                              padding: '6px 12px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              border: '1px solid var(--border-primary)',
                              background: 'var(--surface-secondary)',
                              color: 'var(--text-primary)'
                            }}
                            onClick={checkLoginStatus}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--surface-hover)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'var(--surface-secondary)';
                            }}
                          >
                            Refresh
                          </button>
                          <button
                            style={{
                              padding: '6px 12px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: '500',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              border: '1px solid var(--border-primary)',
                              background: 'var(--surface-secondary)',
                              color: 'var(--text-primary)'
                            }}
                            onClick={handleLogout}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--surface-hover)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'var(--surface-secondary)';
                            }}
                          >
                            Logout
                          </button>
                        </div>
                      </div>

                      {/* Switch Account Option */}
                      <div style={{ marginBottom: '16px' }}>
                        <div style={{
                          fontSize: '13px',
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          marginBottom: '8px'
                        }}>
                          Switch Account
                        </div>
                        <p style={{
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                          marginBottom: '10px',
                          lineHeight: '1.5'
                        }}>
                          Need to use a different Claude account? Logout above and login again.
                        </p>
                      </div>
                    </>
                  )}

                  {/* Not Logged In State - Promote login as primary option */}
                  {loginStatus && !loginStatus.isLoggedIn && (
                    <>
                      {/* Primary Login Card */}
                      <div style={{
                        marginBottom: '16px',
                        padding: '16px',
                        backgroundColor: 'var(--surface-secondary)',
                        border: '1px solid var(--border-primary)',
                        borderRadius: '8px'
                      }}>
                        <div style={{
                          fontSize: '14px',
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          marginBottom: '8px'
                        }}>
                          Recommended: Use Your Claude Plan
                        </div>
                        <p style={{
                          fontSize: '13px',
                          color: 'var(--text-secondary)',
                          marginBottom: '12px',
                          lineHeight: '1.5'
                        }}>
                          Authenticate with your Claude Pro or Team subscription.
                        </p>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            style={{
                              flex: 1,
                              padding: '12px 16px',
                              borderRadius: '6px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                              transition: 'all 0.15s ease',
                              border: 'none',
                              background: isLoggingIn ? 'var(--text-tertiary)' : 'var(--primary-color, #2563eb)',
                              color: 'white',
                              opacity: isLoggingIn ? '0.6' : '1'
                            }}
                            onClick={handleLogin}
                            disabled={isLoggingIn}
                            onMouseEnter={(e) => {
                              if (!isLoggingIn) {
                                e.currentTarget.style.opacity = '0.9';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isLoggingIn) {
                                e.currentTarget.style.opacity = '1';
                              }
                            }}
                          >
                            {isLoggingIn ? 'Opening Login...' : 'Login with Claude Plan'}
                          </button>
                          <button
                            style={{
                              padding: '12px 16px',
                              borderRadius: '6px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              border: '1px solid var(--border-primary)',
                              background: 'var(--surface-secondary)',
                              color: 'var(--text-primary)'
                            }}
                            onClick={checkLoginStatus}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--surface-hover)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'var(--surface-secondary)';
                            }}
                          >
                            Refresh
                          </button>
                        </div>
                        <p style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          marginTop: '8px',
                          lineHeight: '1.4'
                        }}>
                          Opens Terminal for OAuth authentication
                        </p>
                      </div>

                      {/* Divider */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        marginBottom: '16px'
                      }}>
                        <div style={{ flex: 1, height: '1px', background: 'var(--border-primary)' }} />
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          OR
                        </span>
                        <div style={{ flex: 1, height: '1px', background: 'var(--border-primary)' }} />
                      </div>

                      {/* Alternative API Key Option */}
                      <div style={{
                        marginBottom: '16px',
                        padding: '16px',
                        backgroundColor: 'var(--surface-secondary)',
                        border: '1px solid var(--border-primary)',
                        borderRadius: '8px'
                      }}>
                        <div style={{
                          fontSize: '14px',
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          marginBottom: '8px'
                        }}>
                          Alternative: Use API Key
                        </div>
                        <p style={{
                          fontSize: '13px',
                          color: 'var(--text-secondary)',
                          marginBottom: '12px',
                          lineHeight: '1.5'
                        }}>
                          Use an Anthropic API key if you don't have a Claude plan. Pay-per-use with API credits.
                        </p>
                      </div>
                    </>
                  )}

                  {/* API Key Input - Hidden when logged in, visible when not */}
                  {loginStatus?.isLoggedIn ? (
                    <div style={{
                      padding: '12px 16px',
                      backgroundColor: 'var(--surface-secondary)',
                      borderRadius: '6px',
                      opacity: 0.6
                    }}>
                      <div style={{
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}>
                        <span>ℹ️</span>
                        <span>API key not needed - authenticated with Claude Plan</span>
                      </div>
                    </div>
                  ) : (
                    <div className="api-key-row">
                      <input
                        type="password"
                        value={apiKeys['claude-code'] || ''}
                        onChange={(e) => onApiKeyChange('claude-code', e.target.value)}
                        onFocus={(e) => e.target.select()}
                        placeholder="sk-ant-..."
                        className="api-key-input"
                      />
                      {apiKeys['claude-code'] ? (
                        <button
                          className={`test-button ${config.testStatus}`}
                          onClick={onTestConnection}
                          disabled={config.testStatus === 'testing'}
                        >
                          {config.testStatus === 'testing' ? 'Testing...' :
                           config.testStatus === 'success' ? '✓ Connected' :
                           config.testStatus === 'error' ? '✗ Failed' : 'Test'}
                        </button>
                      ) : null}
                    </div>
                  )}

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

              <div className="provider-panel-section">
                <h4 className="provider-panel-section-title">Allowed Tools</h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  Select which tools Claude Code can use. Deselecting tools can improve safety but may limit functionality.
                </p>

                <div className="tools-selection">
                  <div className="tools-header">
                    <label className="cli-config-checkbox">
                      <input
                        type="checkbox"
                        checked={isAllToolsAllowed(config.allowedTools)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            // Select all tools
                            const allToolNames = CLAUDE_CODE_TOOLS.map(t => t.name);
                            onConfigChange({ allowedTools: allToolNames });
                          } else {
                            onConfigChange({ allowedTools: [] });
                          }
                        }}
                      />
                      <span style={{ fontWeight: 600 }}>Select All</span>
                    </label>
                  </div>

                  <div className="tools-categories">
                    {TOOL_CATEGORIES.map(category => {
                      const categoryTools = getToolsByCategory(category.id);
                      // Use default tools if allowedTools is not set
                      const selectedTools = config.allowedTools && config.allowedTools.length > 0
                        ? config.allowedTools
                        : getDefaultAllowedTools();
                      const allCategoryToolsSelected = categoryTools.every(tool =>
                        selectedTools.includes(tool.name)
                      );

                      return (
                        <div key={category.id} className="tool-category">
                          <div className="tool-category-header">
                            <label className="cli-config-checkbox">
                              <input
                                type="checkbox"
                                checked={allCategoryToolsSelected}
                                onChange={(e) => {
                                  const toolNames = categoryTools.map(t => t.name);
                                  // Use default tools as the base if allowedTools is not set
                                  const currentTools = config.allowedTools && config.allowedTools.length > 0
                                    ? config.allowedTools
                                    : getDefaultAllowedTools();
                                  let newAllowedTools = [...currentTools];

                                  if (e.target.checked) {
                                    // Add all category tools
                                    toolNames.forEach(name => {
                                      if (!newAllowedTools.includes(name)) {
                                        newAllowedTools.push(name);
                                      }
                                    });
                                  } else {
                                    // Remove all category tools
                                    newAllowedTools = newAllowedTools.filter(
                                      name => !toolNames.includes(name)
                                    );
                                  }

                                  onConfigChange({ allowedTools: newAllowedTools });
                                }}
                              />
                              <span className="tool-category-name">{category.name}</span>
                            </label>
                            <span className="tool-category-description">{category.description}</span>
                          </div>

                          <div className="tool-list">
                            {categoryTools.map(tool => (
                              <label key={tool.name} className="tool-checkbox">
                                <input
                                  type="checkbox"
                                  checked={selectedTools.includes(tool.name)}
                                  onChange={(e) => {
                                    // Use default tools as the base if allowedTools is not set
                                    const currentTools = config.allowedTools && config.allowedTools.length > 0
                                      ? config.allowedTools
                                      : getDefaultAllowedTools();
                                    let newAllowedTools;

                                    if (e.target.checked) {
                                      newAllowedTools = [...currentTools, tool.name];
                                    } else {
                                      newAllowedTools = currentTools.filter(t => t !== tool.name);
                                    }

                                    onConfigChange({ allowedTools: newAllowedTools });
                                  }}
                                />
                                <span className="tool-name">{tool.name}</span>
                                <span className="tool-description">{tool.description}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
        </>
      )}

      {/* Commented out - no longer managing installation */}
      {/* {installationProgress.isOpen && (
        <InstallationProgress
          title={installationProgress.isNodeJs ? "Installing Node.js" : "Installing Claude Code"}
          status={installationProgress.status}
          progress={installationProgress.progress}
          logs={installationProgress.logs}
          onClose={() => setInstallationProgress(prev => ({ ...prev, isOpen: false }))}
        />
      )} */}
    </div>
  );
}
