import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { VoiceModePanel } from './VoiceModePanel';
import { MCPServersPanel } from '../GlobalSettings/panels/MCPServersPanel';
import { ClaudeCodePluginsPanel } from '../GlobalSettings/panels/ClaudeCodePluginsPanel';
import { SyncPanel, type SyncConfig } from '../GlobalSettings/panels/SyncPanel';
import { ToolPackagesPanel } from './panels/ToolPackagesPanel';
import { ProjectPermissionsPanel } from './panels/ProjectPermissionsPanel';
import { ProviderOverrideWrapper } from './panels/ProviderOverrideWrapper';
import { InstalledExtensionsPanel } from './panels/InstalledExtensionsPanel';
import { walkthroughs } from '../../walkthroughs';

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
  authMethod?: string;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
}

export type SettingsScope = 'user' | 'project';

interface SettingsViewProps {
  workspacePath?: string | null;
  workspaceName?: string | null;
  onClose: () => void;
  initialCategory?: SettingsCategory;
  initialScope?: SettingsScope;
}

export function SettingsView({ workspacePath, workspaceName, onClose, initialCategory, initialScope }: SettingsViewProps) {
  const posthog = usePostHog();

  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>(initialCategory || 'claude-code');
  const [scope, setScope] = useState<SettingsScope>(initialScope || 'user');
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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showToolCalls, setShowToolCalls] = useState(false);

  // Ref to track if we need to save (for debounce)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef(false);
  const performSaveRef = useRef<() => Promise<void>>();
  const [aiDebugLogging, setAiDebugLogging] = useState(false);
  const [completionSoundEnabled, setCompletionSoundEnabled] = useState(false);
  const [completionSoundType, setCompletionSoundType] = useState<'chime' | 'bell' | 'pop' | 'none'>('chime');
  const [osNotificationsEnabled, setOSNotificationsEnabled] = useState(false);
  const [releaseChannel, setReleaseChannel] = useState<'stable' | 'alpha'>('stable');
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [extensionDevToolsEnabled, setExtensionDevToolsEnabled] = useState(false);
  const [walkthroughsEnabled, setWalkthroughsEnabled] = useState(true);
  const [walkthroughsViewedCount, setWalkthroughsViewedCount] = useState(0);
  const [walkthroughsTotalCount, setWalkthroughsTotalCount] = useState(0);
  const [syncConfig, setSyncConfig] = useState<SyncConfig>({
    enabled: false,
    serverUrl: '',
  });
  const [syncTestStatus, setSyncTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [syncTestMessage, setSyncTestMessage] = useState<string | undefined>();

  // Voice Mode settings
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [voiceModeVoice, setVoiceModeVoice] = useState<'marin' | 'cedar'>('marin');
  const [voiceModeShowTranscription, setVoiceModeShowTranscription] = useState(true);
  const [voiceAgentPrompt, setVoiceAgentPrompt] = useState<{ prepend?: string; append?: string }>({});
  const [codingAgentPrompt, setCodingAgentPrompt] = useState<{ prepend?: string; append?: string }>({});

  // Package counts for sidebar badge
  const [installedPackageCount, setInstalledPackageCount] = useState(0);
  const [totalPackageCount, setTotalPackageCount] = useState(0);

  // Valid categories for each scope
  const projectCategories: SettingsCategory[] = ['tool-packages', 'agent-permissions', 'installed-extensions', 'claude-plugins', 'mcp-servers', 'claude-code', 'claude', 'openai', 'openai-codex', 'lmstudio'];
  const userCategories: SettingsCategory[] = ['claude-code', 'claude', 'openai', 'openai-codex', 'lmstudio', 'sync', 'notifications', 'voice-mode', 'advanced', 'installed-extensions', 'claude-plugins', 'mcp-servers'];

  // When initialCategory/initialScope props change, update state (for deep linking)
  useEffect(() => {
    if (initialCategory) {
      setSelectedCategory(initialCategory);
    }
    if (initialScope) {
      setScope(initialScope);
    }
  }, [initialCategory, initialScope]);

  // When scope changes, ensure selected category is valid for that scope
  useEffect(() => {
    const validCategories = scope === 'project' ? projectCategories : userCategories;
    if (!validCategories.includes(selectedCategory)) {
      // Default to first valid category for the scope
      setSelectedCategory(scope === 'project' ? 'tool-packages' : 'claude-code');
    }
  }, [scope]);

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
      // Set default category based on release channel (only if no initial category was provided)
      if (channel === 'alpha' && !initialCategory) {
        setSelectedCategory('sync');
      }

      // Load analytics setting
      const analyticsEnabledSetting = await window.electronAPI.invoke('analytics:is-enabled');
      setAnalyticsEnabled(analyticsEnabledSetting);

      // Load extension dev tools setting
      const extensionDevToolsEnabledSetting = await window.electronAPI.extensionDevTools.isEnabled();
      setExtensionDevToolsEnabled(extensionDevToolsEnabledSetting);

      // Load walkthroughs enabled setting and counts
      const walkthroughState = await window.electronAPI.invoke('walkthroughs:get-state');
      setWalkthroughsEnabled(walkthroughState?.enabled ?? true);
      // Calculate viewed count (completed + dismissed)
      const completedCount = walkthroughState?.completed?.length ?? 0;
      const dismissedCount = walkthroughState?.dismissed?.length ?? 0;
      // Unique viewed = union of completed and dismissed (avoid double counting)
      const viewedIds = new Set([
        ...(walkthroughState?.completed ?? []),
        ...(walkthroughState?.dismissed ?? []),
      ]);
      setWalkthroughsViewedCount(viewedIds.size);
      setWalkthroughsTotalCount(walkthroughs.length);

      // Load sync config
      const syncConfigSetting = await window.electronAPI.invoke('sync:get-config');
      if (syncConfigSetting) {
        setSyncConfig(syncConfigSetting);
      }

      // Initialize voice mode handlers (lazy init to avoid boot-time issues)
      try {
        const initResult = await window.electronAPI.invoke('voice-mode:init');
        // Debug logging - uncomment if needed for troubleshooting voice mode initialization
        // console.log('[Settings] Voice mode init result:', initResult);

        // Load voice mode settings
        const voiceModeSetting = await window.electronAPI.invoke('voice-mode:get-settings');
        // console.log('[Settings] Voice mode settings:', voiceModeSetting);
        if (voiceModeSetting) {
          setVoiceModeEnabled(voiceModeSetting.enabled || false);
          setVoiceModeVoice(voiceModeSetting.voice || 'marin');
          setVoiceModeShowTranscription(voiceModeSetting.showTranscription !== false);
          setVoiceAgentPrompt(voiceModeSetting.voiceAgentPrompt || {});
          setCodingAgentPrompt(voiceModeSetting.codingAgentPrompt || {});
        }
      } catch (error) {
        console.error('[Settings] Failed to initialize/load voice mode:', error);
        // Set defaults if init fails
        setVoiceModeEnabled(false);
        setVoiceModeVoice('marin');
        setVoiceModeShowTranscription(true);
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
    debouncedSave();

    if (enabled && provider !== 'claude-code' && provider !== 'openai-codex') {
      fetchModels(provider);
    }
  };

  const handleApiKeyChange = (key: string, value: string) => {
    setApiKeys(prev => ({ ...prev, [key]: value }));
    debouncedSave();
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

  // Perform the actual save
  const performSave = useCallback(async () => {
    if (!pendingSaveRef.current) return;
    pendingSaveRef.current = false;

    try {
      setSaveStatus('saving');

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

      // Save voice mode settings (ensure handlers are initialized first)
      try {
        await window.electronAPI.invoke('voice-mode:init');
        await window.electronAPI.invoke('voice-mode:set-settings', {
          enabled: voiceModeEnabled,
          voice: voiceModeVoice,
          showTranscription: voiceModeShowTranscription,
          voiceAgentPrompt,
          codingAgentPrompt,
        });
      } catch (error) {
        console.error('[Settings] Failed to save voice mode settings:', error);
      }

      // Clear the model cache to force refresh with new API keys
      await window.electronAPI.aiClearModelCache?.();

      setSaveStatus('saved');

      // Reset status after a delay
      setTimeout(() => setSaveStatus('idle'), 2000);

      // Refresh models for all enabled providers in the background
      Promise.all(
        Object.entries(providers)
          .filter(([_, config]) => config.enabled)
          .map(([provider, _]) => fetchModels(provider))
      ).catch(error => {
        console.error('Failed to refresh models in background:', error);
      });
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [apiKeys, providers, showToolCalls, aiDebugLogging, completionSoundEnabled, completionSoundType, osNotificationsEnabled, releaseChannel, syncConfig, voiceModeEnabled, voiceModeVoice, voiceModeShowTranscription, voiceAgentPrompt, codingAgentPrompt]);

  // Keep the ref in sync with performSave so debounced calls use the latest version
  performSaveRef.current = performSave;

  // Debounced save - call this when settings change
  // Uses a ref to avoid stale closure issues with the timeout
  const debouncedSave = useCallback(() => {
    pendingSaveRef.current = true;

    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout - 500ms debounce
    // Use ref to always call the latest performSave
    saveTimeoutRef.current = setTimeout(() => {
      performSaveRef.current?.();
    }, 500);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Save immediately on unmount if there are pending changes
        if (pendingSaveRef.current) {
          performSaveRef.current?.();
        }
      }
    };
  }, []);

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

    if (selectedCategory === 'agent-permissions' && workspacePath) {
      return (
        <ProjectPermissionsPanel
          workspacePath={workspacePath}
          workspaceName={workspaceName || 'Project'}
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
        debouncedSave();
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
        debouncedSave();
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
        debouncedSave();
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
            debouncedSave();
          }}
          aiDebugLogging={aiDebugLogging}
          onAiDebugLoggingChange={(value) => {
            setAiDebugLogging(value);
            debouncedSave();
          }}
          releaseChannel={releaseChannel}
          onReleaseChannelChange={(value) => {
            setReleaseChannel(value);
            debouncedSave();
          }}
          analyticsEnabled={analyticsEnabled}
          onAnalyticsEnabledChange={async (value) => {
            setAnalyticsEnabled(value);
            await window.electronAPI.invoke('analytics:set-enabled', value);
            debouncedSave();
          }}
          extensionDevToolsEnabled={extensionDevToolsEnabled}
          onExtensionDevToolsEnabledChange={async (value) => {
            setExtensionDevToolsEnabled(value);
            await window.electronAPI.extensionDevTools.setEnabled(value);
            debouncedSave();
          }}
          walkthroughsEnabled={walkthroughsEnabled}
          onWalkthroughsEnabledChange={async (value) => {
            setWalkthroughsEnabled(value);
            await window.electronAPI.invoke('walkthroughs:set-enabled', value);
          }}
          walkthroughsViewedCount={walkthroughsViewedCount}
          walkthroughsTotalCount={walkthroughsTotalCount}
          onWalkthroughsReset={async () => {
            await window.electronAPI.invoke('walkthroughs:reset');
            setWalkthroughsViewedCount(0);
          }}
        />;
      case 'notifications':
        return <NotificationsPanel
          completionSoundEnabled={completionSoundEnabled}
          onCompletionSoundEnabledChange={(value) => {
            setCompletionSoundEnabled(value);
            debouncedSave();
          }}
          completionSoundType={completionSoundType}
          onCompletionSoundTypeChange={(value) => {
            setCompletionSoundType(value);
            debouncedSave();
          }}
          osNotificationsEnabled={osNotificationsEnabled}
          onOSNotificationsEnabledChange={(value) => {
            setOSNotificationsEnabled(value);
            debouncedSave();
          }}
        />;
      case 'voice-mode':
        return <VoiceModePanel
          enabled={voiceModeEnabled}
          onEnabledChange={(value) => {
            setVoiceModeEnabled(value);
            debouncedSave();
          }}
          voice={voiceModeVoice}
          onVoiceChange={(value) => {
            setVoiceModeVoice(value);
            debouncedSave();
          }}
          showTranscription={voiceModeShowTranscription}
          onShowTranscriptionChange={(value) => {
            setVoiceModeShowTranscription(value);
            debouncedSave();
          }}
          hasOpenAIKey={!!apiKeys.openai}
          voiceAgentPrompt={voiceAgentPrompt}
          onVoiceAgentPromptChange={(value) => {
            setVoiceAgentPrompt(value);
            debouncedSave();
          }}
          codingAgentPrompt={codingAgentPrompt}
          onCodingAgentPromptChange={(value) => {
            setCodingAgentPrompt(value);
            debouncedSave();
          }}
        />;
      case 'installed-extensions':
        return (
          <InstalledExtensionsPanel
            scope={scope}
            workspacePath={workspacePath ?? undefined}
          />
        );
      case 'mcp-servers':
        return (
          <MCPServersPanel
            scope={scope === 'project' ? 'workspace' : 'user'}
            workspacePath={scope === 'project' ? workspacePath ?? undefined : undefined}
          />
        );
      case 'claude-plugins':
        return (
          <ClaudeCodePluginsPanel
            scope={scope === 'project' ? 'workspace' : 'user'}
            workspacePath={scope === 'project' ? workspacePath ?? undefined : undefined}
          />
        );
      case 'sync':
        return (
          <SyncPanel
            config={syncConfig}
            onConfigChange={(config) => {
              setSyncConfig(config);
              debouncedSave();
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
  const projectOnlyCategories: SettingsCategory[] = ['tool-packages', 'agent-permissions'];

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



        <div className="settings-scope-container">
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
          <span className="settings-scope-hint">
            {scope === 'user'
              ? 'These settings apply to all projects'
              : `These settings apply only for ${workspaceName || 'this project'}`}
          </span>
        </div>


        <span className={`settings-save-status ${saveStatus}`}>
          {saveStatus === 'saving' && 'Saving...'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Error saving'}
        </span>
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
    </div>
  );
}
