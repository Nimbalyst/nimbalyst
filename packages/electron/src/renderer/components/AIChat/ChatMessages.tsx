import React, { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { StreamingStatus } from './StreamingStatus';

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  edits?: any[];
  toolCall?: {
    name: string;
    arguments?: any;
    result?: any;
  };
  isStreamingStatus?: boolean;
  streamingData?: {
    position: string;
    mode: string;
    content: string;
    isActive: boolean;
  };
}

interface ChatMessagesProps {
  messages: Message[];
  isLoading: boolean;
  currentStreamContent?: string;
  onApplyEdit?: (edit: any) => Promise<{ success: boolean; error?: string }>;
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
      
      {messages.map((message, index) => {
        if (message.isStreamingStatus) {
          return (
            <StreamingStatus
              key={index}
              isActive={message.streamingData?.isActive || false}
              content={message.streamingData?.content}
              position={message.streamingData?.position}
              mode={message.streamingData?.mode}
            />
          );
        } else if (message.role === 'tool' && message.toolCall) {
          // Render tool call as a standalone block with reapply for applyDiff
          const handleReapply = (message.toolCall.name === 'applyDiff' || 
                                 message.toolCall.name?.endsWith('__applyDiff')) 
            ? (args: any) => {
                // Reapply the diff using the onApplyEdit handler
                if (onApplyEdit && args?.replacements) {
                  const edit = {
                    type: 'diff',
                    file: args.filePath || 'current',
                    replacements: args.replacements
                  };
                  onApplyEdit(edit);
                }
              }
            : undefined;
          
          return (
            <ChatMessage
              key={index}
              role={message.role}
              content={message.content}
              toolCall={message.toolCall}
              onApplyEdit={onApplyEdit}
              onReapply={handleReapply}
            />
          );
        } else {
          return (
            <ChatMessage
              key={index}
              role={message.role}
              content={message.content}
              edits={message.edits}
              onApplyEdit={onApplyEdit}
            />
          );
        }
      })}
      
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