import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import './NewSessionButton.css';

interface NewSessionButtonProps {
  currentProvider: 'claude' | 'claude-code';
  onNewSession: (provider: 'claude' | 'claude-code') => void;
  disabled?: boolean;
}

export function NewSessionButton({
  currentProvider,
  onNewSession,
  disabled = false
}: NewSessionButtonProps) {
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
      name: 'Claude Code Session',
      description: 'With MCP tools',
      icon: 'code'
    },
    {
      id: 'claude' as const,
      name: 'Claude SDK Session',
      description: 'Direct API',
      icon: 'api'
    }
  ];

  const handleMainClick = () => {
    onNewSession(currentProvider);
  };

  const handleProviderSelect = (provider: 'claude' | 'claude-code') => {
    onNewSession(provider);
    setIsOpen(false);
  };

  const currentProviderInfo = providers.find(p => p.id === currentProvider);

  return (
    <div className="new-session-button" ref={dropdownRef}>
      <button
        className="new-session-button-main"
        onClick={handleMainClick}
        disabled={disabled}
        title={`New ${currentProviderInfo?.name}`}
        aria-label={`New ${currentProviderInfo?.name}`}
      >
        <MaterialSymbol icon="add" size={20} />
      </button>
      <button
        className="new-session-button-dropdown"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        title="Choose session type"
        aria-label="Choose session type"
      >
        <MaterialSymbol icon="expand_more" size={16} />
      </button>

      {isOpen && (
        <div className="new-session-dropdown">
          {providers.map(provider => (
            <button
              key={provider.id}
              className={`new-session-option ${provider.id === currentProvider ? 'selected' : ''}`}
              onClick={() => handleProviderSelect(provider.id)}
            >
              <MaterialSymbol icon={provider.icon} size={16} />
              <div className="new-session-option-info">
                <div className="new-session-option-name">{provider.name}</div>
                <div className="new-session-option-description">{provider.description}</div>
              </div>
              {provider.id === currentProvider && (
                <MaterialSymbol icon="check" size={16} className="new-session-option-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}