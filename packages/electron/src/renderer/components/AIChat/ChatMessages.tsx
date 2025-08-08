import React, { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  edits?: any[];
}

interface ChatMessagesProps {
  messages: Message[];
  isLoading: boolean;
  currentStreamContent?: string;
  onApplyEdit?: (edit: any) => void;
}

export function ChatMessages({ 
  messages, 
  isLoading, 
  currentStreamContent,
  onApplyEdit 
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamContent]);

  return (
    <div className="ai-chat-messages" ref={containerRef}>
      {messages.length === 0 && !isLoading && (
        <div className="ai-chat-empty">
          <p>Start a conversation with Claude</p>
          <p className="ai-chat-empty-hint">Ask questions about your document or get help with editing</p>
        </div>
      )}
      
      {messages.map((message, index) => (
        <ChatMessage
          key={index}
          role={message.role}
          content={message.content}
          edits={message.edits}
          onApplyEdit={onApplyEdit}
        />
      ))}
      
      {/* Show streaming content */}
      {currentStreamContent && (
        <ChatMessage
          role="assistant"
          content={currentStreamContent}
          isStreaming={true}
        />
      )}
      
      {isLoading && !currentStreamContent && (
        <div className="ai-chat-loading">
          <div className="ai-chat-loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      )}
      
      <div ref={messagesEndRef} />
    </div>
  );
}