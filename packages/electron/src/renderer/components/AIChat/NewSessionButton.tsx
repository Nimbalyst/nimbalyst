import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol, getProviderIcon } from '@nimbalyst/runtime';
import { getClaudeCodeModelLabel } from '../../utils/modelUtils';
import './NewSessionButton.css';

interface Model {
  id: string;
  name: string;
  provider: string;
}

type ProviderType = 'agent' | 'model';

interface NewSessionButtonProps {
  currentModel: string;  // Full provider:model ID
  onNewSession: (modelId: string) => void;  // Creates new session with specified model
  onOpenSettings?: () => void;  // Open AI settings
  disabled?: boolean;
  hasUnsavedInput?: boolean;  // Whether there's text in the input field
  sessionHasMessages?: boolean;  // Whether current session has any messages
  currentProviderType?: ProviderType | null;  // Type of current session's provider
}

export function NewSessionButton({
  currentModel,
  onNewSession,
  onOpenSettings,
  disabled = false,
  hasUnsavedInput = false,
  sessionHasMessages = false,
  currentProviderType = null
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
    // Create new session with current model
    if (hasUnsavedInput && !confirm('Start a new conversation? Your current message will be cleared.')) {
      return;
    }
    onNewSession(currentModel);
  };

  const handleModelSelect = (modelId: string) => {
    // Different model = create new session
    if (modelId !== currentModel) {
      if (hasUnsavedInput && !confirm(`Switch to ${getModelNameFromId(modelId)}? Your current message will be cleared.`)) {
        setIsOpen(false);
        return;
      }
      onNewSession(modelId);  // Create new session with selected model
    } else {
      // Same model = create new session with same model
      if (hasUnsavedInput && !confirm('Start a new conversation? Your current message will be cleared.')) {
        setIsOpen(false);
        return;
      }
      onNewSession(modelId);
    }
    setIsOpen(false);
  };

  const getModelNameFromId = (modelId: string) => {
    // Find the model in our list
    for (const providerModels of Object.values(models)) {
      const model = providerModels.find(m => m.id === modelId);
      if (model) return model.name;
    }
    // Fallback
    if (modelId.startsWith('claude-code')) return getClaudeCodeModelLabel(modelId);
    const [, ...modelParts] = modelId.split(':');
    return modelParts.join(':') || modelId;
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


  const getCurrentModelName = () => {
    if (!currentModel) return 'New Session';
    
    // Find the model in our list by checking all providers
    for (const providerModels of Object.values(models)) {
      const model = providerModels.find(m => m.id === currentModel);
      if (model) return model.name;
    }
    
    // Fallback - strip provider prefix for display
    if (currentModel.startsWith('claude-code')) return getClaudeCodeModelLabel(currentModel);
    const [, ...modelParts] = currentModel.split(':');
    return modelParts.join(':') || currentModel;
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
    <div className="new-session-button" ref={dropdownRef}>
      <button
        className="new-session-button-main"
        data-testid="new-session-button"
        onClick={handleMainClick}
        disabled={disabled}
        title={`New conversation with ${getCurrentModelName()}`}
        aria-label={`New conversation with ${getCurrentModelName()}`}
      >
        <MaterialSymbol icon="add" size={20} />
      </button>
      <button
        className="new-session-button-dropdown"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        title="Switch model or start new conversation"
        aria-label="Switch model or start new conversation"
      >
        <MaterialSymbol icon="expand_more" size={16} />
      </button>

      {isOpen && (
        <div className="new-session-dropdown">
          {loading ? (
            <div className="new-session-loading">Loading models...</div>
          ) : Object.keys(models).length === 0 ? (
            <div className="new-session-empty">
              <p>No models available</p>
              {onOpenSettings && (
                <button
                  className="new-session-configure-inline"
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
            <>
              {/* Agents Section */}
              {groupedProviders.agents && Object.keys(groupedProviders.agents).length > 0 && (
                <>
                  <div className="new-session-section-header">Agents</div>
                  {Object.entries(groupedProviders.agents).map(([provider, providerModels]) => (
                    <div key={provider} className="new-session-provider-group">
                      <div className="new-session-provider-header">
                        {getProviderIcon(provider, { size: 14 })}
                        {getProviderLabel(provider)}
                      </div>
                      {providerModels.map(model => {
                        const isCurrent = model.id === currentModel;
                        const isDisabled = isTypeSwitchDisabled(provider);
                        const disabledTooltip = 'Start a new session to switch between Agent and Chat modes';
                        return (
                          <button
                            key={model.id}
                            className={`new-session-option ${isCurrent ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                            onClick={() => !isDisabled && handleModelSelect(model.id)}
                            title={isDisabled ? disabledTooltip : (isCurrent ? 'Start new conversation' : `Switch to ${model.name}`)}
                            aria-disabled={isDisabled}
                          >
                            <div className="new-session-option-info">
                              <div className="new-session-option-name">
                                {model.name}
                                {isCurrent && (
                                  <span className="new-session-option-current"> (current)</span>
                                )}
                              </div>
                            </div>
                            {isDisabled ? (
                              <MaterialSymbol icon="block" size={16} className="new-session-option-icon disabled-icon" />
                            ) : isCurrent ? (
                              <MaterialSymbol icon="refresh" size={16} className="new-session-option-icon" />
                            ) : (
                              <MaterialSymbol icon="swap_horiz" size={16} className="new-session-option-icon" />
                            )}
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
                    <div className="new-session-divider" />
                  )}
                  <div className="new-session-section-header">Models</div>
                  {Object.entries(groupedProviders.models).map(([provider, providerModels]) => (
                    <div key={provider} className="new-session-provider-group">
                      <div className="new-session-provider-header">
                        {getProviderIcon(provider, { size: 14 })}
                        {getProviderLabel(provider)}
                      </div>
                      {providerModels.map(model => {
                        const isCurrent = model.id === currentModel;
                        const isDisabled = isTypeSwitchDisabled(provider);
                        const disabledTooltip = 'Start a new session to switch between Agent and Chat modes';
                        return (
                          <button
                            key={model.id}
                            className={`new-session-option ${isCurrent ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                            onClick={() => !isDisabled && handleModelSelect(model.id)}
                            title={isDisabled ? disabledTooltip : (isCurrent ? 'Start new conversation' : `Switch to ${model.name}`)}
                            aria-disabled={isDisabled}
                          >
                            <div className="new-session-option-info">
                              <div className="new-session-option-name">
                                {model.name}
                                {isCurrent && (
                                  <span className="new-session-option-current"> (current)</span>
                                )}
                              </div>
                            </div>
                            {isDisabled ? (
                              <MaterialSymbol icon="block" size={16} className="new-session-option-icon disabled-icon" />
                            ) : isCurrent ? (
                              <MaterialSymbol icon="refresh" size={16} className="new-session-option-icon" />
                            ) : (
                              <MaterialSymbol icon="swap_horiz" size={16} className="new-session-option-icon" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
          {onOpenSettings && (
            <>
              <div className="new-session-divider" />
              <button
                className="new-session-configure"
                onClick={() => {
                  onOpenSettings();
                  setIsOpen(false);
                }}
              >
                <MaterialSymbol icon="settings" size={16} />
                <span>Configure Models</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
