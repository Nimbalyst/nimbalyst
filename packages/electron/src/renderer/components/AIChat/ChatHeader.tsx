import React from 'react';
import { MaterialSymbol } from '../MaterialSymbol';

interface ChatHeaderProps {
  onToggleCollapse: () => void;
  onNewSession?: () => void;
  children?: React.ReactNode;
}

export function ChatHeader({ onToggleCollapse, onNewSession, children }: ChatHeaderProps) {
  return (
    <div className="ai-chat-header">
      <h3 className="ai-chat-title">AI Assistant</h3>
      {children && (
        <div className="ai-chat-header-controls">
          {children}
        </div>
      )}
      <div className="ai-chat-header-actions">
        {onNewSession && (
          <button
            className="ai-chat-action-button"
            onClick={onNewSession}
            title="New Session"
            aria-label="New Session"
          >
            <MaterialSymbol icon="add" size={20} />
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
  );
}