import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAtom } from 'jotai';
import { releaseChannelAtom, CLAUDE_CODE_ENV_VAR_TEMPLATES, ClaudeCodeEnvVarTemplate, ClaudeCodeProviderType } from '../../../store/atoms/appSettings';
import { ProviderConfig, Model } from '../../Settings/SettingsView';
// Import the actual SDK package.json to get the exact installed version
// @ts-ignore - importing json
import sdkPackageJson from '@anthropic-ai/claude-agent-sdk/package.json';
import {ClaudeForWindowsInstallation} from "../../../../main/services/CLIManager.ts";
import {usePostHog} from "posthog-js/react";

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

type AuthMethod = 'login' | 'api-key';

/**
 * Get the current template based on selected env vars pattern
 */
function detectCurrentTemplate(customEnvVars: Record<string, string> | undefined): ClaudeCodeEnvVarTemplate | null {
  if (!customEnvVars || Object.keys(customEnvVars).length === 0) {
    return null;
  }

  // Check for Bedrock pattern
  if (customEnvVars['CLAUDE_CODE_USE_BEDROCK'] === '1') {
    return CLAUDE_CODE_ENV_VAR_TEMPLATES.find(t => t.id === 'bedrock') || null;
  }

  // Check for Vertex pattern
  if (customEnvVars['CLAUDE_CODE_USE_VERTEX'] === '1') {
    return CLAUDE_CODE_ENV_VAR_TEMPLATES.find(t => t.id === 'vertex') || null;
  }

  // Check for z.ai pattern (has ANTHROPIC_AUTH_TOKEN and specific base URL)
  if (customEnvVars['ANTHROPIC_AUTH_TOKEN'] || customEnvVars['ANTHROPIC_BASE_URL']?.includes('z.ai') || customEnvVars['ANTHROPIC_BASE_URL']?.includes('bigmodel.cn')) {
    return CLAUDE_CODE_ENV_VAR_TEMPLATES.find(t => t.id === 'zai') || null;
  }

  // Custom configuration
  return CLAUDE_CODE_ENV_VAR_TEMPLATES.find(t => t.id === 'custom') || null;
}

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
  const [selectedAuthMethod, setSelectedAuthMethod] = useState<AuthMethod>(
    config.authMethod as AuthMethod || 'login'
  );
  const [isCheckingClaudeWindowsStatus, setIsCheckingClaudeWindowsStatus] = useState(true);
  const [claudeCodeWindowsStatus, setClaudeCodeWindowsStatus] = useState<ClaudeForWindowsInstallation | null>(null);
  const posthog = usePostHog();

  // Template selection state for custom provider
  const [selectedTemplate, setSelectedTemplate] = useState<ClaudeCodeEnvVarTemplate | null>(() => {
    // First, try to use the saved template ID
    if (config.selectedTemplateId) {
      const template = CLAUDE_CODE_ENV_VAR_TEMPLATES.find(t => t.id === config.selectedTemplateId);
      if (template) {
        return template;
      }
    }
    // Fallback to detection from env vars
    return detectCurrentTemplate(config.customEnvVars);
  });
  const [showTemplateSelection, setShowTemplateSelection] = useState(false);

  // Check if alpha features should be shown
  const [releaseChannel] = useAtom(releaseChannelAtom);
  const showAlphaFeatures = releaseChannel === 'alpha';

  // Detect Windows platform using navigator.platform (client-side, no IPC needed)
  const isWindowsPlatform = navigator.platform === 'Win32';

  // Provider type (anthropic or custom)
  const providerType: ClaudeCodeProviderType = config.claudeCodeProvider || 'anthropic';

  useEffect(() => {
    // Only check Windows installation status on Windows
    if (isWindowsPlatform) {
      checkClaudeCodeWindowsInstallation();
    } else {
      setIsCheckingClaudeWindowsStatus(false);
    }
    checkLoginStatus();
  }, []);

  // Update selected template when config changes
  useEffect(() => {
    if (providerType === 'custom') {
      const detected = detectCurrentTemplate(config.customEnvVars);
      if (detected && detected.id !== selectedTemplate?.id) {
        setSelectedTemplate(detected);
      }
    }
  }, [config.customEnvVars, providerType]);

  const checkLoginStatus = async () => {
    try {
      const status = await window.electronAPI.invoke('claude-code:check-login');
      setLoginStatus(status);
    } catch (error) {
      console.error('Failed to check login status:', error);
      setLoginStatus({ isLoggedIn: false, hasOAuthToken: false, isExpired: true });
    }
  };

  const checkClaudeCodeWindowsInstallation = async () => {
    try {
      setIsCheckingClaudeWindowsStatus(true);
      console.log('[ClaudeCodePanel] Checking Claude Code Installation Status on Windows...');
      const installation = await window.electronAPI.cliCheckClaudeCodeWindowsInstallation();
      console.log('[ClaudeCodePanel] Claude Code installation status:', JSON.stringify(installation));
      setClaudeCodeWindowsStatus(installation);
      if (installation.isPlatformWindows) {
        posthog.capture('check_claude_code_windows_installation', installation)
      }
    } catch (error) {
      // ignore
    } finally {
      setIsCheckingClaudeWindowsStatus(false);
    }
  };

  function isClaudeCodeWindowsReady(): boolean {
    if (isWindowsPlatform) {
      return Boolean(claudeCodeWindowsStatus?.claudeCodeVersion);
    }
    return true;
  }

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

  /**
   * Switch between Anthropic and Custom provider
   */
  const handleProviderChange = useCallback((newProvider: ClaudeCodeProviderType) => {
    if (newProvider === 'anthropic') {
      // Switching to Anthropic - clear custom env vars and template
      onConfigChange({
        claudeCodeProvider: 'anthropic',
        authMethod: 'login',
        selectedTemplateId: undefined,
        customEnvVars: undefined,
      });
      setSelectedAuthMethod('login');
      setSelectedTemplate(null);
      setShowTemplateSelection(false);
    } else {
      // Switching to Custom - show template selection
      onConfigChange({
        claudeCodeProvider: 'custom',
        authMethod: undefined,
      });
      setShowTemplateSelection(true);
    }
  }, [onConfigChange]);

  /**
   * Select a template and initialize env vars with defaults
   */
  const handleTemplateSelect = useCallback((template: ClaudeCodeEnvVarTemplate) => {
    setSelectedTemplate(template);
    setShowTemplateSelection(false);

    // Initialize env vars with default values from template
    const initialEnvVars: Record<string, string> = {};
    for (const envVar of template.envVars) {
      if (envVar.defaultValue) {
        initialEnvVars[envVar.key] = envVar.defaultValue;
      }
    }

    onConfigChange({
      selectedTemplateId: template.id,
      customEnvVars: initialEnvVars
    });
  }, [onConfigChange]);

  /**
   * Update a single env var value
   */
  const handleEnvVarChange = useCallback((key: string, value: string) => {
    const currentEnvVars = config.customEnvVars || {};
    const newEnvVars = { ...currentEnvVars };

    // If empty, delete the key (don't store empty strings)
    if (value === '') {
      delete newEnvVars[key];
    } else {
      newEnvVars[key] = value;
    }

    onConfigChange({ customEnvVars: newEnvVars });
  }, [config.customEnvVars, onConfigChange]);

  /**
   * Add a new custom env var
   */
  const [newEnvVarKey, setNewEnvVarKey] = useState('');
  const [newEnvVarValue, setNewEnvVarValue] = useState('');

  const handleAddCustomEnvVar = useCallback(() => {
    if (!newEnvVarKey.trim()) return;

    const currentEnvVars = config.customEnvVars || {};
    onConfigChange({
      customEnvVars: {
        ...currentEnvVars,
        [newEnvVarKey.trim()]: newEnvVarValue,
      }
    });

    setNewEnvVarKey('');
    setNewEnvVarValue('');
  }, [newEnvVarKey, newEnvVarValue, config.customEnvVars, onConfigChange]);

  /**
   * Remove a custom env var
   */
  const handleRemoveEnvVar = useCallback((key: string) => {
    const currentEnvVars = config.customEnvVars || {};
    const newEnvVars = { ...currentEnvVars };
    delete newEnvVars[key];
    onConfigChange({ customEnvVars: newEnvVars });
  }, [config.customEnvVars, onConfigChange]);

  // Get additional env var keys that aren't in the template
  const additionalEnvVarKeys = useMemo(() => {
    if (!config.customEnvVars) return [];
    const templateKeys = new Set(selectedTemplate?.envVars.map(e => e.key) || []);
    return Object.keys(config.customEnvVars).filter(key => !templateKeys.has(key));
  }, [config.customEnvVars, selectedTemplate]);

  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">Claude Agent</h3>
        <p className="provider-panel-description">
          Agent mode uses the Claude Code SDK with a few extensions for added functionality in Nimbalyst.
          Has full MCP support with file system access, multi-file operations, and session persistence.
        </p>
      </div>

      <div className="provider-enable" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="provider-enable-label">Enable Claude Agent</span>
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

      { isWindowsPlatform && isCheckingClaudeWindowsStatus && (
        <>
          <div className="installation-status installing">
            <div className="installation-status-row">
              <span className="installation-status-label">Checking Claude Code Installation...</span>
            </div>
          </div>
        </>
      )}
      { !isCheckingClaudeWindowsStatus && (
        <>
          <div className="provider-panel-section">
            { isWindowsPlatform ? (
              <>
                <h4 className="provider-panel-section-title">Claude Code for Windows Installation</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '12px', lineHeight: '1.4' }}>
                  Nimbalyst requires Claude Code for Windows to be installed to use the Claude Code provider.
                </p>
                { Boolean(claudeCodeWindowsStatus?.claudeCodeVersion) ? (
                  <>
                    <div className="installation-status installed">
                      <div className="installation-status-row">
                        <span className="installation-status-label">Claude Code Version:</span>
                        <span className="installation-status-value">{claudeCodeWindowsStatus?.claudeCodeVersion}</span>
                      </div>
                    </div>
                  </>
                ): (
                  <>
                    <div className="installation-status not-installed">
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '12px', lineHeight: '1.4' }}>
                        <div>Install Claude Code for Windows by following the instructions beloew:</div>
                        <div>
                          <ol>
                            <li>Install <a href={'https://git-scm.com/install/windows'}>Git for Windows</a>. This is a prerequisite for installing Claude Code</li>
                            <li>Install <a href={'https://code.claude.com/docs/en/overview#windows'}>Claude Code for Windows</a>.</li>
                            <li>When finished, click the button below to recheck / verify the installation.</li>
                          </ol>
                        </div>
                        <div>
                          <button className={"button-update"} onClick={checkClaudeCodeWindowsInstallation}>Re-verify Claude Code Installation</button>
                        </div>
                      </p>
                    </div>
                  </>
                )}
              </>
            ): (
              <>
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
              </>
            )}
          </div>
        </>
      )}

      {config.enabled && isClaudeCodeWindowsReady() && (
        <>
              {/* Provider Selection (Alpha) */}
              {showAlphaFeatures && (
                <div className="provider-panel-section">
                  <h4 className="provider-panel-section-title">API Provider</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: '1.4' }}>
                    Choose how to connect to the Claude API
                  </p>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    <button
                      style={{
                        flex: 1,
                        padding: '12px 16px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        border: providerType === 'anthropic'
                          ? '2px solid var(--primary-color, #2563eb)'
                          : '1px solid var(--border-primary)',
                        background: providerType === 'anthropic'
                          ? 'var(--primary-color, #2563eb)10'
                          : 'var(--surface-secondary)',
                        color: providerType === 'anthropic'
                          ? 'var(--primary-color, #2563eb)'
                          : 'var(--text-primary)'
                      }}
                      onClick={() => handleProviderChange('anthropic')}
                    >
                      <div style={{ fontWeight: '600' }}>Anthropic (Official)</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        Login with Claude Plan or API Key
                      </div>
                    </button>
                    <button
                      style={{
                        flex: 1,
                        padding: '12px 16px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        border: providerType === 'custom'
                          ? '2px solid var(--primary-color, #2563eb)'
                          : '1px solid var(--border-primary)',
                        background: providerType === 'custom'
                          ? 'var(--primary-color, #2563eb)10'
                          : 'var(--surface-secondary)',
                        color: providerType === 'custom'
                          ? 'var(--primary-color, #2563eb)'
                          : 'var(--text-primary)'
                      }}
                      onClick={() => handleProviderChange('custom')}
                    >
                      <div style={{ fontWeight: '600' }}>Custom</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        Bedrock, Vertex AI, z.ai, etc.
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Anthropic Provider Configuration */}
              {/* Show when: anthropic is selected, OR alpha features are off (non-alpha users always see this) */}
              {(providerType === 'anthropic' || !showAlphaFeatures) && (
                <div className="provider-panel-section">
                  <h4 className="provider-panel-section-title">Authentication</h4>
                  <div className="api-key-section">
                    {/* Authentication Method Selector */}
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        marginBottom: '8px'
                      }}>
                        Authentication Method
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          style={{
                            flex: 1,
                            padding: '10px 16px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            border: selectedAuthMethod === 'login'
                              ? '2px solid var(--primary-color, #2563eb)'
                              : '1px solid var(--border-primary)',
                            background: selectedAuthMethod === 'login'
                              ? 'var(--primary-color, #2563eb)10'
                              : 'var(--surface-secondary)',
                            color: selectedAuthMethod === 'login'
                              ? 'var(--primary-color, #2563eb)'
                              : 'var(--text-primary)'
                          }}
                          onClick={() => {
                            setSelectedAuthMethod('login');
                            onConfigChange({ authMethod: 'login' });
                          }}
                        >
                          Claude Plan (Recommended)
                        </button>
                        <button
                          style={{
                            flex: 1,
                            padding: '10px 16px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: '500',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            border: selectedAuthMethod === 'api-key'
                              ? '2px solid var(--primary-color, #2563eb)'
                              : '1px solid var(--border-primary)',
                            background: selectedAuthMethod === 'api-key'
                              ? 'var(--primary-color, #2563eb)10'
                              : 'var(--surface-secondary)',
                            color: selectedAuthMethod === 'api-key'
                              ? 'var(--primary-color, #2563eb)'
                              : 'var(--text-primary)'
                          }}
                          onClick={() => {
                            setSelectedAuthMethod('api-key');
                            onConfigChange({ authMethod: 'api-key' });
                          }}
                        >
                          API Key
                        </button>
                      </div>
                    </div>

                    {/* Claude Plan Authentication */}
                    {selectedAuthMethod === 'login' && (
                      <>
                        {loginStatus?.isLoggedIn ? (
                          <>
                            {/* Logged In State */}
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
                                <span style={{ color: '#10b981', fontSize: '20px', lineHeight: 1 }}>&#10003;</span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <span style={{ color: 'var(--text-primary)', fontWeight: '600', fontSize: '14px' }}>
                                    Authenticated with Claude Plan
                                  </span>
                                  {loginStatus.email && (
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                                      {loginStatus.email}
                                      {loginStatus.organization && ` - ${loginStatus.organization}`}
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

                            {/* Switch Account Info */}
                            <div style={{ marginBottom: '16px' }}>
                              <p style={{
                                fontSize: '12px',
                                color: 'var(--text-secondary)',
                                lineHeight: '1.5'
                              }}>
                                Need to use a different Claude account? Logout above and login again.
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Not Logged In State */}
                            <div style={{
                              marginBottom: '16px',
                              padding: '16px',
                              backgroundColor: 'var(--surface-secondary)',
                              border: '1px solid var(--border-primary)',
                              borderRadius: '8px'
                            }}>
                              <p style={{
                                fontSize: '13px',
                                color: 'var(--text-secondary)',
                                marginBottom: '12px',
                                lineHeight: '1.5'
                              }}>
                                Authenticate with your Claude Pro or Team subscription. No API credits needed.
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
                          </>
                        )}
                      </>
                    )}

                    {/* API Key Authentication */}
                    {selectedAuthMethod === 'api-key' && (
                      <>
                        <div style={{ marginBottom: '12px' }}>
                          <p style={{
                            fontSize: '13px',
                            color: 'var(--text-secondary)',
                            marginBottom: '12px',
                            lineHeight: '1.5'
                          }}>
                            Use an Anthropic API key. Pay-per-use with API credits from your Anthropic account.
                          </p>
                        </div>
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
                               config.testStatus === 'success' ? 'Connected' :
                               config.testStatus === 'error' ? 'Failed' : 'Test'}
                            </button>
                          ) : null}
                        </div>
                        {config.testMessage && config.testStatus === 'error' && (
                          <div className="test-error">{config.testMessage}</div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Custom Provider Configuration */}
              {providerType === 'custom' && showAlphaFeatures && (
                <div className="provider-panel-section">
                  <h4 className="provider-panel-section-title">Custom Provider Configuration</h4>

                  {/* Template Selection View */}
                  {showTemplateSelection && (
                    <>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.4' }}>
                        Choose a template to get started or configure environment variables manually.
                      </p>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                        gap: '12px',
                        marginBottom: '16px'
                      }}>
                        {CLAUDE_CODE_ENV_VAR_TEMPLATES.map((template) => (
                          <button
                            key={template.id}
                            onClick={() => handleTemplateSelect(template)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              padding: '16px',
                              border: '1px solid var(--border-primary)',
                              borderRadius: '8px',
                              background: 'var(--surface-secondary)',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              textAlign: 'left',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = 'var(--primary-color, #2563eb)';
                              e.currentTarget.style.background = 'var(--surface-hover)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = 'var(--border-primary)';
                              e.currentTarget.style.background = 'var(--surface-secondary)';
                            }}
                          >
                            <div style={{ fontWeight: '600', fontSize: '14px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                              {template.name}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                              {template.description}
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Template Configuration View */}
                  {!showTemplateSelection && selectedTemplate && (
                    <>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '16px'
                      }}>
                        <div>
                          <div style={{ fontWeight: '600', fontSize: '14px', color: 'var(--text-primary)' }}>
                            {selectedTemplate.name}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {selectedTemplate.description}
                          </div>
                        </div>
                        <button
                          onClick={() => setShowTemplateSelection(true)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: '500',
                            cursor: 'pointer',
                            border: '1px solid var(--border-primary)',
                            background: 'var(--surface-secondary)',
                            color: 'var(--text-primary)'
                          }}
                        >
                          Change
                        </button>
                      </div>

                      {selectedTemplate.docsUrl && (
                        <div style={{
                          marginBottom: '16px',
                          padding: '8px 12px',
                          backgroundColor: 'var(--surface-secondary)',
                          border: '1px solid var(--border-primary)',
                          borderRadius: '6px',
                          fontSize: '12px',
                        }}>
                          <a
                            href={selectedTemplate.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}
                          >
                            View documentation
                          </a>
                        </div>
                      )}

                      {/* Template Environment Variables */}
                      {selectedTemplate.envVars.length > 0 && (
                        <div style={{ marginBottom: '16px' }}>
                          <h5 style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '12px' }}>
                            Environment Variables
                          </h5>
                          {selectedTemplate.envVars.map((envVar) => (
                            <div key={envVar.key} style={{ marginBottom: '12px' }}>
                              <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '12px',
                                fontWeight: '600',
                                color: 'var(--text-primary)',
                                marginBottom: '4px'
                              }}>
                                {envVar.label}
                                {envVar.required && <span style={{ color: 'var(--error-color, #ef4444)' }}>*</span>}
                              </label>
                              <input
                                type={envVar.secret ? 'password' : 'text'}
                                value={config.customEnvVars?.[envVar.key] || ''}
                                onChange={(e) => handleEnvVarChange(envVar.key, e.target.value)}
                                placeholder={envVar.placeholder || envVar.defaultValue}
                                style={{
                                  width: '100%',
                                  padding: '8px 12px',
                                  borderRadius: '6px',
                                  fontSize: '13px',
                                  border: '1px solid var(--border-primary)',
                                  background: 'var(--surface-secondary)',
                                  color: 'var(--text-primary)',
                                  fontFamily: 'monospace',
                                }}
                              />
                              {envVar.description && (
                                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                  {envVar.description}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Additional custom env vars (for custom template or extras) */}
                      {(selectedTemplate.id === 'custom' || additionalEnvVarKeys.length > 0) && (
                        <div style={{ marginBottom: '16px' }}>
                          <h5 style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '12px' }}>
                            {selectedTemplate.id === 'custom' ? 'Environment Variables' : 'Additional Variables'}
                          </h5>

                          {/* Existing additional env vars */}
                          {additionalEnvVarKeys.map((key) => (
                            <div key={key} style={{ marginBottom: '8px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                              <input
                                type="text"
                                value={key}
                                disabled
                                style={{
                                  width: '40%',
                                  padding: '8px 12px',
                                  borderRadius: '6px',
                                  fontSize: '13px',
                                  border: '1px solid var(--border-primary)',
                                  background: 'var(--surface-tertiary)',
                                  color: 'var(--text-secondary)',
                                  fontFamily: 'monospace',
                                }}
                              />
                              <input
                                type="text"
                                value={config.customEnvVars?.[key] || ''}
                                onChange={(e) => handleEnvVarChange(key, e.target.value)}
                                style={{
                                  flex: 1,
                                  padding: '8px 12px',
                                  borderRadius: '6px',
                                  fontSize: '13px',
                                  border: '1px solid var(--border-primary)',
                                  background: 'var(--surface-secondary)',
                                  color: 'var(--text-primary)',
                                  fontFamily: 'monospace',
                                }}
                              />
                              <button
                                onClick={() => handleRemoveEnvVar(key)}
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: '6px',
                                  fontSize: '13px',
                                  border: '1px solid var(--border-primary)',
                                  background: 'var(--surface-secondary)',
                                  color: 'var(--text-secondary)',
                                  cursor: 'pointer',
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}

                          {/* Add new env var */}
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                            <input
                              type="text"
                              value={newEnvVarKey}
                              onChange={(e) => setNewEnvVarKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                              placeholder="VARIABLE_NAME"
                              style={{
                                width: '40%',
                                padding: '8px 12px',
                                borderRadius: '6px',
                                fontSize: '13px',
                                border: '1px solid var(--border-primary)',
                                background: 'var(--surface-secondary)',
                                color: 'var(--text-primary)',
                                fontFamily: 'monospace',
                              }}
                            />
                            <input
                              type="text"
                              value={newEnvVarValue}
                              onChange={(e) => setNewEnvVarValue(e.target.value)}
                              placeholder="value"
                              style={{
                                flex: 1,
                                padding: '8px 12px',
                                borderRadius: '6px',
                                fontSize: '13px',
                                border: '1px solid var(--border-primary)',
                                background: 'var(--surface-secondary)',
                                color: 'var(--text-primary)',
                                fontFamily: 'monospace',
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleAddCustomEnvVar();
                                }
                              }}
                            />
                            <button
                              onClick={handleAddCustomEnvVar}
                              disabled={!newEnvVarKey.trim()}
                              style={{
                                padding: '8px 12px',
                                borderRadius: '6px',
                                fontSize: '13px',
                                border: '1px solid var(--border-primary)',
                                background: newEnvVarKey.trim() ? 'var(--primary-color, #2563eb)' : 'var(--surface-tertiary)',
                                color: newEnvVarKey.trim() ? 'white' : 'var(--text-secondary)',
                                cursor: newEnvVarKey.trim() ? 'pointer' : 'not-allowed',
                              }}
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      )}

                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                        These environment variables will be passed to the Claude Code SDK when starting sessions.
                        Authentication credentials from your system environment (AWS credentials, gcloud, etc.) will also be available.
                      </p>
                    </>
                  )}
                </div>
              )}

              <div className="provider-panel-section">
                <h4 className="provider-panel-section-title">Tool Permissions</h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Tool permissions are now managed per-project. When Claude Agent attempts to use a tool,
                  you'll be prompted to allow or deny the action.
                </p>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  To view or modify allowed tools for a project, go to{' '}
                  <strong>Project Settings &gt; Permissions</strong>.
                </p>
              </div>
        </>
      )}
    </div>
  );
}
