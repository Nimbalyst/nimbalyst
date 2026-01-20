import React, { useCallback, useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { usePostHog } from 'posthog-js/react';
import { AgentTranscriptPanel, TodoItem, storeAskUserQuestionAnswers, ProviderIcon, FileEditsSidebar, FileEditSummary } from '@nimbalyst/runtime';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { getProviderDisplayName } from '../../utils/modelUtils';
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
import { diffTreeGroupByDirectoryAtom, setDiffTreeGroupByDirectoryAtom } from '../../store/atoms/projectState';
import { SessionEditorArea, SessionEditorAreaRef } from './SessionEditorArea';
import { AgentSessionHeader } from '../AgenticCoding/AgentSessionHeader';
import {
  store,
  sessionEditorStateAtom,
  setSessionSplitRatioAtom,
  sessionDraftInputAtom,
  sessionDraftAttachmentsAtom,
  sessionDataAtom,
  sessionLoadingAtom,
  sessionModeAtom,
  sessionModelAtom,
  sessionArchivedAtom,
  sessionActiveAtom,
  sessionProcessingAtom,
  loadSessionDataAtom,
  reloadSessionDataAtom,
  updateSessionDataAtom,
} from '../../store';

interface Todo {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
  activeForm: string;
}

export interface AISessionViewRef {
  focusInput: () => void;
  getInputElement?: () => HTMLInputElement | HTMLTextAreaElement | null;
  /** Open a file in the session's embedded editor (for non-worktree sessions) */
  openFileInSessionEditor?: (filePath: string) => void;
}

export interface AISessionViewProps {
  // Identity - only sessionId is required, component loads its own data
  sessionId: string;

  // UI mode: chat = sidebar mode, agent = full window mode
  mode: 'chat' | 'agent';

  // Context
  workspacePath: string;
  documentContext?: any; // DocumentContext type

  // NOTE: Session data, mode, model, archive status, processing state, and
  // isActive are all managed via Jotai atoms. AISessionView loads its own data
  // on mount. This eliminates re-render cascades from parent state changes.
  // Parent uses store.set(sessionActiveAtom(sessionId), true/false) to control visibility.

  // File mention support
  fileMentionOptions?: TypeaheadOption[];
  onFileMentionSearch?: (query: string) => void;
  onFileMentionSelect?: (option: TypeaheadOption) => void;

  // Click handlers
  onFileClick?: (filePath: string) => void;
  onTodoClick?: (todo: TodoItem) => void;

  // History navigation (up/down arrow in input)
  onNavigateHistory?: (sessionId: string, direction: 'up' | 'down') => void;

  // Callbacks for tab management (parent still manages open/close)
  onCloseAndArchive?: (sessionId: string) => void;
  onSessionTitleChanged?: (sessionId: string, title: string) => void;
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
  /** Force hide the sidebar (when rendered externally) */
  hideSidebar?: boolean;
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
  onCommandSelect,
  hideSidebar: hideSidebarProp
}) => {
  // Track files with pending AI edits for this session
  const [pendingReviewFiles, setPendingReviewFiles] = useState<Set<string>>(new Set());

  // Diff tree grouping state (persisted per project via Jotai + workspace state)
  const [groupByDirectory] = useAtom(diffTreeGroupByDirectoryAtom);
  const setDiffTreeGroupByDirectory = useSetAtom(setDiffTreeGroupByDirectoryAtom);

  // Wrapper to pass workspacePath to the setter atom
  const setGroupByDirectory = useCallback((value: boolean) => {
    if (workspacePath) {
      setDiffTreeGroupByDirectory({ groupByDirectory: value, workspacePath });
    }
  }, [workspacePath, setDiffTreeGroupByDirectory]);

  // Note: groupByDirectory is hydrated from workspace state once at app init (in App.tsx)
  // No need to load it here - just use the Jotai atom value

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
          hideSidebar={hideSidebarProp || mode === 'chat'} // Hide sidebar when explicitly requested or in chat mode
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
          groupByDirectory={groupByDirectory}
          onGroupByDirectoryChange={setGroupByDirectory}
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
    prevProps.provider === nextProps.provider &&
    prevProps.hideSidebar === nextProps.hideSidebar
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
  mode,
  workspacePath,
  documentContext,
  fileMentionOptions = [],
  onFileMentionSearch,
  onFileMentionSelect,
  onFileClick,
  onTodoClick,
  onNavigateHistory,
  onCloseAndArchive,
  onSessionTitleChanged,
}, ref) => {
  // isActive is managed via Jotai atom to prevent re-render cascades
  // Parent sets it via store.set(sessionActiveAtom(sessionId), true/false)
  const isActive = useAtomValue(sessionActiveAtom(sessionId));
  const posthog = usePostHog();
  const inputRef = useRef<AIInputRef>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [queuedPrompts, setQueuedPrompts] = useState<any[]>([]);
  const [pendingExitPlanConfirmation, setPendingExitPlanConfirmation] = useState<ExitPlanModeConfirmationData | null>(null);
  const [pendingAskUserQuestion, setPendingAskUserQuestion] = useState<AskUserQuestionData | null>(null);

  // ============================================================
  // Session state via Jotai atoms - component owns its own data
  // ============================================================
  const [sessionData, setSessionData] = useAtom(sessionDataAtom(sessionId));
  const isDataLoading = useAtomValue(sessionLoadingAtom(sessionId));
  const [aiMode, setAiMode] = useAtom(sessionModeAtom(sessionId));
  const [currentModel, setCurrentModel] = useAtom(sessionModelAtom(sessionId));
  const [isArchived, setIsArchived] = useAtom(sessionArchivedAtom(sessionId));
  // Processing state is managed by AgenticPanel via sessionState.onStateChange
  // We only read it here - don't write to it directly (use store.set for error recovery only)
  const isProcessing = useAtomValue(sessionProcessingAtom(sessionId));
  const loadSessionData = useSetAtom(loadSessionDataAtom);
  const reloadSessionData = useSetAtom(reloadSessionDataAtom);
  const updateSessionData = useSetAtom(updateSessionDataAtom);

  // Draft input state via Jotai atoms - only this component re-renders on typing
  const [draftInput, setDraftInput] = useAtom(sessionDraftInputAtom(sessionId));
  const [draftAttachments, setDraftAttachments] = useAtom(sessionDraftAttachmentsAtom(sessionId));
  const [pendingToolPermissions, setPendingToolPermissions] = useState<ToolPermissionData[]>([]);

  // Track if we're currently sending a message (for local UI state)
  const sendingRef = useRef(false);

  // ============================================================
  // Files sidebar state (for agent mode non-worktree sessions)
  // ============================================================
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [fileEdits, setFileEdits] = useState<FileEditSummary[]>([]);
  const [pendingReviewFilesMain, setPendingReviewFilesMain] = useState<Set<string>>(new Set());

  // Diff tree grouping state (for files sidebar)
  const [groupByDirectory] = useAtom(diffTreeGroupByDirectoryAtom);
  const setDiffTreeGroupByDirectory = useSetAtom(setDiffTreeGroupByDirectoryAtom);

  const setGroupByDirectory = useCallback((value: boolean) => {
    if (workspacePath) {
      setDiffTreeGroupByDirectory({ groupByDirectory: value, workspacePath });
    }
  }, [workspacePath, setDiffTreeGroupByDirectory]);

  // ============================================================
  // Load session data on mount
  // ============================================================
  useEffect(() => {
    if (!sessionId || !workspacePath) return;

    // Load session data if not already loaded
    if (!sessionData) {
      loadSessionData({ sessionId, workspacePath });
    }
  }, [sessionId, workspacePath, sessionData, loadSessionData]);

  // ============================================================
  // Subscribe to IPC events for session updates
  // NOTE: Processing state (sessionProcessingAtom) is managed by AgenticPanel
  // via sessionState.onStateChange. Don't duplicate that logic here.
  // ============================================================
  useEffect(() => {
    if (!sessionId || !window.electronAPI?.on) return;

    // Handle message logged events - reload session data
    const handleMessageLogged = (data: { sessionId: string; direction: string }) => {
      if (data.sessionId !== sessionId) return;
      // Only reload on assistant output messages
      if (data.direction === 'output') {
        reloadSessionData({ sessionId, workspacePath });
        // Clear sending ref when we get an output message
        sendingRef.current = false;
      }
    };

    // Handle session title updates
    const handleTitleUpdated = (data: { sessionId: string; title: string }) => {
      if (data.sessionId === sessionId && sessionData) {
        updateSessionData({ sessionId, updates: { title: data.title } });
        onSessionTitleChanged?.(sessionId, data.title);
      }
    };

    // Handle token usage updates (for claude-code provider)
    const handleTokenUsageUpdated = (data: { sessionId: string; tokenUsage: any }) => {
      if (data.sessionId === sessionId && sessionData) {
        updateSessionData({ sessionId, updates: { tokenUsage: data.tokenUsage } });
      }
    };

    const cleanup1 = window.electronAPI.on('ai:message-logged', handleMessageLogged);
    const cleanup2 = window.electronAPI.on('session:title-updated', handleTitleUpdated);
    const cleanup3 = window.electronAPI.on('ai:tokenUsageUpdated', handleTokenUsageUpdated);

    return () => {
      cleanup1?.();
      cleanup2?.();
      cleanup3?.();
    };
  }, [sessionId, workspacePath, sessionData, reloadSessionData, updateSessionData, onSessionTitleChanged]);

  // Derived values from session data
  const isLoading = isProcessing || sendingRef.current;
  const sessionHasMessages = (sessionData?.messages?.length ?? 0) > 0;
  const currentProviderType = sessionData?.provider === 'claude-code' ? 'agent' : 'model';

  // Determine if we should show the session editor area
  const isWorktreeSession = Boolean(sessionData?.worktreeId && sessionData?.worktreePath);
  const showSessionEditor = mode === 'agent' && !isWorktreeSession;

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
      setAiMode('agent');
    } catch (error) {
      console.error('[AISessionView] Failed to send ExitPlanMode approval:', error);
    }
  }, [setAiMode]);

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

  // Helper to extract tool category from pattern
  const getToolCategory = useCallback((pattern: string): string => {
    if (pattern.startsWith('Bash')) return 'bash';
    if (pattern.startsWith('WebFetch')) return 'webfetch';
    if (pattern.startsWith('mcp__')) return 'mcp';
    if (['Edit', 'Write', 'Read', 'Glob', 'Grep'].includes(pattern)) return 'file';
    return 'other';
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
    // Find the request data for analytics before removing it
    const requestData = pendingToolPermissions.find(p => p.requestId === requestId);
    const firstPattern = requestData?.request.actionsNeedingApproval[0]?.action.pattern;

    try {
      await window.electronAPI.invoke('claude-code:answer-tool-permission', {
        requestId,
        sessionId: confirmSessionId,
        response
      });

      // Track the permission decision
      posthog?.capture('tool_permission_responded', {
        decision: response.decision,
        scope: response.scope,
        toolCategory: firstPattern ? getToolCategory(firstPattern) : 'unknown',
      });

      // Remove this request from the queue
      setPendingToolPermissions(prev => prev.filter(p => p.requestId !== requestId));
    } catch (error) {
      console.error('[AISessionView] Failed to submit tool permission response:', error);
    }
  }, [pendingToolPermissions, posthog, getToolCategory]);

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
    const currentTodos = sessionData?.metadata?.currentTodos;
    if (Array.isArray(currentTodos)) {
      // console.log(`[AISessionView] Extracting todos for session ${sessionId}:`, currentTodos);
      setTodos(currentTodos);
    } else {
      // console.log(`[AISessionView] No todos found in session metadata for ${sessionId}`);
      setTodos([]);
    }
  }, [sessionId, sessionData?.metadata?.currentTodos]);

  // ============================================================
  // Files sidebar data fetching (for agent mode non-worktree sessions)
  // ============================================================
  const showFileSidebar = mode === 'agent' && !isWorktreeSession;

  // Fetch file edits for this session (sidebar)
  useEffect(() => {
    if (!showFileSidebar) return;

    const fetchFileLinks = async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          const result = await window.electronAPI.invoke('session-files:get-by-session', sessionId);
          if (result.success && result.files) {
            const fileEditsFromDb: FileEditSummary[] = result.files.map((file: any) => ({
              filePath: file.filePath,
              linkType: file.linkType,
              operation: file.metadata?.operation,
              linesAdded: file.metadata?.linesAdded,
              linesRemoved: file.metadata?.linesRemoved,
              timestamp: new Date(file.timestamp).toISOString(),
              metadata: file.metadata
            }));
            setFileEdits(fileEditsFromDb);
          }
        }
      } catch (error) {
        console.error('[AISessionView] Failed to fetch file links:', error);
      }
    };

    fetchFileLinks();

    // Listen for file updates
    const handleFileUpdate = async (updatedSessionId: string) => {
      if (updatedSessionId === sessionId) {
        fetchFileLinks();
      }
    };

    const cleanup = window.electronAPI?.on?.('session-files:updated', handleFileUpdate);
    return () => {
      cleanup?.();
    };
  }, [sessionId, showFileSidebar]);

  // Fetch pending review files for sidebar
  useEffect(() => {
    if (!showFileSidebar || !workspacePath) {
      setPendingReviewFilesMain(new Set());
      return;
    }

    const fetchPendingFiles = async () => {
      try {
        if (window.electronAPI?.history?.getPendingFilesForSession) {
          const files = await window.electronAPI.history.getPendingFilesForSession(workspacePath, sessionId);
          setPendingReviewFilesMain(new Set(files));
        }
      } catch (error) {
        console.error('[AISessionView] Failed to fetch pending review files for sidebar:', error);
      }
    };

    fetchPendingFiles();

    const unsubscribePendingCleared = window.electronAPI?.history?.onPendingCleared?.(
      (data: { workspacePath: string; sessionId?: string; clearedFiles: string[] }) => {
        if (data.workspacePath === workspacePath) {
          fetchPendingFiles();
        }
      }
    );

    const unsubscribePendingCount = window.electronAPI?.history?.onPendingCountChanged?.(
      (data: { workspacePath: string; count: number }) => {
        if (data.workspacePath === workspacePath) {
          fetchPendingFiles();
        }
      }
    );

    return () => {
      unsubscribePendingCleared?.();
      unsubscribePendingCount?.();
    };
  }, [sessionId, workspacePath, showFileSidebar]);

  // Ref for session editor area (for non-worktree sessions)
  const sessionEditorRef = useRef<SessionEditorAreaRef>(null);

  // Expose methods through ref
  useImperativeHandle(ref, () => ({
    focusInput: () => {
      inputRef.current?.focus();
    },
    openFileInSessionEditor: (filePath: string) => {
      sessionEditorRef.current?.openFile(filePath);
    }
  }));

  // Handle input change - updates Jotai atom directly
  const handleInputChange = useCallback((value: string) => {
    setDraftInput(value);
  }, [setDraftInput]);

  // Handle attachment add
  const handleAttachmentAdd = useCallback((attachment: ChatAttachment) => {
    setDraftAttachments(prev => [...prev, attachment]);
  }, [setDraftAttachments]);

  // Handle attachment remove
  const handleAttachmentRemove = useCallback((attachmentId: string) => {
    setDraftAttachments(prev => prev.filter(a => a.id !== attachmentId));
  }, [setDraftAttachments]);

  // Track in-flight queue requests to prevent duplicate submissions
  const queueingRef = useRef(false);

  // Handle queue message (must be before handleSend which uses it)
  // Uses the database queue (queued_prompts table) which is processed by processQueuedPrompts in AgenticPanel
  const handleQueue = useCallback(async (message: string) => {
    if (!message.trim()) {
      return;
    }

    // Prevent duplicate queue submissions
    if (queueingRef.current) {
      console.log('[AISessionView] Already queueing a prompt, ignoring duplicate');
      return;
    }
    queueingRef.current = true;

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
      setDraftInput('');
      setDraftAttachments([]);
    } catch (error) {
      console.error('[AISessionView] Failed to queue prompt:', error);
    } finally {
      queueingRef.current = false;
    }
  }, [sessionId, documentContext, draftAttachments, setDraftInput, setDraftAttachments]);

  // Handle send message - now calls IPC directly
  const handleSend = useCallback(async () => {
    if (!draftInput.trim() || !sessionData) return;

    console.log('[AISessionView] handleSend called', { sessionId, isLoading, draftInputLength: draftInput.length });

    // If already loading, queue the prompt instead
    if (isLoading) {
      console.log('[AISessionView] Session is loading, queueing prompt instead of sending');
      handleQueue(draftInput.trim());
      return;
    }

    const message = draftInput.trim();
    const attachments = draftAttachments;

    // Clear draft immediately for responsive UI
    setDraftInput('');
    setDraftAttachments([]);

    // Set local sending flag for immediate UI feedback
    // Note: sessionProcessingAtom is managed by AgenticPanel via sessionState.onStateChange
    sendingRef.current = true;

    // Add user message to local state optimistically
    const userMessage = {
      id: `msg-${Date.now()}`,
      role: 'user' as const,
      content: message,
      timestamp: Date.now(),
    };
    updateSessionData({
      sessionId,
      updates: {
        messages: [...(sessionData.messages || []), userMessage],
      },
    });

    try {
      // Build document context with attachments included
      // The handler expects: (message, documentContext, sessionId, workspacePath)
      const docContext = {
        filePath: documentContext?.filePath,
        content: documentContext?.content,
        fileType: documentContext?.fileType,
        attachments: attachments.length > 0 ? attachments : undefined,
        mode: aiMode,
      };

      // Send message via IPC using positional arguments
      await window.electronAPI.invoke('ai:sendMessage', message, docContext, sessionId, workspacePath);
    } catch (error) {
      console.error('[AISessionView] Failed to send message:', error);
      sendingRef.current = false;
    }
  }, [sessionId, sessionData, draftInput, draftAttachments, isLoading, documentContext, aiMode, setDraftInput, setDraftAttachments, updateSessionData, handleQueue]);

  // Handle cancel - now calls IPC directly
  // Note: sessionProcessingAtom will be set to false by AgenticPanel when the cancel completes
  const handleCancel = useCallback(async () => {
    console.log('[AISessionView] handleCancel called, sessionId:', sessionId);
    try {
      await window.electronAPI.invoke('ai:cancelRequest', sessionId);
      sendingRef.current = false;
    } catch (error) {
      console.error('[AISessionView] Failed to cancel request:', error);
    }
  }, [sessionId]);

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
      setDraftInput(prompt);

      // Focus the input
      inputRef.current?.focus();

      console.log('[AISessionView] Editing queued prompt:', id);
    } catch (error) {
      console.error('[AISessionView] Failed to edit queued prompt:', error);
    }
  }, [setDraftInput]);

  // Handle close and archive session
  const handleCloseAndArchive = useCallback(async () => {
    try {
      // Archive in database
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: true });
      setIsArchived(true);
      // Notify parent to close the tab
      onCloseAndArchive?.(sessionId);
    } catch (error) {
      console.error('[AISessionView] Failed to archive session:', error);
    }
  }, [sessionId, setIsArchived, onCloseAndArchive]);

  // Handle unarchive session
  const handleUnarchive = useCallback(async () => {
    try {
      // Unarchive in database
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: false });
      setIsArchived(false);
    } catch (error) {
      console.error('[AISessionView] Failed to unarchive session:', error);
    }
  }, [sessionId, setIsArchived]);

  // Handle AI mode change
  const handleAIModeChange = useCallback(async (newMode: AIMode) => {
    setAiMode(newMode);
    // Persist to database
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { mode: newMode });
    } catch (error) {
      console.error('[AISessionView] Failed to update mode:', error);
    }
  }, [sessionId, setAiMode]);

  // Handle model change
  const handleModelChange = useCallback(async (modelId: string) => {
    setCurrentModel(modelId);
    // Persist to database
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { model: modelId });
    } catch (error) {
      console.error('[AISessionView] Failed to update model:', error);
    }
  }, [sessionId, setCurrentModel]);

  // Handle slash command suggestion selection
  const handleCommandSelect = useCallback((command: string) => {
    setDraftInput(command);
    // Focus the input after inserting command
    inputRef.current?.focus();
  }, [setDraftInput]);

  // Handle sidebar resize drag (for files sidebar)
  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.max(180, Math.min(400, startWidth + deltaX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  // Feature flags based on mode and provider
  const enableSlashCommands = sessionData?.provider === 'claude-code'; // Only for Claude Code
  const enableAttachments = true; // Available in both chat and agent modes
  const enableHistoryNavigation = true; // Available in both chat and agent modes

  // Calculate last user message timestamp for mockup annotation indicator
  const lastUserMessageTimestamp = React.useMemo(() => {
    const userMessages = sessionData?.messages?.filter(m => m.role === 'user') || [];
    if (userMessages.length === 0) return null;
    const lastUserMessage = userMessages[userMessages.length - 1];
    return lastUserMessage.timestamp || null;
  }, [sessionData?.messages]);

  // Get session editor layout state for non-worktree sessions
  const sessionEditorState = useAtomValue(sessionEditorStateAtom(sessionId));
  const setSessionSplitRatio = useSetAtom(setSessionSplitRatioAtom);

  // Ref for the left column container (used for resize calculations)
  const leftColumnRef = useRef<HTMLDivElement>(null);

  // Handle transcript header resize drag
  const handleTranscriptResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = leftColumnRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const containerHeight = containerRect.height;
    const startY = e.clientY;
    const startRatio = sessionEditorState.splitRatio;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const currentHeight = startRatio * containerHeight;
      const newHeight = currentHeight + deltaY;
      const newRatio = newHeight / containerHeight;

      // Clamp between 10% and 90%
      const clampedRatio = Math.max(0.1, Math.min(0.9, newRatio));
      setSessionSplitRatio({ sessionId, ratio: clampedRatio });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [sessionId, sessionEditorState.splitRatio, setSessionSplitRatio]);

  // Calculate transcript section style based on layout mode
  // Important: TranscriptSection returns a fragment, so we need the wrapper to handle flex sizing
  // and the inner content already has flex: 1 on the AgentTranscriptPanel wrapper
  const transcriptStyle = React.useMemo((): React.CSSProperties => {
    if (!showSessionEditor || sessionEditorState.layoutMode === 'transcript') {
      // Full height when no session editor or transcript-only mode
      return { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 };
    }
    if (sessionEditorState.layoutMode === 'editor') {
      // Hidden when editor is maximized - use flex: 0 to collapse but keep in DOM for state
      return { flex: 0, height: 0, overflow: 'hidden', minHeight: 0 };
    }
    // Split mode: take remaining space
    return { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: '100px' };
  }, [showSessionEditor, sessionEditorState.layoutMode]);

  // Calculate wrapper style for editor + transcript area (excludes input)
  // When in editor mode, this should expand to fill space
  const editorTranscriptWrapperStyle = React.useMemo((): React.CSSProperties => {
    return { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 };
  }, []);

  // Show loading state while session data is being fetched
  if (!sessionData) {
    return (
      <div
        style={{
          height: '100%',
          display: isActive ? 'flex' : 'none',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
        data-session-id={sessionId}
        data-active={isActive}
      >
        {isDataLoading ? 'Loading session...' : 'Session not found'}
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        display: isActive ? 'flex' : 'none', // Use display:none to keep mounted but hidden
        flexDirection: 'row', // Horizontal: main content on left, full-height sidebar on right
        overflow: 'hidden'
      }}
      data-session-id={sessionId}
      data-active={isActive}
    >
      {/* Left side: Header + Content (vertical stack) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Session Header - only in agent mode */}
        {mode === 'agent' && (
          <AgentSessionHeader sessionData={sessionData} />
        )}

        {/* Content area: Editor + Transcript + Input */}
        <div ref={leftColumnRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {/* Wrapper for Editor + Transcript (flex: 1 to fill space, input stays at bottom) */}
          <div style={editorTranscriptWrapperStyle}>
            {/* Session Editor Area - for non-worktree agent mode sessions */}
            {showSessionEditor && (
              <SessionEditorArea
                ref={sessionEditorRef}
                sessionId={sessionId}
                workspacePath={workspacePath}
              />
            )}

            {/* Transcript header - shows agent info when in split view, draggable to resize */}
            {showSessionEditor && sessionEditorState.layoutMode !== 'editor' && (
              <div
                className="transcript-header"
                onMouseDown={sessionEditorState.layoutMode === 'split' ? handleTranscriptResizeStart : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  borderTop: '3px solid var(--border-primary)',
                  borderBottom: '1px solid var(--border-primary)',
                  backgroundColor: 'var(--surface-secondary)',
                  cursor: sessionEditorState.layoutMode === 'split' ? 'ns-resize' : 'default',
                  flexShrink: 0
                }}
                title={sessionEditorState.layoutMode === 'split' ? 'Drag to resize' : undefined}
              >
                <ProviderIcon provider={sessionData.provider} size={18} />
                <span style={{ fontWeight: 500, fontSize: '13px', color: 'var(--text-primary)' }}>
                  {getProviderDisplayName(sessionData.provider)}
                </span>
                {sessionData.model && (
                  <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                    {sessionData.model.split(':').pop()}
                  </span>
                )}
              </div>
            )}

            {/* Transcript and gutters - memoized to prevent re-render on input changes */}
            <div style={transcriptStyle}>
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
            hideSidebar={showSessionEditor}
          />
            </div>
          </div>

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
          onModeChange={handleAIModeChange}
          currentModel={currentModel}
          onModelChange={handleModelChange}
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
      </div>

      {/* Files Sidebar - only for agent mode non-worktree sessions (full height, sibling to left side) */}
      {showFileSidebar && (
          <>
            {/* Draggable Divider */}
            <div
              onMouseDown={handleSidebarResizeStart}
              style={{
                width: '4px',
                cursor: 'ew-resize',
                background: isDraggingSidebar ? 'var(--border-focus)' : 'var(--border-primary)',
                transition: isDraggingSidebar ? 'none' : 'background-color 0.15s ease',
                flexShrink: 0
              }}
            />
            <div
              className="session-files-sidebar"
              style={{
                width: `${sidebarWidth}px`,
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                borderLeft: '1px solid var(--border-primary)',
                backgroundColor: 'var(--surface-secondary)'
              }}
            >
              {/* Header with Files label and controls */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.75rem',
                borderBottom: '1px solid var(--border-primary)',
                backgroundColor: 'var(--surface-secondary)'
              }}>
                <MaterialSymbol icon="description" size={16} />
                <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Files Edited</span>
                {/* Controls */}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                  <button
                    onClick={() => setGroupByDirectory(!groupByDirectory)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      border: 'none',
                      borderRadius: '4px',
                      background: groupByDirectory ? 'var(--surface-tertiary)' : 'transparent',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer'
                    }}
                    title="Group by directory"
                  >
                    <MaterialSymbol icon="folder" size={16} />
                  </button>
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('file-edits-sidebar:expand-all'));
                    }}
                    disabled={!groupByDirectory}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      border: 'none',
                      borderRadius: '4px',
                      background: 'transparent',
                      color: groupByDirectory ? 'var(--text-secondary)' : 'var(--text-disabled)',
                      cursor: groupByDirectory ? 'pointer' : 'default',
                      opacity: groupByDirectory ? 1 : 0.5
                    }}
                    title="Expand all"
                  >
                    <MaterialSymbol icon="unfold_more" size={16} />
                  </button>
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('file-edits-sidebar:collapse-all'));
                    }}
                    disabled={!groupByDirectory}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      border: 'none',
                      borderRadius: '4px',
                      background: 'transparent',
                      color: groupByDirectory ? 'var(--text-secondary)' : 'var(--text-disabled)',
                      cursor: groupByDirectory ? 'pointer' : 'default',
                      opacity: groupByDirectory ? 1 : 0.5
                    }}
                    title="Collapse all"
                  >
                    <MaterialSymbol icon="unfold_less" size={16} />
                  </button>
                </div>
              </div>

              {/* Pending review banner */}
              <PendingReviewBanner workspacePath={workspacePath} sessionId={sessionId} />

              {/* Files Content */}
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <FileEditsSidebar
                  fileEdits={fileEdits}
                  onFileClick={handleFileClick}
                  workspacePath={workspacePath}
                  pendingReviewFiles={pendingReviewFilesMain}
                  groupByDirectory={groupByDirectory}
                  onGroupByDirectoryChange={setGroupByDirectory}
                  hideControls
                />
              </div>

              {/* Todo list below file edits */}
              {Array.isArray(todos) && todos.length > 0 && (
                <div style={{
                  borderTop: '1px solid var(--border-primary)',
                  backgroundColor: 'var(--surface-secondary)',
                  padding: '0.75rem',
                  maxHeight: '150px',
                  overflow: 'auto'
                }}>
                  <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                    Tasks ({todos.filter(t => t.status === 'completed').length}/{todos.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {todos.map((todo, index) => {
                      const displayText = todo.status === 'in_progress' ? todo.activeForm : todo.content;
                      return (
                        <div key={index} style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.5rem',
                          fontSize: '0.75rem',
                          color: 'var(--text-primary)',
                          opacity: todo.status === 'completed' ? 0.6 : 1
                        }}>
                          <div style={{ marginTop: '2px', flexShrink: 0 }}>
                            {todo.status === 'pending' && <span style={{ fontSize: '0.625rem' }}>○</span>}
                            {todo.status === 'in_progress' && <span style={{ fontSize: '0.625rem', animation: 'spin 1s linear infinite' }}>◐</span>}
                            {todo.status === 'completed' && <span style={{ fontSize: '0.625rem', color: 'var(--primary-color)' }}>●</span>}
                          </div>
                          <div style={{ flex: 1, wordBreak: 'break-word' }}>{displayText}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
    </div>
  );
});

AISessionViewComponent.displayName = 'AISessionView';

// Memoize to prevent re-renders when props haven't changed
// Most session state is now managed via Jotai atoms, so props comparison is simple
// NOTE: isActive is now an atom, not a prop - this prevents re-render cascades when switching sessions
export const AISessionView = React.memo(AISessionViewComponent, (prevProps, nextProps) => {
  // Compare only the props that are actually passed from parent
  // Session data, processing state, isActive, etc. are all in atoms
  if (
    prevProps.sessionId !== nextProps.sessionId ||
    prevProps.workspacePath !== nextProps.workspacePath ||
    prevProps.mode !== nextProps.mode ||
    prevProps.fileMentionOptions?.length !== nextProps.fileMentionOptions?.length
  ) {
    return false; // Props changed, should re-render
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
