import React, { useState, useEffect, useRef } from 'react';
import './ModelSelector.css';

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface ModelSelectorProps {
  onSelectModel: (provider: string, modelId: string) => void;
  currentProvider?: string;
  currentModel?: string;
}

export function ModelSelector({ onSelectModel, currentProvider, currentModel }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<Record<string, Model[]>>({});
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadModels();
    }
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadModels = async () => {
    setLoading(true);
    try {
      const response = await window.electronAPI.aiGetModels();
      if (response.success && response.grouped) {
        setModels(response.grouped);
      }
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectModel = (provider: string, modelId: string) => {
    onSelectModel(provider, modelId);
    setIsOpen(false);
  };

  const getCurrentModelName = () => {
    if (!currentProvider || !currentModel) return 'Select Model';
    
    // Find the model in our list
    const providerModels = models[currentProvider];
    if (providerModels) {
      const model = providerModels.find(m => m.id === currentModel);
      if (model) return model.name;
    }
    
    // Fallback to model ID
    return currentModel;
  };

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'claude': return 'Claude SDK';
      case 'claude-code': return 'Claude Code (MCP)';
      case 'openai': return 'OpenAI';
      case 'lmstudio': return 'LMStudio (Local)';
      default: return provider;
    }
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'claude':
      case 'claude-code':
        return '🤖';
      case 'openai':
        return '🧠';
      case 'lmstudio':
        return '💻';
      default:
        return '🤖';
    }
  };

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button 
        className="model-selector-button"
        onClick={() => setIsOpen(!isOpen)}
        title="Select AI Model"
      >
        <span className="model-selector-icon">
          {currentProvider ? getProviderIcon(currentProvider) : '🤖'}
        </span>
        <span className="model-selector-label">
          {getCurrentModelName()}
        </span>
        <span className="model-selector-arrow">▼</span>
      </button>

      {isOpen && (
        <div className="model-selector-dropdown">
          {loading ? (
            <div className="model-selector-loading">Loading models...</div>
          ) : Object.keys(models).length === 0 ? (
            <div className="model-selector-empty">
              <p>No models available</p>
              <button 
                className="model-selector-settings"
                onClick={() => {
                  // TODO: Open preferences
                  setIsOpen(false);
                }}
              >
                Configure Providers
              </button>
            </div>
          ) : (
            <div className="model-selector-list">
              {Object.entries(models).map(([provider, providerModels]) => (
                <div key={provider} className="model-selector-group">
                  <div className="model-selector-group-header">
                    <span className="model-selector-group-icon">
                      {getProviderIcon(provider)}
                    </span>
                    {getProviderLabel(provider)}
                  </div>
                  <div className="model-selector-group-items">
                    {providerModels.map(model => (
                      <button
                        key={model.id}
                        className={`model-selector-item ${
                          currentProvider === provider && currentModel === model.id 
                            ? 'model-selector-item-active' 
                            : ''
                        }`}
                        onClick={() => handleSelectModel(provider, model.id)}
                      >
                        <span className="model-selector-item-name">
                          {model.name}
                        </span>
                        {currentProvider === provider && currentModel === model.id && (
                          <span className="model-selector-item-check">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              
              <div className="model-selector-footer">
                <button 
                  className="model-selector-settings-link"
                  onClick={() => {
                    // TODO: Open preferences
                    setIsOpen(false);
                  }}
                >
                  ⚙️ Configure Providers
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}