import React from 'react';
import { MaterialSymbol } from '../MaterialSymbol';

interface ChatHeaderProps {
  onToggleCollapse: () => void;
  onOpenSessionManager?: () => void;
  children?: React.ReactNode;
}

export function ChatHeader({ onToggleCollapse, onOpenSessionManager, children }: ChatHeaderProps) {
  return (
    <div className="ai-chat-header">
      <h3 className="ai-chat-title">AI Assistant</h3>
      {children && (
        <div className="ai-chat-header-controls">
          {children}
        </div>
      )}
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
  );
}