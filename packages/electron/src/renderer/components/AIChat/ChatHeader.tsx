import React from 'react';
import { MaterialSymbol } from '../MaterialSymbol';

interface ChatHeaderProps {
  onToggleCollapse: () => void;
  onOpenSessionManager?: () => void;
  children?: React.ReactNode;
  provider?: string;
  model?: string;
}

export function ChatHeader({ onToggleCollapse, onOpenSessionManager, children, provider, model }: ChatHeaderProps) {
  const getProviderLabel = (provider?: string) => {
    if (!provider) return null;
    switch (provider) {
      case 'claude': return 'SDK';
      case 'claude-code': return 'CODE';
      case 'openai': return 'GPT';
      case 'lmstudio': return 'LOCAL';
      default: return provider.toUpperCase();
    }
  };

  const getModelDisplayName = (modelId?: string) => {
    if (!modelId) return '';
    // Shorten long model names for display
    if (modelId.includes('claude-opus-4-1')) return 'Opus 4.1';
    if (modelId.includes('claude-opus-4')) return 'Opus 4';
    if (modelId.includes('claude-sonnet-4')) return 'Sonnet 4';
    if (modelId.includes('claude-3-7-sonnet')) return 'Sonnet 3.7';
    if (modelId.includes('claude-3-5-sonnet')) return 'Sonnet 3.5';
    if (modelId.includes('claude-3-5-haiku')) return 'Haiku 3.5';
    if (modelId.includes('claude-3-opus')) return 'Opus 3';
    if (modelId.includes('claude-3-sonnet')) return 'Sonnet 3';
    if (modelId.includes('claude-3-haiku')) return 'Haiku 3';
    if (modelId.includes('gpt-4-turbo')) return 'GPT-4 Turbo';
    if (modelId.includes('gpt-4')) return 'GPT-4';
    if (modelId.includes('gpt-3.5')) return 'GPT-3.5';
    // For local models, just use the ID
    return modelId;
  };

  return (
    <div className="ai-chat-header">
      <div className="ai-chat-header-top">
        <h3 className="ai-chat-title">
          AI Assistant
          {provider && (
            <span className={`provider-badge provider-badge-${provider}`}>
              {getProviderLabel(provider)}
            </span>
          )}
        </h3>
        <div className="ai-chat-header-actions">
          {onOpenSessionManager && (
            <button
              className="ai-chat-action-button"
              onClick={onOpenSessionManager}
              title="Session Manager (⌥⌘S)"
              aria-label="Open Session Manager"
            >
              <MaterialSymbol icon="history" size={20} />
            </button>
          )}
          <button
            className="ai-chat-action-button"
            onClick={onToggleCollapse}
            title="Collapse (⌘⇧A)"
            aria-label="Collapse AI Assistant"
          >
            <MaterialSymbol icon="chevron_right" size={20} />
          </button>
        </div>
      </div>
      
      <div className="ai-chat-header-bottom">
        {model && (
          <div className="ai-chat-model-info">
            <MaterialSymbol icon="smart_toy" size={14} />
            <span className="ai-chat-model-name">{getModelDisplayName(model)}</span>
          </div>
        )}
        {children && (
          <div className="ai-chat-header-controls">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}