import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { claudeApi, DocumentContext } from '../../services/claudeApi';
import './AIChat.css';

interface AIChatProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  documentContext?: DocumentContext;
  onApplyEdit?: (edit: any) => void;
}

export function AIChat({
  isCollapsed,
  onToggleCollapse,
  width,
  onWidthChange,
  documentContext,
  onApplyEdit
}: AIChatProps) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; edits?: any[] }>>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamContent, setCurrentStreamContent] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const isResizingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Initialize Claude on mount
  useEffect(() => {
    const initClaude = async () => {
      try {
        await claudeApi.initialize();
        await claudeApi.createSession(documentContext);
        setIsInitialized(true);
      } catch (error: any) {
        console.error('Failed to initialize Claude:', error);
        setInitError(error.message || 'Failed to initialize Claude');
      }
    };

    initClaude();

    // Set up streaming response listener
    const handleStreamResponse = (data: any) => {
      if (data.isComplete) {
        // Final response with edits
        setMessages(prev => {
          const newMessages = [...prev];
          if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
            newMessages[newMessages.length - 1].content = data.content;
            newMessages[newMessages.length - 1].edits = data.edits;
          } else {
            newMessages.push({ 
              role: 'assistant', 
              content: data.content,
              edits: data.edits 
            });
          }
          return newMessages;
        });
        setCurrentStreamContent('');
        setIsLoading(false);
        
        // Auto-apply edits when they arrive
        if (data.edits && data.edits.length > 0 && onApplyEdit) {
          data.edits.forEach((edit: any) => {
            console.log('Auto-applying edit from Claude:', edit);
            onApplyEdit(edit);
          });
        }
      } else if (data.partial) {
        // Streaming partial response
        setCurrentStreamContent(prev => prev + data.partial);
      }
    };

    claudeApi.on('streamResponse', handleStreamResponse);

    // Set up edit request listener
    const handleEditRequest = (edit: any) => {
      if (onApplyEdit) {
        onApplyEdit(edit);
      }
    };

    claudeApi.on('editRequest', handleEditRequest);

    return () => {
      claudeApi.off('streamResponse', handleStreamResponse);
      claudeApi.off('editRequest', handleEditRequest);
    };
  }, [documentContext, onApplyEdit]);

  // Update document context when it changes
  useEffect(() => {
    if (isInitialized && documentContext) {
      // Update context for future messages
      // This could be enhanced to send context updates to Claude
    }
  }, [documentContext, isInitialized]);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      
      // Calculate new width from right edge
      const newWidth = window.innerWidth - e.clientX;
      const clampedWidth = Math.min(Math.max(280, newWidth), 600);
      onWidthChange(clampedWidth);
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onWidthChange]);

  const handleSendMessage = useCallback(async (message: string) => {
    if (!message.trim() || !isInitialized) return;
    
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setInputValue('');
    setIsLoading(true);
    setCurrentStreamContent('');
    
    try {
      // Send message to Claude with document context
      await claudeApi.sendMessage(message, documentContext);
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error processing your request. Please try again.' 
      }]);
      setIsLoading(false);
    }
  }, [isInitialized, documentContext]);

  const handleApplyEdit = useCallback((edit: any) => {
    // Apply the edit through the API
    claudeApi.applyEdit(edit);
  }, []);

  if (isCollapsed) {
    return (
      <button 
        className="ai-chat-floating-toggle"
        onClick={onToggleCollapse}
        title="Open AI Assistant (⌘⇧A)"
        aria-label="Open AI Assistant"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
          <path d="M4 3L4.5 4.5L6 5L4.5 5.5L4 7L3.5 5.5L2 5L3.5 4.5L4 3Z" fill="currentColor" opacity="0.6"/>
          <path d="M16 13L16.5 14.5L18 15L16.5 15.5L16 17L15.5 15.5L14 15L15.5 14.5L16 13Z" fill="currentColor" opacity="0.6"/>
        </svg>
      </button>
    );
  }

  return (
    <div 
      ref={panelRef}
      className="ai-chat" 
      style={{ width }}
    >
      <div 
        className="ai-chat-resize-handle"
        onMouseDown={handleMouseDown}
      />
      
      <ChatHeader onToggleCollapse={onToggleCollapse} />
      
      {initError ? (
        <div className="ai-chat-error">
          <p>Failed to initialize Claude AI:</p>
          <p>{initError}</p>
          <p>Please check your API key in settings.</p>
        </div>
      ) : (
        <>
          <ChatMessages 
            messages={messages}
            isLoading={isLoading}
            currentStreamContent={currentStreamContent}
            onApplyEdit={handleApplyEdit}
          />
          
          <ChatInput 
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSendMessage}
            disabled={isLoading || !isInitialized}
            placeholder={!isInitialized ? "Initializing Claude..." : "Ask Claude anything..."}
          />
        </>
      )}
    </div>
  );
}