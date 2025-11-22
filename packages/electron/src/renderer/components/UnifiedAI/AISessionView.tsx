import React, { useCallback, useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import { AgentTranscriptPanel, TodoItem, FileEditSummary } from '@nimbalyst/runtime';
import type { SessionData, ChatAttachment } from '@nimbalyst/runtime/ai/server/types';
import { AIInput, AIInputRef } from './AIInput';
import { PromptQueueList } from './PromptQueueList';
import { FileGutter } from '../AIChat/FileGutter';
import type { TypeaheadOption } from '../Typeahead/GenericTypeahead';
import type { AIMode } from './ModeTag';

interface Todo {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
  activeForm: string;
}

export interface AISessionViewRef {
  focusInput: () => void;
}

export interface AISessionViewProps {
  // Identity
  sessionId: string;
  sessionData: SessionData;

  // UI state
  isActive: boolean; // Determines visibility, not mount/unmount
  mode: 'chat' | 'agent'; // chat = sidebar mode, agent = full window mode

  // Context
  workspacePath: string;
  documentContext?: any; // DocumentContext type

  // Input handling
  draftInput?: string;
  draftAttachments?: ChatAttachment[];
  onDraftInputChange?: (sessionId: string, value: string) => void;
  onDraftAttachmentsChange?: (sessionId: string, attachments: ChatAttachment[]) => void;

  // Message handling
  onSendMessage?: (sessionId: string, message: string, attachments: ChatAttachment[]) => void;
  onCancelRequest?: (sessionId: string) => void;

  // File mention support
  fileMentionOptions?: TypeaheadOption[];
  onFileMentionSearch?: (query: string) => void;
  onFileMentionSelect?: (option: TypeaheadOption) => void;

  // Click handlers
  onFileClick?: (filePath: string) => void;
  onTodoClick?: (todo: TodoItem) => void;

  // Loading state (passed from parent)
  isLoading?: boolean;

  // History navigation (up/down arrow in input)
  onNavigateHistory?: (sessionId: string, direction: 'up' | 'down') => void;

  // AI Mode (plan vs agent)
  aiMode?: AIMode;
  onAIModeChange?: (mode: AIMode) => void;

  // Model selection
  currentModel?: string;
  onModelChange?: (modelId: string) => void;
}

/**
 * TranscriptSection - Memoized component that renders the transcript and file gutters.
 * This is separated from the input area to prevent re-renders when typing.
 */
interface TranscriptSectionProps {
  sessionId: string;
  sessionData: SessionData;
  workspacePath: string;
  mode: 'chat' | 'agent';
  todos: Todo[];
  queuedPrompts: any[];
  onFileClick?: (filePath: string) => void;
  onTodoClick?: (todo: TodoItem) => void;
  onCancelQueuedPrompt: (id: string) => void;
}

const TranscriptSectionComponent: React.FC<TranscriptSectionProps> = ({
  sessionId,
  sessionData,
  workspacePath,
  mode,
  todos,
  queuedPrompts,
  onFileClick,
  onTodoClick,
  onCancelQueuedPrompt
}) => {
  return (
    <>
      {/* Referenced files gutter at top - only in chat mode (agent mode has sidebar) */}
      {mode === 'chat' && (
        <FileGutter
          sessionId={sessionId}
          workspacePath={workspacePath}
          type="referenced"
          onFileClick={onFileClick}
        />
      )}

      {/* Main transcript area */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <AgentTranscriptPanel
          sessionId={sessionId}
          sessionData={sessionData}
          todos={todos}
          onFileClick={onFileClick}
          onTodoClick={onTodoClick}
          hideSidebar={mode === 'chat'} // Hide sidebar in chat mode
          initialSettings={{
            showToolCalls: true,
            compactMode: false,
            collapseTools: false,
            showThinking: true,
            showSessionInit: false
          }}
        />
      </div>

      {/* Edited files gutter at bottom - only in chat mode (agent mode has sidebar) */}
      {mode === 'chat' && (
        <FileGutter
          sessionId={sessionId}
          workspacePath={workspacePath}
          type="edited"
          onFileClick={onFileClick}
        />
      )}

      {/* Queue display */}
      <PromptQueueList
        queue={queuedPrompts}
        onCancel={onCancelQueuedPrompt}
      />
    </>
  );
};

// Memoize TranscriptSection to prevent re-renders when input changes
const TranscriptSection = React.memo(TranscriptSectionComponent, (prevProps, nextProps) => {
  // Only re-render if session data, todos, or queue actually changed
  return (
    prevProps.sessionId === nextProps.sessionId &&
    prevProps.sessionData === nextProps.sessionData &&
    prevProps.workspacePath === nextProps.workspacePath &&
    prevProps.mode === nextProps.mode &&
    prevProps.todos === nextProps.todos &&
    prevProps.queuedPrompts === nextProps.queuedPrompts
  );
});

/**
 * AISessionView component encapsulates all UI for a single AI session.
 *
 * Key features:
 * - Renders all UI for one session (FileGutter + Transcript + Input)
 * - Manages session-specific state (draft input, attachments)
 * - Continues to receive/process stream updates even when hidden (!isActive)
 * - Hides features in chat mode (no right panel, simpler UI)
 * - All session-specific state lives here (isolated from other sessions)
 *
 * The component uses `display: none` when not active instead of unmounting,
 * which allows background streaming to continue and provides instant tab switching.
 */
const AISessionViewComponent = forwardRef<AISessionViewRef, AISessionViewProps>(({
  sessionId,
  sessionData,
  isActive,
  mode,
  workspacePath,
  documentContext,
  draftInput = '',
  draftAttachments = [],
  onDraftInputChange,
  onDraftAttachmentsChange,
  onSendMessage,
  onCancelRequest,
  fileMentionOptions = [],
  onFileMentionSearch,
  onFileMentionSelect,
  onFileClick,
  onTodoClick,
  isLoading = false,
  onNavigateHistory,
  aiMode = 'agent',
  onAIModeChange,
  currentModel,
  onModelChange
}, ref) => {
  const inputRef = useRef<AIInputRef>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [queuedPrompts, setQueuedPrompts] = useState<any[]>([]);

  // Extract queue from session metadata when sessionData changes
  useEffect(() => {
    if (sessionData.metadata?.queuedPrompts) {
      setQueuedPrompts(sessionData.metadata.queuedPrompts as any[]);
    } else {
      setQueuedPrompts([]);
    }
  }, [sessionData.metadata?.queuedPrompts]);

  // Listen for queue updates from backend
  useEffect(() => {
    const handleQueueUpdate = (_event: any, data: { sessionId: string; queueLength: number }) => {
      if (data.sessionId === sessionId) {
        // Queue was updated by backend, reload session data will happen automatically
        // This just ensures UI is responsive
      }
    };

    window.electronAPI.on('ai:queue-updated', handleQueueUpdate);
    return () => {
      window.electronAPI.off('ai:queue-updated', handleQueueUpdate);
    };
  }, [sessionId]);

  // Extract todos from session metadata when sessionData changes
  useEffect(() => {
    if (sessionData.metadata?.currentTodos) {
      // console.log(`[AISessionView] Extracting todos for session ${sessionId}:`, sessionData.metadata.currentTodos);
      setTodos(sessionData.metadata.currentTodos);
    } else {
      // console.log(`[AISessionView] No todos found in session metadata for ${sessionId}`);
      setTodos([]);
    }
  }, [sessionId, sessionData.metadata?.currentTodos]);

  // Expose focusInput method through ref
  useImperativeHandle(ref, () => ({
    focusInput: () => {
      inputRef.current?.focus();
    }
  }));
  // Handle input change
  const handleInputChange = useCallback((value: string) => {
    if (onDraftInputChange) {
      onDraftInputChange(sessionId, value);
    }
  }, [sessionId, onDraftInputChange]);

  // Handle attachment add
  const handleAttachmentAdd = useCallback((attachment: ChatAttachment) => {
    if (onDraftAttachmentsChange) {
      const newAttachments = [...draftAttachments, attachment];
      onDraftAttachmentsChange(sessionId, newAttachments);
    }
  }, [sessionId, draftAttachments, onDraftAttachmentsChange]);

  // Handle attachment remove
  const handleAttachmentRemove = useCallback((attachmentId: string) => {
    if (onDraftAttachmentsChange) {
      const newAttachments = draftAttachments.filter(a => a.id !== attachmentId);
      onDraftAttachmentsChange(sessionId, newAttachments);
    }
  }, [sessionId, draftAttachments, onDraftAttachmentsChange]);

  // Handle queue message (must be before handleSend which uses it)
  const handleQueue = useCallback(async (message: string) => {
    if (!message.trim()) {
      return;
    }

    try {
      // Generate unique ID for queued prompt
      // Only store serializable parts of documentContext
      const serializableContext = documentContext ? {
        filePath: documentContext.filePath,
        content: documentContext.content,
        fileType: documentContext.fileType
      } : undefined;

      const queuedPrompt = {
        id: `queued-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        prompt: message.trim(),
        timestamp: Date.now(),
        documentContext: serializableContext,
        attachments: draftAttachments
      };

      // Add to queue array
      const updatedQueue = [...queuedPrompts, queuedPrompt];

      // Update session metadata via IPC
      await window.electronAPI.invoke('ai:updateSessionMetadata', sessionId, {
        ...sessionData.metadata,
        queuedPrompts: updatedQueue
      }, workspacePath);

      // Update local state immediately
      setQueuedPrompts(updatedQueue);

      // Clear draft
      if (onDraftInputChange) {
        onDraftInputChange(sessionId, '');
      }
      if (onDraftAttachmentsChange) {
        onDraftAttachmentsChange(sessionId, []);
      }
    } catch (error) {
      console.error('[AISessionView] Failed to queue prompt:', error);
    }
  }, [sessionId, documentContext, draftAttachments, queuedPrompts, sessionData.metadata, workspacePath, onDraftInputChange, onDraftAttachmentsChange]);

  // Handle send message
  const handleSend = useCallback(() => {
    if (!draftInput.trim()) return;

    // If already loading, queue the prompt instead
    if (isLoading) {
      handleQueue(draftInput.trim());
      return;
    }

    if (onSendMessage) {
      onSendMessage(sessionId, draftInput.trim(), draftAttachments);
    }

    // Notify parent to clear draft
    if (onDraftInputChange) {
      onDraftInputChange(sessionId, '');
    }
    if (onDraftAttachmentsChange) {
      onDraftAttachmentsChange(sessionId, []);
    }
  }, [sessionId, draftInput, draftAttachments, isLoading, onSendMessage, onDraftInputChange, onDraftAttachmentsChange, handleQueue]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (onCancelRequest) {
      onCancelRequest(sessionId);
    }
  }, [sessionId, onCancelRequest]);

  // Handle file click
  const handleFileClick = useCallback((filePath: string) => {
    if (onFileClick) {
      onFileClick(filePath);
    }
  }, [onFileClick]);

  // Handle todo click
  const handleTodoClick = useCallback((todo: TodoItem) => {
    if (onTodoClick) {
      onTodoClick(todo);
    }
  }, [onTodoClick]);

  // Handle history navigation
  const handleNavigateHistory = useCallback((direction: 'up' | 'down') => {
    if (onNavigateHistory) {
      onNavigateHistory(sessionId, direction);
    }
  }, [sessionId, onNavigateHistory]);

  // Handle cancel queued prompt
  const handleCancelQueuedPrompt = useCallback(async (id: string) => {
    try {
      const updatedQueue = queuedPrompts.filter(p => p.id !== id);

      await window.electronAPI.invoke('ai:updateSessionMetadata', sessionId, {
        ...sessionData.metadata,
        queuedPrompts: updatedQueue
      }, workspacePath);

      setQueuedPrompts(updatedQueue);
    } catch (error) {
      console.error('[AISessionView] Failed to cancel queued prompt:', error);
    }
  }, [sessionId, queuedPrompts, sessionData.metadata, workspacePath]);

  // Feature flags based on mode and provider
  const enableSlashCommands = sessionData.provider === 'claude-code'; // Only for Claude Code
  const enableAttachments = true; // Available in both chat and agent modes
  const enableHistoryNavigation = true; // Available in both chat and agent modes

  return (
    <div
      style={{
        height: '100%',
        display: isActive ? 'flex' : 'none', // Use display:none to keep mounted but hidden
        flexDirection: 'column',
        overflow: 'hidden'
      }}
      data-session-id={sessionId}
      data-active={isActive}
    >
      {/* Transcript and gutters - memoized to prevent re-render on input changes */}
      <TranscriptSection
        sessionId={sessionId}
        sessionData={sessionData}
        workspacePath={workspacePath}
        mode={mode}
        todos={todos}
        queuedPrompts={queuedPrompts}
        onFileClick={handleFileClick}
        onTodoClick={handleTodoClick}
        onCancelQueuedPrompt={handleCancelQueuedPrompt}
      />

      {/* Input area - separate so typing doesn't re-render transcript */}
      <AIInput
        ref={inputRef}
        value={draftInput}
        onChange={handleInputChange}
        onSend={handleSend}
        onCancel={handleCancel}
        isLoading={isLoading}
        workspacePath={workspacePath}
        sessionId={sessionId}
        fileMentionOptions={fileMentionOptions}
        onFileMentionSearch={onFileMentionSearch}
        onFileMentionSelect={onFileMentionSelect}
        attachments={enableAttachments ? draftAttachments : undefined}
        onAttachmentAdd={enableAttachments ? handleAttachmentAdd : undefined}
        onAttachmentRemove={enableAttachments ? handleAttachmentRemove : undefined}
        enableSlashCommands={enableSlashCommands}
        onNavigateHistory={enableHistoryNavigation ? handleNavigateHistory : undefined}
        placeholder={
          mode === 'chat'
            ? "Ask a question. @ for files. / for commands"
            : enableSlashCommands
              ? "Type your message... (Enter to send, Shift+Enter for new line, @ for files, / for commands)"
              : "Type your message... (Enter to send, Shift+Enter for new line, @ for files)"
        }
        mode={aiMode}
        onModeChange={onAIModeChange}
        currentModel={currentModel}
        onModelChange={onModelChange}
        tokenUsage={sessionData.tokenUsage}
        provider={sessionData.provider}
        onQueue={handleQueue}
        queueCount={queuedPrompts.length}
      />
    </div>
  );
});

AISessionViewComponent.displayName = 'AISessionView';

// Memoize to prevent re-renders when props haven't changed
// This is critical for performance when multiple session tabs are open
export const AISessionView = React.memo(AISessionViewComponent, (prevProps, nextProps) => {
  // Only compare data props, not callback props
  // Callback props (onDraftInputChange, onSendMessage, etc.) may have new references
  // but don't affect what's displayed, so we ignore them for performance

  // Basic props comparison
  if (
    prevProps.sessionId !== nextProps.sessionId ||
    prevProps.isActive !== nextProps.isActive ||
    prevProps.draftInput !== nextProps.draftInput ||
    prevProps.isLoading !== nextProps.isLoading ||
    prevProps.aiMode !== nextProps.aiMode ||
    prevProps.currentModel !== nextProps.currentModel ||
    prevProps.workspacePath !== nextProps.workspacePath ||
    prevProps.mode !== nextProps.mode ||
    prevProps.draftAttachments?.length !== nextProps.draftAttachments?.length ||
    prevProps.fileMentionOptions?.length !== nextProps.fileMentionOptions?.length
  ) {
    return false; // Props changed, should re-render
  }

  // Deep comparison of sessionData - only re-render if actual content changed
  const prevData = prevProps.sessionData;
  const nextData = nextProps.sessionData;

  if (prevData === nextData) {
    return true; // Same reference, no re-render needed
  }

  // Compare key properties of sessionData
  if (
    prevData.id !== nextData.id ||
    prevData.provider !== nextData.provider ||
    prevData.model !== nextData.model ||
    prevData.messages.length !== nextData.messages.length ||
    prevData.metadata?.currentTodos !== nextData.metadata?.currentTodos ||
    prevData.metadata?.queuedPrompts !== nextData.metadata?.queuedPrompts
  ) {
    return false; // Content changed, should re-render
  }

  // Compare tokenUsage (for ContextUsageDisplay updates)
  const prevTokenUsage = prevData.tokenUsage;
  const nextTokenUsage = nextData.tokenUsage;
  if (prevTokenUsage !== nextTokenUsage) {
    // Check if the values actually changed (not just reference)
    if (!prevTokenUsage || !nextTokenUsage ||
        prevTokenUsage.inputTokens !== nextTokenUsage.inputTokens ||
        prevTokenUsage.outputTokens !== nextTokenUsage.outputTokens ||
        prevTokenUsage.totalTokens !== nextTokenUsage.totalTokens ||
        prevTokenUsage.contextWindow !== nextTokenUsage.contextWindow) {
      return false; // Token usage changed, should re-render
    }

    const prevCategories = prevTokenUsage.categories ?? [];
    const nextCategories = nextTokenUsage.categories ?? [];
    if (prevCategories.length !== nextCategories.length) {
      return false;
    }
    for (let i = 0; i < prevCategories.length; i++) {
      const prevCat = prevCategories[i];
      const nextCat = nextCategories[i];
      if (
        prevCat.name !== nextCat.name ||
        prevCat.tokens !== nextCat.tokens ||
        prevCat.percentage !== nextCat.percentage
      ) {
        return false;
      }
    }
  }

  // Check if messages content actually changed (compare last message)
  if (prevData.messages.length > 0) {
    const prevLastMsg = prevData.messages[prevData.messages.length - 1];
    const nextLastMsg = nextData.messages[nextData.messages.length - 1];

    if (
      prevLastMsg.content !== nextLastMsg.content ||
      prevLastMsg.role !== nextLastMsg.role ||
      prevLastMsg.timestamp !== nextLastMsg.timestamp
    ) {
      return false; // Last message changed, should re-render
    }
  }

  // Compare documentContext if present
  if (prevProps.documentContext !== nextProps.documentContext) {
    if (!prevProps.documentContext || !nextProps.documentContext) {
      return false; // One is null/undefined, the other isn't
    }
    if (prevProps.documentContext.filePath !== nextProps.documentContext.filePath) {
      return false; // Different file
    }
  }

  return true; // No meaningful changes, skip re-render
});
