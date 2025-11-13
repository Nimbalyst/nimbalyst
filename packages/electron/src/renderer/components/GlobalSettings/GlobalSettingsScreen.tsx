import React, { useState, useEffect } from 'react';
import { getProviderIcon } from '../icons/ProviderIcons';
import { usePostHog } from 'posthog-js/react';
import './GlobalSettingsScreen.css';

// Provider panels
import { ClaudePanel } from './panels/ClaudePanel';
import { ClaudeCodePanel } from './panels/ClaudeCodePanel';
import { OpenAIPanel } from './panels/OpenAIPanel';
import { OpenAICodexPanel } from './panels/OpenAICodexPanel';
import { LMStudioPanel } from './panels/LMStudioPanel';
import { AdvancedPanel } from './panels/AdvancedPanel';
import {AnalyticsSettingsPanel} from "./panels/AnalyticsPanel.tsx";
import { NotificationsPanel } from './panels/NotificationsPanel';

// Apply theme IMMEDIATELY when module loads - BEFORE React renders
// This prevents flash of wrong theme
const applyTheme = () => {
  if (typeof window === 'undefined') return;

  const savedTheme = localStorage.getItem('theme');
  // console.log('[GlobalSettingsScreen] Applying theme:', savedTheme);
  const root = document.documentElement;

  // Clear all theme classes first
  root.classList.remove('light-theme', 'dark-theme', 'crystal-dark-theme');

  if (savedTheme === 'dark') {
    root.setAttribute('data-theme', 'dark');
    root.classList.add('dark-theme');
    // console.log('[GlobalSettingsScreen] Set to dark theme');
  } else if (savedTheme === 'crystal-dark') {
    root.setAttribute('data-theme', 'crystal-dark');
    root.classList.add('crystal-dark-theme');
    // console.log('[GlobalSettingsScreen] Set to crystal-dark theme');
  } else if (savedTheme === 'light') {
    root.setAttribute('data-theme', 'light');
    root.classList.add('light-theme');
    // console.log('[GlobalSettingsScreen] Set to light theme');
  } else {
    // Auto - check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    // console.log('[GlobalSettingsScreen] No saved theme, system prefers dark:', prefersDark);
    if (prefersDark) {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark-theme');
    } else {
      root.setAttribute('data-theme', 'light');
      root.classList.add('light-theme');
    }
  }
  // console.log('[GlobalSettingsScreen] Final classes:', root.className);
  // console.log('[GlobalSettingsScreen] Final data-theme:', root.getAttribute('data-theme'));
};

// Apply theme IMMEDIATELY on module load
applyTheme();

// Listen for theme changes
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'theme') {
      applyTheme();
    }
  });

  // Also listen for IPC theme changes
  if (window.electronAPI?.onThemeChange) {
    window.electronAPI.onThemeChange((theme) => {
      if (localStorage.getItem('theme') !== theme) {
        localStorage.setItem('theme', theme);
        applyTheme();
      }
    });
  }
}

export interface ProviderConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
  testStatus?: 'idle' | 'testing' | 'success' | 'error';
  testMessage?: string;
  // CLI-specific fields
  installed?: boolean;
  version?: string;
  updateAvailable?: boolean;
  installStatus?: 'not-installed' | 'installing' | 'installed' | 'error';
  // Claude Code specific
  allowedTools?: string[];  // List of allowed tool names, ['*'] for all tools
  mcpEnabled?: boolean;
  permissionMode?: string;
  authMethod?: string; // Authentication method: 'login' or 'api-key'
}

export interface Model {
  id: string;
  name: string;
  provider: string;
}

interface AIModelsProps {
  onClose: () => void;
}

type ProviderId = 'claude' | 'claude-code' | 'openai' | 'openai-codex' | 'lmstudio' | 'advanced' | 'analytics' | 'notifications';
type NavItemId = ProviderId;

interface Provider {
  id: ProviderId;
  name: string;
  subtitle: string;
  icon: React.ReactNode;
  type: 'api' | 'cli' | 'local';
}

// All available providers (some may be filtered based on environment)
const ALL_PROVIDERS: Provider[] = [
  {
    id: 'claude',
    name: 'Claude',
    subtitle: 'Anthropic API',
    icon: getProviderIcon('claude', { size: 18 }),
    type: 'api'
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    subtitle: 'CLI-based MCP',
    icon: getProviderIcon('claude-code', { size: 18 }),
    type: 'cli'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    subtitle: 'GPT Models',
    icon: getProviderIcon('openai', { size: 18 }),
    type: 'api'
  },
  {
    id: 'openai-codex',
    name: 'OpenAI Codex',
    subtitle: 'CLI Agent',
    icon: getProviderIcon('openai', { size: 18 }),
    type: 'cli'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    subtitle: 'Local Models',
    icon: getProviderIcon('lmstudio', { size: 18 }),
    type: 'local'
  }
];

// Filter providers based on environment
// In production, hide Codex provider
const PROVIDERS: Provider[] = ALL_PROVIDERS.filter(provider => {
  // Hide Codex in production
  if (provider.id === 'openai-codex' && import.meta.env.PROD) {
    return false;
  }
  return true;
});

export function GlobalSettingsScreen({ onClose }: AIModelsProps) {
  const posthog = usePostHog();

  const [selectedNav, setSelectedNav] = useState<NavItemId>('claude-code');
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
  const [diffViewEnabled, setDiffViewEnabled] = useState(false);
  const [completionSoundEnabled, setCompletionSoundEnabled] = useState(false);
  const [completionSoundType, setCompletionSoundType] = useState<'chime' | 'bell' | 'pop' | 'none'>('chime');
  const [osNotificationsEnabled, setOSNotificationsEnabled] = useState(false);

  // Load current settings on mount
  useEffect(() => {
    loadSettings();

    // No cleanup needed
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

      // Load AI diff view setting
      const diffViewEnabled = await window.electronAPI.isAIDiffViewEnabled();
      setDiffViewEnabled(diffViewEnabled);

      // Fetch ALL models once
      try {
        const response = await window.electronAPI.aiGetAllModels();
        console.log('[GlobalSettings] Initial models fetch response:', response);

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
    // If enabling claude-code or openai-codex, fetch models first to auto-select default
    if (enabled && (provider === 'claude-code' || provider === 'openai-codex')) {
      await fetchModels(provider);
    }

    setProviders(prev => {
      let models = prev[provider]?.models || [];

      // For claude-code and openai-codex, auto-select their default model when enabled
      if (enabled && (provider === 'claude-code' || provider === 'openai-codex')) {
        const providerModels = availableModels[provider] || [];
        if (providerModels.length > 0 && models.length === 0) {
          // Auto-select the first (and only) model for these providers
          models = [providerModels[0].id];
        }
      }

      // Track ai_provider_configured analytics event
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

    // Fetch models for other providers after enabling
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
      console.log('[GlobalSettings] Fetched ALL models response:', response);

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

    // Save AI diff view setting
    await window.electronAPI.setAIDiffViewEnabled(diffViewEnabled);

    // Clear the model cache to force refresh with new API keys
    await window.electronAPI.aiClearModelCache?.();

    // Refresh models for all enabled providers with new API keys
    for (const [provider, config] of Object.entries(providers)) {
      if (config.enabled) {
        await fetchModels(provider);
      }
    }

    setHasChanges(false);
    onClose();
  };

  const renderProviderPanel = () => {
    const commonProps = {
      config: providers[selectedNav] || { enabled: false, testStatus: 'idle' },
      apiKeys,
      availableModels: availableModels[selectedNav] || [],
      loading: loading[selectedNav] || false,
      onToggle: (enabled: boolean) => handleProviderToggle(selectedNav, enabled),
      onApiKeyChange: handleApiKeyChange,
      onModelToggle: (modelId: string, enabled: boolean) => {
        setProviders(prev => {
          const models = prev[selectedNav]?.models || [];
          const updated = enabled
            ? [...models, modelId]
            : models.filter(m => m !== modelId);

          // Track ai_model_selected analytics event
          if (enabled) {
            // Extract model name from model ID (format: provider:model-name)
            const modelName = modelId.includes(':') ? modelId.split(':')[1] : modelId;
            posthog?.capture('ai_model_selected', {
              provider: selectedNav,
              modelName
            });
          }

          return {
            ...prev,
            [selectedNav]: { ...prev[selectedNav], models: updated }
          };
        });
        setHasChanges(true);
      },
      onSelectAllModels: (selectAll: boolean) => {
        if (selectAll) {
          const models = availableModels[selectedNav] || [];
          setProviders(prev => ({
            ...prev,
            [selectedNav]: { ...prev[selectedNav], models: models.map(m => m.id) }
          }));
        } else {
          setProviders(prev => ({
            ...prev,
            [selectedNav]: { ...prev[selectedNav], models: [] }
          }));
        }
        setHasChanges(true);
      },
      onTestConnection: async () => {
        setProviders(prev => ({
          ...prev,
          [selectedNav]: { ...prev[selectedNav], testStatus: 'testing', testMessage: undefined }
        }));

        // Save the current API keys FIRST
        const settings = {
          apiKeys,
          providerSettings: providers
        };
        await window.electronAPI.aiSaveSettings(settings);

        try {
          const result = await window.electronAPI.aiTestConnection(selectedNav);

          setProviders(prev => ({
            ...prev,
            [selectedNav]: {
              ...prev[selectedNav],
              testStatus: result.success ? 'success' : 'error',
              testMessage: result.success ? 'Connected' : result.error
            }
          }));

          if (result.success) {
            await window.electronAPI.aiClearModelCache?.();
            await fetchModels(selectedNav);
          }
        } catch (error) {
          setProviders(prev => ({
            ...prev,
            [selectedNav]: {
              ...prev[selectedNav],
              testStatus: 'error',
              testMessage: 'Connection failed'
            }
          }));
        }
      },
      onConfigChange: (updates: Partial<ProviderConfig>) => {
        setProviders(prev => ({
          ...prev,
          [selectedNav]: { ...prev[selectedNav], ...updates }
        }));
        setHasChanges(true);
      }
    };

    switch (selectedNav) {
      case 'claude':
        return <ClaudePanel {...commonProps} />;
      case 'claude-code':
        return <ClaudeCodePanel {...commonProps} />;
      case 'openai':
        return <OpenAIPanel {...commonProps} />;
      case 'openai-codex':
        return <OpenAICodexPanel {...commonProps} />;
      case 'lmstudio':
        return <LMStudioPanel {...commonProps} />;
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
          diffViewEnabled={diffViewEnabled}
          onDiffViewEnabledChange={(value) => {
            setDiffViewEnabled(value);
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
      default:
        return null;
    }
  };

  const getProviderStatus = (providerId: ProviderId): 'active' | 'configured' | 'warning' | 'inactive' => {
    const config = providers[providerId];

    if (!config.enabled) {
      return 'inactive';
    }

    // For CLI providers, check installation status
    if (providerId === 'claude-code' || providerId === 'openai-codex') {
      if (config.installStatus === 'not-installed') {
        return 'warning';
      }
      if (config.updateAvailable) {
        return 'warning';
      }
    }

    // For API providers, check API key and connection
    if (providerId === 'claude' || providerId === 'openai') {
      const keyName = providerId === 'claude' ? 'anthropic' : 'openai';
      if (!apiKeys[keyName]) {
        return 'warning';
      }
      if (config.testStatus === 'error') {
        return 'warning';
      }
    }

    if (config.testStatus === 'success') {
      return 'active';
    }

    return 'configured';
  };

  return (
    <div className="global-settings-redesigned">


      <div className="global-settings-body">
        <nav className="global-settings-nav">
          <div className="global-settings-header">
            <h2>Global Settings</h2>
          </div>

          <div className="nav-section">
            <div className="nav-section-title">Agents</div>
            {PROVIDERS.filter(p => p.type === 'cli').map(provider => {
              const status = getProviderStatus(provider.id);
              return (
                <button
                  key={provider.id}
                  className={`nav-item ${selectedNav === provider.id ? 'active' : ''}`}
                  onClick={() => setSelectedNav(provider.id)}
                >
                  <span className="nav-item-icon">{provider.icon}</span>
                  <div className="nav-item-content">
                    <div className="nav-item-title">{provider.name}</div>
                    <div className="nav-item-subtitle">{provider.subtitle}</div>
                  </div>
                  <span className={`nav-item-status ${status}`}>
                    {status === 'active' && '●'}
                    {status === 'configured' && '●'}
                    {status === 'warning' && '⚠'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="nav-section">
            <div className="nav-section-title">Models</div>
            {PROVIDERS.filter(p => p.type === 'api' || p.type === 'local').map(provider => {
              const status = getProviderStatus(provider.id);
              return (
                <button
                  key={provider.id}
                  className={`nav-item ${selectedNav === provider.id ? 'active' : ''}`}
                  onClick={() => setSelectedNav(provider.id)}
                >
                  <span className="nav-item-icon">{provider.icon}</span>
                  <div className="nav-item-content">
                    <div className="nav-item-title">{provider.name}</div>
                    <div className="nav-item-subtitle">{provider.subtitle}</div>
                  </div>
                  <span className={`nav-item-status ${status}`}>
                    {status === 'active' && '●'}
                    {status === 'configured' && '●'}
                    {status === 'warning' && '⚠'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="nav-section nav-section-bottom">
            <button
              className={`nav-action-button ${selectedNav === 'notifications' ? 'active' : ''}`}
              onClick={() => setSelectedNav('notifications')}
            >
              Notifications
            </button>
            <button
              className={`nav-action-button ${selectedNav === 'advanced' ? 'active' : ''}`}
              onClick={() => setSelectedNav('advanced')}
            >
              Advanced Settings
            </button>
            <button className="nav-action-button">
              Documentation
            </button>
          </div>
        </nav>

        <main className="global-settings-main">
          {renderProviderPanel()}
        </main>
      </div>

      <div className="global-settings-footer">
        <button
          className="button-cancel"
          onClick={onClose}
        >
          Cancel
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
