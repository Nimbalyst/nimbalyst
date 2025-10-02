import React, { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { StreamingStatus } from './StreamingStatus';
import type { Message } from '@stravu/runtime/ai/server/types';

// Message type is now imported from runtime package

interface ChatMessagesProps {
  messages: Message[];
  isLoading: boolean;
  onApplyEdit?: (edit: any) => Promise<{ success: boolean; error?: string }>;
  provider?: string;  // Provider to show appropriate icon
  modelName?: string;  // Current model name for display
  hasDocument?: boolean;  // Whether a document is open
  currentFilePath?: string;  // Currently active file path
  onOpenFile?: (filePath: string) => void;  // Callback to open a file
}

export function ChatMessages({
  messages,
  isLoading,
  onApplyEdit,
  provider,
  modelName,
  hasDocument = true,
  currentFilePath,
  onOpenFile
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="ai-chat-messages" ref={containerRef}>
      {messages.length === 0 && !isLoading && (
        <div className="ai-chat-empty">
          {hasDocument ? (
            <>
              <p>Start a conversation{modelName ? ` with ${modelName}` : ''}</p>
              <p className="ai-chat-empty-hint">Ask questions about your document or get help with editing</p>
            </>
          ) : (
            <>
              <p>No document open</p>
              <p className="ai-chat-empty-hint">Open a document to start editing with AI assistance</p>
            </>
          )}
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
                // CRITICAL: Check if we need to switch documents first
                const targetPath = message.toolCall?.targetFilePath || args.filePath;

                if (targetPath && currentFilePath && targetPath !== currentFilePath) {
                  // Tool call targets a different file - need to switch first
                  console.warn(`[ChatMessages] Reapply targets ${targetPath} but current file is ${currentFilePath}`);

                  // Switch to the target file first, then reapply
                  if (onOpenFile) {
                    onOpenFile(targetPath);

                    // Wait a bit for the file to open, then apply
                    setTimeout(() => {
                      if (onApplyEdit && args?.replacements) {
                        const edit = {
                          type: 'diff',
                          file: targetPath,
                          replacements: args.replacements
                        };
                        onApplyEdit(edit);
                      }
                    }, 500);
                  } else {
                    console.error('[ChatMessages] Cannot reapply - file opener not available');
                  }
                } else {
                  // Same file or no target path - apply directly
                  if (onApplyEdit && args?.replacements) {
                    const edit = {
                      type: 'diff',
                      file: targetPath || currentFilePath || 'current',
                      replacements: args.replacements
                    };
                    onApplyEdit(edit);
                  }
                }
              }
            : undefined;
          
          return (
            <ChatMessage
              key={index}
              role={message.role}
              content={message.content}
              toolCall={message.toolCall}
              isError={message.isError}
              errorMessage={message.errorMessage}
              onApplyEdit={onApplyEdit}
              onReapply={handleReapply}
              provider={provider}
              hasDocument={hasDocument}
              currentFilePath={currentFilePath}
              onOpenFile={onOpenFile}
            />
          );
        } else {
          return (
            <ChatMessage
              key={index}
              role={message.role}
              content={message.content}
              edits={message.edits}
              isError={message.isError}
              onApplyEdit={onApplyEdit}
              provider={provider}
              hasDocument={hasDocument}
              currentFilePath={currentFilePath}
              onOpenFile={onOpenFile}
            />
          );
        }
      })}
      
      {isLoading && (
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
