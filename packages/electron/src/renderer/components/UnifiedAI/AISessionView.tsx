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
  aiMode = 'plan',
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
    console.log('[AISessionView] handleQueue called with message:', message.substring(0, 50));
    if (!message.trim()) {
      console.log('[AISessionView] Message was empty, returning');
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

      console.log('[AISessionView] About to update metadata. Current queue:', queuedPrompts.length, 'New queue:', updatedQueue.length);

      // Update session metadata via IPC
      const result = await window.electronAPI.invoke('ai:updateSessionMetadata', sessionId, {
        ...sessionData.metadata,
        queuedPrompts: updatedQueue
      }, workspacePath);

      console.log('[AISessionView] Metadata update result:', result);

      // Update local state immediately
      setQueuedPrompts(updatedQueue);

      // Clear draft
      if (onDraftInputChange) {
        onDraftInputChange(sessionId, '');
      }
      if (onDraftAttachmentsChange) {
        onDraftAttachmentsChange(sessionId, []);
      }

      console.log(`[AISessionView] Queued prompt for session ${sessionId}. Queue length: ${updatedQueue.length}`);
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
      console.log(`[AISessionView] Cancelled queued prompt ${id}`);
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
      {/* Referenced files gutter at top */}
      <FileGutter
        sessionId={sessionId}
        workspacePath={workspacePath}
        type="referenced"
        onFileClick={handleFileClick}
      />

      {/* Main transcript area */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <AgentTranscriptPanel
          sessionId={sessionId}
          sessionData={sessionData}
          todos={todos}
          onFileClick={handleFileClick}
          onTodoClick={handleTodoClick}
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

      {/* Edited files gutter at bottom */}
      <FileGutter
        sessionId={sessionId}
        workspacePath={workspacePath}
        type="edited"
        onFileClick={handleFileClick}
      />

      {/* Queue display */}
      <PromptQueueList
        queue={queuedPrompts}
        onCancel={handleCancelQueuedPrompt}
      />

      {/* Input area */}
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
            ? "Ask a question... (type @ to mention files)"
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
  // Re-render if any of these props change
  return (
    prevProps.sessionId === nextProps.sessionId &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.draftInput === nextProps.draftInput &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.sessionData === nextProps.sessionData &&
    prevProps.aiMode === nextProps.aiMode &&
    prevProps.currentModel === nextProps.currentModel
  );
});
