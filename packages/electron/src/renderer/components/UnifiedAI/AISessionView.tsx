import React, { useCallback, useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import { AgentTranscriptPanel, TodoItem, FileEditSummary } from '@nimbalyst/runtime';
import type { SessionData, ChatAttachment } from '@nimbalyst/runtime/ai/server/types';
import { AIInput, AIInputRef } from './AIInput';
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

  // Extract todos from session metadata when sessionData changes
  useEffect(() => {
    if (sessionData.metadata?.currentTodos) {
      console.log(`[AISessionView] Extracting todos for session ${sessionId}:`, sessionData.metadata.currentTodos);
      setTodos(sessionData.metadata.currentTodos);
    } else {
      console.log(`[AISessionView] No todos found in session metadata for ${sessionId}`);
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

  // Handle send message
  const handleSend = useCallback(() => {
    if (!draftInput.trim() || isLoading) return;

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
  }, [sessionId, draftInput, draftAttachments, isLoading, onSendMessage, onDraftInputChange, onDraftAttachmentsChange]);

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
