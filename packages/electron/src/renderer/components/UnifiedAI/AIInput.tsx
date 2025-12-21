import React, { useRef, useEffect, KeyboardEvent, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { GenericTypeahead, TypeaheadOption } from '../Typeahead/GenericTypeahead';
import { extractTriggerMatch, insertAtTrigger, TriggerMatch } from '../Typeahead/typeaheadUtils';
import type { ChatAttachment } from '@nimbalyst/runtime';
import { AttachmentPreviewList } from '../AgenticCoding/AttachmentPreviewList';
import { ModeTag, AIMode } from './ModeTag';
import { ModelSelector } from './ModelSelector';
import { ContextUsageDisplay } from './ContextUsageDisplay';
import { MockupAnnotationIndicator } from './MockupAnnotationIndicator';
import { TextSelectionIndicator } from './TextSelectionIndicator';
import {
  MemoryPromptIndicator,
  MemorySaveButton,
  useMemoryMode,
  shouldActivateMemoryMode,
  getMemoryContent,
} from './interactivePrompts';
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
  sessionHasMessages?: boolean;  // Whether current session has any messages
  currentProviderType?: 'agent' | 'model' | null;  // Type of current session's provider

  // Token usage display support (for Claude Code)
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    contextWindow?: number;
  };
  provider?: string; // Provider ID to determine if we should show token usage

  // Queue support
  onQueue?: (message: string) => void;
  queueCount?: number;

  // Mockup annotation indicator support
  currentFilePath?: string;
  lastUserMessageTimestamp?: number | null;
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
// Constants for prompt box resize
const MIN_PROMPT_HEIGHT = 36;
const MAX_PROMPT_HEIGHT = 600;
const DEFAULT_MAX_PROMPT_HEIGHT = 200;

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
    onModelChange,
    sessionHasMessages,
    currentProviderType,
    tokenUsage,
    provider,
    onQueue,
    queueCount = 0,
    currentFilePath,
    lastUserMessageTimestamp
  }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [typeaheadMatch, setTypeaheadMatch] = useState<TriggerMatch | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [selectedOption, setSelectedOption] = useState<TypeaheadOption | null>(null);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [slashCommandOptions, setSlashCommandOptions] = useState<TypeaheadOption[]>([]);
    const [allSlashCommands, setAllSlashCommands] = useState<any[]>([]);
    const [dragActive, setDragActive] = useState(false);

    // Prompt box resize state
    // userSetHeight: null means auto-size to content, number means user manually resized
    const [userSetHeight, setUserSetHeight] = useState<number | null>(null);
    const [isLoadingHeight, setIsLoadingHeight] = useState(true);
    const [isResizing, setIsResizing] = useState(false);
    const isResizingRef = useRef(false);
    const resizeStartY = useRef<number>(0);
    const resizeStartHeight = useRef<number>(DEFAULT_MAX_PROMPT_HEIGHT);

    // Memory mode hook
    const {
      isMemoryMode,
      memoryTarget,
      isSaving,
      enterMemoryMode,
      exitMemoryMode,
      toggleMemoryTarget,
      setMemoryTarget,
      saveToMemory,
    } = useMemoryMode(workspacePath);

    // Load prompt box height from workspace state on mount
    useEffect(() => {
      if (!workspacePath) {
        setIsLoadingHeight(false);
        return;
      }

      const loadHeight = async () => {
        try {
          const workspaceState = await window.electronAPI.invoke('workspace:get-state', workspacePath);
          const savedHeight = workspaceState?.aiPanel?.promptBoxHeight;
          if (savedHeight !== undefined) {
            setUserSetHeight(savedHeight);
          }
        } catch (err) {
          console.error('[AIInput] Failed to load prompt box height:', err);
        } finally {
          setIsLoadingHeight(false);
        }
      };
      loadHeight();
    }, [workspacePath]);

    // Save prompt box height to workspace state when it changes
    useEffect(() => {
      if (!workspacePath || isLoadingHeight) return;

      const saveHeight = async () => {
        try {
          await window.electronAPI.invoke('workspace:update-state', workspacePath, {
            aiPanel: {
              promptBoxHeight: userSetHeight,
            }
          });
        } catch (err) {
          console.error('[AIInput] Failed to save prompt box height:', err);
        }
      };
      saveHeight();
    }, [userSetHeight, workspacePath, isLoadingHeight]);

    // Prompt box resize handlers
    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isResizingRef.current = true;
      setIsResizing(true);
      resizeStartY.current = e.clientY;
      // Start from current textarea height or default
      const currentHeight = textareaRef.current?.offsetHeight || DEFAULT_MAX_PROMPT_HEIGHT;
      resizeStartHeight.current = currentHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }, []);

    useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizingRef.current) return;

        // Dragging up increases height (negative deltaY = larger height)
        const deltaY = resizeStartY.current - e.clientY;
        const newHeight = Math.max(
          MIN_PROMPT_HEIGHT,
          Math.min(MAX_PROMPT_HEIGHT, resizeStartHeight.current + deltaY)
        );
        setUserSetHeight(newHeight);
      };

      const handleMouseUp = () => {
        if (!isResizingRef.current) return;

        isResizingRef.current = false;
        setIsResizing(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        // Cleanup: reset cursor and user-select if component unmounts during drag
        if (isResizingRef.current) {
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        }
      };
    }, []);

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
    // If user has manually resized (userSetHeight is set), use that height
    // Otherwise, auto-size based on content up to DEFAULT_MAX_PROMPT_HEIGHT
    useEffect(() => {
      if (!textareaRef.current) return;

      const textarea = textareaRef.current;
      const rafId = requestAnimationFrame(() => {
        if (userSetHeight !== null) {
          // User has manually set the height - use it directly
          textarea.style.height = `${userSetHeight}px`;
        } else {
          // Auto-size based on content
          textarea.style.height = 'auto';
          textarea.style.height = `${Math.min(textarea.scrollHeight, DEFAULT_MAX_PROMPT_HEIGHT)}px`;
        }
      });

      return () => cancelAnimationFrame(rafId);
    }, [value, userSetHeight]);

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
      if (cmd.source === 'plugin') {
        return 'extension';
      }
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
      const hasQuery = query.length > 0;
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
            // Only show sections when there's no filter query (full list)
            // When filtering, we want pure relevance-based ordering without section grouping
            section: hasQuery ? undefined :
                     cmd.source === 'builtin' ? 'Built-in Commands' :
                     cmd.source === 'project' ? 'Project Commands' :
                     cmd.source === 'plugin' ? 'Extension Commands' : 'User Commands',
            data: cmd
          };
        });

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
        setSelectedOption(null);
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

    // Detect memory mode trigger (# as first character, Claude Code provider only)
    useEffect(() => {
      if (shouldActivateMemoryMode(value, provider)) {
        if (!isMemoryMode) {
          enterMemoryMode();
        }
      } else {
        if (isMemoryMode) {
          exitMemoryMode();
        }
      }
    }, [value, provider, isMemoryMode, enterMemoryMode, exitMemoryMode]);

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
      setSelectedOption(null);
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
          // Use selectedOption which is kept in sync with visual order by GenericTypeahead
          if (selectedOption) {
            handleTypeaheadSelect(selectedOption);
          }
          return;
        }

        if (e.key === 'Escape') {
          e.preventDefault();
          setTypeaheadMatch(null);
          setSelectedIndex(null);
          setSelectedOption(null);
          return;
        }
      }

      // Handle memory mode keyboard shortcuts
      if (isMemoryMode && !typeaheadMatch) {
        // Arrow keys toggle between user/project memory target
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          toggleMemoryTarget();
          return;
        }

        // Enter saves to memory
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const content = getMemoryContent(value);
          if (content.trim()) {
            saveToMemory(content).then((success) => {
              if (success) {
                onChange(''); // Clear input on success
              }
            });
          }
          return;
        }

        // Escape exits memory mode
        if (e.key === 'Escape') {
          e.preventDefault();
          onChange(''); // Clear input to exit memory mode
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

      // Queue on Cmd+Shift+Enter (if loading and queue handler exists)
      if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey) && !typeaheadMatch) {
        e.preventDefault();
        if (value.trim() && !disabled && isLoading && onQueue) {
          handleQueue();
        }
        return;
      }

      // Handle Enter to send (Shift+Enter for new line, but not when typeaheadis open)
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
          const reference = `@${file.name} `;
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

    // Threshold for converting large text pastes to attachments (25 lines or 1000 characters)
    const LARGE_PASTE_LINE_THRESHOLD = 25;
    const LARGE_PASTE_CHAR_THRESHOLD = 1000;

    // Paste handler for images and text
    const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData.items);

      // Handle image attachments
      if (onAttachmentAdd) {
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
            return; // Exit early after handling image
          }
        }
      }

      // Get pasted text for further processing
      const pastedText = e.clipboardData.getData('text');
      if (!pastedText) return;

      // Handle large text pastes as attachments (keeps transcript clean)
      if (onAttachmentAdd && sessionId) {
        const lineCount = pastedText.split('\n').length;
        const isLargePaste = lineCount >= LARGE_PASTE_LINE_THRESHOLD ||
                            pastedText.length >= LARGE_PASTE_CHAR_THRESHOLD;

        if (isLargePaste) {
          e.preventDefault();
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const textFile = new File([pastedText], `pasted-text-${timestamp}.txt`, { type: 'text/plain' });
          await handleFileAttachment(textFile);
          return;
        }
      }

      // For Claude Code provider: prevent pasted text starting with '#' from triggering memory mode
      // by prepending a newline when pasting into an empty input
      if (provider === 'claude-code' && value.trim() === '') {
        if (pastedText.trimStart().startsWith('#')) {
          e.preventDefault();
          // Prepend a newline to prevent '#' from being the first character
          onChange('\n' + pastedText);
        }
      }
    }, [onAttachmentAdd, handleFileAttachment, provider, value, onChange, sessionId]);

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

    const handleQueue = () => {
      if (value.trim() && !disabled && onQueue) {
        onQueue(value);
      }
    };

    // Handle memory save button click
    const handleMemorySave = useCallback(() => {
      const content = getMemoryContent(value);
      if (content.trim()) {
        saveToMemory(content).then((success) => {
          if (success) {
            onChange(''); // Clear input on success
          }
        });
      }
    }, [value, saveToMemory, onChange]);

    return (
      <div className={`ai-chat-input ${isMemoryMode ? 'memory-mode' : ''}`} style={{ position: 'relative' }}>
        {/* Vertical resize handle at top of input area */}
        <div
          className={`ai-chat-input-resize-handle ${isResizing ? 'resizing' : ''}`}
          onMouseDown={handleResizeMouseDown}
          title="Drag to resize prompt box"
        />

        {/* Memory mode indicator */}
        {isMemoryMode && (
          <MemoryPromptIndicator
            target={memoryTarget}
            onTargetChange={setMemoryTarget}
            isSaving={isSaving}
          />
        )}

        {/* Attachment preview list */}
        {attachments && attachments.length > 0 && (
          <AttachmentPreviewList
            attachments={attachments}
            onRemove={handleRemoveAttachment}
          />
        )}

        {/* Mockup annotation indicator - shown when there are new annotations */}
        <MockupAnnotationIndicator
          currentFilePath={currentFilePath}
          lastUserMessageTimestamp={lastUserMessageTimestamp ?? null}
        />

        {/* Text selection indicator - shown when text is selected in the editor */}
        <TextSelectionIndicator
          currentFilePath={currentFilePath}
          lastUserMessageTimestamp={lastUserMessageTimestamp ?? null}
        />

        {/* Inline controls row - hidden in memory mode */}
        {!isMemoryMode && (onModeChange || onModelChange || (tokenUsage && provider === 'claude-code')) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 0',
            marginBottom: '4px'
          }}>
            {onModeChange && provider === 'claude-code' && <ModeTag mode={mode} onModeChange={onModeChange} />}

            {onModelChange && currentModel && (
              <ModelSelector
                currentModel={currentModel}
                onModelChange={onModelChange}
                sessionHasMessages={sessionHasMessages}
                currentProviderType={currentProviderType}
              />
            )}
            {/* Show token usage for all providers - displays "--" if no data yet */}
            <ContextUsageDisplay
              inputTokens={tokenUsage?.inputTokens || 0}
              outputTokens={tokenUsage?.outputTokens || 0}
              totalTokens={tokenUsage?.totalTokens || 0}
              contextWindow={tokenUsage?.contextWindow || 0}
              categories={tokenUsage?.categories}
            />
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
              minHeight: `${MIN_PROMPT_HEIGHT}px`,
              maxHeight: `${userSetHeight ?? DEFAULT_MAX_PROMPT_HEIGHT}px`,
              resize: 'none'
            }}
          />
          {isMemoryMode ? (
            // Memory mode: show save button
            <MemorySaveButton
              onSave={handleMemorySave}
              disabled={disabled || !getMemoryContent(value).trim()}
              isSaving={isSaving}
            />
          ) : isLoading ? (
            onCancel && (
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
            )
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
            onSelectedOptionChange={setSelectedOption}
            onSelect={handleTypeaheadSelect}
            onClose={() => {
              setTypeaheadMatch(null);
              setSelectedIndex(null);
              setSelectedOption(null);
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
