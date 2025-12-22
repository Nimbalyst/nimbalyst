import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol, getProviderIcon } from '@nimbalyst/runtime';
import { getClaudeCodeModelLabel } from '../../utils/modelUtils';
import './ModelSelector.css';

interface Model {
  id: string;
  name: string;
  provider: string;
}

type ProviderType = 'agent' | 'model';

interface ModelSelectorProps {
  currentModel: string;  // Full provider:model ID
  onModelChange: (modelId: string) => void;
  sessionHasMessages?: boolean;  // Whether current session has any messages
  currentProviderType?: ProviderType | null;  // Type of current session's provider
}

export function ModelSelector({
  currentModel,
  onModelChange,
  sessionHasMessages = false,
  currentProviderType = null
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<Record<string, Model[]>>({});
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  const handleModelSelect = (modelId: string) => {
    onModelChange(modelId);
    setIsOpen(false);
  };

  const handleConfigureModels = () => {
    setIsOpen(false);
    window.electronAPI.send('set-content-mode', 'settings');
  };

  const getCurrentModelName = () => {
    if (!currentModel) return 'Select Model';

    // Find the model in our list
    for (const providerModels of Object.values(models)) {
      const model = providerModels.find(m => m.id === currentModel);
      if (model) return model.name;
    }

    // Fallback - strip provider prefix for display
    if (currentModel.startsWith('claude-code')) {
      return getClaudeCodeModelLabel(currentModel);
    }
    const [, ...modelParts] = currentModel.split(':');
    return modelParts.join(':') || currentModel;
  };

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'claude': return 'Claude Chat';
      case 'claude-code': return 'Claude Agent';
      case 'openai': return 'OpenAI';
      case 'openai-codex': return 'OpenAI Codex';
      case 'lmstudio': return 'LMStudio';
      default: return provider;
    }
  };

  // Helper to determine if a provider is an agent type
  const getProviderType = (provider: string): ProviderType => {
    return (provider === 'claude-code' || provider === 'openai-codex') ? 'agent' : 'model';
  };

  // Check if switching to a provider type is disabled (session has messages and would switch types)
  const isTypeSwitchDisabled = (targetProvider: string): boolean => {
    if (!sessionHasMessages || !currentProviderType) return false;
    const targetType = getProviderType(targetProvider);
    return targetType !== currentProviderType;
  };

  // Group providers by type (agents vs models)
  const groupedProviders = Object.entries(models).reduce((acc, [provider, providerModels]) => {
    const isAgent = provider === 'claude-code' || provider === 'openai-codex';
    const type = isAgent ? 'agents' : 'models';
    if (!acc[type]) acc[type] = {};
    acc[type][provider] = providerModels;
    return acc;
  }, {} as Record<'agents' | 'models', Record<string, Model[]>>);

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button
        ref={buttonRef}
        className="model-selector-button"
        onClick={() => setIsOpen(!isOpen)}
        title={`Current model: ${getCurrentModelName()}`}
      >
        <span className="model-selector-label">{getCurrentModelName()}</span>
        <MaterialSymbol icon="expand_more" size={14} className={`model-selector-arrow ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="model-selector-dropdown">
          {loading ? (
            <div className="model-selector-loading">Loading models...</div>
          ) : Object.keys(models).length === 0 ? (
            <div className="model-selector-empty">No models available</div>
          ) : (
            <>
              {/* Agents Section */}
              {groupedProviders.agents && Object.keys(groupedProviders.agents).length > 0 && (
                <>
                  <div className="model-selector-section-header">Agents</div>
                  {Object.entries(groupedProviders.agents).map(([provider, providerModels]) => (
                    <div key={provider} className="model-selector-provider-group">
                      <div className="model-selector-provider-header">
                        {getProviderIcon(provider, { size: 12 })}
                        {getProviderLabel(provider)}
                      </div>
                      {providerModels.map(model => {
                        const isCurrent = model.id === currentModel;
                        const isDisabled = isTypeSwitchDisabled(provider);
                        const disabledTooltip = 'Start a new session to switch between Agent and Chat modes';
                        return (
                          <button
                            key={model.id}
                            className={`model-selector-option ${isCurrent ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                            onClick={() => !isDisabled && handleModelSelect(model.id)}
                            title={isDisabled ? disabledTooltip : undefined}
                            aria-disabled={isDisabled}
                          >
                            <span className="model-selector-option-name">{model.name}</span>
                            {isDisabled ? (
                              <MaterialSymbol icon="block" size={14} className="disabled-icon" />
                            ) : isCurrent ? (
                              <MaterialSymbol icon="check" size={14} />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}

              {/* Models Section */}
              {groupedProviders.models && Object.keys(groupedProviders.models).length > 0 && (
                <>
                  {groupedProviders.agents && Object.keys(groupedProviders.agents).length > 0 && (
                    <div className="model-selector-divider" />
                  )}
                  <div className="model-selector-section-header">Models</div>
                  {Object.entries(groupedProviders.models).map(([provider, providerModels]) => (
                    <div key={provider} className="model-selector-provider-group">
                      <div className="model-selector-provider-header">
                        {getProviderIcon(provider, { size: 12 })}
                        {getProviderLabel(provider)}
                      </div>
                      {providerModels.map(model => {
                        const isCurrent = model.id === currentModel;
                        const isDisabled = isTypeSwitchDisabled(provider);
                        const disabledTooltip = 'Start a new session to switch between Agent and Chat modes';
                        return (
                          <button
                            key={model.id}
                            className={`model-selector-option ${isCurrent ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                            onClick={() => !isDisabled && handleModelSelect(model.id)}
                            title={isDisabled ? disabledTooltip : undefined}
                            aria-disabled={isDisabled}
                          >
                            <span className="model-selector-option-name">{model.name}</span>
                            {isDisabled ? (
                              <MaterialSymbol icon="block" size={14} className="disabled-icon" />
                            ) : isCurrent ? (
                              <MaterialSymbol icon="check" size={14} />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}

              {/* Configure Models */}
              <div className="model-selector-divider" />
              <button
                className="model-selector-configure"
                onClick={handleConfigureModels}
              >
                <MaterialSymbol icon="settings" size={14} />
                <span>Configure models</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
