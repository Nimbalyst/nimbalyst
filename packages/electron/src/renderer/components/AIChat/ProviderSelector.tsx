import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './ProviderSelector.css';

interface ProviderSelectorProps {
  currentProvider: 'claude' | 'claude-code' | 'openai' | 'openai-codex' | 'lmstudio';
  onProviderChange: (provider: 'claude' | 'claude-code' | 'openai' | 'openai-codex' | 'lmstudio') => void;
  disabled?: boolean;
}

export function ProviderSelector({
  currentProvider,
  onProviderChange,
  disabled = false
}: ProviderSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
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

  const providers = [
    {
      id: 'claude-code' as const,
      name: 'Claude Agent',
      description: 'With MCP tools',
      icon: 'code'
    },
    {
      id: 'claude' as const,
      name: 'Claude SDK',
      description: 'Direct API',
      icon: 'api'
    },
    {
      id: 'openai-codex' as const,
      name: 'OpenAI Codex',
      description: 'CLI Agent',
      icon: 'terminal'
    },
    {
      id: 'openai' as const,
      name: 'OpenAI',
      description: 'GPT Models',
      icon: 'smart_toy'
    },
    {
      id: 'lmstudio' as const,
      name: 'LM Studio',
      description: 'Local Models',
      icon: 'computer'
    }
  ];

  const currentProviderInfo = providers.find(p => p.id === currentProvider);

  const handleProviderSelect = (provider: 'claude' | 'claude-code' | 'openai' | 'openai-codex' | 'lmstudio') => {
    onProviderChange(provider);
    setIsOpen(false);
  };

  return (
    <div className="provider-selector" ref={dropdownRef}>
      <button 
        className="provider-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        title="Select AI Provider"
      >
        <MaterialSymbol icon={currentProviderInfo?.icon || 'code'} size={16} />
        <span className="provider-selector-label">{currentProviderInfo?.name}</span>
        <MaterialSymbol icon="expand_more" size={16} className={`provider-selector-arrow ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="provider-selector-dropdown">
          {providers.map(provider => (
            <button
              key={provider.id}
              className={`provider-selector-option ${provider.id === currentProvider ? 'selected' : ''}`}
              onClick={() => handleProviderSelect(provider.id)}
            >
              <MaterialSymbol icon={provider.icon} size={16} />
              <div className="provider-selector-option-info">
                <div className="provider-selector-option-name">{provider.name}</div>
                <div className="provider-selector-option-description">{provider.description}</div>
              </div>
              {provider.id === currentProvider && (
                <MaterialSymbol icon="check" size={16} className="provider-selector-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
