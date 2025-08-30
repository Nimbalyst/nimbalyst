import React, { useState, useEffect } from 'react';
import './AIPreferences.css';

interface ProviderSettings {
  enabled: boolean;
  apiKey?: string;
  models?: string[];
  defaultModel?: string;
  baseUrl?: string;
}

interface AIPreferencesProps {
  onClose: () => void;
  onSave: (settings: any) => void;
}

export function AIPreferences({ onClose, onSave }: AIPreferencesProps) {
  const [providers, setProviders] = useState<Record<string, ProviderSettings>>({
    claude: { enabled: false },
    'claude-code': { enabled: false },
    openai: { enabled: false },
    lmstudio: { enabled: false, baseUrl: 'http://127.0.0.1:1234' }
  });
  
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    anthropic: '',
    openai: '',
    lmstudio_url: 'http://127.0.0.1:1234'
  });
  
  const [availableModels, setAvailableModels] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, string>>({});

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
        setProviders(prev => ({ ...prev, ...settings.providerSettings }));
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
  };

  const handleApiKeyChange = (key: string, value: string) => {
    setApiKeys(prev => ({ ...prev, [key]: value }));
  };

  const fetchModels = async (provider: string) => {
    setLoading(prev => ({ ...prev, [provider]: true }));
    
    try {
      let apiKey: string | undefined;
      let baseUrl: string | undefined;
      
      switch (provider) {
        case 'claude':
        case 'claude-code':
          apiKey = apiKeys.anthropic;
          break;
        case 'openai':
          apiKey = apiKeys.openai;
          break;
        case 'lmstudio':
          baseUrl = apiKeys.lmstudio_url;
          break;
      }
      
      const response = await window.electronAPI.aiGetModels();
      if (response.success && response.grouped) {
        setAvailableModels(response.grouped);
      }
    } catch (error) {
      console.error(`Failed to fetch models for ${provider}:`, error);
    } finally {
      setLoading(prev => ({ ...prev, [provider]: false }));
    }
  };

  const testConnection = async (provider: string) => {
    setTestResults(prev => ({ ...prev, [provider]: 'Testing...' }));
    
    try {
      const result = await window.electronAPI.aiTestConnection(provider);
      if (result.success) {
        setTestResults(prev => ({ ...prev, [provider]: '✅ Connected' }));
        // Auto-fetch models on successful connection
        fetchModels(provider);
      } else {
        setTestResults(prev => ({ ...prev, [provider]: `❌ ${result.error}` }));
      }
    } catch (error) {
      setTestResults(prev => ({ ...prev, [provider]: `❌ Connection failed` }));
    }
  };

  const handleSave = () => {
    const settings = {
      apiKeys,
      providerSettings: providers
    };
    
    onSave(settings);
    window.electronAPI.aiSaveSettings(settings);
    onClose();
  };

  return (
    <div className="ai-preferences-overlay">
      <div className="ai-preferences-modal">
        <div className="ai-preferences-header">
          <h2>AI Provider Settings</h2>
          <button className="ai-preferences-close" onClick={onClose}>×</button>
        </div>
        
        <div className="ai-preferences-content">
          {/* Claude SDK Section */}
          <div className="provider-section">
            <div className="provider-header">
              <label className="provider-toggle">
                <input
                  type="checkbox"
                  checked={providers.claude?.enabled}
                  onChange={(e) => handleProviderToggle('claude', e.target.checked)}
                />
                <span>Claude SDK</span>
              </label>
              {providers.claude?.enabled && (
                <button 
                  className="test-button"
                  onClick={() => testConnection('claude')}
                >
                  Test
                </button>
              )}
            </div>
            
            {providers.claude?.enabled && (
              <div className="provider-config">
                <label>
                  API Key:
                  <input
                    type="password"
                    value={apiKeys.anthropic || ''}
                    onChange={(e) => handleApiKeyChange('anthropic', e.target.value)}
                    placeholder="sk-ant-..."
                  />
                </label>
                {testResults.claude && (
                  <div className="test-result">{testResults.claude}</div>
                )}
                {availableModels.claude && (
                  <div className="model-list">
                    <label>Available Models:</label>
                    {availableModels.claude.map(model => (
                      <div key={model.id} className="model-item">
                        <label>
                          <input
                            type="checkbox"
                            checked={providers.claude?.models?.includes(model.id) ?? true}
                            onChange={(e) => {
                              const models = e.target.checked
                                ? [...(providers.claude?.models || []), model.id]
                                : providers.claude?.models?.filter(m => m !== model.id) || [];
                              setProviders(prev => ({
                                ...prev,
                                claude: { ...prev.claude, models }
                              }));
                            }}
                          />
                          {model.name}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Claude Code Section */}
          <div className="provider-section">
            <div className="provider-header">
              <label className="provider-toggle">
                <input
                  type="checkbox"
                  checked={providers['claude-code']?.enabled}
                  onChange={(e) => handleProviderToggle('claude-code', e.target.checked)}
                />
                <span>Claude Code (MCP)</span>
              </label>
            </div>
            
            {providers['claude-code']?.enabled && (
              <div className="provider-config">
                <div className="info-text">
                  Uses the same Anthropic API key as Claude SDK
                </div>
              </div>
            )}
          </div>

          {/* OpenAI Section */}
          <div className="provider-section">
            <div className="provider-header">
              <label className="provider-toggle">
                <input
                  type="checkbox"
                  checked={providers.openai?.enabled}
                  onChange={(e) => handleProviderToggle('openai', e.target.checked)}
                />
                <span>OpenAI</span>
              </label>
              {providers.openai?.enabled && (
                <button 
                  className="test-button"
                  onClick={() => testConnection('openai')}
                >
                  Test
                </button>
              )}
            </div>
            
            {providers.openai?.enabled && (
              <div className="provider-config">
                <label>
                  API Key:
                  <input
                    type="password"
                    value={apiKeys.openai || ''}
                    onChange={(e) => handleApiKeyChange('openai', e.target.value)}
                    placeholder="sk-..."
                  />
                </label>
                {testResults.openai && (
                  <div className="test-result">{testResults.openai}</div>
                )}
                {loading.openai && <div>Loading models...</div>}
                {availableModels.openai && (
                  <div className="model-list">
                    <label>Available Models:</label>
                    {availableModels.openai.map(model => (
                      <div key={model.id} className="model-item">
                        <label>
                          <input
                            type="checkbox"
                            checked={providers.openai?.models?.includes(model.id) ?? true}
                            onChange={(e) => {
                              const models = e.target.checked
                                ? [...(providers.openai?.models || []), model.id]
                                : providers.openai?.models?.filter(m => m !== model.id) || [];
                              setProviders(prev => ({
                                ...prev,
                                openai: { ...prev.openai, models }
                              }));
                            }}
                          />
                          {model.name}
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* LMStudio Section */}
          <div className="provider-section">
            <div className="provider-header">
              <label className="provider-toggle">
                <input
                  type="checkbox"
                  checked={providers.lmstudio?.enabled}
                  onChange={(e) => handleProviderToggle('lmstudio', e.target.checked)}
                />
                <span>LMStudio (Local)</span>
              </label>
              {providers.lmstudio?.enabled && (
                <button 
                  className="test-button"
                  onClick={() => testConnection('lmstudio')}
                >
                  Test
                </button>
              )}
            </div>
            
            {providers.lmstudio?.enabled && (
              <div className="provider-config">
                <label>
                  Server URL:
                  <input
                    type="text"
                    value={apiKeys.lmstudio_url || 'http://127.0.0.1:1234'}
                    onChange={(e) => handleApiKeyChange('lmstudio_url', e.target.value)}
                    placeholder="http://127.0.0.1:1234"
                  />
                </label>
                {testResults.lmstudio && (
                  <div className="test-result">{testResults.lmstudio}</div>
                )}
                {loading.lmstudio && <div>Loading models...</div>}
                {availableModels.lmstudio && (
                  <div className="model-list">
                    <label>Available Models:</label>
                    {availableModels.lmstudio.map(model => (
                      <div key={model.id} className="model-item">
                        {model.name}
                      </div>
                    ))}
                  </div>
                )}
                <div className="info-text">
                  Ensure LMStudio is running and a model is loaded
                </div>
              </div>
            )}
          </div>
        </div>
        
        <div className="ai-preferences-footer">
          <button className="button-cancel" onClick={onClose}>Cancel</button>
          <button className="button-save" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}