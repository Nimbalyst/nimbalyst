import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import './NewSessionButton.css';

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface NewSessionButtonProps {
  currentProvider: string;
  currentModel?: string;
  onNewSession: (provider: string, modelId?: string) => void;
  disabled?: boolean;
}

export function NewSessionButton({
  currentProvider,
  currentModel,
  onNewSession,
  disabled = false
}: NewSessionButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<Record<string, Model[]>>({});
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load models when dropdown opens
  useEffect(() => {
    if (isOpen && Object.keys(models).length === 0) {
      loadModels();
    }
  }, [isOpen]);

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

  const handleMainClick = () => {
    onNewSession(currentProvider, currentModel);
  };

  const handleModelSelect = (provider: string, modelId: string) => {
    onNewSession(provider, modelId);
    setIsOpen(false);
  };

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'claude': return 'Claude SDK';
      case 'claude-code': return 'Claude Code (MCP)';
      case 'openai': return 'OpenAI';
      case 'lmstudio': return 'LMStudio';
      default: return provider;
    }
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'claude': return 'api';
      case 'claude-code': return 'code';
      case 'openai': return 'psychology';
      case 'lmstudio': return 'computer';
      default: return 'smart_toy';
    }
  };

  const getCurrentModelName = () => {
    if (!currentProvider || !currentModel) return 'New Session';
    
    // Find the model in our list
    const providerModels = models[currentProvider];
    if (providerModels) {
      const model = providerModels.find(m => m.id === currentModel);
      if (model) return model.name;
    }
    
    // Fallback
    return currentModel;
  };

  return (
    <div className="new-session-button" ref={dropdownRef}>
      <button
        className="new-session-button-main"
        onClick={handleMainClick}
        disabled={disabled}
        title={`New Session with ${getCurrentModelName()}`}
        aria-label={`New Session with ${getCurrentModelName()}`}
      >
        <MaterialSymbol icon="add" size={20} />
      </button>
      <button
        className="new-session-button-dropdown"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        title="Choose model"
        aria-label="Choose model"
      >
        <MaterialSymbol icon="expand_more" size={16} />
      </button>

      {isOpen && (
        <div className="new-session-dropdown">
          {loading ? (
            <div className="new-session-loading">Loading models...</div>
          ) : Object.keys(models).length === 0 ? (
            <div className="new-session-empty">
              No models available. Please configure providers in AI Models settings.
            </div>
          ) : (
            Object.entries(models).map(([provider, providerModels]) => (
              <div key={provider} className="new-session-provider-group">
                <div className="new-session-provider-header">
                  <MaterialSymbol icon={getProviderIcon(provider)} size={14} />
                  {getProviderLabel(provider)}
                </div>
                {providerModels.map(model => (
                  <button
                    key={model.id}
                    className={`new-session-option ${
                      provider === currentProvider && model.id === currentModel ? 'selected' : ''
                    }`}
                    onClick={() => handleModelSelect(provider, model.id)}
                  >
                    <div className="new-session-option-info">
                      <div className="new-session-option-name">{model.name}</div>
                    </div>
                    {provider === currentProvider && model.id === currentModel && (
                      <MaterialSymbol icon="check" size={16} className="new-session-option-check" />
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}