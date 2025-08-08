import React from 'react';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatMessage({ role, content }: ChatMessageProps) {
  return (
    <div className={`ai-chat-message ai-chat-message--${role}`}>
      <div className="ai-chat-message-avatar">
        {role === 'user' ? (
          'U'
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 1L9 5L13 6L9 7L8 11L7 7L3 6L7 5L8 1Z" fill="currentColor"/>
            <path d="M3 2L3.5 3.5L5 4L3.5 4.5L3 6L2.5 4.5L1 4L2.5 3.5L3 2Z" fill="currentColor" opacity="0.5"/>
            <path d="M13 10L13.5 11.5L15 12L13.5 12.5L13 14L12.5 12.5L11 12L12.5 11.5L13 10Z" fill="currentColor" opacity="0.5"/>
          </svg>
        )}
      </div>
      <div className="ai-chat-message-content">
        {content}
      </div>
    </div>
  );
}