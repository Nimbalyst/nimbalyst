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
import type { SessionData, ChatAttachment } from '@nimbalyst/runtime/ai/server/types';
import { AIInput, AIInputRef } from './AIInput';
import { PromptQueueList } from './PromptQueueList';
import { FileGutter } from '../AIChat/FileGutter';
import { PendingReviewBanner } from '../AIChat/PendingReviewBanner';
import type { AIMode } from './ModeTag';
import { ExitPlanModeConfirmation, ExitPlanModeConfirmationData } from './ExitPlanModeConfirmation';
import { AskUserQuestionConfirmation, AskUserQuestionData } from './AskUserQuestionConfirmation';
import { ToolPermissionConfirmation, ToolPermissionData } from './ToolPermissionConfirmation';
import { SlashCommandSuggestions } from './SlashCommandSuggestions';
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
  reloadSessionDataAtom,
  updateSessionStoreAtom,
  navigateSessionHistoryAtom,
  resetSessionHistoryAtom,
  createChildSessionAtom,
  sessionChildrenAtom,
  sessionParentIdAtom,
} from '../../store';
import { convertToWorkstreamAtom } from '../../store/atoms/sessions';
import { usePostHog } from 'posthog-js/react';
import { setAgentModeSettingsAtom, showPromptAdditionsAtom } from '../../store/atoms/appSettings';

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

  // Click handlers
  onFileClick?: (filePath: string) => void;
  onTodoClick?: (todo: TodoItem) => void;

  // Archive callbacks
  onCloseAndArchive?: (sessionId: string) => void;
  onSessionTitleChanged?: (sessionId: string, title: string) => void;

  // Document context (for chat mode where parent provides it)
  documentContext?: {
    filePath?: string;
    content?: string;
    fileType?: string;
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
 * SessionTranscript - Fully encapsulated transcript + input for one session
 */
export const SessionTranscript = forwardRef<SessionTranscriptRef, SessionTranscriptProps>(({
  sessionId,
  workspacePath,
  mode,
  hideSidebar = false,
  onFileClick,
  onTodoClick,
  onCloseAndArchive,
  onSessionTitleChanged,
  documentContext,
}, ref) => {
  const posthog = usePostHog();
  const inputRef = useRef<AIInputRef>(null);

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
  const reloadSessionData = useSetAtom(reloadSessionDataAtom);
  const updateSessionStore = useSetAtom(updateSessionStoreAtom);

  // Child session creation for "start new session" option
  const createChildSession = useSetAtom(createChildSessionAtom);
  const convertToWorkstream = useSetAtom(convertToWorkstreamAtom);
  const sessionChildren = useAtomValue(sessionChildrenAtom(sessionId));
  const sessionParentId = useAtomValue(sessionParentIdAtom(sessionId));

  // Still need full sessionData for certain operations (updating, checking loaded state)
  const sessionData = useAtomValue(sessionStoreAtom(sessionId));

  // Draft input state via Jotai atoms - only this component re-renders on typing
  const [draftInput, setDraftInput] = useAtom(sessionDraftInputAtom(sessionId));
  const [draftAttachments, setDraftAttachments] = useAtom(sessionDraftAttachmentsAtom(sessionId));

  // Prompt history navigation via Jotai atoms
  const navigateHistory = useSetAtom(navigateSessionHistoryAtom);
  const resetHistory = useSetAtom(resetSessionHistoryAtom);

  // Show prompt additions setting (dev mode only)
  const showPromptAdditions = useAtomValue(showPromptAdditionsAtom);

  // Local state
  const [todos, setTodos] = useState<Todo[]>([]);
  const [queuedPrompts, setQueuedPrompts] = useState<any[]>([]);
  const [pendingExitPlanConfirmation, setPendingExitPlanConfirmation] = useState<ExitPlanModeConfirmationData | null>(null);
  const [pendingAskUserQuestion, setPendingAskUserQuestion] = useState<AskUserQuestionData | null>(null);
  const [pendingToolPermissions, setPendingToolPermissions] = useState<ToolPermissionData[]>([]);
  const [pendingReviewFiles, setPendingReviewFiles] = useState<Set<string>>(new Set());
  const [promptAdditions, setPromptAdditions] = useState<{
    systemPromptAddition: string | null;
    userMessageAddition: string | null;
    timestamp: number;
  } | null>(null);

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

  // ============================================================
  // Subscribe to IPC events for session updates
  // ============================================================
  useEffect(() => {
    if (!sessionId || !window.electronAPI?.on) return;

    const handleMessageLogged = (data: { sessionId: string; direction: string }) => {
      if (data.sessionId !== sessionId) return;
      // Reload on both input and output messages to ensure we stay in sync
      reloadSessionData({ sessionId, workspacePath });
      // Note: processing state is managed by sessionProcessingAtom via sessionStateListeners
    };

    const handleTitleUpdated = (data: { sessionId: string; title: string }) => {
      if (data.sessionId === sessionId && sessionData) {
        updateSessionStore({ sessionId, updates: { title: data.title } });
        onSessionTitleChanged?.(sessionId, data.title);
      }
    };

    const handleTokenUsageUpdated = (data: { sessionId: string; tokenUsage: any }) => {
      if (data.sessionId === sessionId && sessionData) {
        updateSessionStore({ sessionId, updates: { tokenUsage: data.tokenUsage } });
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
  }, [sessionId, workspacePath, sessionData, reloadSessionData, updateSessionStore, onSessionTitleChanged]);

  // ============================================================
  // Subscribe to error events to show errors in the transcript
  // ============================================================
  useEffect(() => {
    if (!sessionId || !window.electronAPI?.on) return;

    const handleError = (data: { sessionId: string; message: string }) => {
      if (data.sessionId !== sessionId) return;

      // Add error as an assistant message so user can see what went wrong
      const errorMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant' as const,
        content: `Error: ${data.message}`,
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
    };

    const cleanup = window.electronAPI.on('ai:error', handleError);
    return () => { cleanup?.(); };
  }, [sessionId, sessionData?.messages, updateSessionStore, setIsProcessing]);

  // Derived values
  const isLoading = isProcessing;
  const sessionHasMessages = (sessionData?.messages?.length ?? 0) > 0;
  const currentProviderType = sessionData?.provider === 'claude-code' ? 'agent' : 'model';

  // ============================================================
  // Confirmation dialogs (ExitPlanMode, AskUserQuestion, ToolPermission)
  // ============================================================

  // Restore pending ExitPlanMode confirmation from session metadata on load
  useEffect(() => {
    const metadata = sessionData?.metadata as Record<string, unknown> | undefined;
    console.log('[SessionTranscript] Checking for saved ExitPlanMode confirmation:', {
      sessionId,
      hasMetadata: !!metadata,
      metadataKeys: metadata ? Object.keys(metadata) : [],
      pendingExitPlanConfirmation: metadata?.pendingExitPlanConfirmation
    });
    const savedConfirmation = metadata?.pendingExitPlanConfirmation as ExitPlanModeConfirmationData | undefined;
    if (savedConfirmation && savedConfirmation.sessionId === sessionId) {
      console.log('[SessionTranscript] Restoring saved ExitPlanMode confirmation:', savedConfirmation);
      setPendingExitPlanConfirmation(savedConfirmation);
    }
  }, [sessionId, sessionData?.metadata]);

  useEffect(() => {
    const handleExitPlanModeConfirm = async (data: ExitPlanModeConfirmationData) => {
      if (data.sessionId === sessionId) {
        console.log('[SessionTranscript] Received ExitPlanMode confirmation:', data);
        setPendingExitPlanConfirmation(data);
        // Persist to session metadata so it survives refresh
        try {
          console.log('[SessionTranscript] Persisting ExitPlanMode confirmation to metadata...');
          const result = await window.electronAPI.invoke('sessions:update-metadata', sessionId, {
            metadata: { pendingExitPlanConfirmation: data }
          });
          console.log('[SessionTranscript] Persist result:', result);

          // Also update local session store so it's immediately available
          if (sessionData) {
            updateSessionStore({
              sessionId,
              updates: {
                metadata: {
                  ...(sessionData.metadata as Record<string, unknown> || {}),
                  pendingExitPlanConfirmation: data
                }
              }
            });
          }
        } catch (error) {
          console.error('[SessionTranscript] Failed to persist ExitPlanMode confirmation:', error);
        }
      }
    };
    const cleanup = window.electronAPI.on('ai:exitPlanModeConfirm', handleExitPlanModeConfirm);
    return () => { cleanup?.(); };
  }, [sessionId, sessionData, updateSessionStore]);

  useEffect(() => {
    const handleAskUserQuestion = (data: AskUserQuestionData) => {
      if (data.sessionId === sessionId) {
        setPendingAskUserQuestion(prev => {
          if (prev && prev.questionId === data.questionId) return prev;
          return data;
        });
      }
    };
    const cleanup = window.electronAPI.on('ai:askUserQuestion', handleAskUserQuestion);
    return () => { cleanup?.(); };
  }, [sessionId]);

  useEffect(() => {
    const handleAskUserQuestionAnswered = (data: { questionId: string; sessionId: string; answers: Record<string, string> }) => {
      if (data.sessionId === sessionId) {
        storeAskUserQuestionAnswers(data.answers);
      }
    };
    const cleanup = window.electronAPI.on('ai:askUserQuestionAnswered', handleAskUserQuestionAnswered);
    return () => { cleanup?.(); };
  }, [sessionId]);

  useEffect(() => {
    const handleSessionCancelled = (data: { sessionId: string }) => {
      if (data.sessionId === sessionId) {
        setPendingAskUserQuestion(null);
      }
    };
    const cleanup = window.electronAPI.on('ai:sessionCancelled', handleSessionCancelled);
    return () => { cleanup?.(); };
  }, [sessionId]);

  useEffect(() => {
    const handleToolPermission = (data: ToolPermissionData) => {
      if (data.sessionId === sessionId) {
        setPendingToolPermissions(prev => {
          if (prev.some(p => p.requestId === data.requestId)) return prev;
          return [...prev, data];
        });
      }
    };
    const cleanup = window.electronAPI.on('ai:toolPermission', handleToolPermission);
    return () => { cleanup?.(); };
  }, [sessionId]);

  useEffect(() => {
    const handleToolPermissionResolved = (data: { requestId: string; sessionId: string }) => {
      if (data.sessionId === sessionId) {
        setPendingToolPermissions(prev => prev.filter(p => p.requestId !== data.requestId));
      }
    };
    const cleanup = window.electronAPI.on('ai:toolPermissionResolved', handleToolPermissionResolved);
    return () => { cleanup?.(); };
  }, [sessionId]);

  // ============================================================
  // Prompt additions (dev mode debugging)
  // ============================================================
  useEffect(() => {
    if (!showPromptAdditions) {
      setPromptAdditions(null);
      return;
    }

    const handlePromptAdditions = (data: {
      sessionId: string;
      systemPromptAddition: string | null;
      userMessageAddition: string | null;
      timestamp: number;
    }) => {
      if (data.sessionId === sessionId) {
        setPromptAdditions({
          systemPromptAddition: data.systemPromptAddition,
          userMessageAddition: data.userMessageAddition,
          timestamp: data.timestamp
        });
      }
    };
    const cleanup = window.electronAPI.on('ai:promptAdditions', handlePromptAdditions);
    return () => { cleanup?.(); };
  }, [sessionId, showPromptAdditions]);

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
  // Queued prompts
  // ============================================================
  const loadQueuedPrompts = useCallback(async () => {
    try {
      const pending = await window.electronAPI.invoke('ai:listPendingPrompts', sessionId);
      setQueuedPrompts(pending || []);
    } catch (error) {
      console.error('[SessionTranscript] Failed to load queued prompts:', error);
      setQueuedPrompts([]);
    }
  }, [sessionId]);

  useEffect(() => {
    loadQueuedPrompts();
  }, [loadQueuedPrompts]);

  const prevIsLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) {
      loadQueuedPrompts();
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, loadQueuedPrompts]);

  useEffect(() => {
    const handleQueuedPromptsReceived = async (data: { sessionId: string }) => {
      if (data.sessionId === sessionId) {
        loadQueuedPrompts();
        // If AI is idle, trigger queue processing immediately
        if (!isLoading && workspacePath) {
          try {
            await window.electronAPI.invoke('ai:triggerQueueProcessing', sessionId, workspacePath);
          } catch (error) {
            console.error('[SessionTranscript] Failed to trigger queue processing:', error);
          }
        }
      }
    };
    const cleanup = window.electronAPI.on('ai:queuedPromptsReceived', handleQueuedPromptsReceived);
    return () => { cleanup?.(); };
  }, [sessionId, loadQueuedPrompts, isLoading, workspacePath]);

  useEffect(() => {
    const handlePromptClaimed = (event: CustomEvent<{ sessionId: string; promptId: string }>) => {
      if (event.detail.sessionId === sessionId) {
        setQueuedPrompts(prev => prev.filter(p => p.id !== event.detail.promptId));
      }
    };
    window.addEventListener('ai:promptClaimed', handlePromptClaimed as EventListener);
    return () => {
      window.removeEventListener('ai:promptClaimed', handlePromptClaimed as EventListener);
    };
  }, [sessionId]);

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
      const serializableContext = documentContext ? {
        filePath: documentContext.filePath,
        content: documentContext.content,
        fileType: documentContext.fileType
      } : undefined;

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
  }, [sessionId, documentContext, draftAttachments, setDraftInput, setDraftAttachments, isQueueing]);

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
    let prependPlanModeInstructions = false;
    const planCommandMatch = message.match(/^\/plan(?:\s|$)/);

    if (planCommandMatch) {
      overrideMode = 'planning';
      // Remove /plan from the message, keeping the rest
      message = message.slice(planCommandMatch[0].length).trim();

      // If this is a mid-session switch (there are already messages), flag to prepend instructions
      if (messages.length > 0 && aiMode !== 'planning') {
        prependPlanModeInstructions = true;
      }

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
    }

    // If switching to planning mode mid-session, prepend plan mode activation message
    if (prependPlanModeInstructions) {
      message = `<PLAN_MODE_ACTIVATED>
The user has activated plan mode. From this point forward, you are in PLANNING MODE ONLY.

You MUST NOT:
- Make any code edits (except to the plan file)
- Run any non-readonly tools
- Execute any commands
- Make any changes to the system

You MUST:
- Explore the codebase using Read, Glob, Grep tools
- Ask questions using AskUserQuestion to clarify requirements
- Write and iteratively update a plan file
- Call ExitPlanMode when ready for approval

The plan file path will be provided in the system prompt.
</PLAN_MODE_ACTIVATED>

${message}`;
    }

    setDraftInput('');
    setDraftAttachments([]);
    resetHistory(sessionId); // Reset prompt history navigation
    // Optimistically set processing state - will be confirmed by session:started event
    setIsProcessing(true);

    const userMessage = {
      id: `msg-${Date.now()}`,
      role: 'user' as const,
      content: message,
      timestamp: Date.now(),
    };
    updateSessionStore({
      sessionId,
      updates: {
        messages: [...messages, userMessage],
      },
    });

    try {
      const docContext = {
        filePath: documentContext?.filePath,
        content: documentContext?.content,
        fileType: documentContext?.fileType,
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
  }, [sessionId, sessionData, draftInput, draftAttachments, isLoading, documentContext, aiMode, workspacePath, setDraftInput, setDraftAttachments, resetHistory, updateSessionStore, handleQueue, setIsProcessing, messages]);

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

  const handleCompact = useCallback(async () => {
    if (!sessionData) return;

    const message = '/compact';
    const userMessage = {
      id: `msg-${Date.now()}`,
      role: 'user' as const,
      content: message,
      timestamp: Date.now(),
    };
    updateSessionStore({
      sessionId,
      updates: {
        messages: [...messages, userMessage],
      },
    });

    try {
      const docContext = {
        filePath: documentContext?.filePath,
        content: documentContext?.content,
        fileType: documentContext?.fileType,
        mode: aiMode,
      };

      await window.electronAPI.invoke('ai:sendMessage', message, docContext, sessionId, workspacePath);
    } catch (error) {
      console.error('[SessionTranscript] Failed to send /compact command:', error);
    }
  }, [sessionId, sessionData, messages, documentContext, aiMode, workspacePath, updateSessionStore]);

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
      await window.electronAPI.invoke('ai:exitPlanModeConfirmResponse', requestId, confirmSessionId, {
        approved: true
      });
      setPendingExitPlanConfirmation(null);
      setAiMode('agent');
      // Clear from persisted metadata
      await window.electronAPI.invoke('sessions:update-metadata', confirmSessionId, {
        metadata: { pendingExitPlanConfirmation: null }
      });
    } catch (error) {
      console.error('[SessionTranscript] Failed to send ExitPlanMode approval:', error);
    }
  }, [setAiMode]);

  const handleExitPlanModeDeny = useCallback(async (requestId: string, confirmSessionId: string, feedback?: string) => {
    try {
      await window.electronAPI.invoke('ai:exitPlanModeConfirmResponse', requestId, confirmSessionId, {
        approved: false,
        feedback
      });
      setPendingExitPlanConfirmation(null);
      // Clear from persisted metadata
      await window.electronAPI.invoke('sessions:update-metadata', confirmSessionId, {
        metadata: { pendingExitPlanConfirmation: null }
      });
    } catch (error) {
      console.error('[SessionTranscript] Failed to send ExitPlanMode denial:', error);
    }
  }, []);

  // Handler for "Start new session to implement" option
  // Creates a child session with the plan file as context and sets up the implementation prompt
  const handleExitPlanModeStartNewSession = useCallback(async (requestId: string, confirmSessionId: string, planFilePath: string) => {
    try {
      // First approve the ExitPlanMode so Claude finishes
      await window.electronAPI.invoke('ai:exitPlanModeConfirmResponse', requestId, confirmSessionId, {
        approved: true
      });
      setPendingExitPlanConfirmation(null);
      setAiMode('agent');
      // Clear from persisted metadata
      await window.electronAPI.invoke('sessions:update-metadata', confirmSessionId, {
        metadata: { pendingExitPlanConfirmation: null }
      });

      // Determine the parent session ID for creating a child
      // If we have a parent (we're already in a workstream), use that parent
      // Otherwise, use the current session as the parent (or convert to workstream)
      const hasChildren = sessionChildren.length > 0;
      let newSessionId: string | null = null;

      if (hasChildren || sessionParentId) {
        // Already part of a workstream hierarchy - create a child of the appropriate parent
        // If sessionParentId exists, we're a child session - create sibling under the same parent
        // If hasChildren, we're the root - create child under us
        const parentId = sessionParentId || confirmSessionId;
        newSessionId = await createChildSession({
          parentSessionId: parentId,
          workspacePath: workspacePath || '',
          provider: 'claude-code',
        });
      } else {
        // Single session - convert to workstream first, which creates a sibling session
        const result = await convertToWorkstream({
          sessionId: confirmSessionId,
          workspacePath: workspacePath || '',
        });
        if (result?.siblingId) {
          newSessionId = result.siblingId;
        }
      }

      if (newSessionId) {
        // Construct absolute plan path
        const basePath = sessionData?.worktreePath || workspacePath;
        const absolutePlanPath = planFilePath.startsWith('/')
          ? planFilePath
          : `${basePath}/${planFilePath}`;

        // Save the draft input as an instruction to implement the plan
        const implementationPrompt = `/implement ${absolutePlanPath}`;

        // 1. Update the atom directly for immediate display when the new session mounts
        store.set(sessionDraftInputAtom(newSessionId), implementationPrompt);

        // 2. Persist to database for durability (async, no need to await)
        window.electronAPI.invoke('ai:saveDraftInput', newSessionId, implementationPrompt, workspacePath)
          .catch(err => console.error('[SessionTranscript] Failed to persist draft input:', err));

        console.log('[SessionTranscript] Created new session for implementation:', newSessionId, 'with prompt:', implementationPrompt);

        // The atom operations (createChildSession/convertToWorkstream) already update:
        // - sessionActiveChildAtom (sets new session as active)
        // - setSelectedWorkstreamAtom (navigates to workstream)
        // - workstreamState atoms
        // So the parent components will automatically switch to the new session
      }
    } catch (error) {
      console.error('[SessionTranscript] Failed to start new session for implementation:', error);
    }
  }, [setAiMode, sessionChildren, sessionParentId, workspacePath, createChildSession, convertToWorkstream, sessionData?.worktreePath]);

  const handleAskUserQuestionSubmit = useCallback(async (questionId: string, confirmSessionId: string, answers: Record<string, string>) => {
    try {
      storeAskUserQuestionAnswers(answers);
      await window.electronAPI.invoke('claude-code:answer-question', { questionId, answers });
      setPendingAskUserQuestion(null);
    } catch (error) {
      console.error('[SessionTranscript] Failed to submit AskUserQuestion answers:', error);
    }
  }, []);

  const handleAskUserQuestionCancel = useCallback(async (questionId: string) => {
    try {
      await window.electronAPI.invoke('claude-code:cancel-question', { questionId });
      setPendingAskUserQuestion(null);
    } catch (error) {
      console.error('[SessionTranscript] Failed to cancel AskUserQuestion:', error);
      setPendingAskUserQuestion(null);
    }
  }, []);

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

      setPendingToolPermissions(prev => prev.filter(p => p.requestId !== requestId));
    } catch (error) {
      console.error('[SessionTranscript] Failed to submit tool permission response:', error);
    }
  }, [pendingToolPermissions, posthog, getToolCategory]);

  const handleToolPermissionCancel = useCallback(async (requestId: string, confirmSessionId: string) => {
    try {
      await window.electronAPI.invoke('claude-code:cancel-tool-permission', {
        requestId,
        sessionId: confirmSessionId
      });
      setPendingToolPermissions(prev => prev.filter(p => p.requestId !== requestId));
    } catch (error) {
      console.error('[SessionTranscript] Failed to cancel tool permission:', error);
      setPendingToolPermissions(prev => prev.filter(p => p.requestId !== requestId));
    }
  }, []);

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
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--nim-text-muted)',
      }}>
        {isDataLoading ? 'Loading session...' : 'Session not found'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      {/* Main transcript area */}
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
          onCompact={handleCompact}
          promptAdditions={promptAdditions}
        />
      </div>

      {/* Pending review banner - only in chat mode */}
      {mode === 'chat' && (
        <PendingReviewBanner workspacePath={workspacePath} sessionId={sessionId} />
      )}

      {/* Edited files gutter at bottom - only in chat mode */}
      {mode === 'chat' && (
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
        currentFilePath={documentContext?.filePath}
        lastUserMessageTimestamp={lastUserMessageTimestamp}
      />
    </div>
  );
});

SessionTranscript.displayName = 'SessionTranscript';
