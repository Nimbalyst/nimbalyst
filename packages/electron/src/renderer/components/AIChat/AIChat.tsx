import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import './AIChat.css';

interface AIChatProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (width: number) => void;
}

export function AIChat({
  isCollapsed,
  onToggleCollapse,
  width,
  onWidthChange
}: AIChatProps) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isResizingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const handleSendMessage = useCallback((message: string) => {
    if (!message.trim()) return;
    
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setInputValue('');
    setIsLoading(true);
    
    // TODO: Send to AI service
    // For now, just simulate a response
    setTimeout(() => {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'This is a placeholder response. AI integration coming soon!' 
      }]);
      setIsLoading(false);
    }, 1000);
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
      
      <ChatMessages 
        messages={messages}
        isLoading={isLoading}
      />
      
      <ChatInput 
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSendMessage}
        disabled={isLoading}
      />
    </div>
  );
}