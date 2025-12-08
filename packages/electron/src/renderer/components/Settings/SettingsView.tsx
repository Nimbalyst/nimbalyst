import React, { useState, useEffect } from 'react';
import { usePostHog } from 'posthog-js/react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { SettingsSidebar, type SettingsCategory } from './SettingsSidebar';
import './SettingsView.css';

// Import provider panels from GlobalSettings
import { ClaudePanel } from '../GlobalSettings/panels/ClaudePanel';
import { ClaudeCodePanel } from '../GlobalSettings/panels/ClaudeCodePanel';
import { OpenAIPanel } from '../GlobalSettings/panels/OpenAIPanel';
import { OpenAICodexPanel } from '../GlobalSettings/panels/OpenAICodexPanel';
import { LMStudioPanel } from '../GlobalSettings/panels/LMStudioPanel';
import { AdvancedPanel } from '../GlobalSettings/panels/AdvancedPanel';
import { NotificationsPanel } from '../GlobalSettings/panels/NotificationsPanel';
import { MCPServersPanel } from '../GlobalSettings/panels/MCPServersPanel';
import { SyncPanel, type SyncConfig } from '../GlobalSettings/panels/SyncPanel';
import { ToolPackagesPanel } from './panels/ToolPackagesPanel';
import { ProviderOverrideWrapper } from './panels/ProviderOverrideWrapper';

export interface ProviderConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
  testStatus?: 'idle' | 'testing' | 'success' | 'error';
  testMessage?: string;
  installed?: boolean;
  version?: string;
  updateAvailable?: boolean;
  installStatus?: 'not-installed' | 'installing' | 'installed' | 'error';
  allowedTools?: string[];
  mcpEnabled?: boolean;
  permissionMode?: string;
  authMethod?: string;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
}

interface SettingsViewProps {
  workspacePath?: string | null;
  workspaceName?: string | null;
  onClose: () => void;
}

export type SettingsScope = 'user' | 'project';

export function SettingsView({ workspacePath, workspaceName, onClose }: SettingsViewProps) {
  const posthog = usePostHog();

  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>('claude-code');
  const [scope, setScope] = useState<SettingsScope>('user');
  const [searchQuery, setSearchQuery] = useState('');
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({
    claude: { enabled: false, testStatus: 'idle' },
    'claude-code': { enabled: true, testStatus: 'idle', installStatus: 'not-installed' },
    openai: { enabled: false, testStatus: 'idle' },
    'openai-codex': { enabled: false, testStatus: 'idle', installStatus: 'not-installed' },
    lmstudio: { enabled: false, baseUrl: 'http://127.0.0.1:8234', testStatus: 'idle' }
  });

  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    anthropic: '',
    openai: '',
    lmstudio_url: 'http://127.0.0.1:8234'
  });

  const [availableModels, setAvailableModels] = useState<Record<string, Model[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [showToolCalls, setShowToolCalls] = useState(false);
  const [aiDebugLogging, setAiDebugLogging] = useState(false);
  const [completionSoundEnabled, setCompletionSoundEnabled] = useState(false);
  const [completionSoundType, setCompletionSoundType] = useState<'chime' | 'bell' | 'pop' | 'none'>('chime');
  const [osNotificationsEnabled, setOSNotificationsEnabled] = useState(false);
  const [releaseChannel, setReleaseChannel] = useState<'stable' | 'alpha'>('stable');
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [syncConfig, setSyncConfig] = useState<SyncConfig>({
    enabled: false,
    serverUrl: '',
    userId: '',
    authToken: '',
  });
  const [syncTestStatus, setSyncTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [syncTestMessage, setSyncTestMessage] = useState<string | undefined>();

  // Package counts for sidebar badge
  const [installedPackageCount, setInstalledPackageCount] = useState(0);
  const [totalPackageCount, setTotalPackageCount] = useState(0);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await window.electronAPI.aiGetSettings();
      if (settings.apiKeys) {
        setApiKeys(settings.apiKeys);
      }
      if (settings.providerSettings) {
        setProviders(prev => {
          const updated = { ...prev };
          Object.entries(settings.providerSettings).forEach(([key, value]: [string, any]) => {
            if (updated[key]) {
              updated[key] = { ...updated[key], ...value };
            }
          });
          return updated;
        });
      }
      if (settings.showToolCalls !== undefined) {
        setShowToolCalls(settings.showToolCalls);
      }
      if (settings.aiDebugLogging !== undefined) {
        setAiDebugLogging(settings.aiDebugLogging);
      }

      // Load completion sound settings
      const soundEnabled = await window.electronAPI.invoke('completion-sound:is-enabled');
      const soundType = await window.electronAPI.invoke('completion-sound:get-type');
      setCompletionSoundEnabled(soundEnabled);
      setCompletionSoundType(soundType);

      // Load OS notifications settings
      const osNotifEnabled = await window.electronAPI.invoke('notifications:get-enabled');
      setOSNotificationsEnabled(osNotifEnabled);

      // Load release channel setting
      const channel = await window.electronAPI.invoke('release-channel:get');
      setReleaseChannel(channel);
      // Set default category based on release channel
      if (channel === 'alpha') {
        setSelectedCategory('sync');
      }

      // Load analytics setting
      const analyticsEnabledSetting = await window.electronAPI.invoke('analytics:is-enabled');
      setAnalyticsEnabled(analyticsEnabledSetting);

      // Load sync config
      const syncConfigSetting = await window.electronAPI.invoke('sync:get-config');
      if (syncConfigSetting) {
        setSyncConfig(syncConfigSetting);
      }

      // Fetch ALL models once
      try {
        const response = await window.electronAPI.aiGetAllModels();
        if (response.success && response.grouped) {
          setAvailableModels(response.grouped);
        }
      } catch (error) {
        console.error('Failed to fetch initial models:', error);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleProviderToggle = async (provider: string, enabled: boolean) => {
    if (enabled && (provider === 'claude-code' || provider === 'openai-codex')) {
      await fetchModels(provider);
    }

    setProviders(prev => {
      let models = prev[provider]?.models || [];

      if (enabled && (provider === 'claude-code' || provider === 'openai-codex')) {
        const providerModels = availableModels[provider] || [];
        if (providerModels.length > 0 && models.length === 0) {
          models = [providerModels[0].id];
        }
      }

      posthog?.capture('ai_provider_configured', {
        provider,
        modelCount: models.length,
        action: enabled ? 'enabled' : 'disabled'
      });

      return {
        ...prev,
        [provider]: {
          ...prev[provider],
          enabled,
          models
        }
      };
    });
    setHasChanges(true);

    if (enabled && provider !== 'claude-code' && provider !== 'openai-codex') {
      fetchModels(provider);
    }
  };

  const handleApiKeyChange = (key: string, value: string) => {
    setApiKeys(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const fetchModels = async (provider: string) => {
    setLoading(prev => ({ ...prev, [provider]: true }));

    try {
      const response = await window.electronAPI.aiGetAllModels();
      if (response.success && response.grouped) {
        setAvailableModels(response.grouped);
      }
    } catch (error) {
      console.error(`Failed to fetch models for ${provider}:`, error);
    } finally {
      setLoading(prev => ({ ...prev, [provider]: false }));
    }
  };

  const handleSave = async () => {
    const settings = {
      apiKeys,
      providerSettings: providers,
      showToolCalls,
      aiDebugLogging
    };

    await window.electronAPI.aiSaveSettings(settings);

    // Save completion sound settings
    await window.electronAPI.invoke('completion-sound:set-enabled', completionSoundEnabled);
    await window.electronAPI.invoke('completion-sound:set-type', completionSoundType);

    // Save OS notifications settings
    await window.electronAPI.invoke('notifications:set-enabled', osNotificationsEnabled);

    // Save release channel setting
    await window.electronAPI.invoke('release-channel:set', releaseChannel);

    // Save sync config
    await window.electronAPI.invoke('sync:set-config', syncConfig.enabled ? syncConfig : null);

    // Clear the model cache to force refresh with new API keys
    await window.electronAPI.aiClearModelCache?.();

    setHasChanges(false);
    onClose();

    // Refresh models for all enabled providers in the background
    Promise.all(
      Object.entries(providers)
        .filter(([_, config]) => config.enabled)
        .map(([provider, _]) => fetchModels(provider))
    ).catch(error => {
      console.error('Failed to refresh models in background:', error);
    });
  };

  // Build provider status for sidebar
  const providerStatus = Object.fromEntries(
    Object.entries(providers).map(([id, config]) => [
      id,
      { enabled: config.enabled, testStatus: config.testStatus }
    ])
  );

  const renderPanel = () => {
    // Project panels
    if (selectedCategory === 'tool-packages' && workspacePath) {
      return (
        <ToolPackagesPanel
          workspacePath={workspacePath}
          workspaceName={workspaceName || 'Project'}
          onPackagesChange={(installed, total) => {
            setInstalledPackageCount(installed);
            setTotalPackageCount(total);
          }}
        />
      );
    }

    // Provider panels
    const commonProps = {
      config: providers[selectedCategory] || { enabled: false, testStatus: 'idle' },
      apiKeys,
      availableModels: availableModels[selectedCategory] || [],
      loading: loading[selectedCategory] || false,
      onToggle: (enabled: boolean) => handleProviderToggle(selectedCategory, enabled),
      onApiKeyChange: handleApiKeyChange,
      onModelToggle: (modelId: string, enabled: boolean) => {
        setProviders(prev => {
          const models = prev[selectedCategory]?.models || [];
          const updated = enabled
            ? [...models, modelId]
            : models.filter(m => m !== modelId);

          if (enabled) {
            const modelName = modelId.includes(':') ? modelId.split(':')[1] : modelId;
            posthog?.capture('ai_model_selected', {
              provider: selectedCategory,
              modelName
            });
          }

          return {
            ...prev,
            [selectedCategory]: { ...prev[selectedCategory], models: updated }
          };
        });
        setHasChanges(true);
      },
      onSelectAllModels: (selectAll: boolean) => {
        if (selectAll) {
          const models = availableModels[selectedCategory] || [];
          setProviders(prev => ({
            ...prev,
            [selectedCategory]: { ...prev[selectedCategory], models: models.map(m => m.id) }
          }));
        } else {
          setProviders(prev => ({
            ...prev,
            [selectedCategory]: { ...prev[selectedCategory], models: [] }
          }));
        }
        setHasChanges(true);
      },
      onTestConnection: async () => {
        setProviders(prev => ({
          ...prev,
          [selectedCategory]: { ...prev[selectedCategory], testStatus: 'testing', testMessage: undefined }
        }));

        const settings = {
          apiKeys,
          providerSettings: providers
        };
        await window.electronAPI.aiSaveSettings(settings);

        try {
          const result = await window.electronAPI.aiTestConnection(selectedCategory);

          setProviders(prev => ({
            ...prev,
            [selectedCategory]: {
              ...prev[selectedCategory],
              testStatus: result.success ? 'success' : 'error',
              testMessage: result.success ? 'Connected' : result.error
            }
          }));

          if (result.success) {
            await window.electronAPI.aiClearModelCache?.();
            await fetchModels(selectedCategory);
          }
        } catch (error) {
          setProviders(prev => ({
            ...prev,
            [selectedCategory]: {
              ...prev[selectedCategory],
              testStatus: 'error',
              testMessage: 'Connection failed'
            }
          }));
        }
      },
      onConfigChange: (updates: Partial<ProviderConfig>) => {
        setProviders(prev => ({
          ...prev,
          [selectedCategory]: { ...prev[selectedCategory], ...updates }
        }));
        setHasChanges(true);
      }
    };

    // Helper to wrap provider panels with override wrapper when in project scope
    const wrapWithOverride = (providerId: string, providerName: string, panel: React.ReactNode) => {
      if (scope === 'project' && workspacePath) {
        return (
          <ProviderOverrideWrapper
            providerId={providerId}
            providerName={providerName}
            workspacePath={workspacePath}
            workspaceName={workspaceName || 'Project'}
            globalEnabled={providers[providerId]?.enabled ?? false}
            onOverrideChange={() => loadSettings()}
          >
            {panel}
          </ProviderOverrideWrapper>
        );
      }
      return panel;
    };

    switch (selectedCategory) {
      case 'claude':
        return wrapWithOverride('claude', 'Claude', <ClaudePanel {...commonProps} />);
      case 'claude-code':
        return wrapWithOverride('claude-code', 'Claude Agent', <ClaudeCodePanel {...commonProps} />);
      case 'openai':
        return wrapWithOverride('openai', 'OpenAI', <OpenAIPanel {...commonProps} />);
      case 'openai-codex':
        return wrapWithOverride('openai-codex', 'OpenAI Codex', <OpenAICodexPanel {...commonProps} />);
      case 'lmstudio':
        return wrapWithOverride('lmstudio', 'LM Studio', <LMStudioPanel {...commonProps} />);
      case 'advanced':
        return <AdvancedPanel
          showToolCalls={showToolCalls}
          onShowToolCallsChange={(value) => {
            setShowToolCalls(value);
            setHasChanges(true);
          }}
          aiDebugLogging={aiDebugLogging}
          onAiDebugLoggingChange={(value) => {
            setAiDebugLogging(value);
            setHasChanges(true);
          }}
          releaseChannel={releaseChannel}
          onReleaseChannelChange={(value) => {
            setReleaseChannel(value);
            setHasChanges(true);
          }}
          analyticsEnabled={analyticsEnabled}
          onAnalyticsEnabledChange={async (value) => {
            setAnalyticsEnabled(value);
            await window.electronAPI.invoke('analytics:set-enabled', value);
            setHasChanges(true);
          }}
        />;
      case 'notifications':
        return <NotificationsPanel
          completionSoundEnabled={completionSoundEnabled}
          onCompletionSoundEnabledChange={(value) => {
            setCompletionSoundEnabled(value);
            setHasChanges(true);
          }}
          completionSoundType={completionSoundType}
          onCompletionSoundTypeChange={(value) => {
            setCompletionSoundType(value);
            setHasChanges(true);
          }}
          osNotificationsEnabled={osNotificationsEnabled}
          onOSNotificationsEnabledChange={(value) => {
            setOSNotificationsEnabled(value);
            setHasChanges(true);
          }}
        />;
      case 'mcp-servers':
        // When in project scope, default to workspace mode with current workspace
        return (
          <MCPServersPanel
            defaultScope={scope === 'project' ? 'workspace' : 'user'}
            workspacePath={scope === 'project' && workspacePath ? workspacePath : undefined}
          />
        );
      case 'sync':
        return (
          <SyncPanel
            config={syncConfig}
            onConfigChange={(config) => {
              setSyncConfig(config);
              setHasChanges(true);
            }}
            onTestConnection={async () => {
              setSyncTestStatus('testing');
              setSyncTestMessage(undefined);
              try {
                const result = await window.electronAPI.invoke('sync:test-connection', syncConfig);
                if (result.success) {
                  setSyncTestStatus('success');
                } else {
                  setSyncTestStatus('error');
                  setSyncTestMessage(result.error || 'Connection failed');
                }
              } catch (error) {
                setSyncTestStatus('error');
                setSyncTestMessage(error instanceof Error ? error.message : 'Connection failed');
              }
            }}
            testStatus={syncTestStatus}
            testMessage={syncTestMessage}
          />
        );
      default:
        return null;
    }
  };

  // Categories that are only available in project scope
  const projectOnlyCategories: SettingsCategory[] = ['tool-packages'];

  // Handle scope changes - preserve selected category when possible
  const handleScopeChange = (newScope: SettingsScope) => {
    setScope(newScope);
    // Only change category if current one is not available in the new scope
    if (newScope === 'user' && projectOnlyCategories.includes(selectedCategory)) {
      // Switching to user scope from a project-only category
      setSelectedCategory('claude-code');
    }
    // When switching to project scope, keep the current category (all user categories are available in project scope)
  };

  return (
    <div className="settings-view">
      {/* Settings Header */}
      <header className="settings-view-header">
        <span className="settings-view-title">Settings</span>

        <div className="settings-search">
          <MaterialSymbol icon="search" size={14} className="settings-search-icon" />
          <input
            type="text"
            placeholder="Search settings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="settings-scope-tabs">
          <button
            className={`settings-scope-tab ${scope === 'user' ? 'active' : ''}`}
            onClick={() => handleScopeChange('user')}
          >
            User
          </button>
          <button
            className={`settings-scope-tab ${scope === 'project' ? 'active' : ''}`}
            onClick={() => handleScopeChange('project')}
            disabled={!workspacePath}
            title={!workspacePath ? 'Open a project to access project settings' : undefined}
          >
            Project
          </button>
        </div>
      </header>

      <div className="settings-view-body">
        <SettingsSidebar
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          providerStatus={providerStatus}
          installedPackageCount={installedPackageCount}
          totalPackageCount={totalPackageCount}
          scope={scope}
          releaseChannel={releaseChannel}
        />

        <main className="settings-view-main">
          {renderPanel()}
        </main>
      </div>

      <div className="settings-view-footer">
        <button
          className="button-cancel"
          onClick={onClose}
        >
          Close
        </button>
        <button
          className="button-save"
          onClick={handleSave}
          disabled={!hasChanges}
        >
          {hasChanges ? 'Save Changes' : 'Save'}
        </button>
      </div>
    </div>
  );
}
