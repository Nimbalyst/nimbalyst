import React, { useState, useEffect, useRef } from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import { getProviderIcon } from '../icons/ProviderIcons';
import './ModelSelector.css';

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface ModelSelectorProps {
  onSelectModel: (modelId: string) => void;  // Just pass the full provider:model ID
  currentModel?: string;  // Full provider:model ID
  onOpenSettings?: () => void;  // Open AI settings
}

export function ModelSelector({ onSelectModel, currentModel, onOpenSettings }: ModelSelectorProps) {
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

  const handleSelectModel = (modelId: string) => {
    onSelectModel(modelId);  // Pass the full provider:model ID
    setIsOpen(false);
  };

  const getCurrentModelName = () => {
    if (!currentModel) return 'Select Model';
    
    // Find the model in our list by checking all providers
    for (const providerModels of Object.values(models)) {
      const model = providerModels.find(m => m.id === currentModel);
      if (model) return model.name;
    }
    
    // Fallback to model ID (strip provider prefix for display)
    const [, ...modelParts] = currentModel.split(':');
    return modelParts.join(':') || currentModel;
  };
  
  const getCurrentProvider = () => {
    if (!currentModel) return 'default';
    const [provider] = currentModel.split(':');
    return provider || 'default';
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


  return (
    <div className="model-selector" ref={dropdownRef}>
      <button 
        className="model-selector-button"
        onClick={() => setIsOpen(!isOpen)}
        title="Select AI Model"
      >
        <span className="model-selector-icon">
          {getProviderIcon(getCurrentProvider(), { size: 16 })}
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
              {onOpenSettings && (
                <button 
                  className="model-selector-settings"
                  onClick={() => {
                    onOpenSettings();
                    setIsOpen(false);
                  }}
                >
                  Configure Providers
                </button>
              )}
            </div>
          ) : (
            <div className="model-selector-list">
              {Object.entries(models).map(([provider, providerModels]) => (
                <div key={provider} className="model-selector-group">
                  <div className="model-selector-group-header">
                    <span className="model-selector-group-icon">
                      {getProviderIcon(provider, { size: 16 })}
                    </span>
                    {getProviderLabel(provider)}
                  </div>
                  <div className="model-selector-group-items">
                    {providerModels.map(model => (
                      <button
                        key={model.id}
                        className={`model-selector-item ${
                          currentModel === model.id 
                            ? 'model-selector-item-active' 
                            : ''
                        }`}
                        onClick={() => handleSelectModel(model.id)}
                      >
                        <span className="model-selector-item-name">
                          {model.name}
                        </span>
                        {currentModel === model.id && (
                          <span className="model-selector-item-check">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              
              {onOpenSettings && (
                <div className="model-selector-footer">
                  <button 
                    className="model-selector-settings-link"
                    onClick={() => {
                      onOpenSettings();
                      setIsOpen(false);
                    }}
                  >
                    <MaterialSymbol icon="settings" size={16} />
                    <span>Configure Models</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}