import React from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import { getProviderIcon } from '../icons/ProviderIcons';

interface ChatHeaderProps {
  onToggleCollapse: () => void;
  onOpenSessionManager?: () => void;
  children?: React.ReactNode;
  provider?: string;
  model?: string;  // Full provider:model ID
}

export function ChatHeader({ onToggleCollapse, onOpenSessionManager, children, provider, model }: ChatHeaderProps) {

  const parseModelInfo = (modelId?: string): { provider: string; modelName: string } | null => {
    if (!modelId) return null;
    
    // Special case for Claude Code
    if (modelId === 'claude-code') {
      return { provider: 'Claude Code', modelName: 'MCP' };
    }
    
    // Parse provider:model format
    const [provider, ...modelParts] = modelId.split(':');
    const model = modelParts.join(':');
    
    // Get provider display name
    const providerName = provider === 'claude' ? 'Claude' :
                        provider === 'openai' ? 'OpenAI' :
                        provider === 'lmstudio' ? 'LMStudio' :
                        provider;
    
    // Shorten long model names for display
    let modelName = model;
    if (model.includes('claude-opus-4-1')) modelName = 'Opus 4.1';
    else if (model.includes('claude-opus-4')) modelName = 'Opus 4';
    else if (model.includes('claude-sonnet-4')) modelName = 'Sonnet 4';
    else if (model.includes('claude-3-7-sonnet')) modelName = 'Sonnet 3.7';
    else if (model.includes('claude-3-5-sonnet')) modelName = 'Sonnet 3.5';
    else if (model.includes('claude-3-5-haiku')) modelName = 'Haiku 3.5';
    else if (model.includes('claude-3-opus')) modelName = 'Opus 3';
    else if (model.includes('claude-3-sonnet')) modelName = 'Sonnet 3';
    else if (model.includes('claude-3-haiku')) modelName = 'Haiku 3';
    else if (model.includes('gpt-4-turbo')) modelName = 'GPT-4 Turbo';
    else if (model.includes('gpt-4o')) modelName = 'GPT-4o';
    else if (model.includes('gpt-4')) modelName = 'GPT-4';
    else if (model.includes('gpt-3.5')) modelName = 'GPT-3.5';
    else if (model.includes('o1-preview')) modelName = 'o1 Preview';
    else if (model.includes('o1-mini')) modelName = 'o1 Mini';
    
    return { provider: providerName, modelName };
  };

  return (
    <div className="ai-chat-header">
      <div className="ai-chat-header-top">
        <h3 className="ai-chat-title">
          AI Assistant
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
        {model && (() => {
          const modelInfo = parseModelInfo(model);
          if (!modelInfo) return null;
          
          return (
            <div className="ai-chat-model-info">
              {provider ? getProviderIcon(provider, { size: 14 }) : <MaterialSymbol icon="smart_toy" size={14} />}
              <span className="ai-chat-provider-name">{modelInfo.provider}</span>
              <span className="ai-chat-model-separator">•</span>
              <span className="ai-chat-model-name">{modelInfo.modelName}</span>
            </div>
          );
        })()}
        {children && (
          <div className="ai-chat-header-controls">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}