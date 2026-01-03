import React, { useCallback, useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import { AgentTranscriptPanel, TodoItem, FileEditSummary, storeAskUserQuestionAnswers } from '@nimbalyst/runtime';
import type { SessionData, ChatAttachment } from '@nimbalyst/runtime/ai/server/types';
import { AIInput, AIInputRef } from './AIInput';
import { PromptQueueList } from './PromptQueueList';
import { FileGutter } from '../AIChat/FileGutter';
import { PendingReviewBanner } from '../AIChat/PendingReviewBanner';
import type { TypeaheadOption } from '../Typeahead/GenericTypeahead';
import type { AIMode } from './ModeTag';
import { ExitPlanModeConfirmation, ExitPlanModeConfirmationData } from './ExitPlanModeConfirmation';
import { AskUserQuestionConfirmation, AskUserQuestionData } from './AskUserQuestionConfirmation';
import { ToolPermissionConfirmation, ToolPermissionData } from './ToolPermissionConfirmation';
import { SlashCommandSuggestions } from './SlashCommandSuggestions';

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
  sessionHasMessages?: boolean;  // Whether current session has any messages
  currentProviderType?: 'agent' | 'model' | null;  // Type of current session's provider

  // Archive state and actions
  isArchived?: boolean;
  onCloseAndArchive?: (sessionId: string) => void;
  onUnarchive?: (sessionId: string) => void;
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
  isProcessing?: boolean;
  onFileClick?: (filePath: string) => void;
  onTodoClick?: (todo: TodoItem) => void;
  onCancelQueuedPrompt: (id: string) => void;
  onEditQueuedPrompt?: (id: string, prompt: string) => void;
  isArchived?: boolean;
  onCloseAndArchive?: () => void;
  onUnarchive?: () => void;
  provider: string;
  onCommandSelect: (command: string) => void;
}

// Helper to read files from the main process (for persisted output files)
const readFile = async (filePath: string): Promise<{ success: boolean; content?: string; error?: string }> => {
  try {
    const result = await window.electronAPI.readFileContent(filePath);
    if (!result) {
      return { success: false, error: 'No response from file reader' };
    }
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to read file' };
    }
    return { success: true, content: result.content };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to read file'
    };
  }
};

const TranscriptSectionComponent: React.FC<TranscriptSectionProps> = ({
  sessionId,
  sessionData,
  workspacePath,
  mode,
  todos,
  queuedPrompts,
  isProcessing,
  onFileClick,
  onTodoClick,
  onCancelQueuedPrompt,
  onEditQueuedPrompt,
  isArchived,
  onCloseAndArchive,
  onUnarchive,
  provider,
  onCommandSelect
}) => {
  // Track files with pending AI edits for this session
  const [pendingReviewFiles, setPendingReviewFiles] = useState<Set<string>>(new Set());

  // Fetch pending review files for this session
  useEffect(() => {
    if (!workspacePath || !sessionId) {
      setPendingReviewFiles(new Set());
      return;
    }

    const fetchPendingFiles = async () => {
      try {
        if (window.electronAPI?.history?.getPendingFilesForSession) {
          const files = await window.electronAPI.history.getPendingFilesForSession(workspacePath, sessionId);
          setPendingReviewFiles(new Set(files));
        }
      } catch (error) {
        console.error('[AISessionView] Failed to fetch pending review files:', error);
      }
    };

    fetchPendingFiles();

    // Listen for pending cleared events to refresh the list
    const unsubscribe = window.electronAPI?.history?.onPendingCleared?.(
      (data: { workspacePath: string; sessionId?: string; clearedFiles: string[] }) => {
        if (data.workspacePath === workspacePath) {
          // Re-fetch to get the updated list
          fetchPendingFiles();
        }
      }
    );

    // Also listen for pending count changes (which means new files might be pending)
    const unsubscribeCount = window.electronAPI?.history?.onPendingCountChanged?.(
      (data: { workspacePath: string; count: number }) => {
        if (data.workspacePath === workspacePath) {
          fetchPendingFiles();
        }
      }
    );

    return () => {
      unsubscribe?.();
      unsubscribeCount?.();
    };
  }, [workspacePath, sessionId]);

  // Create the renderEmptyExtra callback for slash command suggestions
  const renderEmptyExtra = React.useCallback(() => {
    // Only show for claude-code provider with empty session
    if (provider !== 'claude-code' || sessionData.messages.length > 0) {
      return null;
    }
    return (
      <SlashCommandSuggestions
        provider={provider}
        hasMessages={sessionData.messages.length > 0}
        workspacePath={workspacePath}
        sessionId={sessionId}
        onCommandSelect={onCommandSelect}
      />
    );
  }, [provider, sessionData.messages.length, workspacePath, sessionId, onCommandSelect]);

  return (
    <>
      {/* Referenced files gutter at top - only in chat mode (agent mode has sidebar) */}
      {mode === 'chat' && (
        <FileGutter
          sessionId={sessionId}
          workspacePath={workspacePath}
          type="referenced"
          onFileClick={onFileClick}
          pendingReviewFiles={pendingReviewFiles}
        />
      )}

      {/* Main transcript area */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <AgentTranscriptPanel
          sessionId={sessionId}
          sessionData={sessionData}
          todos={todos}
          isProcessing={isProcessing}
          onFileClick={onFileClick}
          onTodoClick={onTodoClick}
          hideSidebar={mode === 'chat'} // Hide sidebar in chat mode
          workspacePath={workspacePath}
          initialSettings={{
            showToolCalls: true,
            compactMode: false,
            collapseTools: false,
            showThinking: true,
            showSessionInit: false
          }}
          renderEmptyExtra={renderEmptyExtra}
          isArchived={isArchived}
          onCloseAndArchive={onCloseAndArchive}
          onUnarchive={onUnarchive}
          readFile={readFile}
          renderFilesHeader={mode === 'agent' ? () => (
            <PendingReviewBanner workspacePath={workspacePath} sessionId={sessionId} />
          ) : undefined}
          pendingReviewFiles={pendingReviewFiles}
        />
      </div>

      {/* Pending review banner - shows pending files for current session */}
      {mode === 'chat' && (
        <PendingReviewBanner workspacePath={workspacePath} sessionId={sessionId} />
      )}

      {/* Edited files gutter at bottom - only in chat mode (agent mode has sidebar) */}
      {mode === 'chat' && (
        <FileGutter
          sessionId={sessionId}
          workspacePath={workspacePath}
          type="edited"
          onFileClick={onFileClick}
          pendingReviewFiles={pendingReviewFiles}
        />
      )}

      {/* Queue display */}
      <PromptQueueList
        queue={queuedPrompts}
        onCancel={onCancelQueuedPrompt}
        onEdit={onEditQueuedPrompt}
      />
    </>
  );
};

// Memoize TranscriptSection to prevent re-renders when input changes
const TranscriptSection = React.memo(TranscriptSectionComponent, (prevProps, nextProps) => {
  // Only re-render if session data, todos, queue, processing state, or archive state changed
  return (
    prevProps.sessionId === nextProps.sessionId &&
    prevProps.sessionData === nextProps.sessionData &&
    prevProps.workspacePath === nextProps.workspacePath &&
    prevProps.mode === nextProps.mode &&
    prevProps.todos === nextProps.todos &&
    prevProps.queuedPrompts === nextProps.queuedPrompts &&
    prevProps.isProcessing === nextProps.isProcessing &&
    prevProps.isArchived === nextProps.isArchived &&
    prevProps.provider === nextProps.provider
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
  onModelChange,
  sessionHasMessages,
  currentProviderType,
  isArchived,
  onCloseAndArchive,
  onUnarchive
}, ref) => {
  const inputRef = useRef<AIInputRef>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [queuedPrompts, setQueuedPrompts] = useState<any[]>([]);
  const [pendingExitPlanConfirmation, setPendingExitPlanConfirmation] = useState<ExitPlanModeConfirmationData | null>(null);
  const [pendingAskUserQuestion, setPendingAskUserQuestion] = useState<AskUserQuestionData | null>(null);
  const [pendingToolPermissions, setPendingToolPermissions] = useState<ToolPermissionData[]>([]);

  // Listen for ExitPlanMode confirmation requests for this session
  useEffect(() => {
    const handleExitPlanModeConfirm = (data: ExitPlanModeConfirmationData) => {
      // Only show confirmation for this session
      if (data.sessionId === sessionId) {
        // TODO: Debug logging - uncomment if needed
        // console.log(`[AISessionView] ExitPlanMode confirmation requested for session ${sessionId}`);
        setPendingExitPlanConfirmation(data);
      }
    };

    const cleanup = window.electronAPI.on('ai:exitPlanModeConfirm', handleExitPlanModeConfirm);
    return () => {
      cleanup?.();
    };
  }, [sessionId]);

  // Listen for AskUserQuestion requests for this session
  useEffect(() => {
    const handleAskUserQuestion = (data: AskUserQuestionData) => {
      // Only show questions for this session
      if (data.sessionId === sessionId) {
        // Prevent duplicate events from resetting the component state
        // Check if we already have a pending question with the same ID
        setPendingAskUserQuestion(prev => {
          if (prev && prev.questionId === data.questionId) {
            // Same question already pending, don't reset state
            return prev;
          }
          return data;
        });
      }
    };

    const cleanup = window.electronAPI.on('ai:askUserQuestion', handleAskUserQuestion);
    return () => {
      cleanup?.();
    };
  }, [sessionId]);

  // Listen for AskUserQuestion answered events to store answers for widget display
  useEffect(() => {
    const handleAskUserQuestionAnswered = (data: { questionId: string; sessionId: string; answers: Record<string, string> }) => {
      // Only process for this session
      if (data.sessionId === sessionId) {
        // Debug logging - uncomment if needed
        // console.log(`[AISessionView] AskUserQuestion answered for session ${sessionId}:`, data.questionId);
        // Store answers so widget can display them
        storeAskUserQuestionAnswers(data.answers);
      }
    };

    const cleanup = window.electronAPI.on('ai:askUserQuestionAnswered', handleAskUserQuestionAnswered);
    return () => {
      cleanup?.();
    };
  }, [sessionId]);

  // Listen for session cancelled events (from mobile cancellation)
  useEffect(() => {
    const handleSessionCancelled = (data: { sessionId: string }) => {
      // Only process for this session
      if (data.sessionId === sessionId) {
        console.log(`[AISessionView] Session cancelled from mobile for session ${sessionId}`);
        // Clear any pending question UI
        setPendingAskUserQuestion(null);
      }
    };

    const cleanup = window.electronAPI.on('ai:sessionCancelled', handleSessionCancelled);
    return () => {
      cleanup?.();
    };
  }, [sessionId]);

  // Handle ExitPlanMode confirmation response
  const handleExitPlanModeApprove = useCallback(async (requestId: string, confirmSessionId: string) => {
    // TODO: Debug logging - uncomment if needed
    // console.log(`[AISessionView] User approved ExitPlanMode: ${requestId}`);
    try {
      await window.electronAPI.invoke('ai:exitPlanModeConfirmResponse', requestId, confirmSessionId, true);
      setPendingExitPlanConfirmation(null);
      // Update the UI mode to 'agent' since we've exited plan mode
      if (onAIModeChange) {
        onAIModeChange('agent');
      }
    } catch (error) {
      console.error('[AISessionView] Failed to send ExitPlanMode approval:', error);
    }
  }, [onAIModeChange]);

  const handleExitPlanModeDeny = useCallback(async (requestId: string, confirmSessionId: string) => {
    // TODO: Debug logging - uncomment if needed
    // console.log(`[AISessionView] User denied ExitPlanMode: ${requestId}`);
    try {
      await window.electronAPI.invoke('ai:exitPlanModeConfirmResponse', requestId, confirmSessionId, false);
      setPendingExitPlanConfirmation(null);
    } catch (error) {
      console.error('[AISessionView] Failed to send ExitPlanMode denial:', error);
    }
  }, []);

  // Handle AskUserQuestion answer submission
  const handleAskUserQuestionSubmit = useCallback(async (questionId: string, confirmSessionId: string, answers: Record<string, string>) => {
    // Debug logging - uncomment if needed
    // console.log(`[AISessionView] User submitted answers for ${questionId}:`, answers);
    try {
      // Store answers in global store so the widget can display them
      storeAskUserQuestionAnswers(answers);

      await window.electronAPI.invoke('claude-code:answer-question', { questionId, answers });
      setPendingAskUserQuestion(null);
    } catch (error) {
      console.error('[AISessionView] Failed to submit AskUserQuestion answers:', error);
    }
  }, []);

  const handleAskUserQuestionCancel = useCallback(async (questionId: string, confirmSessionId: string) => {
    // Debug logging - uncomment if needed
    // console.log(`[AISessionView] User cancelled AskUserQuestion: ${questionId}`);
    try {
      // Reject the pending promise and abort the AI request
      await window.electronAPI.invoke('claude-code:cancel-question', { questionId });
      setPendingAskUserQuestion(null);
    } catch (error) {
      console.error('[AISessionView] Failed to cancel AskUserQuestion:', error);
      // Still clear the UI even if the cancel fails
      setPendingAskUserQuestion(null);
    }
  }, []);

  // Listen for tool permission requests for this session
  useEffect(() => {
    const handleToolPermission = (data: ToolPermissionData) => {
      // Only show permission request for this session
      if (data.sessionId === sessionId) {
        // Add to queue if not already present (prevents duplicate events)
        setPendingToolPermissions(prev => {
          if (prev.some(p => p.requestId === data.requestId)) {
            return prev;
          }
          return [...prev, data];
        });
      }
    };

    const cleanup = window.electronAPI.on('ai:toolPermission', handleToolPermission);
    return () => {
      cleanup?.();
    };
  }, [sessionId]);

  // Listen for tool permission resolved events (for auto-approved permissions)
  useEffect(() => {
    const handleToolPermissionResolved = (data: { requestId: string; sessionId: string; autoApproved?: boolean }) => {
      // Only process for this session
      if (data.sessionId === sessionId) {
        // Remove the auto-approved request from the queue
        setPendingToolPermissions(prev => prev.filter(p => p.requestId !== data.requestId));
      }
    };

    const cleanup = window.electronAPI.on('ai:toolPermissionResolved', handleToolPermissionResolved);
    return () => {
      cleanup?.();
    };
  }, [sessionId]);

  // Handle tool permission response
  const handleToolPermissionSubmit = useCallback(async (
    requestId: string,
    confirmSessionId: string,
    response: { decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' | 'always-all' }
  ) => {
    try {
      await window.electronAPI.invoke('claude-code:answer-tool-permission', {
        requestId,
        sessionId: confirmSessionId,
        response
      });
      // Remove this request from the queue
      setPendingToolPermissions(prev => prev.filter(p => p.requestId !== requestId));
    } catch (error) {
      console.error('[AISessionView] Failed to submit tool permission response:', error);
    }
  }, []);

  const handleToolPermissionCancel = useCallback(async (requestId: string, confirmSessionId: string) => {
    try {
      await window.electronAPI.invoke('claude-code:cancel-tool-permission', {
        requestId,
        sessionId: confirmSessionId
      });
      // Remove this request from the queue
      setPendingToolPermissions(prev => prev.filter(p => p.requestId !== requestId));
    } catch (error) {
      console.error('[AISessionView] Failed to cancel tool permission:', error);
      // Still remove from queue even if cancel fails
      setPendingToolPermissions(prev => prev.filter(p => p.requestId !== requestId));
    }
  }, []);

  // Load pending queued prompts from database
  // This uses the same queue that mobile sync uses (queued_prompts table)
  const loadQueuedPrompts = useCallback(async () => {
    try {
      const pending = await window.electronAPI.invoke('ai:listPendingPrompts', sessionId) as Array<{
        id: string;
        prompt: string;
        timestamp: number;
        documentContext?: any;
        attachments?: any[];
      }>;
      setQueuedPrompts(pending || []);
    } catch (error) {
      console.error('[AISessionView] Failed to load queued prompts:', error);
      setQueuedPrompts([]);
    }
  }, [sessionId]);

  // Load queued prompts on session change
  useEffect(() => {
    loadQueuedPrompts();
  }, [loadQueuedPrompts]);

  // Track previous loading state to detect transition from loading to not loading
  const prevIsLoadingRef = useRef(isLoading);
  useEffect(() => {
    // When loading transitions from true to false, refresh the queue
    // This ensures the UI updates after a queued prompt is processed
    if (prevIsLoadingRef.current && !isLoading) {
      loadQueuedPrompts();
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, loadQueuedPrompts]);

  // Listen for queued prompts from mobile sync and refresh the queue display
  useEffect(() => {
    const handleQueuedPromptsReceived = (data: { sessionId: string }) => {
      // Only refresh if this is for our session
      if (data.sessionId === sessionId) {
        loadQueuedPrompts();
      }
    };

    const cleanup = window.electronAPI.on('ai:queuedPromptsReceived', handleQueuedPromptsReceived);
    return () => {
      cleanup?.();
    };
  }, [sessionId, loadQueuedPrompts]);

  // Listen for prompt claimed events and remove from local queue display immediately
  useEffect(() => {
    const handlePromptClaimed = (event: CustomEvent<{ sessionId: string; promptId: string }>) => {
      if (event.detail.sessionId === sessionId) {
        console.log(`[AISessionView] Prompt ${event.detail.promptId} claimed, removing from queue display`);
        setQueuedPrompts(prev => prev.filter(p => p.id !== event.detail.promptId));
      }
    };

    window.addEventListener('ai:promptClaimed', handlePromptClaimed as EventListener);
    return () => {
      window.removeEventListener('ai:promptClaimed', handlePromptClaimed as EventListener);
    };
  }, [sessionId]);

  // Extract todos from session metadata when sessionData changes
  useEffect(() => {
    const currentTodos = sessionData.metadata?.currentTodos;
    if (Array.isArray(currentTodos)) {
      // console.log(`[AISessionView] Extracting todos for session ${sessionId}:`, currentTodos);
      setTodos(currentTodos);
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
  // Uses the database queue (queued_prompts table) which is processed by processQueuedPrompts in AgenticPanel
  const handleQueue = useCallback(async (message: string) => {
    if (!message.trim()) {
      return;
    }

    try {
      // Only store serializable parts of documentContext
      const serializableContext = documentContext ? {
        filePath: documentContext.filePath,
        content: documentContext.content,
        fileType: documentContext.fileType
      } : undefined;

      // Create the queued prompt in the database (same queue used by mobile sync)
      // This will be processed by processQueuedPrompts after the current AI response completes
      const result = await window.electronAPI.invoke(
        'ai:createQueuedPrompt',
        sessionId,
        message.trim(),
        draftAttachments,
        serializableContext
      ) as { id: string; prompt: string; timestamp: number };

      console.log('[AISessionView] Created queued prompt:', result.id);

      // Add to local state for immediate UI update
      const queuedPrompt = {
        id: result.id,
        prompt: message.trim(),
        timestamp: result.timestamp,
        documentContext: serializableContext,
        attachments: draftAttachments
      };
      setQueuedPrompts(prev => [...prev, queuedPrompt]);

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
  }, [sessionId, documentContext, draftAttachments, onDraftInputChange, onDraftAttachmentsChange]);

  // Handle send message
  const handleSend = useCallback(() => {
    if (!draftInput.trim()) return;

    console.log('[AISessionView] handleSend called', { sessionId, isLoading, draftInputLength: draftInput.length });

    // If already loading, queue the prompt instead
    if (isLoading) {
      console.log('[AISessionView] Session is loading, queueing prompt instead of sending');
      handleQueue(draftInput.trim());
      return;
    }

    if (onSendMessage) {
      console.log('[AISessionView] Calling onSendMessage with sessionId:', sessionId);
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
    console.log('[AISessionView] handleCancel called, sessionId:', sessionId, 'onCancelRequest:', !!onCancelRequest);
    if (onCancelRequest) {
      onCancelRequest(sessionId);
    } else {
      console.warn('[AISessionView] onCancelRequest is undefined!');
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

  // Handle cancel queued prompt (delete from database queue)
  const handleCancelQueuedPrompt = useCallback(async (id: string) => {
    try {
      // Delete from database
      await window.electronAPI.invoke('ai:deleteQueuedPrompt', id);

      // Update local state
      setQueuedPrompts(prev => prev.filter(p => p.id !== id));

      console.log('[AISessionView] Cancelled queued prompt:', id);
    } catch (error) {
      console.error('[AISessionView] Failed to cancel queued prompt:', error);
    }
  }, []);

  // Handle edit queued prompt (delete from queue and put back in input)
  const handleEditQueuedPrompt = useCallback(async (id: string, prompt: string) => {
    try {
      // Delete from database
      await window.electronAPI.invoke('ai:deleteQueuedPrompt', id);

      // Update local state
      setQueuedPrompts(prev => prev.filter(p => p.id !== id));

      // Set input value
      if (onDraftInputChange) {
        onDraftInputChange(sessionId, prompt);
      }

      // Focus the input
      inputRef.current?.focus();

      console.log('[AISessionView] Editing queued prompt:', id);
    } catch (error) {
      console.error('[AISessionView] Failed to edit queued prompt:', error);
    }
  }, [sessionId, onDraftInputChange]);

  // Handle close and archive session
  const handleCloseAndArchive = useCallback(() => {
    if (onCloseAndArchive) {
      onCloseAndArchive(sessionId);
    }
  }, [sessionId, onCloseAndArchive]);

  // Handle unarchive session
  const handleUnarchive = useCallback(() => {
    if (onUnarchive) {
      onUnarchive(sessionId);
    }
  }, [sessionId, onUnarchive]);

  // Handle slash command suggestion selection
  const handleCommandSelect = useCallback((command: string) => {
    if (onDraftInputChange) {
      onDraftInputChange(sessionId, command);
    }
    // Focus the input after inserting command
    inputRef.current?.focus();
  }, [sessionId, onDraftInputChange]);

  // Feature flags based on mode and provider
  const enableSlashCommands = sessionData.provider === 'claude-code'; // Only for Claude Code
  const enableAttachments = true; // Available in both chat and agent modes
  const enableHistoryNavigation = true; // Available in both chat and agent modes

  // Calculate last user message timestamp for mockup annotation indicator
  const lastUserMessageTimestamp = React.useMemo(() => {
    const userMessages = sessionData.messages?.filter(m => m.role === 'user') || [];
    if (userMessages.length === 0) return null;
    const lastUserMessage = userMessages[userMessages.length - 1];
    return lastUserMessage.timestamp || null;
  }, [sessionData.messages]);

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
        isProcessing={isLoading}
        onFileClick={handleFileClick}
        onTodoClick={handleTodoClick}
        onCancelQueuedPrompt={handleCancelQueuedPrompt}
        onEditQueuedPrompt={handleEditQueuedPrompt}
        isArchived={isArchived}
        onCloseAndArchive={handleCloseAndArchive}
        onUnarchive={handleUnarchive}
        provider={sessionData.provider}
        onCommandSelect={handleCommandSelect}
      />

      {/* ExitPlanMode confirmation - shown when agent requests to exit planning mode */}
      {pendingExitPlanConfirmation && (
        <ExitPlanModeConfirmation
          data={pendingExitPlanConfirmation}
          onApprove={handleExitPlanModeApprove}
          onDeny={handleExitPlanModeDeny}
        />
      )}

      {/* AskUserQuestion confirmation - shown when agent asks clarifying questions */}
      {pendingAskUserQuestion && (
        <AskUserQuestionConfirmation
          key={pendingAskUserQuestion.questionId}
          data={pendingAskUserQuestion}
          onSubmit={handleAskUserQuestionSubmit}
          onCancel={handleAskUserQuestionCancel}
        />
      )}

      {/* Tool permission confirmations - shown when tools require user approval */}
      {pendingToolPermissions.map(permission => (
        <ToolPermissionConfirmation
          key={permission.requestId}
          data={permission}
          onSubmit={handleToolPermissionSubmit}
          onCancel={handleToolPermissionCancel}
        />
      ))}

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
        sessionHasMessages={sessionHasMessages}
        currentProviderType={currentProviderType}
        tokenUsage={sessionData.tokenUsage}
        provider={sessionData.provider}
        onQueue={handleQueue}
        queueCount={queuedPrompts.length}
        currentFilePath={documentContext?.filePath}
        lastUserMessageTimestamp={lastUserMessageTimestamp}
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
    prevProps.isArchived !== nextProps.isArchived ||
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
  // Note: queuedPrompts are now loaded from database, not from session metadata
  if (
    prevData.id !== nextData.id ||
    prevData.provider !== nextData.provider ||
    prevData.model !== nextData.model ||
    prevData.messages.length !== nextData.messages.length ||
    prevData.metadata?.currentTodos !== nextData.metadata?.currentTodos
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
