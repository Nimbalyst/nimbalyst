import React, { useRef, useEffect, KeyboardEvent, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { GenericTypeahead, TypeaheadOption } from '../Typeahead/GenericTypeahead';
import { extractTriggerMatch, insertAtTrigger, TriggerMatch } from '../Typeahead/typeaheadUtils';
import type { ChatAttachment } from '@nimbalyst/runtime';
import { AttachmentPreviewList } from '../AgenticCoding/AttachmentPreviewList';
import { ModeTag, AIMode } from './ModeTag';
import { ModelSelector } from './ModelSelector';
import '../AIChat/AIChat.css';

export interface AIInputRef {
  focus: () => void;
  textarea: HTMLTextAreaElement | null;
}

interface AIInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (message?: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  workspacePath?: string;
  sessionId?: string;

  // History navigation support (from ChatInput)
  onNavigateHistory?: (direction: 'up' | 'down') => void;

  // File mention support
  fileMentionOptions?: TypeaheadOption[];
  onFileMentionSearch?: (query: string) => void;
  onFileMentionSelect?: (option: TypeaheadOption) => void;

  // Attachment support (from AgenticInput)
  attachments?: ChatAttachment[];
  onAttachmentAdd?: (attachment: ChatAttachment) => void;
  onAttachmentRemove?: (attachmentId: string) => void;

  // Slash command support (from AgenticInput)
  enableSlashCommands?: boolean;

  // Mode support (plan vs agent)
  mode?: AIMode;
  onModeChange?: (mode: AIMode) => void;

  // Model selection support
  currentModel?: string;
  onModelChange?: (modelId: string) => void;
}

/**
 * Unified AI input component that merges features from AgenticInput and ChatInput.
 * Supports:
 * - File mentions (@) with typeahead
 * - Slash commands (/) with typeahead (optional)
 * - Image/file attachments via drag & drop and paste (optional)
 * - History navigation with arrow keys (optional)
 * - Auto-resize
 * - Send/Cancel buttons
 */
export const AIInput = forwardRef<AIInputRef, AIInputProps>(
  ({
    value,
    onChange,
    onSend,
    onCancel,
    disabled,
    isLoading,
    placeholder = "Type your message... (Enter to send, Shift+Enter for new line, @ for files)",
    workspacePath,
    sessionId,
    onNavigateHistory,
    fileMentionOptions = [],
    onFileMentionSearch,
    onFileMentionSelect,
    attachments = [],
    onAttachmentAdd,
    onAttachmentRemove,
    enableSlashCommands = false,
    mode = 'plan',
    onModeChange,
    currentModel,
    onModelChange
  }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [typeaheadMatch, setTypeaheadMatch] = useState<TriggerMatch | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [slashCommandOptions, setSlashCommandOptions] = useState<TypeaheadOption[]>([]);
    const [allSlashCommands, setAllSlashCommands] = useState<any[]>([]);
    const [dragActive, setDragActive] = useState(false);

    // Expose focus method and textarea element through the ref
    useImperativeHandle(ref, () => ({
      focus: () => {
        textareaRef.current?.focus();
      },
      get textarea() {
        return textareaRef.current;
      }
    }));

    // Auto-resize textarea (use RAF to batch DOM operations)
    useEffect(() => {
      if (!textareaRef.current) return;

      const textarea = textareaRef.current;
      const rafId = requestAnimationFrame(() => {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
      });

      return () => cancelAnimationFrame(rafId);
    }, [value]);

    // Fetch slash commands on mount and when workspace changes (if enabled)
    useEffect(() => {
      if (!enableSlashCommands || !workspacePath) return;

      const fetchSlashCommands = async () => {
        try {
          // Get SDK commands from ClaudeCodeProvider if available
          let sdkCommands: string[] = [];
          try {
            const sdkResult = await window.electronAPI.invoke('ai:getSlashCommands', sessionId);
            if (sdkResult?.success && Array.isArray(sdkResult.commands)) {
              sdkCommands = sdkResult.commands;
              // console.log('[AIInput] Got SDK commands from provider:', sdkCommands);
            }
          } catch (sdkError) {
            console.warn('[AIInput] Failed to get SDK commands:', sdkError);
          }

          // Fetch all commands (built-in + custom)
          const commands = await window.electronAPI.invoke('slash-command:list', {
            workspacePath,
            sdkCommands
          });

          setAllSlashCommands(commands || []);
          // console.log('[AIInput] Loaded slash commands:', commands);
        } catch (error) {
          console.error('[AIInput] Failed to load slash commands:', error);
          setAllSlashCommands([]);
        }
      };

      fetchSlashCommands();
    }, [workspacePath, sessionId, enableSlashCommands]);

    // Get icon for command based on name and source
    const getCommandIcon = (cmd: any): string => {
      if (cmd.source === 'builtin') {
        const builtinIcons: Record<string, string> = {
          'compact': 'compress',
          'clear': 'delete_sweep',
          'context': 'info',
          'cost': 'payments',
          'init': 'restart_alt',
          'output-style:new': 'palette',
          'pr-comments': 'comment',
          'release-notes': 'description',
          'todos': 'checklist',
          'review': 'rate_review',
          'security-review': 'security'
        };
        return builtinIcons[cmd.name] || 'bolt';
      }
      return 'code';
    };

    // Filter slash commands based on query
    const filterSlashCommands = useCallback((query: string) => {
      const lowerQuery = query.toLowerCase();
      const filtered = allSlashCommands
        .filter(cmd => cmd.name.toLowerCase().includes(lowerQuery))
        .map(cmd => ({
          id: cmd.name,
          label: `/${cmd.name}`,
          description: cmd.description || `Execute ${cmd.name} command`,
          icon: getCommandIcon(cmd),
          section: cmd.source === 'builtin' ? 'Built-in Commands' :
                   cmd.source === 'project' ? 'Project Commands' : 'User Commands',
          data: cmd
        }));

      setSlashCommandOptions(filtered);
    }, [allSlashCommands]);

    // Check for typeahead trigger when value or cursor changes (debounced for performance)
    useEffect(() => {
      if (!textareaRef.current) return;

      const textarea = textareaRef.current;
      const pos = textarea.selectionStart;

      // Build trigger list based on enabled features
      const triggers: string[] = [];
      if (onFileMentionSearch) triggers.push('@');
      if (enableSlashCommands) triggers.push('/');

      if (triggers.length === 0) {
        setTypeaheadMatch(null);
        return;
      }

      // Debounce expensive typeahead operations (but allow immediate trigger detection)
      const match = extractTriggerMatch(value, pos, triggers);

      if (match) {
        setTypeaheadMatch(match);
        setCursorPosition(pos);

        // Debounce the expensive filtering operations
        const timerId = setTimeout(() => {
          if (match.trigger === '@' && onFileMentionSearch) {
            onFileMentionSearch(match.query);
            if (fileMentionOptions.length > 0) {
              setSelectedIndex(0);
            }
          } else if (match.trigger === '/' && enableSlashCommands) {
            filterSlashCommands(match.query);
            setSelectedIndex(0);
          }
        }, 150); // 150ms debounce - fast enough to feel instant, slow enough to skip intermediate keystrokes

        return () => clearTimeout(timerId);
      } else {
        setTypeaheadMatch(null);
        setSelectedIndex(null);
      }
    }, [value, cursorPosition, onFileMentionSearch, filterSlashCommands, enableSlashCommands, fileMentionOptions.length]);

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

      let insertText: string;

      if (typeaheadMatch.trigger === '@') {
        insertText = `@${option.data?.path || option.label}`;
      } else if (typeaheadMatch.trigger === '/') {
        const commandName = option.data?.name || option.id;
        insertText = `/${commandName}`;
      } else {
        return;
      }

      const { value: newValue, cursorPos } = insertAtTrigger(
        value,
        typeaheadMatch,
        insertText
      );

      onChange(newValue);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(cursorPos, cursorPos);
          textareaRef.current.focus();
        }
      }, 0);

      if (typeaheadMatch.trigger === '@' && onFileMentionSelect) {
        onFileMentionSelect(option);
      }

      setTypeaheadMatch(null);
      setSelectedIndex(null);
    }, [typeaheadMatch, value, onChange, onFileMentionSelect]);

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const currentOptions = typeaheadMatch?.trigger === '@' ? fileMentionOptions : slashCommandOptions;

      // Handle typeahead navigation
      if (typeaheadMatch && currentOptions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex(prev => {
            if (prev === null) return 0;
            return Math.min(prev + 1, currentOptions.length - 1);
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
          if (selectedIndex !== null && currentOptions[selectedIndex]) {
            handleTypeaheadSelect(currentOptions[selectedIndex]);
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
        e.stopPropagation();
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

    // Handle file attachment
    const handleFileAttachment = useCallback(async (file: File) => {
      if (!onAttachmentAdd || !sessionId) return;

      try {
        const validation = await window.electronAPI.invoke('attachment:validate', {
          fileSize: file.size,
          mimeType: file.type
        });

        if (!validation.valid) {
          console.error('[AIInput] File validation failed:', validation.error);
          alert(validation.error || 'Invalid file');
          return;
        }

        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const result = await window.electronAPI.invoke('attachment:save', {
          fileBuffer: Array.from(uint8Array),
          filename: file.name,
          mimeType: file.type,
          sessionId
        });

        if (result.success && result.attachment) {
          onAttachmentAdd(result.attachment);
          const reference = `@${file.name}`;
          onChange(value + (value ? ' ' : '') + reference);
        } else {
          console.error('[AIInput] Failed to save attachment:', result.error);
          alert(result.error || 'Failed to save attachment');
        }
      } catch (error) {
        console.error('[AIInput] Error handling file attachment:', error);
        alert('Failed to attach file');
      }
    }, [onAttachmentAdd, sessionId, value, onChange]);

    // Drag and drop handlers
    const handleDragOver = useCallback((e: React.DragEvent) => {
      if (!onAttachmentAdd) return;
      e.preventDefault();
      e.stopPropagation();
      setDragActive(true);
    }, [onAttachmentAdd]);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
      if (!onAttachmentAdd) return;
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        await handleFileAttachment(file);
      }
    }, [onAttachmentAdd, handleFileAttachment]);

    // Paste handler for images
    const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
      if (!onAttachmentAdd) return;

      const items = Array.from(e.clipboardData.items);
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await handleFileAttachment(file);
          }
        }
      }
    }, [onAttachmentAdd, handleFileAttachment]);

    // Handle attachment removal
    const handleRemoveAttachment = useCallback((attachmentId: string) => {
      if (onAttachmentRemove) {
        onAttachmentRemove(attachmentId);
      }
    }, [onAttachmentRemove]);

    const handleSend = () => {
      if (value.trim() && !disabled) {
        onSend(value);
      }
    };

    return (
      <div className="ai-chat-input" style={{ position: 'relative' }}>
        {/* Attachment preview list */}
        {attachments && attachments.length > 0 && (
          <AttachmentPreviewList
            attachments={attachments}
            onRemove={handleRemoveAttachment}
          />
        )}

        {/* Inline controls row */}
        {(onModeChange || onModelChange) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 0',
            marginBottom: '4px'
          }}>
            {onModeChange && <ModeTag mode={mode} onModeChange={onModeChange} />}
            {onModelChange && currentModel && <ModelSelector currentModel={currentModel} onModelChange={onModelChange} />}
          </div>
        )}

        {/* Input container with drag/drop support */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            gap: '8px',
            position: 'relative',
            border: dragActive ? '2px dashed var(--primary-color)' : 'none',
            borderRadius: dragActive ? '4px' : '0',
            backgroundColor: dragActive ? 'var(--surface-hover)' : 'transparent',
            transition: 'all 0.2s ease',
            padding: dragActive ? '4px' : '0'
          }}
        >
          <textarea
            ref={textareaRef}
            className="ai-chat-input-field"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            style={{
              flex: 1,
              minHeight: '36px',
              maxHeight: '200px',
              resize: 'none'
            }}
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

        {/* Typeahead for file mentions and slash commands */}
        {typeaheadMatch && (
          (typeaheadMatch.trigger === '@' && fileMentionOptions.length > 0) ||
          (typeaheadMatch.trigger === '/' && slashCommandOptions.length > 0)
        ) && (
          <GenericTypeahead
            anchorElement={textareaRef.current}
            options={typeaheadMatch.trigger === '@' ? fileMentionOptions : slashCommandOptions}
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
  }
);

AIInput.displayName = 'AIInput';
