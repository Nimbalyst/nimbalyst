import React, { useRef, useEffect, KeyboardEvent, forwardRef, useImperativeHandle, useState, useCallback } from 'react';
import { GenericTypeahead, TypeaheadOption } from '../Typeahead/GenericTypeahead';
import { extractTriggerMatch, insertAtTrigger, TriggerMatch } from '../Typeahead/typeaheadUtils';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (message: string) => void;
  onNavigateHistory?: (direction: 'up' | 'down') => void;
  onCancel?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;

  // File mention support
  fileMentionOptions?: TypeaheadOption[];
  onFileMentionSearch?: (query: string) => void;
  onFileMentionSelect?: (option: TypeaheadOption) => void;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  ({
    value,
    onChange,
    onSend,
    onNavigateHistory,
    onCancel,
    disabled,
    isLoading,
    placeholder = "Ask a question...",
    fileMentionOptions = [],
    onFileMentionSearch,
    onFileMentionSelect
  }, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [typeaheadMatch, setTypeaheadMatch] = useState<TriggerMatch | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Expose the textarea element through the ref
  useImperativeHandle(ref, () => textareaRef.current!);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  // Check for typeahead trigger when value or cursor changes
  useEffect(() => {
    if (!textareaRef.current || !onFileMentionSearch) {
      console.log('[ChatInput] Typeahead check skipped:', { hasRef: !!textareaRef.current, hasCallback: !!onFileMentionSearch });
      return;
    }

    const textarea = textareaRef.current;
    const pos = textarea.selectionStart;

    const match = extractTriggerMatch(value, pos, '@');
    // console.log('[ChatInput] Typeahead trigger check:', { value, pos, match });

    if (match) {
      // console.log('[ChatInput] Setting typeahead match:', match);
      setTypeaheadMatch(match);
      setCursorPosition(pos);
      onFileMentionSearch(match.query);

      // Auto-select first option
      if (fileMentionOptions.length > 0) {
        setSelectedIndex(0);
      }
    } else {
      setTypeaheadMatch(null);
      setSelectedIndex(null);
    }
  }, [value, cursorPosition, onFileMentionSearch, fileMentionOptions.length]);

  // Update cursor position on selection change
  const handleSelectionChange = useCallback(() => {
    if (textareaRef.current) {
      setCursorPosition(textareaRef.current.selectionStart);
    }
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.addEventListener('select', handleSelectionChange);
    textarea.addEventListener('click', handleSelectionChange);

    return () => {
      textarea.removeEventListener('select', handleSelectionChange);
      textarea.removeEventListener('click', handleSelectionChange);
    };
  }, [handleSelectionChange]);

  // Handle typeahead option selection
  const handleTypeaheadSelect = useCallback((option: TypeaheadOption) => {
    if (!typeaheadMatch || !textareaRef.current) return;

    // Use the relative path from project root
    const filePath = option.data?.path || option.label;
    const fileMention = `@${filePath}`;

    const { value: newValue, cursorPos } = insertAtTrigger(
      value,
      typeaheadMatch,
      fileMention
    );

    onChange(newValue);

    // Update cursor position
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
        textareaRef.current.focus();
      }
    }, 0);

    // Notify parent
    if (onFileMentionSelect) {
      onFileMentionSelect(option);
    }

    // Close typeahead
    setTypeaheadMatch(null);
    setSelectedIndex(null);
  }, [typeaheadMatch, value, onChange, onFileMentionSelect]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // If typeahead is open, handle navigation keys
    if (typeaheadMatch && fileMentionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => {
          if (prev === null) return 0;
          return Math.min(prev + 1, fileMentionOptions.length - 1);
        });
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => {
          if (prev === null || prev === 0) return 0;
          return prev - 1;
        });
        return;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (selectedIndex !== null && fileMentionOptions[selectedIndex]) {
          handleTypeaheadSelect(fileMentionOptions[selectedIndex]);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setTypeaheadMatch(null);
        setSelectedIndex(null);
        return;
      }
    }

    // Handle Escape to cancel (only if typeahead is not open)
    if (e.key === 'Escape' && isLoading && onCancel) {
      e.preventDefault();
      onCancel();
      return;
    }

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

    // Handle arrow keys for history navigation (only when at start/end of input and no typeahead)
    if (onNavigateHistory && !typeaheadMatch) {
      const textarea = e.currentTarget;
      const cursorPos = textarea.selectionStart;
      const isAtStart = cursorPos === 0;
      const isAtEnd = cursorPos === value.length;

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

    // Handle Enter to send (Shift+Enter for new line, but not when typeahead is open)
    if (e.key === 'Enter' && !e.shiftKey && !typeaheadMatch) {
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
    <div className="ai-chat-input" style={{ position: 'relative' }}>
      <div className="ai-chat-input-row">
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
        {isLoading && onCancel ? (
          <button
            className="ai-chat-cancel-button"
            onClick={onCancel}
            title="Cancel request (Esc)"
            aria-label="Cancel request"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ) : (
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
        )}
      </div>

      {/* File mention typeahead */}
      {typeaheadMatch && fileMentionOptions.length > 0 && (
        <GenericTypeahead
          anchorElement={textareaRef.current}
          options={fileMentionOptions}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={setSelectedIndex}
          onSelect={handleTypeaheadSelect}
          onClose={() => {
            setTypeaheadMatch(null);
            setSelectedIndex(null);
          }}
          cursorPosition={cursorPosition}
          maxHeight={500}
        />
      )}
    </div>
  );
});

ChatInput.displayName = 'ChatInput';
