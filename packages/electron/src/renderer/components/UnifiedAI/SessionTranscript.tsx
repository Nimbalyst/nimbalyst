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
  sessionDataAtom,
  sessionMessagesAtom,
  sessionProviderAtom,
  sessionTokenUsageAtom,
  sessionLoadingAtom,
  sessionModeAtom,
  sessionModelAtom,
  sessionArchivedAtom,
  sessionProcessingAtom,
  loadSessionDataAtom,
  reloadSessionDataAtom,
  updateSessionDataAtom,
} from '../../store';
import { usePostHog } from 'posthog-js/react';

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

  // History navigation (up/down arrow in input)
  onNavigateHistory?: (sessionId: string, direction: 'up' | 'down') => void;

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
  onNavigateHistory,
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
  const isProcessing = useAtomValue(sessionProcessingAtom(sessionId));
  const loadSessionData = useSetAtom(loadSessionDataAtom);
  const reloadSessionData = useSetAtom(reloadSessionDataAtom);
  const updateSessionData = useSetAtom(updateSessionDataAtom);

  // Still need full sessionData for certain operations (updating, checking loaded state)
  const sessionData = useAtomValue(sessionDataAtom(sessionId));

  // Draft input state via Jotai atoms - only this component re-renders on typing
  const [draftInput, setDraftInput] = useAtom(sessionDraftInputAtom(sessionId));
  const [draftAttachments, setDraftAttachments] = useAtom(sessionDraftAttachmentsAtom(sessionId));

  // Local state
  const [todos, setTodos] = useState<Todo[]>([]);
  const [queuedPrompts, setQueuedPrompts] = useState<any[]>([]);
  const [pendingExitPlanConfirmation, setPendingExitPlanConfirmation] = useState<ExitPlanModeConfirmationData | null>(null);
  const [pendingAskUserQuestion, setPendingAskUserQuestion] = useState<AskUserQuestionData | null>(null);
  const [pendingToolPermissions, setPendingToolPermissions] = useState<ToolPermissionData[]>([]);
  const [pendingReviewFiles, setPendingReviewFiles] = useState<Set<string>>(new Set());

  // Track if we're currently sending a message (for local UI state)
  const sendingRef = useRef(false);
  const queueingRef = useRef(false);

  // Diff tree grouping state
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
      if (data.direction === 'output') {
        sendingRef.current = false;
      }
    };

    const handleTitleUpdated = (data: { sessionId: string; title: string }) => {
      if (data.sessionId === sessionId && sessionData) {
        updateSessionData({ sessionId, updates: { title: data.title } });
        onSessionTitleChanged?.(sessionId, data.title);
      }
    };

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

  // Derived values
  const isLoading = isProcessing || sendingRef.current;
  const sessionHasMessages = (sessionData?.messages?.length ?? 0) > 0;
  const currentProviderType = sessionData?.provider === 'claude-code' ? 'agent' : 'model';

  // ============================================================
  // Confirmation dialogs (ExitPlanMode, AskUserQuestion, ToolPermission)
  // ============================================================
  useEffect(() => {
    const handleExitPlanModeConfirm = (data: ExitPlanModeConfirmationData) => {
      if (data.sessionId === sessionId) {
        setPendingExitPlanConfirmation(data);
      }
    };
    const cleanup = window.electronAPI.on('ai:exitPlanModeConfirm', handleExitPlanModeConfirm);
    return () => { cleanup?.(); };
  }, [sessionId]);

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
    const handleQueuedPromptsReceived = (data: { sessionId: string }) => {
      if (data.sessionId === sessionId) loadQueuedPrompts();
    };
    const cleanup = window.electronAPI.on('ai:queuedPromptsReceived', handleQueuedPromptsReceived);
    return () => { cleanup?.(); };
  }, [sessionId, loadQueuedPrompts]);

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
    if (!message.trim() || queueingRef.current) return;
    queueingRef.current = true;

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
      queueingRef.current = false;
    }
  }, [sessionId, documentContext, draftAttachments, setDraftInput, setDraftAttachments]);

  const handleSend = useCallback(async () => {
    if (!draftInput.trim() || !sessionData) return;

    if (isLoading) {
      handleQueue(draftInput.trim());
      return;
    }

    const message = draftInput.trim();
    const attachments = draftAttachments;

    setDraftInput('');
    setDraftAttachments([]);
    sendingRef.current = true;

    const userMessage = {
      id: `msg-${Date.now()}`,
      role: 'user' as const,
      content: message,
      timestamp: Date.now(),
    };
    updateSessionData({
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
        mode: aiMode,
      };

      await window.electronAPI.invoke('ai:sendMessage', message, docContext, sessionId, workspacePath);
    } catch (error) {
      console.error('[SessionTranscript] Failed to send message:', error);
      sendingRef.current = false;
    }
  }, [sessionId, sessionData, draftInput, draftAttachments, isLoading, documentContext, aiMode, workspacePath, setDraftInput, setDraftAttachments, updateSessionData, handleQueue]);

  const handleCancel = useCallback(async () => {
    try {
      await window.electronAPI.invoke('ai:cancelRequest', sessionId);
      sendingRef.current = false;
    } catch (error) {
      console.error('[SessionTranscript] Failed to cancel request:', error);
    }
  }, [sessionId]);

  const handleFileClick = useCallback((filePath: string) => {
    onFileClick?.(filePath);
  }, [onFileClick]);

  const handleTodoClick = useCallback((todo: TodoItem) => {
    onTodoClick?.(todo);
  }, [onTodoClick]);

  const handleNavigateHistory = useCallback((direction: 'up' | 'down') => {
    onNavigateHistory?.(sessionId, direction);
  }, [sessionId, onNavigateHistory]);

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
    try {
      await window.electronAPI.invoke('sessions:update-metadata', sessionId, { model: modelId });
    } catch (error) {
      console.error('[SessionTranscript] Failed to update model:', error);
    }
  }, [sessionId, setCurrentModel]);

  const handleCommandSelect = useCallback((command: string) => {
    setDraftInput(command);
    inputRef.current?.focus();
  }, [setDraftInput]);

  // Confirmation handlers
  const handleExitPlanModeApprove = useCallback(async (requestId: string, confirmSessionId: string) => {
    try {
      await window.electronAPI.invoke('ai:exitPlanModeConfirmResponse', requestId, confirmSessionId, true);
      setPendingExitPlanConfirmation(null);
      setAiMode('agent');
    } catch (error) {
      console.error('[SessionTranscript] Failed to send ExitPlanMode approval:', error);
    }
  }, [setAiMode]);

  const handleExitPlanModeDeny = useCallback(async (requestId: string, confirmSessionId: string) => {
    try {
      await window.electronAPI.invoke('ai:exitPlanModeConfirmResponse', requestId, confirmSessionId, false);
      setPendingExitPlanConfirmation(null);
    } catch (error) {
      console.error('[SessionTranscript] Failed to send ExitPlanMode denial:', error);
    }
  }, []);

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
        color: 'var(--text-secondary)',
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
          onApprove={handleExitPlanModeApprove}
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
