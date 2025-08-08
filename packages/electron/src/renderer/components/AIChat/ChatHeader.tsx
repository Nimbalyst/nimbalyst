import React from 'react';

interface ChatHeaderProps {
  onToggleCollapse: () => void;
}

export function ChatHeader({ onToggleCollapse }: ChatHeaderProps) {
  return (
    <div className="ai-chat-header">
      <h3 className="ai-chat-title">AI Assistant</h3>
      <div className="ai-chat-header-actions">
        <button
          className="ai-chat-action-button"
          onClick={onToggleCollapse}
          title="Collapse (⌘⇧A)"
          aria-label="Collapse AI Assistant"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}