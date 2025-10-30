import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { SessionData, ChatAttachment } from '@nimbalyst/runtime/ai/server/types';
import { AISessionView } from './AISessionView';
import { SessionDropdown } from '../AIChat/SessionDropdown';
import { SessionHistory } from '../AgenticCoding/SessionHistory';
import { ResizablePanel } from '../AgenticCoding/ResizablePanel';
import { TabBar } from '../TabManager/TabBar';
import type { Tab } from '../TabManager/TabManager';
import { useFileMention } from '../../hooks/useFileMention';
import type { TypeaheadOption } from '../Typeahead/GenericTypeahead';
import type { AIMode } from './ModeTag';
import { DiffTestDropdown } from "../AIChat/DiffTestDropdown.tsx";

export interface AgenticPanelRef {
  createNewSession: (planPath?: string) => Promise<void>;
  closeActiveTab: () => void;
}

export interface AgenticPanelProps {
  // Mode configuration
  mode: 'chat' | 'agent'; // chat = sidebar, agent = full window
  workspacePath: string;

  // Optional context
  documentContext?: any; // DocumentContext type

  // Initial session (optional)
  initialSessionId?: string;

  // Plan document path (optional, for agent mode)
  planDocumentPath?: string;

  // Whether keyboard shortcuts should be active (for agent mode tabs)
  isActive?: boolean;

  // Callbacks for external coordination
  onSessionChange?: (sessionId: string | null) => void;
  onContentModeChange?: (mode: string) => void; // Switch to files mode when opening a document
}

interface SessionTab {
  id: string;
  name: string;
  sessionData: SessionData;
  isPinned?: boolean;
  draftInput?: string;
  draftAttachments?: ChatAttachment[];
  mode?: AIMode; // Plan vs Agent mode (default: plan)
  model?: string; // Current model ID (provider:model format)
}

type SessionListItem = Pick<SessionData, 'id' | 'createdAt' | 'name' | 'title' | 'provider' | 'model'> & {
  messageCount?: number;
};

/**
 * AgenticPanel is the top-level container for unified AI interface.
 *
 * Key features:
 * - Supports both 'chat' mode (sidebar) and 'agent' mode (full window)
 * - Manages session collection and active session
 * - Shows SessionHistory in agent mode (hidden in chat mode)
 * - Shows TabBar in agent mode (single session dropdown in chat mode)
 * - Coordinates session lifecycle (create, load, delete)
 * - Handles streaming state across all sessions
 * - Persists state to workspace
 */
const AgenticPanel = forwardRef<AgenticPanelRef, AgenticPanelProps>(function AgenticPanel({
  mode,
  workspacePath,
  documentContext,
  initialSessionId,
  planDocumentPath,
  isActive = true,
  onSessionChange,
  onContentModeChange
}: AgenticPanelProps, ref) {
  // Session state
  const [sessionTabs, setSessionTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [availableSessions, setAvailableSessions] = useState<SessionListItem[]>([]);
  const [closedSessions, setClosedSessions] = useState<SessionTab[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const sendingSessionsRef = useRef<Set<string>>(new Set());

  // Prompt history navigation state (per session)
  const [historyPosition, setHistoryPosition] = useState<Map<string, number>>(new Map());
  const [savedDraft, setSavedDraft] = useState<Map<string, string>>(new Map());

  // Session history layout state (agent mode only)
  const [sessionHistoryWidth, setSessionHistoryWidth] = useState(240);
  const [sessionHistoryCollapsed, setSessionHistoryCollapsed] = useState(mode === 'chat'); // Collapsed in chat mode
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [sessionHistoryRefreshTrigger, setSessionHistoryRefreshTrigger] = useState(0);

  // Reload coordination for database-backed session state
  const reloadTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastReloadAtRef = useRef<Map<string, number>>(new Map());

  // Initialization
  const initializedRef = useRef(false);

  // Constants
  const MAX_CLOSED_SESSION_HISTORY = 10;

  // File mention support
  const {
    options: fileMentionOptions,
    handleSearch: handleFileMentionSearch,
    handleSelect: handleFileMentionSelect
  } = useFileMention({
    onInsertReference: () => {
      // File reference insertion is handled by AIInput
    }
  });

  // Load session history layout from workspace state
  useEffect(() => {
    if (mode !== 'agent') return; // Only for agent mode

    const loadLayout = async () => {
      try {
        const workspaceState = await window.electronAPI.invoke('workspace:get-state', workspacePath);
        const result = workspaceState?.agenticCodingWindowState;
        if (result?.sessionHistoryLayout) {
          const layout = result.sessionHistoryLayout;
          setSessionHistoryWidth(layout.width ?? 240);
          setSessionHistoryCollapsed(layout.collapsed ?? false);
          setCollapsedGroups(layout.collapsedGroups ?? []);
        }
      } catch (err) {
        console.error('[AgenticPanel] Failed to load session history layout:', err);
      }
    };
    loadLayout();
  }, [workspacePath, mode]);

  // Save session history layout to workspace state when it changes (agent mode only)
  useEffect(() => {
    if (mode !== 'agent') return;

    const saveLayout = async () => {
      try {
        await window.electronAPI.invoke('workspace:update-state', workspacePath, {
          agenticCodingWindowState: {
            sessionHistoryLayout: {
              width: sessionHistoryWidth,
              collapsed: sessionHistoryCollapsed,
              collapsedGroups
            }
          }
        });
      } catch (err) {
        console.error('[AgenticPanel] Failed to save session history layout:', err);
      }
    };

    const timer = setTimeout(saveLayout, 500);
    return () => clearTimeout(timer);
  }, [workspacePath, sessionHistoryWidth, sessionHistoryCollapsed, collapsedGroups, mode]);


  // Load all sessions for the workspace
  const loadSessions = useCallback(async () => {
    try {
      const sessionType = mode === 'agent' ? 'coding' : undefined; // Filter by type in agent mode
      const result = await window.electronAPI.invoke('sessions:list', workspacePath);
      if (result.success && Array.isArray(result.sessions)) {
        const sessions = result.sessions
          .filter((s: any) => !sessionType || s.sessionType === sessionType)
          .map((s: any) => ({
            id: s.id,
            createdAt: s.createdAt,
            name: s.name,
            title: s.title,
            provider: s.provider,
            model: s.model,
            messageCount: 0 // TODO: Get actual count
          }));
        setAvailableSessions(sessions);
      }
    } catch (err) {
      console.error('[AgenticPanel] Failed to load sessions:', err);
    }
  }, [workspacePath, mode]);

  const scheduleSessionReload = useCallback((
    sessionId: string,
    options: { immediate?: boolean; reason?: string; minInterval?: number } = {}
  ) => {
    if (!sessionId || typeof window === 'undefined' || !window.electronAPI?.aiLoadSession) {
      return;
    }

    const { immediate = false, reason, minInterval = 200 } = options;
    const timers = reloadTimersRef.current;
    const lastReloadMap = lastReloadAtRef.current;

    const executeReload = async () => {
      timers.delete(sessionId);
      lastReloadMap.set(sessionId, Date.now());
      try {
        const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePath);
        if (sessionData) {
          setSessionTabs(prev => prev.map(tab => {
            if (tab.id !== sessionId) {
              return tab;
            }

            const previousThinking = [...tab.sessionData.messages]
              .reverse()
              .find(message => message.isThinking);

            let messages = [...sessionData.messages];

            if (previousThinking && sendingSessionsRef.current.has(sessionId)) {
              const hasExistingThinking = messages.some(message => message.isThinking);
              if (!hasExistingThinking) {
                messages = [...messages, previousThinking];
              }
            }

            return {
              ...tab,
              sessionData: {
                ...sessionData,
                messages
              }
            };
          }));
        }
      } catch (err) {
        console.error(`[AgenticPanel] Failed to reload session${reason ? ` (${reason})` : ''}:`, err);
      }
    };

    const now = Date.now();
    const lastReload = lastReloadMap.get(sessionId) ?? 0;

    if (immediate) {
      const existing = timers.get(sessionId);
      if (existing) {
        clearTimeout(existing);
        timers.delete(sessionId);
      }
      void executeReload();
      return;
    }

    if (now - lastReload >= minInterval) {
      const existing = timers.get(sessionId);
      if (existing) {
        clearTimeout(existing);
        timers.delete(sessionId);
      }
      void executeReload();
      return;
    }

    const delay = Math.max(0, minInterval - (now - lastReload));
    const existing = timers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
    }
    timers.set(sessionId, setTimeout(() => {
      timers.delete(sessionId);
      void executeReload();
    }, delay));
  }, [workspacePath]);

  // Open a session in a new tab (agent mode) or load it (chat mode)
  const openSessionInTab = useCallback(async (sessionId: string) => {
    // Check if already open
    const existingTab = sessionTabs.find(tab => tab.id === sessionId);
    if (existingTab) {
      setActiveTabId(sessionId);
      return;
    }

    try {
      const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePath);
      if (sessionData) {
        const planPath = sessionData.metadata?.planDocumentPath as string | undefined;
        const tabName = planPath
          ? `Plan: ${planPath.split('/').pop()}`
          : sessionData.title || `Session ${sessionTabs.length + 1}`;

        const newTab: SessionTab = {
          id: sessionData.id,
          name: tabName,
          sessionData,
          mode: 'plan',
          model: sessionData.model || sessionData.provider || 'claude-code'
        };

        if (mode === 'chat') {
          // In chat mode, replace the current session
          setSessionTabs([newTab]);
        } else {
          // In agent mode, add as new tab
          setSessionTabs(prev => [...prev, newTab]);
        }

        setActiveTabId(sessionData.id);

        if (onSessionChange) {
          onSessionChange(sessionData.id);
        }
      }
    } catch (err) {
      console.error('[AgenticPanel] Failed to load session:', err);
    }
  }, [sessionTabs, workspacePath, mode, onSessionChange]);

  // Delete a session
  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await window.electronAPI.invoke('sessions:delete', sessionId);

      // Remove from tabs if open
      setSessionTabs(prev => {
        const filtered = prev.filter(tab => tab.id !== sessionId);
        if (activeTabId === sessionId && filtered.length > 0) {
          setActiveTabId(filtered[0].id);
          if (onSessionChange) {
            onSessionChange(filtered[0].id);
          }
        } else if (filtered.length === 0) {
          setActiveTabId(null);
          if (onSessionChange) {
            onSessionChange(null);
          }
        }
        return filtered;
      });

      await loadSessions();
    } catch (err) {
      console.error('[AgenticPanel] Failed to delete session:', err);
    }
  }, [activeTabId, loadSessions, onSessionChange]);

  // Create a new session
  const createNewSession = useCallback(async (planPath?: string) => {
    const session = await window.electronAPI.aiCreateSession(
      'claude-code',
      undefined,
      workspacePath,
      undefined,
      mode === 'agent' ? 'coding' : 'chat'
    );

    // Add metadata if needed
    if (mode === 'agent') {
      await window.electronAPI.invoke('agentic-coding:update-session-metadata', session.id, {
        sessionType: 'coding',
        planDocumentPath: planPath,
        fileEdits: [],
        todos: []
      });
    }

    const tabName = planPath
      ? `Plan: ${planPath.split('/').pop()}`
      : `Session ${sessionTabs.length + 1}`;

    const sessionData = await window.electronAPI.aiLoadSession(session.id, workspacePath);
    if (!sessionData) {
      throw new Error('Failed to load newly created session');
    }

    const newTab: SessionTab = {
      id: sessionData.id,
      name: tabName,
      sessionData,
      mode: 'plan',
      model: sessionData.model || sessionData.provider || 'claude-code'
    };

    if (mode === 'chat') {
      setSessionTabs([newTab]);
    } else {
      setSessionTabs(prev => [...prev, newTab]);
    }

    setActiveTabId(sessionData.id);

    await loadSessions();

    // Trigger SessionHistory refresh
    setSessionHistoryRefreshTrigger(prev => prev + 1);

    if (planPath && mode === 'agent') {
      await window.electronAPI.invoke('plan-status:notify-session-created', {
        sessionId: sessionData.id,
        planDocumentPath: planPath
      });
    }

    if (onSessionChange) {
      onSessionChange(sessionData.id);
    }

    return sessionData;
  }, [sessionTabs, workspacePath, mode, loadSessions, onSessionChange]);

  // Load or create initial session
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const loadOrCreateSession = async () => {
      try {
        setLoading(true);
        setError(null);

        await loadSessions();

        // Try to restore from workspace state
        const workspaceState = await window.electronAPI?.invoke('workspace:get-state', workspacePath);

        if (mode === 'agent') {
          // Agent mode: restore multiple tabs
          const tabStateResult = workspaceState?.agenticTabs;
          const savedTabs = tabStateResult?.tabs || [];

          if (savedTabs.length > 0) {
            const restoredTabs: SessionTab[] = [];
            for (const savedTab of savedTabs) {
              try {
                const sessionId = savedTab.filePath.replace(/^(session|agentic):\/\//, '') || savedTab.id;
                const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePath);
                if (sessionData) {
                  restoredTabs.push({
                    id: sessionId,
                    name: savedTab.fileName,
                    sessionData,
                    isPinned: savedTab.isPinned,
                    mode: 'plan',
                    model: sessionData.model || sessionData.provider || 'claude-code'
                  });
                }
              } catch (err) {
                console.error('[AgenticPanel] Failed to load saved session:', savedTab.filePath, err);
              }
            }

            if (restoredTabs.length > 0) {
              setSessionTabs(restoredTabs);
              const activeId = tabStateResult.activeTabId?.replace(/^(session|agentic):\/\//, '') || tabStateResult.activeTabId || restoredTabs[0].id;
              setActiveTabId(activeId);

              if (onSessionChange) {
                onSessionChange(activeId);
              }

              setLoading(false);
              return;
            }
          }
        } else {
          // Chat mode: restore single active session from aiPanel state
          const aiPanelState = workspaceState?.aiPanel;
          const savedSessionId = aiPanelState?.currentSessionId;

          if (savedSessionId) {
            try {
              const sessionData = await window.electronAPI.aiLoadSession(savedSessionId, workspacePath);
              if (sessionData) {
                const tab: SessionTab = {
                  id: sessionData.id,
                  name: sessionData.title || 'Session',
                  sessionData,
                  mode: 'plan',
                  model: sessionData.model || sessionData.provider || 'claude-code'
                };

                setSessionTabs([tab]);
                setActiveTabId(sessionData.id);

                if (onSessionChange) {
                  onSessionChange(sessionData.id);
                }

                setLoading(false);
                return;
              }
            } catch (err) {
              console.error('[AgenticPanel] Failed to load saved chat session:', err);
            }
          }
        }

        // No saved state - load initial session or create first-time session
        if (initialSessionId) {
          const sessionData = await window.electronAPI.aiLoadSession(initialSessionId, workspacePath);
          if (sessionData) {
            const planPath = sessionData.metadata?.planDocumentPath as string | undefined;
            const tabName = planPath
              ? `Plan: ${planPath.split('/').pop()}`
              : 'Session 1';

            const tab: SessionTab = {
              id: sessionData.id,
              name: tabName,
              sessionData,
              mode: 'plan',
              model: sessionData.model || sessionData.provider || 'claude-code'
            };

            setSessionTabs([tab]);
            setActiveTabId(sessionData.id);

            if (onSessionChange) {
              onSessionChange(sessionData.id);
            }
          } else {
            setError('Failed to load session');
          }
        } else if (mode === 'agent') {
          // In agent mode, create a session by default
          await createNewSession(planDocumentPath);
        }
        // In chat mode, don't create a session automatically - wait for user
      } catch (err) {
        console.error('[AgenticPanel] Failed to load/create session:', err);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    loadOrCreateSession();
  }, []); // Only run once

  // Insert plan document reference when provided
  useEffect(() => {
    if (!planDocumentPath || !activeTabId || !workspacePath) return;

    // Convert absolute path to workspace-relative path
    let relativePath = planDocumentPath;
    if (planDocumentPath.startsWith(workspacePath)) {
      relativePath = planDocumentPath.substring(workspacePath.length);
      // Remove leading slash if present
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.substring(1);
      }
    }

    // Set the draft input with the file reference
    const fileRef = `@${relativePath} `;
    handleDraftInputChange(activeTabId, fileRef);
  }, [planDocumentPath, activeTabId, workspacePath]);

  // Save to workspace state when tabs/session changes
  useEffect(() => {
    if (sessionTabs.length === 0 && !activeTabId) return;

    const saveState = async () => {
      try {
        if (mode === 'agent') {
          // Agent mode: save multiple tabs
          const tabs = sessionTabs.map(tab => ({
            id: tab.id,
            filePath: `session://${tab.id}`,
            fileName: tab.name,
            isDirty: false,
            isPinned: tab.isPinned || false,
            isVirtual: true
          }));

          await window.electronAPI?.invoke('workspace:update-state', workspacePath, {
            agenticTabs: {
              tabs,
              activeTabId: activeTabId,
              tabOrder: tabs.map(t => t.id),
              closedTabs: closedSessions.map(tab => ({
                id: tab.id,
                filePath: `session://${tab.id}`,
                fileName: tab.name,
                isPinned: tab.isPinned || false
              }))
            }
          });
        } else {
          // Chat mode: save single active session to aiPanel state
          if (activeTabId) {
            await window.electronAPI?.invoke('workspace:update-state', workspacePath, {
              aiPanel: {
                currentSessionId: activeTabId
              }
            });
          }
        }
      } catch (err) {
        console.error('[AgenticPanel] Failed to save state:', err);
      }
    };

    const timer = setTimeout(saveState, 500);
    return () => clearTimeout(timer);
  }, [sessionTabs, activeTabId, closedSessions, mode, workspacePath]);

  // Listen for database updates and reload session
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleMessageLogged = (data: { sessionId: string; direction: string }) => {
      const isRelevantSession = sessionTabs.some(tab => tab.id === data.sessionId) || data.sessionId === activeTabId;
      if (!isRelevantSession) return;

      scheduleSessionReload(data.sessionId, { reason: 'message-logged', minInterval: 120 });
    };

    const cleanup = window.electronAPI.on('ai:message-logged', handleMessageLogged);

    return () => {
      cleanup?.();
    };
  }, [sessionTabs, activeTabId, scheduleSessionReload]);

  // Listen for streaming responses and completion
  // This handles real-time updates during AI streaming:
  // - Updates assistant message content as it streams in
  // - Adds tool calls as they execute
  // - Final completion triggers database reload for consistency
  useEffect(() => {
    const handlerId = Math.random().toString(36).substring(7);
    console.log(`[AgenticPanel] useEffect REGISTER handlers ${handlerId}`, {
      activeTabId,
      workspacePath: !!workspacePath,
      hasElectronAPI: !!window.electronAPI,
      hasOnAIStreamResponse: typeof window.electronAPI?.onAIStreamResponse === 'function'
    });

    const handleStreamResponse = (data: any) => {
      console.log(`[AgenticPanel-${handlerId}] handleStreamResponse called:`, {
        sessionId: data.sessionId,
        hasActiveTabId: !!activeTabId,
        isComplete: data.isComplete,
        hasPartial: !!data.partial,
        partialLength: data.partial?.length,
        hasToolCalls: !!data.toolCalls,
        toolCallsCount: data.toolCalls?.length
      });

      // Check if this session is relevant to this panel (any open tab)
      const isRelevantSession = sessionTabs.some(tab => tab.id === data.sessionId);
      if (!isRelevantSession) {
        console.log('[AgenticPanel] Ignoring stream for session not in this panel:', data.sessionId);
        return;
      }

      const reason = data.isComplete ? 'stream-complete' : 'stream-update';

      if (data.isComplete) {
        sendingSessionsRef.current.delete(data.sessionId);
        scheduleSessionReload(data.sessionId, { immediate: true, reason });
        if (data.sessionId === activeTabId) {
          setIsSending(false);
        }
        return;
      }

      scheduleSessionReload(data.sessionId, { reason, minInterval: 150 });
    };

    const handleStreamError = (error: any) => {
      console.error('[AgenticPanel] AI error:', error);
      // Don't set panel-level error state - that's for session loading errors
      // Streaming errors are saved to the database and will appear via message-logged event
      setIsSending(false);
      if (typeof error?.sessionId === 'string') {
        sendingSessionsRef.current.delete(error.sessionId);
      }
    };

    const cleanupStreamResponse = window.electronAPI.onAIStreamResponse(handleStreamResponse);
    const cleanupError = window.electronAPI.onAIError(handleStreamError);

    return () => {
      console.log(`[AgenticPanel] useEffect CLEANUP handlers ${handlerId}`);
      cleanupStreamResponse();
      cleanupError();
    };
  }, [activeTabId, workspacePath, sessionTabs, scheduleSessionReload]);

  useEffect(() => {
    return () => {
      reloadTimersRef.current.forEach(timer => clearTimeout(timer));
      reloadTimersRef.current.clear();
      lastReloadAtRef.current.clear();
    };
  }, []);

  // Handle draft input change
  const handleDraftInputChange = useCallback((sessionId: string, value: string) => {
    setSessionTabs(prev => prev.map(tab =>
      tab.id === sessionId ? { ...tab, draftInput: value } : tab
    ));
  }, []);

  // Handle draft attachments change
  const handleDraftAttachmentsChange = useCallback((sessionId: string, attachments: ChatAttachment[]) => {
    setSessionTabs(prev => prev.map(tab =>
      tab.id === sessionId ? { ...tab, draftAttachments: attachments } : tab
    ));
  }, []);

  // Handle history navigation (up/down arrow in input)
  const handleNavigateHistory = useCallback((sessionId: string, direction: 'up' | 'down') => {
    const currentTab = sessionTabs.find(tab => tab.id === sessionId);
    if (!currentTab) return;

    // Extract user prompts from session messages
    const userPrompts = currentTab.sessionData.messages
      .filter(msg => msg.role === 'user')
      .map(msg => msg.content);

    if (userPrompts.length === 0) return;

    // Get current position (default to -1 for "not navigating")
    const currentPosition = historyPosition.get(sessionId) ?? -1;

    if (direction === 'up') {
      // Move to previous prompt (more recent = higher index)
      const newPosition = currentPosition === -1 ? userPrompts.length - 1 : Math.max(0, currentPosition - 1);

      // Save current draft on first navigation
      if (currentPosition === -1) {
        const newSavedDraft = new Map(savedDraft);
        newSavedDraft.set(sessionId, currentTab.draftInput || '');
        setSavedDraft(newSavedDraft);
      }

      // Update position
      const newHistoryPosition = new Map(historyPosition);
      newHistoryPosition.set(sessionId, newPosition);
      setHistoryPosition(newHistoryPosition);

      // Update draft input
      handleDraftInputChange(sessionId, userPrompts[newPosition]);
    } else {
      // Move to next prompt or restore draft
      if (currentPosition === -1) return; // Not navigating

      const newPosition = currentPosition + 1;

      if (newPosition >= userPrompts.length) {
        // Past the last prompt - restore original draft
        const draft = savedDraft.get(sessionId) || '';
        handleDraftInputChange(sessionId, draft);

        // Clear history navigation state
        const newHistoryPosition = new Map(historyPosition);
        newHistoryPosition.delete(sessionId);
        setHistoryPosition(newHistoryPosition);

        const newSavedDraft = new Map(savedDraft);
        newSavedDraft.delete(sessionId);
        setSavedDraft(newSavedDraft);
      } else {
        // Move to next prompt
        const newHistoryPosition = new Map(historyPosition);
        newHistoryPosition.set(sessionId, newPosition);
        setHistoryPosition(newHistoryPosition);

        handleDraftInputChange(sessionId, userPrompts[newPosition]);
      }
    }
  }, [sessionTabs, historyPosition, savedDraft, handleDraftInputChange]);

  // Handle mode change (plan <-> agent)
  const handleModeChange = useCallback((sessionId: string, newMode: AIMode) => {
    setSessionTabs(prev => prev.map(tab =>
      tab.id === sessionId ? { ...tab, mode: newMode } : tab
    ));
  }, []);

  // Handle model change
  const handleModelChange = useCallback(async (sessionId: string, newModel: string) => {
    console.log(`[AgenticPanel] handleModelChange called - sessionId: ${sessionId}, newModel: ${newModel}`);

    // Parse provider from model ID (format: "provider:model" or just "provider")
    const [newProvider, ...modelParts] = newModel.split(':');
    const actualModel = modelParts.length > 0 ? modelParts.join(':') : newModel;

    console.log(`[AgenticPanel] Parsed provider: ${newProvider}, model: ${actualModel}`);

    // Update local state immediately for responsive UI
    setSessionTabs(prev => prev.map(tab => {
      if (tab.id === sessionId) {
        console.log(`[AgenticPanel] Updating tab ${tab.id}:`);
        console.log(`  - provider: ${tab.sessionData.provider} -> ${newProvider}`);
        console.log(`  - model: ${tab.model} -> ${newModel}`);
        console.log(`  - sessionData.model: ${tab.sessionData.model} -> ${newModel}`);
        return {
          ...tab,
          model: newModel,
          // Also update sessionData with both provider and model
          sessionData: {
            ...tab.sessionData,
            provider: newProvider as any,
            model: newModel
          }
        };
      }
      return tab;
    }));

    // Persist both provider and model changes to session data in database
    try {
      console.log(`[AgenticPanel] Persisting changes to database: ${sessionId}`);
      console.log(`  - provider: ${newProvider}`);
      console.log(`  - model: ${newModel}`);

      await window.electronAPI.invoke('sessions:update-provider-and-model', sessionId, newProvider, newModel);
      console.log(`[AgenticPanel] Provider and model changes persisted successfully`);
    } catch (err) {
      console.error('[AgenticPanel] Failed to update session provider/model:', err);
    }
  }, []);

  // Handle send message
  const handleSendMessage = useCallback(async (sessionId: string, message: string, attachments: ChatAttachment[]) => {
    if (!message.trim() || !sessionId) return;

    // Reset history navigation state when sending a message
    setHistoryPosition(prev => {
      const newMap = new Map(prev);
      newMap.delete(sessionId);
      return newMap;
    });
    setSavedDraft(prev => {
      const newMap = new Map(prev);
      newMap.delete(sessionId);
      return newMap;
    });

    setIsSending(true);
    sendingSessionsRef.current.add(sessionId);

    // Get the session to determine sessionType
    const currentTab = sessionTabs.find(tab => tab.id === sessionId);
    const sessionType = currentTab?.sessionData?.sessionType || (mode === 'agent' ? 'coding' : 'chat');

    // Add user message immediately
    setSessionTabs(prev => prev.map(tab => {
      if (tab.id === sessionId) {
        const userMessage = {
          role: 'user' as const,
          content: message,
          timestamp: Date.now(),
          attachments: attachments.length > 0 ? attachments : undefined
        };
        const thinkingMessage = {
          role: 'assistant' as const,
          content: '',
          timestamp: Date.now(),
          isThinking: true
        };
        return {
          ...tab,
          sessionData: {
            ...tab.sessionData,
            messages: [...tab.sessionData.messages, userMessage, thinkingMessage]
          }
        };
      }
      return tab;
    }));

    try {
      // Prepare document context - strip out non-serializable functions
      let contextToSend = undefined;
      if (documentContext) {
        const { getLatestContent, ...serializableContext } = documentContext as any;

        // If getLatestContent exists, call it to get the current content
        if (typeof getLatestContent === 'function') {
          serializableContext.content = getLatestContent();
        }

        contextToSend = {
          ...serializableContext,
          sessionType,  // Include sessionType for MCP tool availability
          attachments: attachments.length > 0 ? attachments : undefined
        };

        // Debug log to verify filePath is included
        console.log('[AgenticPanel] Sending document context:', {
          hasFilePath: !!contextToSend.filePath,
          filePath: contextToSend.filePath,
          sessionType: contextToSend.sessionType,
          hasContent: !!contextToSend.content,
          contentLength: contextToSend.content?.length
        });
      } else if (attachments.length > 0) {
        contextToSend = { attachments, sessionType };
      } else {
        // Even without document context or attachments, pass sessionType
        contextToSend = { sessionType };
      }

      await window.electronAPI.aiSendMessage(
        message,
        contextToSend,
        sessionId,
        workspacePath
      );
    } catch (err) {
      console.error('[AgenticPanel] Failed to send message:', err);
      setError(String(err));
      setIsSending(false);
      sendingSessionsRef.current.delete(sessionId);

      // Remove thinking message on error
      setSessionTabs(prev => prev.map(tab => {
        if (tab.id === sessionId) {
          return {
            ...tab,
            sessionData: {
              ...tab.sessionData,
              messages: tab.sessionData.messages.filter(m => !m.isThinking)
            }
          };
        }
        return tab;
      }));
    }
  }, [workspacePath, mode, documentContext, sessionTabs]);

  // Handle cancel request
  const handleCancelRequest = useCallback(async (sessionId: string) => {
    try {
      const result = await window.electronAPI.aiCancelRequest();
      if (result.success) {
        setIsSending(false);
        sendingSessionsRef.current.delete(sessionId);

        // Remove thinking message
        setSessionTabs(prev => prev.map(tab => {
          if (tab.id === sessionId) {
            return {
              ...tab,
              sessionData: {
                ...tab.sessionData,
                messages: tab.sessionData.messages.filter(m => !m.isThinking)
              }
            };
          }
          return tab;
        }));
      }
    } catch (err) {
      console.error('[AgenticPanel] Failed to cancel request:', err);
    }
  }, []);

  // Handle file click
  const handleFileClick = useCallback(async (filePath: string) => {
    try {
      await window.electronAPI.invoke('workspace:open-file', {
        workspacePath,
        filePath
      });
      // Switch to files mode after opening the file
      if (onContentModeChange) {
        onContentModeChange('files');
      }
    } catch (err) {
      console.error('[AgenticPanel] Failed to open file:', err);
    }
  }, [workspacePath, onContentModeChange]);

  // Tab management (agent mode only)
  const handleTabSelect = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    if (onSessionChange) {
      onSessionChange(tabId);
    }
  }, [onSessionChange]);

  const handleTabClose = useCallback((tabId: string) => {
    const closingTab = sessionTabs.find(t => t.id === tabId);
    if (closingTab) {
      setClosedSessions(prev => [closingTab, ...prev].slice(0, MAX_CLOSED_SESSION_HISTORY));
    }

    setSessionTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId && filtered.length > 0) {
        const newActiveId = filtered[filtered.length - 1].id;
        setActiveTabId(newActiveId);
        if (onSessionChange) {
          onSessionChange(newActiveId);
        }
      } else if (filtered.length === 0) {
        setActiveTabId(null);
        if (onSessionChange) {
          onSessionChange(null);
        }
      }
      return filtered;
    });
  }, [sessionTabs, activeTabId, onSessionChange]);

  const handleTabReorder = useCallback((fromIndex: number, toIndex: number) => {
    setSessionTabs(prev => {
      const newTabs = [...prev];
      const [movedTab] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, movedTab);
      return newTabs;
    });
  }, []);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    createNewSession,
    closeActiveTab: () => {
      if (activeTabId) {
        handleTabClose(activeTabId);
      }
    }
  }), [createNewSession, activeTabId, handleTabClose]);

  const handleTogglePin = useCallback((tabId: string) => {
    setSessionTabs(prev => {
      const tab = prev.find(t => t.id === tabId);
      if (!tab) return prev;

      const newIsPinned = !tab.isPinned;
      const updatedTab = { ...tab, isPinned: newIsPinned };

      let newTabs = prev.map(t => t.id === tabId ? updatedTab : t);

      if (newIsPinned) {
        newTabs = newTabs.filter(t => t.id !== tabId);
        const lastPinnedIndex = newTabs.findIndex(t => !t.isPinned);
        const insertIndex = lastPinnedIndex === -1 ? newTabs.length : lastPinnedIndex;
        newTabs.splice(insertIndex, 0, updatedTab);
      } else {
        newTabs = newTabs.filter(t => t.id !== tabId);
        const firstUnpinnedIndex = newTabs.findIndex(t => !t.isPinned);
        const insertIndex = firstUnpinnedIndex === -1 ? newTabs.length : firstUnpinnedIndex;
        newTabs.splice(insertIndex, 0, updatedTab);
      }

      return newTabs;
    });
  }, []);

  const handleTabRename = useCallback(async (tabId: string, newName: string) => {
    setSessionTabs(prev => prev.map(tab => {
      if (tab.id === tabId) {
        return { ...tab, name: newName };
      }
      return tab;
    }));

    try {
      await window.electronAPI.invoke('sessions:update-title', tabId, newName);
    } catch (err) {
      console.error('[AgenticPanel] Failed to update session title:', err);
    }
  }, []);

  const reopenLastClosedSession = useCallback(async () => {
    if (closedSessions.length === 0) return;

    const [lastClosed, ...remainingClosed] = closedSessions;
    setClosedSessions(remainingClosed);

    await openSessionInTab(lastClosed.id);
  }, [closedSessions, openSessionInTab]);

  // Convert SessionTab to Tab format for TabBar
  const convertToTabs = (sessionTabs: SessionTab[]): Tab[] => {
    return sessionTabs.map(tab => ({
      id: tab.id,
      filePath: `session://${tab.id}`,
      fileName: tab.name,
      content: '',
      isDirty: false,
      isPinned: tab.isPinned || false,
      isVirtual: true
    }));
  };

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--surface-primary)' }}>
        <div style={{ color: 'var(--text-secondary)' }}>Loading session...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--surface-primary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--status-error)', marginBottom: '0.5rem' }}>Failed to load session</div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>{error}</div>
        </div>
      </div>
    );
  }

  // Chat mode: single session with dropdown selector
  if (mode === 'chat') {
    const activeTab = sessionTabs.find(tab => tab.id === activeTabId);

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-primary)' }}>
        {/* Header with session dropdown */}
        <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between' }}>
          <SessionDropdown
            currentSessionId={activeTabId}
            sessions={availableSessions}
            onSessionSelect={openSessionInTab}
            onNewSession={() => createNewSession()}
            onDeleteSession={deleteSession}
            onOpenSessionManager={() => window.electronAPI.invoke('open-session-manager', workspacePath)}
          />
          {import.meta.env.DEV && (
              <DiffTestDropdown documentContext={documentContext} />
          )}
          <button
            onClick={() => createNewSession()}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: '0.375rem',
              fontSize: '0.8125rem',
              fontWeight: 500,
              backgroundColor: 'var(--primary-color)',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              transition: 'opacity 0.15s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            title="Start new conversation"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            New
          </button>
        </div>

        {/* Session view or empty state */}
        {activeTab ? (
          <AISessionView
            sessionId={activeTab.id}
            sessionData={activeTab.sessionData}
            isActive={true}
            mode="chat"
            workspacePath={workspacePath}
            documentContext={documentContext}
            draftInput={activeTab.draftInput}
            draftAttachments={activeTab.draftAttachments}
            onDraftInputChange={handleDraftInputChange}
            onDraftAttachmentsChange={handleDraftAttachmentsChange}
            onSendMessage={handleSendMessage}
            onCancelRequest={handleCancelRequest}
            onNavigateHistory={handleNavigateHistory}
            fileMentionOptions={fileMentionOptions}
            onFileMentionSearch={handleFileMentionSearch}
            onFileMentionSelect={handleFileMentionSelect}
            onFileClick={handleFileClick}
            isLoading={isSending}
            aiMode={activeTab.mode || 'plan'}
            onAIModeChange={(newMode) => handleModeChange(activeTab.id, newMode)}
            currentModel={activeTab.model || activeTab.sessionData.model || 'claude-code'}
            onModelChange={(newModel) => handleModelChange(activeTab.id, newModel)}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', maxWidth: '400px', padding: '2rem' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                No session selected
              </div>
              <button
                onClick={() => createNewSession()}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--primary-color)',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                New Session
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Agent mode: multi-tab with session history
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-primary)' }}>
      <ResizablePanel
        leftWidth={sessionHistoryWidth}
        minWidth={180}
        maxWidth={400}
        onWidthChange={setSessionHistoryWidth}
        collapsed={sessionHistoryCollapsed}
        leftPanel={
          <SessionHistory
            workspacePath={workspacePath}
            activeSessionId={activeTabId}
            loadedSessionIds={sessionTabs.map(tab => tab.id)}
            onSessionSelect={openSessionInTab}
            onSessionDelete={deleteSession}
            onNewSession={() => createNewSession()}
            collapsedGroups={collapsedGroups}
            onCollapsedGroupsChange={setCollapsedGroups}
            refreshTrigger={sessionHistoryRefreshTrigger}
          />
        }
        rightPanel={
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Tabs */}
            {sessionTabs.length > 0 && (
              <div className="ai-session-tabs-container">
                <TabBar
                tabs={convertToTabs(sessionTabs)}
                activeTabId={activeTabId}
                onTabSelect={handleTabSelect}
                onTabClose={handleTabClose}
                onNewTab={() => createNewSession()}
                onTogglePin={handleTogglePin}
                onTabReorder={handleTabReorder}
                onReopenLastClosed={reopenLastClosedSession}
                hasClosedTabs={closedSessions.length > 0}
                onTabRename={handleTabRename}
                allowRename={true}
                isActive={isActive}
              />
              </div>
            )}

            {/* Session views */}
            {sessionTabs.map(tab => (
              <AISessionView
                key={tab.id}
                sessionId={tab.id}
                sessionData={tab.sessionData}
                isActive={tab.id === activeTabId}
                mode="agent"
                workspacePath={workspacePath}
                documentContext={documentContext}
                draftInput={tab.draftInput}
                draftAttachments={tab.draftAttachments}
                onDraftInputChange={handleDraftInputChange}
                onDraftAttachmentsChange={handleDraftAttachmentsChange}
                onSendMessage={handleSendMessage}
                onCancelRequest={handleCancelRequest}
                onNavigateHistory={handleNavigateHistory}
                fileMentionOptions={fileMentionOptions}
                onFileMentionSearch={handleFileMentionSearch}
                onFileMentionSelect={handleFileMentionSelect}
                onFileClick={handleFileClick}
                isLoading={isSending && tab.id === activeTabId}
                aiMode={tab.mode || 'plan'}
                onAIModeChange={(newMode) => handleModeChange(tab.id, newMode)}
                currentModel={tab.model || tab.sessionData.model || 'claude-code'}
                onModelChange={(newModel) => handleModelChange(tab.id, newModel)}
              />
            ))}

            {/* Empty state */}
            {sessionTabs.length === 0 && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', maxWidth: '400px', padding: '2rem' }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                    No session selected
                  </div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                    Select a session from the history or create a new one
                  </div>
                </div>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
});
export default AgenticPanel
