import React, { useState, useEffect } from 'react';
import { MaterialSymbol, getProviderIcon } from '@nimbalyst/runtime';
import './ProjectAIProvidersPanel.css';

interface ProviderOverride {
  enabled?: boolean;
  models?: string[];
  defaultModel?: string;
  apiKey?: string;
}

interface AIProviderOverrides {
  defaultProvider?: string;
  providers?: Record<string, ProviderOverride>;
}

interface GlobalProviderSettings {
  enabled?: boolean;
  models?: string[];
  defaultModel?: string;
}

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface ProjectAIProvidersPanelProps {
  workspacePath: string;
  workspaceName: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  subtitle: string;
  apiKeyField?: string; // The key name in apiKeys (e.g., 'anthropic', 'openai')
}

const PROVIDERS: ProviderInfo[] = [
  { id: 'claude-code', name: 'Claude Code', subtitle: 'CLI-based MCP', apiKeyField: 'anthropic' },
  { id: 'claude', name: 'Claude', subtitle: 'Anthropic API', apiKeyField: 'anthropic' },
  { id: 'openai', name: 'OpenAI', subtitle: 'GPT Models', apiKeyField: 'openai' },
  { id: 'lmstudio', name: 'LM Studio', subtitle: 'Local Models' },
];

export function ProjectAIProvidersPanel({ workspacePath, workspaceName }: ProjectAIProvidersPanelProps) {
  const [globalSettings, setGlobalSettings] = useState<Record<string, GlobalProviderSettings>>({});
  const [globalApiKeys, setGlobalApiKeys] = useState<Record<string, string>>({});
  const [projectOverrides, setProjectOverrides] = useState<AIProviderOverrides>({});
  const [availableModels, setAvailableModels] = useState<Record<string, Model[]>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, [workspacePath]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      // Load global settings
      const globalResult = await window.electronAPI.aiGetSettings();
      if (globalResult.providerSettings) {
        setGlobalSettings(globalResult.providerSettings);
      }
      if (globalResult.apiKeys) {
        setGlobalApiKeys(globalResult.apiKeys);
      }

      // Load project overrides
      const projectResult = await window.electronAPI.invoke('ai:getProjectSettings', workspacePath);
      if (projectResult.success && projectResult.overrides) {
        setProjectOverrides(projectResult.overrides);
      } else {
        setProjectOverrides({});
      }

      // Load available models
      try {
        const modelsResult = await window.electronAPI.aiGetAllModels();
        if (modelsResult.success && modelsResult.grouped) {
          setAvailableModels(modelsResult.grouped);
        }
      } catch (err) {
        console.error('Failed to load models:', err);
      }
    } catch (error) {
      console.error('Failed to load AI provider settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.electronAPI.invoke('ai:saveProjectSettings', workspacePath, projectOverrides);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save project AI settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const isOverriding = (providerId: string): boolean => {
    return projectOverrides.providers?.[providerId] !== undefined;
  };

  const getOverride = (providerId: string): ProviderOverride | undefined => {
    return projectOverrides.providers?.[providerId];
  };

  const getEffectiveEnabled = (providerId: string): boolean => {
    const override = getOverride(providerId);
    if (override?.enabled !== undefined) {
      return override.enabled;
    }
    return globalSettings[providerId]?.enabled ?? false;
  };

  const getEffectiveApiKey = (providerId: string, apiKeyField?: string): string => {
    const override = getOverride(providerId);
    if (override?.apiKey) {
      return override.apiKey;
    }
    return apiKeyField ? (globalApiKeys[apiKeyField] || '') : '';
  };

  const getEffectiveModels = (providerId: string): string[] => {
    const override = getOverride(providerId);
    if (override?.models) {
      return override.models;
    }
    return globalSettings[providerId]?.models || [];
  };

  const handleOverrideToggle = (providerId: string, override: boolean) => {
    setProjectOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides.providers) {
        newOverrides.providers = {};
      }

      if (override) {
        // Initialize override with current global values
        const globalProvider = globalSettings[providerId] || {};
        const provider = PROVIDERS.find(p => p.id === providerId);
        newOverrides.providers[providerId] = {
          enabled: globalProvider.enabled ?? false,
          models: globalProvider.models ? [...globalProvider.models] : [],
          apiKey: '', // Don't copy global API key, let user enter project-specific one
        };
      } else {
        // Remove override
        delete newOverrides.providers[providerId];
        if (Object.keys(newOverrides.providers).length === 0) {
          delete newOverrides.providers;
        }
      }

      return newOverrides;
    });
    setHasChanges(true);
  };

  const handleEnabledChange = (providerId: string, enabled: boolean) => {
    setProjectOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides.providers) newOverrides.providers = {};
      if (!newOverrides.providers[providerId]) newOverrides.providers[providerId] = {};
      newOverrides.providers[providerId].enabled = enabled;
      return newOverrides;
    });
    setHasChanges(true);
  };

  const handleApiKeyChange = (providerId: string, apiKey: string) => {
    setProjectOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides.providers) newOverrides.providers = {};
      if (!newOverrides.providers[providerId]) newOverrides.providers[providerId] = {};
      newOverrides.providers[providerId].apiKey = apiKey;
      return newOverrides;
    });
    setHasChanges(true);
  };

  const handleModelToggle = (providerId: string, modelId: string, enabled: boolean) => {
    setProjectOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides.providers) newOverrides.providers = {};
      if (!newOverrides.providers[providerId]) newOverrides.providers[providerId] = {};

      const currentModels = newOverrides.providers[providerId].models || [];
      if (enabled) {
        newOverrides.providers[providerId].models = [...currentModels, modelId];
      } else {
        newOverrides.providers[providerId].models = currentModels.filter(m => m !== modelId);
      }
      return newOverrides;
    });
    setHasChanges(true);
  };

  const handleSelectAllModels = (providerId: string, selectAll: boolean) => {
    const models = availableModels[providerId] || [];
    setProjectOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides.providers) newOverrides.providers = {};
      if (!newOverrides.providers[providerId]) newOverrides.providers[providerId] = {};
      newOverrides.providers[providerId].models = selectAll ? models.map(m => m.id) : [];
      return newOverrides;
    });
    setHasChanges(true);
  };

  const hasAnyOverrides = () => {
    return (projectOverrides.providers && Object.keys(projectOverrides.providers).length > 0) ||
           projectOverrides.defaultProvider !== undefined;
  };

  if (loading) {
    return (
      <div className="project-ai-providers-panel">
        <div className="panel-loading">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="project-ai-providers-panel">
      <div className="panel-header">
        <h2>AI Providers</h2>
        <p className="panel-description">
          Override AI provider settings for <strong>{workspaceName}</strong>.
          Enable overrides to use different API keys or models for this project.
        </p>
      </div>

      <div className="panel-content">
        <div className="providers-list">
          {PROVIDERS.map(provider => {
            const globalEnabled = globalSettings[provider.id]?.enabled ?? false;
            const overriding = isOverriding(provider.id);
            const effectiveEnabled = getEffectiveEnabled(provider.id);
            const isExpanded = expandedProvider === provider.id;
            const override = getOverride(provider.id);
            const models = availableModels[provider.id] || [];
            const selectedModels = getEffectiveModels(provider.id);

            return (
              <div key={provider.id} className={`provider-card ${overriding ? 'has-override' : ''}`}>
                {/* Provider Header - Always Visible */}
                <div
                  className="provider-card-header"
                  onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                >
                  <div className="provider-info">
                    <span className="provider-icon">
                      {getProviderIcon(provider.id as any, { size: 24 })}
                    </span>
                    <div className="provider-details">
                      <span className="provider-name">{provider.name}</span>
                      <span className="provider-subtitle">{provider.subtitle}</span>
                    </div>
                  </div>

                  <div className="provider-status">
                    <span className={`global-status ${globalEnabled ? 'enabled' : 'disabled'}`}>
                      Global: {globalEnabled ? 'On' : 'Off'}
                    </span>
                    {overriding && (
                      <span className="override-badge">Overridden</span>
                    )}
                    <span className={`effective-status ${effectiveEnabled ? 'enabled' : 'disabled'}`}>
                      {effectiveEnabled ? 'Active' : 'Inactive'}
                    </span>
                    <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>
                      <MaterialSymbol icon="expand_more" size={16} />
                    </span>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="provider-card-content">
                    {/* Override Toggle */}
                    <div className="override-toggle-section">
                      <label className="override-toggle">
                        <input
                          type="checkbox"
                          checked={overriding}
                          onChange={(e) => handleOverrideToggle(provider.id, e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                        <span className="toggle-label">
                          {overriding ? 'Override enabled - using project settings' : 'Using global settings'}
                        </span>
                      </label>
                    </div>

                    {overriding && (
                      <>
                        {/* Enable Toggle */}
                        <div className="config-section">
                          <div className="config-row">
                            <span className="config-label">Enable for this project</span>
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={override?.enabled ?? false}
                                onChange={(e) => handleEnabledChange(provider.id, e.target.checked)}
                              />
                              <span className="toggle-slider"></span>
                            </label>
                          </div>
                        </div>

                        {/* API Key (if applicable) */}
                        {provider.apiKeyField && (
                          <div className="config-section">
                            <h4 className="config-section-title">API Key</h4>
                            <div className="api-key-info">
                              <span className="api-key-hint">
                                {globalApiKeys[provider.apiKeyField]
                                  ? 'Leave empty to use global key, or enter a project-specific key'
                                  : 'Enter an API key for this project'}
                              </span>
                            </div>
                            <input
                              type="password"
                              className="api-key-input"
                              placeholder={globalApiKeys[provider.apiKeyField] ? 'Using global key...' : 'Enter API key...'}
                              value={override?.apiKey || ''}
                              onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                            />
                          </div>
                        )}

                        {/* Models Selection */}
                        {models.length > 0 && (
                          <div className="config-section">
                            <div className="config-section-header">
                              <h4 className="config-section-title">Models</h4>
                              <div className="models-actions">
                                <button
                                  className="models-action-btn"
                                  onClick={() => handleSelectAllModels(provider.id, true)}
                                >
                                  All
                                </button>
                                <button
                                  className="models-action-btn"
                                  onClick={() => handleSelectAllModels(provider.id, false)}
                                >
                                  None
                                </button>
                              </div>
                            </div>
                            <div className="models-grid">
                              {models.map(model => {
                                const isSelected = selectedModels.includes(model.id);
                                return (
                                  <label key={model.id} className={`model-item ${isSelected ? 'selected' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={(e) => handleModelToggle(provider.id, model.id, e.target.checked)}
                                    />
                                    <span className="model-name">{model.name || model.id}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {!overriding && (
                      <div className="no-override-message">
                        <p>This project uses global settings for {provider.name}.</p>
                        <p className="hint">Enable override to customize API key or models for this project.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {hasAnyOverrides() && (
          <div className="overrides-summary">
            <MaterialSymbol icon="info" size={16} />
            <span>This project has custom AI provider settings</span>
          </div>
        )}
      </div>

      <div className="panel-footer">
        <button
          className="save-button"
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
