import React, { useState, useEffect } from 'react';
import { getProviderIcon } from '../icons/ProviderIcons';
import './AIModelsRedesigned.css';

// Provider panels
import { ClaudePanel } from './panels/ClaudePanel';
import { ClaudeCodePanel } from './panels/ClaudeCodePanel';
import { OpenAIPanel } from './panels/OpenAIPanel';
import { OpenAICodexPanel } from './panels/OpenAICodexPanel';
import { LMStudioPanel } from './panels/LMStudioPanel';
import { AdvancedPanel } from './panels/AdvancedPanel';

// Apply theme IMMEDIATELY when module loads - BEFORE React renders
// This prevents flash of wrong theme
const applyTheme = () => {
  if (typeof window === 'undefined') return;

  const savedTheme = localStorage.getItem('theme');
  // console.log('[AIModelsRedesigned] Applying theme:', savedTheme);
  const root = document.documentElement;

  // Clear all theme classes first
  root.classList.remove('light-theme', 'dark-theme', 'crystal-dark-theme');

  if (savedTheme === 'dark') {
    root.setAttribute('data-theme', 'dark');
    root.classList.add('dark-theme');
    // console.log('[AIModelsRedesigned] Set to dark theme');
  } else if (savedTheme === 'crystal-dark') {
    root.setAttribute('data-theme', 'crystal-dark');
    root.classList.add('crystal-dark-theme');
    // console.log('[AIModelsRedesigned] Set to crystal-dark theme');
  } else if (savedTheme === 'light') {
    root.setAttribute('data-theme', 'light');
    root.classList.add('light-theme');
    // console.log('[AIModelsRedesigned] Set to light theme');
  } else {
    // Auto - check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    // console.log('[AIModelsRedesigned] No saved theme, system prefers dark:', prefersDark);
    if (prefersDark) {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark-theme');
    } else {
      root.setAttribute('data-theme', 'light');
      root.classList.add('light-theme');
    }
  }
  // console.log('[AIModelsRedesigned] Final classes:', root.className);
  // console.log('[AIModelsRedesigned] Final data-theme:', root.getAttribute('data-theme'));
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
}

export interface Model {
  id: string;
  name: string;
  provider: string;
}

interface AIModelsProps {
  onClose: () => void;
}

type ProviderId = 'claude' | 'claude-code' | 'openai' | 'openai-codex' | 'lmstudio' | 'advanced';

interface Provider {
  id: ProviderId;
  name: string;
  subtitle: string;
  icon: React.ReactNode;
  type: 'api' | 'cli' | 'local';
}

const PROVIDERS: Provider[] = [
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

export function AIModelsRedesigned({ onClose }: AIModelsProps) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('claude');
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({
    claude: { enabled: false, testStatus: 'idle' },
    'claude-code': { enabled: false, testStatus: 'idle', installStatus: 'not-installed' },
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

      // Fetch ALL models once
      try {
        const response = await window.electronAPI.aiGetAllModels();
        console.log('[AIModels] Initial models fetch response:', response);

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
      console.log('[AIModels] Fetched ALL models response:', response);

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
      showToolCalls
    };

    await window.electronAPI.aiSaveSettings(settings);

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
      config: providers[selectedProvider] || { enabled: false, testStatus: 'idle' },
      apiKeys,
      availableModels: availableModels[selectedProvider] || [],
      loading: loading[selectedProvider] || false,
      onToggle: (enabled: boolean) => handleProviderToggle(selectedProvider, enabled),
      onApiKeyChange: handleApiKeyChange,
      onModelToggle: (modelId: string, enabled: boolean) => {
        setProviders(prev => {
          const models = prev[selectedProvider]?.models || [];
          const updated = enabled
            ? [...models, modelId]
            : models.filter(m => m !== modelId);

          return {
            ...prev,
            [selectedProvider]: { ...prev[selectedProvider], models: updated }
          };
        });
        setHasChanges(true);
      },
      onSelectAllModels: (selectAll: boolean) => {
        if (selectAll) {
          const models = availableModels[selectedProvider] || [];
          setProviders(prev => ({
            ...prev,
            [selectedProvider]: { ...prev[selectedProvider], models: models.map(m => m.id) }
          }));
        } else {
          setProviders(prev => ({
            ...prev,
            [selectedProvider]: { ...prev[selectedProvider], models: [] }
          }));
        }
        setHasChanges(true);
      },
      onTestConnection: async () => {
        setProviders(prev => ({
          ...prev,
          [selectedProvider]: { ...prev[selectedProvider], testStatus: 'testing', testMessage: undefined }
        }));

        // Save the current API keys FIRST
        const settings = {
          apiKeys,
          providerSettings: providers
        };
        await window.electronAPI.aiSaveSettings(settings);

        try {
          const result = await window.electronAPI.aiTestConnection(selectedProvider);

          setProviders(prev => ({
            ...prev,
            [selectedProvider]: {
              ...prev[selectedProvider],
              testStatus: result.success ? 'success' : 'error',
              testMessage: result.success ? 'Connected' : result.error
            }
          }));

          if (result.success) {
            await window.electronAPI.aiClearModelCache?.();
            await fetchModels(selectedProvider);
          }
        } catch (error) {
          setProviders(prev => ({
            ...prev,
            [selectedProvider]: {
              ...prev[selectedProvider],
              testStatus: 'error',
              testMessage: 'Connection failed'
            }
          }));
        }
      },
      onConfigChange: (updates: Partial<ProviderConfig>) => {
        setProviders(prev => ({
          ...prev,
          [selectedProvider]: { ...prev[selectedProvider], ...updates }
        }));
        setHasChanges(true);
      }
    };

    switch (selectedProvider) {
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
    <div className="ai-models-redesigned">
      <div className="ai-models-header">
        <h2>AI Provider Configuration</h2>
      </div>

      <div className="ai-models-body">
        <nav className="ai-models-nav">
          <div className="nav-section">
            <div className="nav-section-title">Agents</div>
            {PROVIDERS.filter(p => p.type === 'cli').map(provider => {
              const status = getProviderStatus(provider.id);
              return (
                <button
                  key={provider.id}
                  className={`nav-item ${selectedProvider === provider.id ? 'active' : ''}`}
                  onClick={() => setSelectedProvider(provider.id)}
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
                  className={`nav-item ${selectedProvider === provider.id ? 'active' : ''}`}
                  onClick={() => setSelectedProvider(provider.id)}
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
              className={`nav-action-button ${selectedProvider === 'advanced' ? 'active' : ''}`}
              onClick={() => setSelectedProvider('advanced')}
            >
              <span>🔧</span> Advanced Settings
            </button>
            <button className="nav-action-button">
              <span>📚</span> Documentation
            </button>
          </div>
        </nav>

        <main className="ai-models-main">
          {renderProviderPanel()}
        </main>
      </div>

      <div className="ai-models-footer">
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
