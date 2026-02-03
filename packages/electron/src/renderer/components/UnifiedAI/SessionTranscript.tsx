/**
 * SessionTranscript - Encapsulated transcript + input for a single session
 *
 * This component is designed to be swapped in/out based on which session tab is active.
 * It manages all session-specific state via Jotai atoms:
 * - Draft input text
 * - Draft attachments
 * - Queued prompts
 * - Todos
 *
 * It does NOT manage:
 * - Layout (sidebar, editor area)
 * - Session switching/tabs
 * - File edits aggregation (parent handles this)
 */

import React, { useCallback, useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { store } from '@nimbalyst/runtime/store';
import { AgentTranscriptPanel, TodoItem, storeAskUserQuestionAnswers } from '@nimbalyst/runtime';
import { registerPendingQuestion, clearPendingQuestionForSession, setSessionGitCommitProposalAtom } from '@nimbalyst/runtime/store';
import type { SessionData, ChatAttachment } from '@nimbalyst/runtime/ai/server/types';
import { AIInput, AIInputRef } from './AIInput';
import { PromptQueueList } from './PromptQueueList';
import { useDialog } from '../../contexts/DialogContext';
import { FileGutter } from '../AIChat/FileGutter';
import { PendingReviewBanner } from '../AIChat/PendingReviewBanner';
import type { AIMode } from './ModeTag';
import { ExitPlanModeConfirmation } from './ExitPlanModeConfirmation';
import { AskUserQuestionConfirmation, AskUserQuestionData } from './AskUserQuestionConfirmation';
import { ToolPermissionConfirmation, ToolPermissionData } from './ToolPermissionConfirmation';
import { SlashCommandSuggestions } from './SlashCommandSuggestions';
import type { TextSelection } from './TextSelectionIndicator';
import type { SerializableDocumentContext } from '../../hooks/useDocumentContext';
import { diffTreeGroupByDirectoryAtom, setDiffTreeGroupByDirectoryAtom } from '../../store/atoms/projectState';
import {
  sessionDraftInputAtom,
  sessionDraftAttachmentsAtom,
  sessionStoreAtom,
  sessionMessagesAtom,
  sessionProviderAtom,
  sessionTokenUsageAtom,
  sessionLoadingAtom,
  sessionModeAtom,
  sessionModelAtom,
  sessionArchivedAtom,
  sessionProcessingAtom,
  sessionWorktreeIdAtom,
  loadSessionDataAtom,
  updateSessionStoreAtom,
  navigateSessionHistoryAtom,
  resetSessionHistoryAtom,
  createChildSessionAtom,
  sessionChildrenAtom,
  sessionParentIdAtom,
  sessionPendingQuestionAtom,
  // DB-derived atoms for durable prompts
  sessionPendingPromptsAtom,
  sessionPendingPermissionsAtom,
  sessionPendingExitPlanModeAtom,
  sessionPendingGitCommitProposalAtom,
  refreshPendingPromptsAtom,
  respondToPromptAtom,
  // Centralized transcript state atoms
  sessionErrorAtom,
  sessionQueuedPromptsAtom,
  clearSessionError,
  loadInitialQueuedPrompts,
} from '../../store';
import { convertToWorkstreamAtom, sessionPromptAdditionsAtom, type ExitPlanModeConfirmationData } from '../../store/atoms/sessions';
import { usePostHog } from 'posthog-js/react';
import { setAgentModeSettingsAtom, showPromptAdditionsAtom, hasExternalEditorAtom, externalEditorNameAtom, openInExternalEditorAtom, defaultAgentModelAtom } from '../../store/atoms/appSettings';
import { buildPlanModeInstructions, PLAN_MODE_DEACTIVATION } from '@nimbalyst/runtime/ai/services/planModePrompts';

interface Todo {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
  activeForm: string;
}

export interface SessionTranscriptRef {
  focusInput: () => void;
}

export interface SessionTranscriptProps {
  sessionId: string;
  workspacePath: string;

  // UI mode affects placeholder text and features
  mode: 'chat' | 'agent';

  // Whether to hide the internal sidebar (parent may render an external one)
  hideSidebar?: boolean;

  // Whether to collapse the transcript (hide messages, show only input and dialogs)
  // Used when editor is maximized but we still want to show the AI input
  collapseTranscript?: boolean;

  // Click handlers
  onFileClick?: (filePath: string) => void;
  onTodoClick?: (todo: TodoItem) => void;

  // Archive callbacks
  onCloseAndArchive?: (sessionId: string) => void;
  onSessionTitleChanged?: (sessionId: string, title: string) => void;

  // Clear session callback (for files mode - creates new standalone session)
  onClearSession?: () => void;

  // Clear agent session callback (for agent mode - creates new session in worktree or workstream)
  onClearAgentSession?: () => void;

  // Create new session in worktree callback (returns new session ID)
  // Used by handleExitPlanModeStartNewSession when in a worktree
  onCreateWorktreeSession?: (worktreeId: string) => Promise<string | null>;

  // Document context (for chat mode where parent provides it)
  documentContext?: SerializableDocumentContext;

  // On-demand getter for document context (preferred over static documentContext)
  // Async because it reads file content from disk for consistency across all editor types
  getDocumentContext?: () => Promise<SerializableDocumentContext>;
}

/**
 * Serialize document context for IPC calls.
 * Always sends full content - backend handles diff optimization.
 */
function serializeDocumentContext(
  documentContext: SerializableDocumentContext | undefined
): SerializableDocumentContext | undefined {
  if (!documentContext) return undefined;
  return {
    filePath: documentContext.filePath,
    content: documentContext.content,
    fileType: documentContext.fileType,
    textSelection: documentContext.textSelection,
    textSelectionTimestamp: documentContext.textSelectionTimestamp,
    mockupSelection: documentContext.mockupSelection,
    mockupDrawing: documentContext.mockupDrawing
  };
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

/**
 * Helper to persist or clear a metadata field on a session.
 * Handles both the IPC call and local store update.
 * Uses store.get() to fetch current sessionData, so callers don't need to pass it.
 */
async function updateSessionMetadataField<T>(
  sessionId: string,
  field: string,
  value: T | null,
  _sessionData: SessionData | null,  // Deprecated - kept for backwards compatibility, not used
  updateSessionStore: (params: { sessionId: string; updates: Partial<SessionData> }) => void
): Promise<void> {
  try {
    // Update local store FIRST (before async IPC) to ensure immediate availability
    const currentSessionData = store.get(sessionStoreAtom(sessionId));

    if (currentSessionData) {
      const newMetadata = {
        ...(currentSessionData.metadata as Record<string, unknown> || {}),
        [field]: value
      };
      updateSessionStore({
        sessionId,
        updates: {
          metadata: newMetadata
        }
      });
    }

    // Then persist to database
    await window.electronAPI.invoke('sessions:update-metadata', sessionId, {
      metadata: { [field]: value }
    });
  } catch (error) {
    console.error(`[SessionTranscript] Failed to update ${field} metadata:`, error);
  }
}

/**
 * SessionTranscript - Fully encapsulated transcript + input for one session
 */
export const SessionTranscript = forwardRef<SessionTranscriptRef, SessionTranscriptProps>(({
  sessionId,
  workspacePath,
  mode,
  hideSidebar = false,
  collapseTranscript = false,
  onFileClick,
  onTodoClick,
  onCloseAndArchive,
  onSessionTitleChanged,
  onClearSession,
  onClearAgentSession,
  onCreateWorktreeSession,
  documentContext,
  getDocumentContext,
}, ref) => {
  const posthog = usePostHog();
  const inputRef = useRef<AIInputRef>(null);

  // Get effective document context - prefer getter for fresh data (reads from disk at call time)
  const getEffectiveDocumentContext = useCallback(async () => {
    return getDocumentContext ? await getDocumentContext() : documentContext;
  }, [getDocumentContext, documentContext]);

  // Get current file path for selection indicator - use static prop only
  // (getDocumentContext is async so can't be used in render - it's called on-demand when sending messages)
  const currentFilePath = documentContext?.filePath;

  // ============================================================
  // Session state via Jotai atoms - component owns its own data
  // Use derived atoms to avoid re-rendering on unrelated changes
  // ============================================================
  const messages = useAtomValue(sessionMessagesAtom(sessionId));
  const provider = useAtomValue(sessionProviderAtom(sessionId));
  const tokenUsage = useAtomValue(sessionTokenUsageAtom(sessionId));
  const isDataLoading = useAtomValue(sessionLoadingAtom(sessionId));
  const [aiMode, setAiMode] = useAtom(sessionModeAtom(sessionId));
  const [currentModel, setCurrentModel] = useAtom(sessionModelAtom(sessionId));
  const [isArchived, setIsArchived] = useAtom(sessionArchivedAtom(sessionId));
  const [isProcessing, setIsProcessing] = useAtom(sessionProcessingAtom(sessionId));
  const worktreeId = useAtomValue(sessionWorktreeIdAtom(sessionId));
  const loadSessionData = useSetAtom(loadSessionDataAtom);
  const updateSessionStore = useSetAtom(updateSessionStoreAtom);

  // Child session creation for "start new session" option
  const createChildSession = useSetAtom(createChildSessionAtom);
  const convertToWorkstream = useSetAtom(convertToWorkstreamAtom);
  const sessionChildren = useAtomValue(sessionChildrenAtom(sessionId));
  const sessionParentId = useAtomValue(sessionParentIdAtom(sessionId));
  const defaultModel = useAtomValue(defaultAgentModelAtom);

  // Still need full sessionData for certain operations (updating, checking loaded state)
  const sessionData = useAtomValue(sessionStoreAtom(sessionId));

  // Draft input state via Jotai atoms - only this component re-renders on typing
  const [draftInput, setDraftInput] = useAtom(sessionDraftInputAtom(sessionId));
  const [draftAttachments, setDraftAttachments] = useAtom(sessionDraftAttachmentsAtom(sessionId));

  // Debounced persistence of draft input to database
  // This ensures drafts survive app restarts
  useEffect(() => {
    // Don't persist empty drafts or undefined workspacePath
    if (!workspacePath) return;

    const timeoutId = setTimeout(() => {
      // Only persist if there's actual content (or we need to clear a previously saved draft)
      window.electronAPI.invoke('ai:saveDraftInput', sessionId, draftInput, workspacePath)
        .catch(err => console.error('[SessionTranscript] Failed to persist draft input:', err));
    }, 1000); // 1 second debounce

    return () => clearTimeout(timeoutId);
  }, [sessionId, draftInput, workspacePath]);

  // Prompt history navigation via Jotai atoms
  const navigateHistory = useSetAtom(navigateSessionHistoryAtom);
  const resetHistory = useSetAtom(resetSessionHistoryAtom);

  // Show prompt additions setting (dev mode only)
  const showPromptAdditions = useAtomValue(showPromptAdditionsAtom);

  // File action atoms
  const hasExternalEditor = useAtomValue(hasExternalEditorAtom);
  const externalEditorName = useAtomValue(externalEditorNameAtom);
  const openInExternalEditor = useSetAtom(openInExternalEditorAtom);

  // Local state
  const [todos, setTodos] = useState<Todo[]>([]);
  const [pendingReviewFiles, setPendingReviewFiles] = useState<Set<string>>(new Set());
  // Prompt additions state (dev mode) - uses Jotai atom for persistence across navigation
  const [promptAdditions, setPromptAdditions] = useAtom(sessionPromptAdditionsAtom(sessionId));
  // Queued prompts - centralized in atom, updated by sessionTranscriptListeners
  const [queuedPrompts, setQueuedPrompts] = useAtom(sessionQueuedPromptsAtom(sessionId));

  // ============================================================
  // DB-derived pending prompts (durable across session switches/restarts)
  // ============================================================
  const pendingPrompts = useAtomValue(sessionPendingPromptsAtom(sessionId));
  const refreshPendingPrompts = useSetAtom(refreshPendingPromptsAtom);
  const respondToPrompt = useSetAtom(respondToPromptAtom);

  // Derived pending prompts for compatibility with existing UI components
  const pendingAskUserQuestionRaw = useAtomValue(sessionPendingQuestionAtom(sessionId));
  const pendingToolPermissionsRaw = useAtomValue(sessionPendingPermissionsAtom(sessionId));

  // Only show prompts that are at the end of the conversation
  // If the conversation has moved past the prompt, don't show the UI
  const lastMessageTimestamp = React.useMemo(() => {
    if (messages.length === 0) return 0;
    const lastMsg = messages[messages.length - 1];
    return lastMsg.timestamp || 0;
  }, [messages]);

  const pendingAskUserQuestion = React.useMemo(() => {
    if (!pendingAskUserQuestionRaw) return null;
    // Show only if the question was asked after the last message
    // (or within a reasonable tolerance for timing differences)
    const questionTimestamp = pendingAskUserQuestionRaw.timestamp || 0;
    if (questionTimestamp >= lastMessageTimestamp - 1000) {
      return pendingAskUserQuestionRaw;
    }
    return null;
  }, [pendingAskUserQuestionRaw, lastMessageTimestamp]);

  const pendingToolPermissions = React.useMemo(() => {
    // Filter to only show permissions that are at the end of conversation
    return pendingToolPermissionsRaw.filter(permission => {
      const permissionTimestamp = permission.timestamp || 0;
      return permissionTimestamp >= lastMessageTimestamp - 1000;
    });
  }, [pendingToolPermissionsRaw, lastMessageTimestamp]);

  // ExitPlanMode confirmation - DB-derived, updated by refreshPendingPromptsAtom
  const pendingExitPlanConfirmation = useAtomValue(sessionPendingExitPlanModeAtom(sessionId));

  // GitCommitProposal - DB-derived, updated by refreshPendingPromptsAtom
  const pendingGitCommitProposalElectron = useAtomValue(sessionPendingGitCommitProposalAtom(sessionId));

  // Error state - centralized in atom, updated by sessionTranscriptListeners
  const sessionError = useAtomValue(sessionErrorAtom(sessionId));

  // Track mode at last message send to detect mode transitions via toggle button
  const lastSentModeRef = useRef<AIMode | null>(null);

  // Track if we're currently queueing a message (prevents double-submission)
  const [isQueueing, setIsQueueing] = useState(false);

  // Diff tree grouping state
  const [groupByDirectory] = useAtom(diffTreeGroupByDirectoryAtom);
  const setDiffTreeGroupByDirectory = useSetAtom(setDiffTreeGroupByDirectoryAtom);

  // Agent mode settings (for persisting default model)
  const setAgentModeSettings = useSetAtom(setAgentModeSettingsAtom);

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
    if (!sessionData) {
      loadSessionData({ sessionId, workspacePath });
    }
  }, [sessionId, workspacePath, sessionData, loadSessionData]);

  // Initialize lastSentModeRef when session loads with existing messages
  // This ensures mode transitions are detected correctly for existing sessions
  useEffect(() => {
    if (sessionData && messages.length > 0 && lastSentModeRef.current === null) {
      lastSentModeRef.current = aiMode;
    }
  }, [sessionData, messages.length, aiMode]);

  // Sync git commit proposal from electron atom (DB-backed) to runtime atom
  // This makes the proposal available to GitCommitConfirmationWidget in runtime package
  useEffect(() => {
    store.set(setSessionGitCommitProposalAtom, {
      sessionId,
      proposal: pendingGitCommitProposalElectron,
    });
  }, [sessionId, pendingGitCommitProposalElectron]);

  // ============================================================
  // Auto-focus input when session data loads
  // ============================================================
  const hasFocusedRef = useRef(false);
  useEffect(() => {
    // Only focus once per session, and only after sessionData is available
    if (!sessionData || hasFocusedRef.current) return;
    hasFocusedRef.current = true;

    // Use setTimeout to ensure the DOM is ready after render
    // (RAF can be cancelled by rapid re-renders before it executes)
    setTimeout(() => {
      // console.log('[SessionTranscript] Auto-focusing input, inputRef:', inputRef.current);
      inputRef.current?.focus();
    }, 0);
  }, [sessionData]);

  // ============================================================
  // IPC events handled by centralized listeners (sessionStateListeners.ts, sessionTranscriptListeners.ts)
  // - ai:message-logged → sessionStateListeners reloads session data
  // - session:title-updated → sessionStateListeners updates sessionStoreAtom
  // - ai:tokenUsageUpdated → sessionTranscriptListeners updates sessionStoreAtom
  // - ai:error → sessionTranscriptListeners updates sessionErrorAtom
  // ============================================================
  const { confirm } = useDialog();

  // Handle errors from centralized atom
  useEffect(() => {
    if (!sessionError) return;

    const handleError = async () => {
      // For server errors (500, internal server error - Claude may be down)
      if (sessionError.isServerError) {
        await confirm({
          title: 'Service Error',
          message: [
            'Claude appears to be experiencing issues.',
            '',
            'This could be a temporary service disruption.',
            'Check the status page for more information:',
            '',
            'https://status.anthropic.com'
          ].join('\n'),
          confirmLabel: 'OK',
          cancelLabel: ''
        });
      }

      // For tool search errors (common with alternative AI providers like Bedrock)
      if (sessionError.isBedrockToolError) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const settingsShortcut = isMac ? 'Cmd+,' : 'Ctrl+,';
        await confirm({
          title: 'MCP Tool Configuration Required',
          message: [
            'Some alternative AI providers don\'t fully support deferred tool loading (tool search).',
            '',
            'To fix this:',
            `1. Open Settings (${settingsShortcut})`,
            '2. Go to "Claude Code" panel',
            '3. In the "Environment Variables" section, add:',
            '   ENABLE_TOOL_SEARCH = false',
            '4. Save and retry your request'
          ].join('\n'),
          confirmLabel: 'OK',
          cancelLabel: ''
        });
      }

      // Add error as an assistant message so user can see what went wrong
      const errorMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant' as const,
        content: `Error: ${sessionError.message}`,
        timestamp: Date.now(),
        isError: true,
      };
      updateSessionStore({
        sessionId,
        updates: {
          messages: [...(sessionData?.messages || []), errorMessage],
        },
      });
      setIsProcessing(false);

      // Clear the error from the atom after handling
      clearSessionError(sessionId);
    };

    handleError();
  }, [sessionError, sessionId, sessionData?.messages, updateSessionStore, setIsProcessing, confirm]);

  // Derived values
  const isLoading = isProcessing;
  const sessionHasMessages = (sessionData?.messages?.length ?? 0) > 0;
  const currentProviderType = sessionData?.provider === 'claude-code' ? 'agent' : 'model';

  // ============================================================
  // Confirmation dialogs (ExitPlanMode, AskUserQuestion, ToolPermission)
  // All prompts are DB-backed and derived from sessionPendingPromptsAtom
  // ============================================================

  // Register pending question in global store when it exists (for widget rendering)
  // The central listener (sessionStateListeners.ts) handles IPC events and refreshes atoms
  useEffect(() => {
    if (pendingAskUserQuestion) {
      registerPendingQuestion(pendingAskUserQuestion.questionId, sessionId);
    }
  }, [pendingAskUserQuestion, sessionId]);

  // Refresh pending prompts when session loads
  useEffect(() => {
    if (sessionId) {
      refreshPendingPrompts(sessionId);
    }
  }, [sessionId, refreshPendingPrompts]);

  // Note: ai:askUserQuestionAnswered handled by sessionStateListeners.ts
  // Note: ai:promptAdditions handled by sessionTranscriptListeners.ts

  // Clear prompt additions when dev mode is disabled
  useEffect(() => {
    if (!showPromptAdditions) {
      setPromptAdditions(null);
    }
  }, [showPromptAdditions, setPromptAdditions]);

  // ============================================================
  // Pending review files
  // ============================================================
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
        console.error('[SessionTranscript] Failed to fetch pending review files:', error);
      }
    };

    fetchPendingFiles();

    const unsubscribe = window.electronAPI?.history?.onPendingCleared?.(
      (data: { workspacePath: string }) => {
        if (data.workspacePath === workspacePath) fetchPendingFiles();
      }
    );

    const unsubscribeCount = window.electronAPI?.history?.onPendingCountChanged?.(
      (data: { workspacePath: string }) => {
        if (data.workspacePath === workspacePath) fetchPendingFiles();
      }
    );

    return () => {
      unsubscribe?.();
      unsubscribeCount?.();
    };
  }, [workspacePath, sessionId]);

  // ============================================================
  // Queued prompts - centralized in sessionTranscriptListeners.ts
  // ============================================================
  // Load initial queued prompts when session loads
  useEffect(() => {
    if (sessionId) {
      loadInitialQueuedPrompts(sessionId);
    }
  }, [sessionId]);

  // Reload queued prompts when AI finishes processing (in case any were added)
  const prevIsLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) {
      loadInitialQueuedPrompts(sessionId);
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, sessionId]);

  // Trigger queue processing when queuedPrompts change and AI is idle
  useEffect(() => {
    if (queuedPrompts.length > 0 && !isLoading && workspacePath) {
      window.electronAPI.invoke('ai:triggerQueueProcessing', sessionId, workspacePath)
        .catch(error => {
          console.error('[SessionTranscript] Failed to trigger queue processing:', error);
        });
    }
  }, [queuedPrompts.length, isLoading, sessionId, workspacePath]);

  // ============================================================
  // Todos
  // ============================================================
  useEffect(() => {
    const currentTodos = sessionData?.metadata?.currentTodos;
    if (Array.isArray(currentTodos)) {
      setTodos(currentTodos);
    } else {
      setTodos([]);
    }
  }, [sessionData?.metadata?.currentTodos]);

  // ============================================================
  // Expose ref methods
  // ============================================================
  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
  }));

  // ============================================================
  // Handlers
  // ============================================================
  const handleInputChange = useCallback((value: string) => {
    setDraftInput(value);
  }, [setDraftInput]);

  const handleAttachmentAdd = useCallback((attachment: ChatAttachment) => {
    setDraftAttachments(prev => [...prev, attachment]);
  }, [setDraftAttachments]);

  const handleAttachmentRemove = useCallback((attachmentId: string) => {
    setDraftAttachments(prev => prev.filter(a => a.id !== attachmentId));
  }, [setDraftAttachments]);

  const handleQueue = useCallback(async (message: string) => {
    if (!message.trim() || isQueueing) return;
    setIsQueueing(true);

    try {
      // Get fresh document context at queue time (reads from disk)
      const effectiveContext = await getEffectiveDocumentContext();
      const serializableContext = serializeDocumentContext(effectiveContext);

      const result = await window.electronAPI.invoke(
        'ai:createQueuedPrompt',
        sessionId,
        message.trim(),
        draftAttachments,
        serializableContext
      ) as { id: string; prompt: string; timestamp: number };

      setQueuedPrompts(prev => [...prev, {
        id: result.id,
        prompt: message.trim(),
        timestamp: result.timestamp,
        documentContext: serializableContext,
        attachments: draftAttachments
      }]);

      setDraftInput('');
      setDraftAttachments([]);
    } catch (error) {
      console.error('[SessionTranscript] Failed to queue prompt:', error);
    } finally {
      setIsQueueing(false);
    }
  }, [sessionId, getEffectiveDocumentContext, draftAttachments, setDraftInput, setDraftAttachments, isQueueing]);

  const handleSend = useCallback(async () => {
    if (!draftInput.trim() || !sessionData) return;

    if (isLoading) {
      handleQueue(draftInput.trim());
      return;
    }

    let message = draftInput.trim();
    const attachments = draftAttachments;

    // Intercept /plan command - strip it and switch to planning mode
    // Match "/plan" only when followed by whitespace or end of string (not "/planning" or "/planify")
    let overrideMode = aiMode;
    let includePlanModeInstructions = false;
    let includePlanModeDeactivation = false;
    const planCommandMatch = message.match(/^\/plan(?:\s|$)/);

    if (planCommandMatch) {
      overrideMode = 'planning';
      // Remove /plan from the message, keeping the rest
      message = message.slice(planCommandMatch[0].length).trim();

      // Always include plan mode instructions when switching to planning mode
      includePlanModeInstructions = true;

      // Update mode in atom and session metadata - must succeed before proceeding
      setAiMode('planning');
      try {
        await window.electronAPI.invoke('sessions:update-metadata', sessionId, { mode: 'planning' });
      } catch (error) {
        console.error('[SessionTranscript] Failed to update session mode:', error);
        // Revert local state since persistence failed
        setAiMode(aiMode);
        // Show error to user
        const errorMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant' as const,
          content: 'Failed to switch to planning mode. Please try again.',
          timestamp: Date.now(),
          isError: true,
        };
        updateSessionStore({
          sessionId,
          updates: {
            messages: [...messages, errorMessage],
          },
        });
        return;
      }

      // If no message after /plan, don't send (just switched mode)
      if (!message) {
        setDraftInput('');
        setDraftAttachments([]);
        return;
      }
    } else {
      // Check if we're in planning mode - always include instructions for first message or mode transition
      if (overrideMode === 'planning') {
        // Include plan mode instructions if:
        // 1. First message of session (messages.length === 0)
        // 2. Mode transition from agent to planning (lastSentModeRef was agent)
        if (messages.length === 0 || (lastSentModeRef.current !== null && lastSentModeRef.current === 'agent')) {
          includePlanModeInstructions = true;
        }
      } else if (overrideMode === 'agent') {
        // Check for mode transition from planning to agent
        if (lastSentModeRef.current !== null && lastSentModeRef.current === 'planning') {
          includePlanModeDeactivation = true;
        }
      }
    }

    // Intercept /implement command - switch to agent mode if in planning mode
    // This allows the /implement command (or nimbalyst-planning:implement) to actually code
    // Match both "/implement" and "/nimbalyst-planning:implement" followed by space or end
    const implementCommandMatch = message.match(/^\/(nimbalyst-planning:)?implement(?:\s|$)/);
    if (implementCommandMatch && overrideMode === 'planning') {
      // Switch to agent mode for implementation
      overrideMode = 'agent';
      setAiMode('agent');
      try {
        await window.electronAPI.invoke('sessions:update-metadata', sessionId, { mode: 'agent' });
      } catch (error) {
        console.error('[SessionTranscript] Failed to update session mode for implement:', error);
        // Continue anyway - the command should still work even if mode update fails
      }
      // Signal mode transition from planning to agent
      includePlanModeDeactivation = true;
    }

    // Intercept /clear command - create new session attached to current
    const clearCommandMatch = message.match(/^\/clear(?:\s|$)/);
    if (clearCommandMatch) {
      // Clear the draft input immediately
      setDraftInput('');
      setDraftAttachments([]);

      if (mode === 'chat') {
        // Files mode: Create a new standalone session (same as +new button)
        onClearSession?.();
      } else {
        // Agent mode: Let parent component handle session creation
        // (handles worktree sessions, workstreams, and single sessions properly)
        onClearAgentSession?.();
      }
      return; // Don't send the /clear message to the AI
    }

    // If in planning mode, append plan mode instructions with full details
    // Wrapped in NIMBALYST_SYSTEM_MESSAGE to hide from UI but still send to AI
    if (includePlanModeInstructions) {
      message = `${message}\n\n${buildPlanModeInstructions()}`;
    }

    // If switching to agent mode, append plan mode deactivation message
    // Wrapped in NIMBALYST_SYSTEM_MESSAGE to hide from UI but still send to AI
    if (includePlanModeDeactivation) {
      message = `${message}\n\n<NIMBALYST_SYSTEM_MESSAGE>\n${PLAN_MODE_DEACTIVATION}\n</NIMBALYST_SYSTEM_MESSAGE>`;
    }

    setDraftInput('');
    setDraftAttachments([]);
    resetHistory(sessionId); // Reset prompt history navigation
    // Optimistically set processing state - will be confirmed by session:started event
    setIsProcessing(true);

    // Track the mode at send time for detecting future mode transitions via toggle
    lastSentModeRef.current = overrideMode;

    const userMessage = {
      id: `msg-${Date.now()}`,
      role: 'user' as const,
      content: message,
      timestamp: Date.now(),
      mode: overrideMode,
    };
    updateSessionStore({
      sessionId,
      updates: {
        messages: [...messages, userMessage],
      },
    });

    try {
      // Get fresh document context at send time (reads from disk)
      const effectiveContext = await getEffectiveDocumentContext();

      // Always send full document content - backend handles diff optimization
      const docContext = {
        ...serializeDocumentContext(effectiveContext),
        attachments: attachments.length > 0 ? attachments : undefined,
        mode: overrideMode,
      };

      await window.electronAPI.invoke('ai:sendMessage', message, docContext, sessionId, workspacePath);
    } catch (error) {
      console.error('[SessionTranscript] Failed to send message:', error);
      // Show error in transcript so user knows what went wrong
      const errorMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant' as const,
        content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
        timestamp: Date.now(),
        isError: true,
      };
      updateSessionStore({
        sessionId,
        updates: {
          messages: [...messages, userMessage, errorMessage],
        },
      });
      setIsProcessing(false);
    }
  }, [sessionId, sessionData, draftInput, draftAttachments, isLoading, getEffectiveDocumentContext, aiMode, workspacePath, setDraftInput, setDraftAttachments, resetHistory, updateSessionStore, handleQueue, setIsProcessing, messages, mode, onClearSession, onClearAgentSession]);

  const handleCancel = useCallback(async () => {
    try {
      await window.electronAPI.invoke('ai:cancelRequest', sessionId);
      // Note: session:interrupted event will also set this to false via sessionStateListeners
      setIsProcessing(false);
    } catch (error) {
      console.error('[SessionTranscript] Failed to cancel request:', error);
    }
  }, [sessionId, setIsProcessing]);

  const handleFileClick = useCallback((filePath: string) => {
    onFileClick?.(filePath);
  }, [onFileClick]);

  const handleOpenInExternalEditor = useCallback((filePath: string) => {
    openInExternalEditor(filePath);
  }, [openInExternalEditor]);

  const handleCompact = useCallback(async () => {
    if (!sessionData) return;

    const message = '/compact';
    const userMessage = {
      id: `msg-${Date.now()}`,
      role: 'user' as const,
      content: message,
      timestamp: Date.now(),
      mode: aiMode,
    };
    updateSessionStore({
      sessionId,
      updates: {
        messages: [...messages, userMessage],
      },
    });

    try {
      // Get fresh document context at compact time (reads from disk)
      const effectiveContext = await getEffectiveDocumentContext();
      const docContext = {
        ...serializeDocumentContext(effectiveContext),
        mode: aiMode,
      };

      await window.electronAPI.invoke('ai:sendMessage', message, docContext, sessionId, workspacePath);
    } catch (error) {
      console.error('[SessionTranscript] Failed to send /compact command:', error);
    }
  }, [sessionId, sessionData, messages, getEffectiveDocumentContext, aiMode, workspacePath, updateSessionStore]);

  const handleTodoClick = useCallback((todo: TodoItem) => {
    onTodoClick?.(todo);
  }, [onTodoClick]);

  const handleNavigateHistory = useCallback((direction: 'up' | 'down') => {
    navigateHistory({ sessionId, direction });
  }, [sessionId, navigateHistory]);

  const handleCancelQueuedPrompt = useCallback(async (id: string) => {
    try {
      await window.electronAPI.invoke('ai:deleteQueuedPrompt', id);
      setQueuedPrompts(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      console.error('[SessionTranscript] Failed to cancel queued prompt:', error);
    }
  }, []);

  const handleEditQueuedPrompt = useCallback(async (id: string, prompt: string) => {
    try {
      await window.electronAPI.invoke('ai:deleteQueuedPrompt', id);
      setQueuedPrompts(prev => prev.filter(p => p.id !== id));
      setDraftInput(prompt);
      inputRef.current?.focus();
    } catch (error) {
      console.error('[SessionTranscript] Failed to edit queued prompt:', error);
    }
  }, [setDraftInput]);

  const handleCloseAndArchive = useCallback(async () => {
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: true });
      setIsArchived(true);
      onCloseAndArchive?.(sessionId);
    } catch (error) {
      console.error('[SessionTranscript] Failed to archive session:', error);
    }
  }, [sessionId, setIsArchived, onCloseAndArchive]);

  const handleUnarchive = useCallback(async () => {
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: false });
      setIsArchived(false);
    } catch (error) {
      console.error('[SessionTranscript] Failed to unarchive session:', error);
    }
  }, [sessionId, setIsArchived]);

  const handleAIModeChange = useCallback(async (newMode: AIMode) => {
    setAiMode(newMode);
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { mode: newMode });
    } catch (error) {
      console.error('[SessionTranscript] Failed to update mode:', error);
    }
  }, [sessionId, setAiMode]);

  const handleModelChange = useCallback(async (modelId: string) => {
    setCurrentModel(modelId);
    // Save as the default model for new sessions
    setAgentModeSettings({ defaultModel: modelId });
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { model: modelId });
    } catch (error) {
      console.error('[SessionTranscript] Failed to update model:', error);
    }
  }, [sessionId, setCurrentModel, setAgentModeSettings]);

  const handleCommandSelect = useCallback((command: string) => {
    setDraftInput(command);
    inputRef.current?.focus();
  }, [setDraftInput]);

  // Confirmation handlers
  const handleExitPlanModeApprove = useCallback(async (requestId: string, confirmSessionId: string) => {
    try {
      // Use the unified respondToPromptAtom which persists to DB and notifies provider
      const success = await respondToPrompt({
        sessionId: confirmSessionId,
        promptId: requestId,
        promptType: 'exit_plan_mode_request',
        response: { approved: true },
      });

      if (success) {
        setAiMode('agent');

        // Track exit plan mode response
        posthog?.capture('exit_plan_mode_response', {
          decision: 'approved',
        });
      }
    } catch (error) {
      console.error('[SessionTranscript] Failed to send ExitPlanMode approval:', error);
    }
  }, [respondToPrompt, setAiMode, posthog]);

  const handleExitPlanModeDeny = useCallback(async (requestId: string, confirmSessionId: string, feedback?: string) => {
    try {
      // Use the unified respondToPromptAtom which persists to DB and notifies provider
      await respondToPrompt({
        sessionId: confirmSessionId,
        promptId: requestId,
        promptType: 'exit_plan_mode_request',
        response: { approved: false, feedback },
      });

      // Track exit plan mode response
      posthog?.capture('exit_plan_mode_response', {
        decision: 'denied',
        has_feedback: !!feedback,
      });
    } catch (error) {
      console.error('[SessionTranscript] Failed to send ExitPlanMode denial:', error);
    }
  }, [respondToPrompt, posthog]);

  // Handler for "Start new session to implement" option
  // Creates a new session with the plan file as context and sets up the implementation prompt
  // For worktree sessions: creates a new session in the same worktree (no parent-child hierarchy)
  // For regular sessions: creates a workstream hierarchy (converts to workstream if needed)
  const handleExitPlanModeStartNewSession = useCallback(async (requestId: string, confirmSessionId: string, planFilePath: string) => {
    try {
      // First approve the ExitPlanMode so Claude finishes
      const success = await respondToPrompt({
        sessionId: confirmSessionId,
        promptId: requestId,
        promptType: 'exit_plan_mode_request',
        response: { approved: true },
      });

      if (!success) {
        console.error('[SessionTranscript] Failed to approve ExitPlanMode for new session');
        return;
      }

      setAiMode('agent');

      // Track exit plan mode response
      posthog?.capture('exit_plan_mode_response', {
        decision: 'start_new_session',
        is_worktree: !!worktreeId,
      });

      let newSessionId: string | null = null;

      // Check if we're in a worktree session
      if (worktreeId && onCreateWorktreeSession) {
        // Worktree sessions: create a new session in the same worktree (NOT a workstream)
        // This avoids creating workstreams-within-worktrees which is not supported
        console.log('[SessionTranscript] Creating new session in worktree:', worktreeId);
        newSessionId = await onCreateWorktreeSession(worktreeId);
      } else {
        // Regular sessions: use workstream hierarchy logic
        const hasChildren = sessionChildren.length > 0;

        if (hasChildren || sessionParentId) {
          // Already part of a workstream hierarchy - create a child of the appropriate parent
          // If sessionParentId exists, we're a child session - create sibling under the same parent
          // If hasChildren, we're the root - create child under us
          const parentId = sessionParentId || confirmSessionId;
          newSessionId = await createChildSession({
            parentSessionId: parentId,
            workspacePath: workspacePath || '',
            provider: 'claude-code',
            model: defaultModel,
          });
        } else {
          // Single session - convert to workstream first, which creates a sibling session
          const result = await convertToWorkstream({
            sessionId: confirmSessionId,
            workspacePath: workspacePath || '',
            model: defaultModel,
          });
          if (result?.siblingId) {
            newSessionId = result.siblingId;
          }
        }
      }

      if (newSessionId) {
        // Construct absolute plan path
        const basePath = sessionData?.worktreePath || workspacePath;
        const absolutePlanPath = planFilePath.startsWith('/')
          ? planFilePath
          : `${basePath}/${planFilePath}`;

        // Save the draft input as an instruction to implement the plan
        // This matches Claude Code's ExitPlanMode flow - reference the plan file for context
        const implementationPrompt = `Implement the plan at ${absolutePlanPath}. Start with updating your todo list if applicable.`;

        // 1. Update the atom directly for immediate display when the new session mounts
        store.set(sessionDraftInputAtom(newSessionId), implementationPrompt);

        // 2. Persist to database for durability (async, no need to await)
        window.electronAPI.invoke('ai:saveDraftInput', newSessionId, implementationPrompt, workspacePath)
          .catch(err => console.error('[SessionTranscript] Failed to persist draft input:', err));

        console.log('[SessionTranscript] Created new session for implementation:', newSessionId, 'with prompt:', implementationPrompt);

        // The atom operations (createChildSession/convertToWorkstream/onCreateWorktreeSession) already update:
        // - sessionActiveChildAtom (sets new session as active)
        // - setSelectedWorkstreamAtom (navigates to workstream/worktree)
        // - workstreamState atoms
        // So the parent components will automatically switch to the new session
      }
    } catch (error) {
      console.error('[SessionTranscript] Failed to start new session for implementation:', error);
    }
  }, [setAiMode, sessionChildren, sessionParentId, workspacePath, worktreeId, onCreateWorktreeSession, createChildSession, convertToWorkstream, sessionData?.worktreePath, posthog]);

  const handleExitPlanModeCancel = useCallback(async (requestId: string, confirmSessionId: string) => {
    try {
      // Mark the prompt as cancelled in DB so it doesn't reappear
      await respondToPrompt({
        sessionId: confirmSessionId,
        promptId: requestId,
        promptType: 'exit_plan_mode_request',
        response: { approved: false, cancelled: true },
      });

      // Cancel the entire agent session - this will abort the waiting ExitPlanMode request
      await window.electronAPI.invoke('ai:cancelRequest', confirmSessionId);

      // Track cancellation
      posthog?.capture('exit_plan_mode_response', {
        decision: 'cancelled',
      });
    } catch (error) {
      console.error('[SessionTranscript] Failed to cancel ExitPlanMode:', error);
    }
  }, [respondToPrompt, posthog]);

  const handleAskUserQuestionSubmit = useCallback(async (questionId: string, confirmSessionId: string, answers: Record<string, string>) => {
    storeAskUserQuestionAnswers(answers);
    // Clear from global Jotai store so widget can render as completed
    clearPendingQuestionForSession(confirmSessionId);

    // Try to answer via SDK first
    const result = await window.electronAPI.invoke('claude-code:answer-question', { questionId, answers }) as { success: boolean; error?: string };

    // Refresh pending prompts from DB (clears the answered question)
    refreshPendingPrompts(confirmSessionId);

    if (!result.success) {
      // SDK doesn't have this question anymore (session was interrupted)
      // Fall back to sending answers as a plain text message to continue the conversation
      console.log('[SessionTranscript] SDK question not found, sending answers as message:', result.error);
      const answersText = Object.entries(answers)
        .map(([q, a]) => `${q}: ${a}`)
        .join('\n');
      // Send as a simple user message - the AI will understand this is in response to its questions
      const fallbackMessage = `Here are my answers to your questions:\n\n${answersText}`;

      try {
        await window.electronAPI.invoke('ai:sendMessage', fallbackMessage, { mode: aiMode }, confirmSessionId, workspacePath);
      } catch (sendError) {
        console.error('[SessionTranscript] Failed to send fallback message:', sendError);
      }
    }
  }, [aiMode, workspacePath, refreshPendingPrompts]);

  const handleAskUserQuestionCancel = useCallback(async (questionId: string, confirmSessionId: string) => {
    // Clear from global Jotai store
    clearPendingQuestionForSession(confirmSessionId);

    // Try SDK cancel (might fail for old/inactive sessions - that's OK)
    try {
      await window.electronAPI.invoke('claude-code:cancel-question', { questionId });
    } catch (error) {
      // Debug logging - uncomment if needed
      // console.log('[SessionTranscript] SDK cancel failed (session may be inactive):', error);
    }

    // Always mark as cancelled in DB so it doesn't reappear
    // This creates a response message which the pending query will see
    await respondToPrompt({
      sessionId: confirmSessionId,
      promptId: questionId,
      promptType: 'ask_user_question_request',
      response: { cancelled: true },
    });

    // Refresh pending prompts from DB
    refreshPendingPrompts(confirmSessionId);
  }, [refreshPendingPrompts, respondToPrompt]);

  const getToolCategory = useCallback((pattern: string): string => {
    if (pattern.startsWith('Bash')) return 'bash';
    if (pattern.startsWith('WebFetch')) return 'webfetch';
    if (pattern.startsWith('mcp__')) return 'mcp';
    if (['Edit', 'Write', 'Read', 'Glob', 'Grep'].includes(pattern)) return 'file';
    return 'other';
  }, []);

  const handleToolPermissionSubmit = useCallback(async (
    requestId: string,
    confirmSessionId: string,
    response: { decision: 'allow' | 'deny'; scope: 'once' | 'session' | 'always' | 'always-all' }
  ) => {
    const requestData = pendingToolPermissions.find(p => p.requestId === requestId);
    const firstPattern = requestData?.request.actionsNeedingApproval[0]?.action.pattern;

    try {
      await window.electronAPI.invoke('claude-code:answer-tool-permission', {
        requestId,
        sessionId: confirmSessionId,
        response
      });

      posthog?.capture('tool_permission_responded', {
        decision: response.decision,
        scope: response.scope,
        toolCategory: firstPattern ? getToolCategory(firstPattern) : 'unknown',
      });

      // Refresh pending prompts from DB (clears the answered permission)
      refreshPendingPrompts(confirmSessionId);
    } catch (error) {
      console.error('[SessionTranscript] Failed to submit tool permission response:', error);
    }
  }, [pendingToolPermissions, posthog, getToolCategory, refreshPendingPrompts]);

  const handleToolPermissionCancel = useCallback(async (requestId: string, confirmSessionId: string) => {
    // Try SDK cancel (might fail for old/inactive sessions - that's OK)
    try {
      await window.electronAPI.invoke('claude-code:cancel-tool-permission', {
        requestId,
        sessionId: confirmSessionId
      });
    } catch (error) {
      // Debug logging - uncomment if needed
      // console.log('[SessionTranscript] SDK cancel failed (session may be inactive):', error);
    }

    // Always mark as cancelled in DB so it doesn't reappear
    await respondToPrompt({
      sessionId: confirmSessionId,
      promptId: requestId,
      promptType: 'permission_request',
      response: { decision: 'deny', scope: 'once', cancelled: true },
    });

    // Refresh pending prompts from DB
    refreshPendingPrompts(confirmSessionId);
  }, [refreshPendingPrompts, respondToPrompt]);

  // Feature flags
  const enableSlashCommands = sessionData?.provider === 'claude-code';
  const enableAttachments = true;
  const enableHistoryNavigation = true;

  // Last user message timestamp for mockup annotation indicator
  const lastUserMessageTimestamp = React.useMemo(() => {
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return null;
    return userMessages[userMessages.length - 1].timestamp || null;
  }, [messages]);

  // Slash command suggestions for empty sessions
  const renderEmptyExtra = React.useCallback(() => {
    if (provider !== 'claude-code' || messages.length > 0) {
      return null;
    }
    return (
      <SlashCommandSuggestions
        provider={provider}
        hasMessages={messages.length > 0}
        workspacePath={workspacePath}
        sessionId={sessionId}
        onCommandSelect={handleCommandSelect}
      />
    );
  }, [provider, messages.length, workspacePath, sessionId, handleCommandSelect]);

  // Loading state
  if (!sessionData) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--nim-text-muted)',
        }}
        data-session-id={sessionId}
      >
        {isDataLoading ? 'Loading session...' : 'Session not found'}
      </div>
    );
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}
      data-session-id={sessionId}
    >
      {/* Main transcript area - hidden when collapsed */}
      {!collapseTranscript && (
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <AgentTranscriptPanel
            sessionId={sessionId}
            sessionData={sessionData}
            todos={todos}
            isProcessing={isLoading}
            onFileClick={handleFileClick}
            hideSidebar={hideSidebar || mode === 'chat'}
            showFloatingActions={mode === 'agent'}
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
            onCloseAndArchive={handleCloseAndArchive}
            onUnarchive={handleUnarchive}
            readFile={readFile}
            renderFilesHeader={mode === 'agent' ? () => (
              <PendingReviewBanner workspacePath={workspacePath} sessionId={sessionId} />
            ) : undefined}
            pendingReviewFiles={pendingReviewFiles}
            groupByDirectory={groupByDirectory}
            onGroupByDirectoryChange={setGroupByDirectory}
            onOpenInExternalEditor={hasExternalEditor ? handleOpenInExternalEditor : undefined}
            externalEditorName={externalEditorName}
            onCompact={handleCompact}
            promptAdditions={promptAdditions}
          />
        </div>
      )}

      {/* Pending review banner - only in chat mode, hidden when collapsed */}
      {mode === 'chat' && !collapseTranscript && (
        <PendingReviewBanner workspacePath={workspacePath} sessionId={sessionId} />
      )}

      {/* Edited files gutter at bottom - only in chat mode, hidden when collapsed */}
      {mode === 'chat' && !collapseTranscript && (
        <FileGutter
          sessionId={sessionId}
          workspacePath={workspacePath}
          type="edited"
          onFileClick={handleFileClick}
          pendingReviewFiles={pendingReviewFiles}
        />
      )}

      {/* Queue display */}
      <PromptQueueList
        queue={queuedPrompts}
        onCancel={handleCancelQueuedPrompt}
        onEdit={handleEditQueuedPrompt}
      />

      {/* Confirmation dialogs */}
      {pendingExitPlanConfirmation && (
        <ExitPlanModeConfirmation
          data={pendingExitPlanConfirmation}
          workspacePath={workspacePath}
          worktreeId={worktreeId}
          onFileClick={handleFileClick}
          onApprove={handleExitPlanModeApprove}
          onStartNewSession={handleExitPlanModeStartNewSession}
          onDeny={handleExitPlanModeDeny}
          onCancel={handleExitPlanModeCancel}
        />
      )}

      {pendingAskUserQuestion && (
        <AskUserQuestionConfirmation
          key={pendingAskUserQuestion.questionId}
          data={pendingAskUserQuestion}
          onSubmit={handleAskUserQuestionSubmit}
          onCancel={handleAskUserQuestionCancel}
        />
      )}

      {pendingToolPermissions.map(permission => (
        <ToolPermissionConfirmation
          key={permission.requestId}
          data={permission}
          onSubmit={handleToolPermissionSubmit}
          onCancel={handleToolPermissionCancel}
        />
      ))}

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
        tokenUsage={tokenUsage}
        provider={provider}
        onQueue={handleQueue}
        queueCount={queuedPrompts.length}
        currentFilePath={currentFilePath}
        lastUserMessageTimestamp={lastUserMessageTimestamp}
      />
    </div>
  );
});

SessionTranscript.displayName = 'SessionTranscript';
