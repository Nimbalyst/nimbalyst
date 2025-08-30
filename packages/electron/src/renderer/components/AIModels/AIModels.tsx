import React, { useState, useEffect } from 'react';
import './AIModels.css';

// Apply theme to document on mount
if (typeof window !== 'undefined') {
  // Get theme from localStorage or system preference
  const savedTheme = localStorage.getItem('theme');
  const root = document.documentElement;
  
  if (savedTheme === 'dark' || savedTheme === 'crystal-dark') {
    root.setAttribute('data-theme', savedTheme);
  } else if (savedTheme === 'light') {
    root.setAttribute('data-theme', 'light');
  } else {
    // Auto - check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }
}

interface ProviderConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
  testStatus?: 'idle' | 'testing' | 'success' | 'error';
  testMessage?: string;
}

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface AIModelsProps {
  onClose: () => void;
}

// Define which models are "recent/relevant" for each provider
const FEATURED_MODELS: Record<string, string[]> = {
  claude: [], // Show all available models
  openai: [], // Show all available models
  lmstudio: [] // All local models are shown
};

export function AIModels({ onClose }: AIModelsProps) {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({
    claude: { enabled: false, testStatus: 'idle' },
    'claude-code': { enabled: false, testStatus: 'idle' },
    openai: { enabled: false, testStatus: 'idle' },
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

  // Load current settings on mount
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
      
      // Auto-fetch models for enabled providers
      for (const [provider, config] of Object.entries(settings.providerSettings || {})) {
        if (config.enabled) {
          fetchModels(provider);
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleProviderToggle = (provider: string, enabled: boolean) => {
    setProviders(prev => ({
      ...prev,
      [provider]: { ...prev[provider], enabled }
    }));
    setHasChanges(true);
    
    // If enabling, fetch models
    if (enabled) {
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
      // Fetch ALL models (not just enabled ones)
      const response = await window.electronAPI.aiGetAllModels();
      console.log('[AIModels] Fetched ALL models response:', response);
      
      if (response.success && response.grouped) {
        console.log('[AIModels] Grouped models:', response.grouped);
        console.log('[AIModels] Claude models:', response.grouped.claude);
        setAvailableModels(response.grouped);
      }
    } catch (error) {
      console.error(`Failed to fetch models for ${provider}:`, error);
    } finally {
      setLoading(prev => ({ ...prev, [provider]: false }));
    }
  };

  const testConnection = async (provider: string) => {
    setProviders(prev => ({
      ...prev,
      [provider]: { ...prev[provider], testStatus: 'testing', testMessage: undefined }
    }));
    
    try {
      const result = await window.electronAPI.aiTestConnection(provider);
      
      setProviders(prev => ({
        ...prev,
        [provider]: { 
          ...prev[provider], 
          testStatus: result.success ? 'success' : 'error',
          testMessage: result.success ? 'Connected' : result.error
        }
      }));
      
      if (result.success) {
        // Refresh models on successful connection
        fetchModels(provider);
      }
    } catch (error) {
      setProviders(prev => ({
        ...prev,
        [provider]: { 
          ...prev[provider], 
          testStatus: 'error',
          testMessage: 'Connection failed'
        }
      }));
    }
  };

  const handleModelToggle = (provider: string, modelId: string, enabled: boolean) => {
    setProviders(prev => {
      const models = prev[provider]?.models || [];
      const updated = enabled 
        ? [...models, modelId]
        : models.filter(m => m !== modelId);
      
      return {
        ...prev,
        [provider]: { ...prev[provider], models: updated }
      };
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    const settings = {
      apiKeys,
      providerSettings: providers
    };
    
    await window.electronAPI.aiSaveSettings(settings);
    setHasChanges(false);
    onClose();
  };

  const getProviderInfo = (provider: string) => {
    switch (provider) {
      case 'claude':
        return {
          name: 'Claude (Anthropic)',
          icon: '🤖',
          keyName: 'anthropic',
          keyPlaceholder: 'sk-ant-...',
          description: 'Direct API access to Claude models'
        };
      case 'claude-code':
        return {
          name: 'Claude Code (MCP)',
          icon: '🔧',
          keyName: 'anthropic',
          keyPlaceholder: 'Uses same key as Claude',
          description: 'Model Context Protocol integration',
          readonly: true
        };
      case 'openai':
        return {
          name: 'OpenAI',
          icon: '🧠',
          keyName: 'openai',
          keyPlaceholder: 'sk-...',
          description: 'GPT-4, GPT-3.5, and other OpenAI models'
        };
      case 'lmstudio':
        return {
          name: 'LMStudio',
          icon: '💻',
          keyName: 'lmstudio_url',
          keyPlaceholder: 'http://127.0.0.1:8234',
          description: 'Local models running on your machine',
          isUrl: true
        };
      default:
        return {
          name: provider,
          icon: '🤖',
          keyName: provider,
          keyPlaceholder: '',
          description: ''
        };
    }
  };

  const getFilteredModels = (provider: string) => {
    const models = availableModels[provider] || [];
    console.log(`[AIModels] Models for ${provider}:`, models);
    const featured = FEATURED_MODELS[provider];
    
    if (!featured || featured.length === 0) {
      console.log(`[AIModels] No featured list for ${provider}, showing all ${models.length} models`);
      return models; // Show all for providers without featured list
    }
    
    // Filter to only featured models
    const filtered = models.filter(m => featured.includes(m.id));
    console.log(`[AIModels] Filtered to ${filtered.length} featured models for ${provider}`);
    return filtered;
  };

  const renderProviderSection = (providerId: string) => {
    const provider = providers[providerId];
    const info = getProviderInfo(providerId);
    const models = getFilteredModels(providerId);
    const isLoading = loading[providerId];
    
    return (
      <div key={providerId} className="provider-row">
        <div className="provider-header">
          <label className="provider-toggle">
            <input
              type="checkbox"
              checked={provider.enabled}
              onChange={(e) => handleProviderToggle(providerId, e.target.checked)}
            />
            <span className="provider-icon">{info.icon}</span>
            <div className="provider-info">
              <span className="provider-name">{info.name}</span>
              <span className="provider-description">{info.description}</span>
            </div>
          </label>
        </div>
        
        {provider.enabled && (
          <div className="provider-config">
            {!info.readonly && (
              <div className="api-key-row">
                <input
                  type={info.isUrl ? 'text' : 'password'}
                  value={apiKeys[info.keyName] || ''}
                  onChange={(e) => handleApiKeyChange(info.keyName, e.target.value)}
                  placeholder={info.keyPlaceholder}
                  className="api-key-input"
                />
                <button 
                  className={`test-button ${provider.testStatus}`}
                  onClick={() => testConnection(providerId)}
                  disabled={provider.testStatus === 'testing'}
                >
                  {provider.testStatus === 'testing' ? 'Testing...' : 
                   provider.testStatus === 'success' ? '✓ Connected' :
                   provider.testStatus === 'error' ? '✗ Failed' : 'Test'}
                </button>
              </div>
            )}
            
            {provider.testMessage && provider.testStatus === 'error' && (
              <div className="test-error">{provider.testMessage}</div>
            )}
            
            {info.readonly && (
              <div className="readonly-info">
                Uses the same API key as Claude
              </div>
            )}
            
            {isLoading && (
              <div className="models-loading">Loading models...</div>
            )}
            
            {!isLoading && models.length > 0 && (
              <div className="models-list">
                <div className="models-header">Available Models:</div>
                <div className="models-grid">
                  {models.map(model => (
                    <label key={model.id} className="model-checkbox">
                      <input
                        type="checkbox"
                        checked={provider.models?.includes(model.id) ?? true}
                        onChange={(e) => handleModelToggle(providerId, model.id, e.target.checked)}
                      />
                      <span>{model.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ai-models-window">
      <div className="ai-models-header">
        <h2>AI Models</h2>
      </div>
        
        <div className="ai-models-content">
          <div className="ai-models-intro">
            Enable AI providers and configure their API keys to use different models.
          </div>
          
          <div className="providers-list">
            {renderProviderSection('claude')}
            {renderProviderSection('claude-code')}
            {renderProviderSection('openai')}
            {renderProviderSection('lmstudio')}
          </div>
        </div>
        
      <div className="ai-models-footer">
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