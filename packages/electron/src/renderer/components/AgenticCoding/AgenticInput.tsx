import React, { useRef, useEffect, KeyboardEvent, useState, useCallback } from 'react';
import { GenericTypeahead, TypeaheadOption } from '../Typeahead/GenericTypeahead';
import { extractTriggerMatch, insertAtTrigger, TriggerMatch } from '../Typeahead/typeaheadUtils';

interface AgenticInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;

  // File mention support
  fileMentionOptions?: TypeaheadOption[];
  onFileMentionSearch?: (query: string) => void;
  onFileMentionSelect?: (option: TypeaheadOption) => void;
}

export function AgenticInput({
  value,
  onChange,
  onSend,
  disabled,
  placeholder = "Type your message... (Enter to send, Shift+Enter for new line)",
  fileMentionOptions = [],
  onFileMentionSearch,
  onFileMentionSelect
}: AgenticInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [typeaheadMatch, setTypeaheadMatch] = useState<TriggerMatch | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Check for typeahead trigger when value or cursor changes
  useEffect(() => {
    if (!textareaRef.current || !onFileMentionSearch) return;

    const textarea = textareaRef.current;
    const pos = textarea.selectionStart;

    const match = extractTriggerMatch(value, pos, '@');

    if (match) {
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
  }, [value, cursorPosition, onFileMentionSearch]);

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

    // Format as markdown link: @[filename](path)
    const fileMention = `@[${option.label}](${option.data?.path || option.label})`;

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

    // Handle Enter to send (Shift+Enter for new line, but not when typeahead is open)
    if (e.key === 'Enter' && !e.shiftKey && !typeaheadMatch) {
      e.preventDefault();
      if (value.trim() && !disabled) {
        onSend();
      }
    }
  };

  return (
    <div style={{
      borderTop: '1px solid var(--border-primary)',
      backgroundColor: 'var(--surface-secondary)',
      padding: '0.75rem',
      display: 'flex',
      gap: '0.5rem',
      alignItems: 'flex-end',
      position: 'relative'
    }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          flex: 1,
          minHeight: '2.5rem',
          maxHeight: '10rem',
          padding: '0.5rem',
          backgroundColor: 'var(--surface-primary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '0.375rem',
          resize: 'vertical',
          fontFamily: 'inherit',
          fontSize: '0.875rem',
          outline: 'none'
        }}
      />
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        style={{
          padding: '0.5rem 1rem',
          backgroundColor: disabled || !value.trim() ? 'var(--surface-tertiary)' : 'var(--color-interactive)',
          color: disabled || !value.trim() ? 'var(--text-tertiary)' : 'white',
          border: 'none',
          borderRadius: '0.375rem',
          cursor: disabled || !value.trim() ? 'not-allowed' : 'pointer',
          fontSize: '0.875rem',
          fontWeight: 500,
          whiteSpace: 'nowrap'
        }}
      >
        {disabled ? 'Sending...' : 'Send'}
      </button>

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
        />
      )}
    </div>
  );
}
