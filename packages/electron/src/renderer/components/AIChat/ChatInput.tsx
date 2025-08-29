import React, { useRef, useEffect, KeyboardEvent, forwardRef, useImperativeHandle } from 'react';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (message: string) => void;
  onNavigateHistory?: (direction: 'up' | 'down') => void;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  ({ value, onChange, onSend, onNavigateHistory, disabled, placeholder = "Ask a question..." }, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Expose the textarea element through the ref
  useImperativeHandle(ref, () => textareaRef.current!);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
     // Handle Cmd+A / Ctrl+A for select all
    if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !e.shiftKey) {
      e.stopPropagation(); // Prevent bubbling to global handlers
      // Don't preventDefault - let the browser handle select all
      const textarea = e.currentTarget;
      setTimeout(() => {
        textarea.select();
      }, 0);
      return;
    }

    // Handle arrow keys for history navigation (only when at start/end of input)
    if (onNavigateHistory) {
      const textarea = e.currentTarget;
      const cursorPosition = textarea.selectionStart;
      const isAtStart = cursorPosition === 0;
      const isAtEnd = cursorPosition === value.length;
      
      if (e.key === 'ArrowUp' && isAtStart) {
        e.preventDefault();
        onNavigateHistory('up');
        // Move cursor to beginning after navigation
        setTimeout(() => {
          textarea.setSelectionRange(0, 0);
        }, 0);
        return;
      }
      
      if (e.key === 'ArrowDown' && isAtEnd) {
        e.preventDefault();
        onNavigateHistory('down');
        return;
      }
    }

    // Handle Enter to send (Shift+Enter for new line)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) {
        onSend(value);
      }
    }
  };

  const handleSend = () => {
    if (value.trim() && !disabled) {
      onSend(value);
    }
  };

  return (
    <div className="ai-chat-input">
      <textarea
        ref={textareaRef}
        className="ai-chat-input-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
      />
      <button
        className="ai-chat-send-button"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        title="Send message (Enter)"
        aria-label="Send message"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 8L14 2L11 14L8 9L2 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
});

ChatInput.displayName = 'ChatInput';
