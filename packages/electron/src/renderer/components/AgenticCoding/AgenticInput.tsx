import React, { useRef, useEffect, KeyboardEvent, useState, useCallback } from 'react';
import { GenericTypeahead, TypeaheadOption } from '../Typeahead/GenericTypeahead';
import { extractTriggerMatch, insertAtTrigger, TriggerMatch } from '../Typeahead/typeaheadUtils';
import type { ChatAttachment } from '@nimbalyst/runtime';
import { AttachmentPreviewList } from './AttachmentPreviewList';

interface AgenticInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  workspacePath?: string;
  sessionId?: string; // Used to trigger command refresh when session changes

  // File mention support
  fileMentionOptions?: TypeaheadOption[];
  onFileMentionSearch?: (query: string) => void;
  onFileMentionSelect?: (option: TypeaheadOption) => void;

  // Attachment support
  attachments?: ChatAttachment[];
  onAttachmentAdd?: (attachment: ChatAttachment) => void;
  onAttachmentRemove?: (attachmentId: string) => void;
}

export function AgenticInput({
  value,
  onChange,
  onSend,
  onCancel,
  disabled,
  isLoading,
  placeholder = "Type your message... (Enter to send, Shift+Enter for new line, @ for files, / for commands)",
  workspacePath,
  sessionId,
  fileMentionOptions = [],
  onFileMentionSearch,
  onFileMentionSelect,
  attachments = [],
  onAttachmentAdd,
  onAttachmentRemove
}: AgenticInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [typeaheadMatch, setTypeaheadMatch] = useState<TriggerMatch | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [slashCommandOptions, setSlashCommandOptions] = useState<TypeaheadOption[]>([]);
  const [allSlashCommands, setAllSlashCommands] = useState<any[]>([]);
  const [dragActive, setDragActive] = useState(false);

  // Track attachments that are being processed (e.g., compressed)
  const [processingAttachments, setProcessingAttachments] = useState<Array<{ id: string; filename: string }>>([]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  // Fetch slash commands on mount and when workspace changes
  useEffect(() => {
    if (!workspacePath) return;

    const fetchSlashCommands = async () => {
      try {
        // Get SDK commands from ClaudeCodeProvider if available
        let sdkCommands: string[] = [];
        try {
          const sdkResult = await window.electronAPI.invoke('ai:getSlashCommands', sessionId);
          if (sdkResult?.success && Array.isArray(sdkResult.commands)) {
            sdkCommands = sdkResult.commands;
            // console.log('[AgenticInput] Got SDK commands from provider:', sdkCommands);
          }
        } catch (sdkError) {
          console.warn('[AgenticInput] Failed to get SDK commands:', sdkError);
        }

        // Fetch all commands (built-in + custom)
        const commands = await window.electronAPI.invoke('slash-command:list', {
          workspacePath,
          sdkCommands
        });

        setAllSlashCommands(commands || []);
        // console.log('[AgenticInput] Loaded slash commands:', commands);
      } catch (error) {
        console.error('[AgenticInput] Failed to load slash commands:', error);
        setAllSlashCommands([]);
      }
    };

    fetchSlashCommands();
  }, [workspacePath, sessionId]); // Refetch when session changes

  // Get icon for command based on name and source
  const getCommandIcon = (cmd: any): string => {
    if (cmd.source === 'builtin') {
      // Built-in command icons
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
    // Custom command icon
    return 'code';
  };

  // Score a command name against a query for relevance ranking
  // Higher score = better match
  const scoreCommand = (name: string, query: string): number => {
    const lowerName = name.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Exact match
    if (lowerName === lowerQuery) return 100;

    // Name starts with query (prefix match)
    if (lowerName.startsWith(lowerQuery)) return 80;

    // Name contains query at word boundary (e.g., "prepare-commit" matches at "-commit")
    const wordBoundaryRegex = new RegExp(`(?:^|[\\s_-])${lowerQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (wordBoundaryRegex.test(lowerName)) return 60;

    // Name contains query anywhere
    if (lowerName.includes(lowerQuery)) return 40;

    // No match
    return 0;
  };

  // Filter and sort slash commands based on query
  const filterSlashCommands = useCallback((query: string) => {
    const filtered = allSlashCommands
      .map(cmd => ({
        cmd,
        score: scoreCommand(cmd.name, query)
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ cmd }) => {
        // Build label with argument hint if available (e.g., "/fix-issue [issue-number]")
        const label = cmd.argumentHint
          ? `/${cmd.name} ${cmd.argumentHint}`
          : `/${cmd.name}`;
        return {
          id: cmd.name,
          label,
          description: cmd.description || `Execute ${cmd.name} command`,
          icon: getCommandIcon(cmd),
          section: cmd.source === 'builtin' ? 'Built-in Commands' :
                   cmd.source === 'project' ? 'Project Commands' : 'User Commands',
          data: cmd
        };
      });

    setSlashCommandOptions(filtered);
  }, [allSlashCommands]);

  // Check for typeahead trigger when value or cursor changes
  useEffect(() => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const pos = textarea.selectionStart;

    // Check for both "@" and "/" triggers
    const match = extractTriggerMatch(value, pos, ['@', '/']);

    if (match) {
      setTypeaheadMatch(match);
      setCursorPosition(pos);

      if (match.trigger === '@' && onFileMentionSearch) {
        // File mention
        onFileMentionSearch(match.query);
        // Auto-select first option
        if (fileMentionOptions.length > 0) {
          setSelectedIndex(0);
        }
      } else if (match.trigger === '/') {
        // Slash command - filter from already-loaded commands
        // (Now uses static fallback so commands are always available)
        filterSlashCommands(match.query);

        // Auto-select first option
        setSelectedIndex(0);
      }
    } else {
      setTypeaheadMatch(null);
      setSelectedIndex(null);
    }
  }, [value, cursorPosition, onFileMentionSearch, filterSlashCommands, allSlashCommands]);

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
      // Format as simple file mention: @<filepath>
      insertText = `@${option.data?.path || option.label}`;
    } else if (typeaheadMatch.trigger === '/') {
      // Format as slash command: /commandname
      // Extract command name (remove "/" if it's in the label)
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

    // Update cursor position
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
        textareaRef.current.focus();
      }
    }, 0);

    // Notify parent for file mentions
    if (typeaheadMatch.trigger === '@' && onFileMentionSelect) {
      onFileMentionSelect(option);
    }

    // Close typeahead
    setTypeaheadMatch(null);
    setSelectedIndex(null);
  }, [typeaheadMatch, value, onChange, onFileMentionSelect]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Determine which options to use based on trigger type
    const currentOptions = typeaheadMatch?.trigger === '@' ? fileMentionOptions : slashCommandOptions;

    // If typeahead is open, handle navigation keys
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

    // Handle Enter to send (Shift+Enter for new line, but not when typeahead is open)
    // Skip if IME composition is in progress (e.g., Japanese kanji conversion)
    if (e.key === 'Enter' && !e.shiftKey && !typeaheadMatch && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim() && !disabled) {
        onSend();
      }
    }
  };

  // Handle file attachment
  const handleFileAttachment = useCallback(async (file: File) => {
    if (!onAttachmentAdd || !sessionId) return;

    // Generate a temporary ID for tracking processing state
    const processingId = `processing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Validate file before uploading
      const validation = await window.electronAPI.invoke('attachment:validate', {
        fileSize: file.size,
        mimeType: file.type
      });

      if (!validation.valid) {
        console.error('[AgenticInput] File validation failed:', validation.error);
        alert(validation.error || 'Invalid file');
        return;
      }

      // Add to processing state before starting compression
      setProcessingAttachments(prev => [...prev, { id: processingId, filename: file.name }]);

      // Read file as array buffer (for IPC transfer)
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Save attachment via IPC
      const result = await window.electronAPI.invoke('attachment:save', {
        fileBuffer: Array.from(uint8Array), // Convert to regular array for IPC
        filename: file.name,
        mimeType: file.type,
        sessionId
      });

      // Remove from processing state
      setProcessingAttachments(prev => prev.filter(p => p.id !== processingId));

      if (result.success && result.attachment) {
        onAttachmentAdd(result.attachment);

        // Insert reference in input text
        const reference = `@${file.name}`;
        onChange(value + (value ? ' ' : '') + reference);
      } else {
        console.error('[AgenticInput] Failed to save attachment:', result.error);
        alert(result.error || 'Failed to save attachment');
      }
    } catch (error) {
      // Remove from processing state on error
      setProcessingAttachments(prev => prev.filter(p => p.id !== processingId));
      console.error('[AgenticInput] Error handling file attachment:', error);
      alert('Failed to attach file');
    }
  }, [onAttachmentAdd, sessionId, value, onChange]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await handleFileAttachment(file);
    }
  }, [handleFileAttachment]);

  // Paste handler for images
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();

        const file = item.getAsFile();
        if (file) {
          // Generate unique filename for pasted images (clipboard gives generic "image.png")
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const ext = file.type.split('/')[1] || 'png';
          const uniqueName = `pasted-image-${timestamp}.${ext}`;
          const renamedFile = new File([file], uniqueName, { type: file.type });
          await handleFileAttachment(renamedFile);
        }
      }
    }
  }, [handleFileAttachment]);

  // Handle attachment removal
  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    if (onAttachmentRemove) {
      onAttachmentRemove(attachmentId);
    }
  }, [onAttachmentRemove]);

  return (
    <div className="ai-chat-input relative flex flex-col gap-2 p-3 border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] shrink-0">
      {/* Attachment preview list */}
      {(attachments.length > 0 || processingAttachments.length > 0) && (
        <AttachmentPreviewList
          attachments={attachments}
          onRemove={handleRemoveAttachment}
          processingAttachments={processingAttachments}
        />
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
          className="ai-chat-input-field flex-1 min-h-9 max-h-[200px] py-2 px-3 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md text-[var(--nim-text)] text-[13px] font-[inherit] resize-none outline-none transition-colors duration-200 focus:border-[var(--nim-primary)] disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-[var(--nim-text-faint)]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
        />
        {isLoading && onCancel ? (
          <button
            className="ai-chat-cancel-button w-9 h-9 flex items-center justify-center bg-[var(--nim-error)] border-none rounded-md text-white cursor-pointer transition-all duration-200 animate-pulse hover:opacity-90 hover:scale-105 hover:animate-none"
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
            className="ai-chat-send-button w-9 h-9 flex items-center justify-center bg-[var(--nim-primary)] border-none rounded-md text-white cursor-pointer transition-all duration-200 shrink-0 hover:enabled:bg-[var(--nim-primary-hover)] hover:enabled:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onSend}
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
        />
      )}
    </div>
  );
}
