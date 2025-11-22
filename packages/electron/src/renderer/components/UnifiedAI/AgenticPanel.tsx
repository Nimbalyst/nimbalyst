import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef, createRef } from 'react';
import type { SessionData, ChatAttachment, Message, TokenUsageCategory } from '@nimbalyst/runtime/ai/server/types';
import { AISessionView, AISessionViewRef } from './AISessionView';
import { SessionDropdown } from '../AIChat/SessionDropdown';
import { SessionHistory } from '../AgenticCoding/SessionHistory';
import { SessionImportDialog } from '../AgenticCoding/SessionImportDialog';
import { ResizablePanel } from '../AgenticCoding/ResizablePanel';
import { TabBar } from '../TabManager/TabBar';
import type { Tab } from '../TabManager/TabManager';
import { useFileMention } from '../../hooks/useFileMention';
import type { TypeaheadOption } from '../Typeahead/GenericTypeahead';
import type { AIMode } from './ModeTag';
import { DiffTestDropdown } from "../AIChat/DiffTestDropdown.tsx";
import { getFileName } from '../../utils/pathUtils';

export interface AgenticPanelRef {
  createNewSession: (planPath?: string) => Promise<void>;
  openSessionInTab: (sessionId: string) => Promise<void>;
  closeActiveTab: () => void;
  nextTab: () => void;
  previousTab: () => void;
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
  mode?: AIMode; // Planning vs Agent mode (default: agent)
  model?: string; // Current model ID (provider:model format)
}

type SessionListItem = Pick<SessionData, 'id' | 'createdAt' | 'name' | 'title' | 'provider' | 'model'> & {
  messageCount?: number;
};

const SESSION_HISTORY_REFRESH_EVENT = 'agentic:session-history-refresh';

interface SessionHistoryRefreshDetail {
  workspacePath?: string;
  sourceId: string;
  reason?: string;
}

/**
 * Helper function to strip NIMBALYST_SYSTEM_MESSAGE from message content.
 * The ClaudeCodeProvider appends system messages to user prompts before sending them,
 * but we don't want these system messages to appear when users navigate history with arrow keys.
 */
function stripSystemMessage(content: string): string {
  // Remove the NIMBALYST_SYSTEM_MESSAGE section that gets appended in ClaudeCodeProvider
  const systemMessagePattern = /\n\n<NIMBALYST_SYSTEM_MESSAGE>[\s\S]*?<\/NIMBALYST_SYSTEM_MESSAGE>$/;
  return content.replace(systemMessagePattern, '').trim();
}

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
  const [sendingSessions, setSendingSessions] = useState<Set<string>>(new Set());
  const sendingSessionsRef = useRef<Set<string>>(new Set());

  // Track sessions that are actively running (from session state manager)
  const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set());

  // Prompt history navigation state (per session)
  const [historyPosition, setHistoryPosition] = useState<Map<string, number>>(new Map());
  const [savedDraft, setSavedDraft] = useState<Map<string, string>>(new Map());

  // Session history layout state (agent mode only)
  const [sessionHistoryWidth, setSessionHistoryWidth] = useState(240);
  const [sessionHistoryCollapsed, setSessionHistoryCollapsed] = useState(mode === 'chat'); // Collapsed in chat mode
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [sessionHistoryRefreshTrigger, setSessionHistoryRefreshTrigger] = useState(0);
  const [renamedSession, setRenamedSession] = useState<{ id: string; title: string } | null>(null);
  const [updatedSession, setUpdatedSession] = useState<{ id: string; timestamp: number } | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Reload coordination for database-backed session state
  const reloadTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastReloadAtRef = useRef<Map<string, number>>(new Map());
  const reloadInProgressRef = useRef<Set<string>>(new Set()); // Track in-flight reloads
  const sessionTabsRef = useRef<SessionTab[]>(sessionTabs);
  const workspacePathRef = useRef(workspacePath);
  const panelInstanceIdRef = useRef<string>(`agentic-panel-${Math.random().toString(36).slice(2)}`);
  const autoContextSessionsRef = useRef<Set<string>>(new Set());

  // Read state tracking - synchronous ref to avoid React state update delay
  const readStateRef = useRef<Map<string, { lastReadMessageTimestamp: number | null }>>(new Map());

  // Session view refs for focusing input
  const sessionViewRefsRef = useRef<Map<string, React.RefObject<AISessionViewRef>>>(new Map());

  // Initialization
  const initializedRef = useRef(false);

  // Keep refs in sync with state/props
  useEffect(() => {
    sessionTabsRef.current = sessionTabs;
  }, [sessionTabs]);

  useEffect(() => {
    workspacePathRef.current = workspacePath;
  }, [workspacePath]);

  // Constants
  const MAX_CLOSED_SESSION_HISTORY = 10;

  // Helper to get or create ref for a session
  const getSessionViewRef = useCallback((sessionId: string) => {
    const refsMap = sessionViewRefsRef.current;
    if (!refsMap.has(sessionId)) {
      refsMap.set(sessionId, createRef<AISessionViewRef>());
    }
    return refsMap.get(sessionId)!;
  }, []);

  // Mark a session as read - called whenever a session becomes active
  const markSessionAsRead = useCallback(async (sessionId: string) => {
    const tab = sessionTabsRef.current.find(t => t.id === sessionId);
    if (!tab) return;

    const messages = tab.sessionData.messages || [];
    const lastMessage = messages[messages.length - 1];
    const lastMessageTimestamp = lastMessage?.timestamp ?? null;

    // Update ref IMMEDIATELY (synchronous) so it's available before React state updates
    readStateRef.current.set(sessionId, {
      lastReadMessageTimestamp: lastMessageTimestamp
    });

    // Update local state for persistence
    setSessionTabs(prev => prev.filter(t => t != null).map(t => {
      if (t.id === sessionId) {
        return {
          ...t,
          sessionData: {
            ...t.sessionData,
            lastReadMessageTimestamp: lastMessageTimestamp
          }
        };
      }
      return t;
    }));

    // Persist to database
    try {
      await window.electronAPI.invoke('sessions:mark-read', sessionId, lastMessageTimestamp);
    } catch (err) {
      console.error('[AgenticPanel] Failed to mark session as read:', err);
    }
  }, []);

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

  // Subscribe to session state changes to track running sessions
  useEffect(() => {
    const initSessionState = async () => {
      try {
        // TODO: Debug logging - uncomment if needed
        // console.log('[AgenticPanel] Initializing session state subscription');

        // Get initial active sessions
        const result = await window.electronAPI.sessionState.getActiveSessionIds();
        // TODO: Debug logging - uncomment if needed
        // console.log('[AgenticPanel] Initial active sessions:', result);
        if (result.success && result.sessionIds) {
          // TODO: Debug logging - uncomment if needed
          // console.log('[AgenticPanel] Setting running sessions:', result.sessionIds);
          setRunningSessions(new Set(result.sessionIds));
        }

        // Subscribe to state changes
        // TODO: Debug logging - uncomment if needed
        // console.log('[AgenticPanel] Subscribing to session state changes');
        await window.electronAPI.sessionState.subscribe();

        // Listen for state change events
        const handleStateChange = (event: any) => {
          // TODO: Debug logging - uncomment if needed
          // console.log('[AgenticPanel] Session state changed:', event);
          setRunningSessions(prev => {
            const next = new Set(prev);

            switch (event.type) {
              case 'session:started':
              case 'session:streaming':
              case 'session:waiting':
                next.add(event.sessionId);
                // TODO: Debug logging - uncomment if needed
                // console.log('[AgenticPanel] Added running session:', event.sessionId, 'Total:', next.size);
                break;
              case 'session:completed':
              case 'session:error':
              case 'session:interrupted':
                next.delete(event.sessionId);
                // TODO: Debug logging - uncomment if needed
                // console.log('[AgenticPanel] Removed running session:', event.sessionId, 'Total:', next.size);
                break;
            }

            return next;
          });
        };

        window.electronAPI.sessionState.onStateChange(handleStateChange);

        return () => {
          // TODO: Debug logging - uncomment if needed
          // console.log('[AgenticPanel] Cleaning up session state subscription');
          window.electronAPI.sessionState.removeStateChangeListener(handleStateChange);
          window.electronAPI.sessionState.unsubscribe();
        };
      } catch (err) {
        console.error('[AgenticPanel] Failed to subscribe to session state:', err);
      }
    };

    const cleanup = initSessionState();
    return () => {
      cleanup.then(fn => fn?.());
    };
  }, []);

  // Load all sessions for the workspace
  const loadSessions = useCallback(async () => {
    try {
      // TODO: Debug logging - uncomment if needed
      // console.log('[AgenticPanel] loadSessions called, mode:', mode, 'workspace:', workspacePath);
      // Don't filter by session type - show all sessions in agent mode
      const result = await window.electronAPI.invoke('sessions:list', workspacePath);
      // TODO: Debug logging - uncomment if needed
      // console.log('[AgenticPanel] sessions:list result:', result);
      if (result.success && Array.isArray(result.sessions)) {
        const sessions = result.sessions
          .map((s: any) => ({
            id: s.id,
            createdAt: s.createdAt,
            name: s.name,
            title: s.title,
            provider: s.provider,
            model: s.model,
            messageCount: s.messageCount || 0,
            sessionType: s.sessionType
          }));
        // TODO: Debug logging - uncomment if needed
        // console.log('[AgenticPanel] Setting availableSessions:', sessions.length, 'sessions');
        // console.log('[AgenticPanel] Session details:', sessions.map(s => ({ id: s.id, type: s.sessionType })));
        setAvailableSessions(sessions);
      }
    } catch (err) {
      console.error('[AgenticPanel] Failed to load sessions:', err);
    }
  }, [workspacePath, mode]);

  const triggerSessionHistoryRefresh = useCallback((reason?: string) => {
    setSessionHistoryRefreshTrigger(prev => prev + 1);

    if (typeof window !== 'undefined') {
      const detail: SessionHistoryRefreshDetail = {
        workspacePath,
        sourceId: panelInstanceIdRef.current,
        reason
      };
      window.dispatchEvent(new CustomEvent(SESSION_HISTORY_REFRESH_EVENT, { detail }));
    }
  }, [workspacePath]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleExternalRefresh = (event: Event) => {
      const customEvent = event as CustomEvent<SessionHistoryRefreshDetail>;
      const detail = customEvent.detail;
      if (!detail) {
        return;
      }
      if (detail.sourceId === panelInstanceIdRef.current) {
        return;
      }
      if (detail.workspacePath && detail.workspacePath !== workspacePath) {
        return;
      }
      setSessionHistoryRefreshTrigger(prev => prev + 1);
      // Also refresh availableSessions so session dropdowns in other modes stay in sync
      loadSessions();
    };

    window.addEventListener(SESSION_HISTORY_REFRESH_EVENT, handleExternalRefresh as EventListener);
    return () => {
      window.removeEventListener(SESSION_HISTORY_REFRESH_EVENT, handleExternalRefresh as EventListener);
    };
  }, [workspacePath, loadSessions]);

  // When switching TO agent mode, refresh SessionHistory to pick up any sessions created in other modes
  useEffect(() => {
    if (mode === 'agent') {
      triggerSessionHistoryRefresh('mode-switch');
    }
  }, [mode, triggerSessionHistoryRefresh]);

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
      // Guard against concurrent reloads for the same session
      if (reloadInProgressRef.current.has(sessionId)) {
        // console.log(`[AgenticPanel] Reload already in progress for session ${sessionId}, skipping`);
        return;
      }

      timers.delete(sessionId);
      lastReloadMap.set(sessionId, Date.now());
      reloadInProgressRef.current.add(sessionId);

      try {
        const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePathRef.current);
        if (sessionData) {
          setSessionTabs(prev => prev.filter(tab => tab != null).map(tab => {
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

            // Preserve read state from ref (most recent), then tab state, then database
            const refReadState = readStateRef.current.get(sessionId);
            const preservedTimestamp = refReadState?.lastReadMessageTimestamp ?? tab.sessionData.lastReadMessageTimestamp ?? 0;
            const dbTimestamp = sessionData.lastReadMessageTimestamp || 0;

            // Use the most recent read state
            const finalTimestamp = Math.max(preservedTimestamp, dbTimestamp);

            // Update ref with the final read state
            if (finalTimestamp > 0) {
              readStateRef.current.set(sessionId, { lastReadMessageTimestamp: finalTimestamp });
            }

            return {
              ...tab,
              name: sessionData.title || tab.name,
              sessionData: {
                ...sessionData,
                messages,
                lastReadMessageTimestamp: finalTimestamp
              }
            };
          }));
        }
      } catch (err) {
        console.error(`[AgenticPanel] Failed to reload session${reason ? ` (${reason})` : ''}:`, err);
      } finally {
        reloadInProgressRef.current.delete(sessionId);
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
  }, []); // No dependencies - uses refs for all values

  // Open a session in a new tab (agent mode) or load it (chat mode)
  const openSessionInTab = useCallback(async (sessionId: string) => {
    // console.log('[AgenticPanel] openSessionInTab called with sessionId:', sessionId);
    // console.log('[AgenticPanel] Current mode:', mode);
    // console.log('[AgenticPanel] Current sessionTabs:', sessionTabs);
    // console.log('[AgenticPanel] workspacePath:', workspacePath);

    // In agent mode, check if already open and just switch to it
    // In chat mode, always reload to ensure we're showing the correct session
    if (mode === 'agent') {
      const existingTab = sessionTabs.filter(tab => tab != null).find(tab => tab.id === sessionId);
      if (existingTab) {
        // console.log('[AgenticPanel] Agent mode: session already open, switching');
        setActiveTabId(sessionId);
        if (onSessionChange) {
          onSessionChange(sessionId);
        }
        await markSessionAsRead(sessionId);
        return;
      }
    }

    // Chat mode or new session: always load fresh data

    // console.log('[AgenticPanel] Loading session from database...');
    try {
      const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePath);
      // console.log('[AgenticPanel] Session data loaded:', sessionData);
      if (sessionData) {
        const planPath = sessionData.metadata?.planDocumentPath as string | undefined;
        const tabName = planPath
          ? `Plan: ${getFileName(planPath)}`
          : sessionData.title || `Session ${sessionTabs.length + 1}`;

        const newTab: SessionTab = {
          id: sessionData.id,
          name: tabName,
          sessionData,
          draftInput: sessionData.draftInput,
          mode: sessionData.mode || 'agent',
          model: sessionData.model || sessionData.provider || 'claude-code'
        };

        // console.log('[AgenticPanel] Created new tab:', newTab);
        // console.log('[AgenticPanel] Mode is:', mode);

        if (mode === 'chat') {
          // In chat mode, replace the current session
          // console.log('[AgenticPanel] Chat mode: replacing current session');
          setSessionTabs([newTab]);
        } else {
          // In agent mode, add as new tab
          // console.log('[AgenticPanel] Agent mode: adding new tab');
          setSessionTabs(prev => [...prev, newTab]);
        }

        setActiveTabId(sessionData.id);
        // console.log('[AgenticPanel] Set active tab ID to:', sessionData.id);

        if (onSessionChange) {
          // console.log('[AgenticPanel] Calling onSessionChange with:', sessionData.id);
          onSessionChange(sessionData.id);
        }

        // Mark as read when opening a new session
        await markSessionAsRead(sessionData.id);
        // console.log('[AgenticPanel] Session marked as read');
      } else {
        console.error('[AgenticPanel] Session data is null or undefined');
      }
    } catch (err) {
      console.error('[AgenticPanel] Failed to load session:', err);
    }
  }, [sessionTabs, workspacePath, mode, onSessionChange, markSessionAsRead]);

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

  // Close tab when session is archived (without deleting the session data)
  const closeArchivedSession = useCallback((sessionId: string) => {
    setSessionTabs(prev => {
      const filtered = prev.filter(tab => tab.id !== sessionId);
      if (activeTabId === sessionId && filtered.length > 0) {
        setActiveTabId(filtered[0].id);
        if (onSessionChange) {
          onSessionChange(filtered[0].id);
        }
      } else if (activeTabId === sessionId && filtered.length === 0) {
        setActiveTabId(null);
        if (onSessionChange) {
          onSessionChange(null);
        }
      }
      return filtered;
    });
  }, [activeTabId, onSessionChange]);

  // Create a new session
  const createNewSession = useCallback(async (planPath?: string) => {
    try {
      const session = await window.electronAPI.aiCreateSession(
        'claude-code',
        undefined,
        workspacePath,
        undefined,
        mode === 'agent' ? 'coding' : 'chat'
      );

    // Add metadata if needed
    if (mode === 'agent') {
      const metadata: any = {
        sessionType: 'coding',
        fileEdits: [],
        todos: []
      };

      if (planPath !== undefined) {
        metadata.planDocumentPath = planPath;
      }

      await window.electronAPI.invoke('sessions:update-session-metadata', session.id, metadata);
    }

    const tabName = planPath
      ? `Plan: ${getFileName(planPath)}`
      : `Session ${sessionTabs.length + 1}`;

    const sessionData = await window.electronAPI.aiLoadSession(session.id, workspacePath);
    if (!sessionData) {
      throw new Error('Failed to load newly created session');
    }

    // If planPath provided, create @ mention for draft input
    let initialDraftInput = sessionData.draftInput;
    if (planPath) {
      // Convert absolute path to workspace-relative path
      let relativePath = planPath;
      if (planPath.startsWith(workspacePath)) {
        relativePath = planPath.substring(workspacePath.length);
        // Remove leading slash if present
        if (relativePath.startsWith('/')) {
          relativePath = relativePath.substring(1);
        }
      }
      initialDraftInput = `@${relativePath} `;
    }

    const newTab: SessionTab = {
      id: sessionData.id,
      name: tabName,
      sessionData,
      draftInput: initialDraftInput,
      mode: sessionData.mode || 'agent',
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
    triggerSessionHistoryRefresh('new-session');

    if (planPath && mode === 'agent') {
      await window.electronAPI.invoke('plan-status:notify-session-created', {
        sessionId: sessionData.id,
        planDocumentPath: planPath
      });
    }

    if (onSessionChange) {
      onSessionChange(sessionData.id);
    }

    // Focus the input after a brief delay to ensure the component is rendered
    // If we have planPath, position cursor at end of the @ mention
    setTimeout(() => {
      const ref = sessionViewRefsRef.current.get(sessionData.id);
      if (planPath) {
        // Focus and move cursor to end
        ref?.current?.focusInput();
        // Additional timeout to ensure input is focused before setting cursor
        setTimeout(() => {
          const inputElement = ref?.current?.getInputElement?.();
          if (inputElement && inputElement.selectionStart !== undefined) {
            const length = inputElement.value.length;
            inputElement.setSelectionRange(length, length);
          }
        }, 10);
      } else {
        ref?.current?.focusInput();
      }
    }, 50);

      return sessionData;
    } catch (error) {
      console.error('[AgenticPanel] Failed to create session:', error);
      throw error;
    }
  }, [sessionTabs, workspacePath, mode, loadSessions, onSessionChange, triggerSessionHistoryRefresh]);

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
                    draftInput: sessionData.draftInput,
                    mode: sessionData.mode || 'agent',
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
                  draftInput: sessionData.draftInput,
                  mode: sessionData.mode || 'agent',
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
              ? `Plan: ${getFileName(planPath)}`
              : 'Session 1';

            const tab: SessionTab = {
              id: sessionData.id,
              name: tabName,
              sessionData,
              draftInput: sessionData.draftInput,
              mode: sessionData.mode || 'agent',
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
      if (!data || !data.sessionId) return;

      const isRelevantSession = sessionTabsRef.current.some(tab => tab.id === data.sessionId) || data.sessionId === activeTabId;

      if (!isRelevantSession) {
        return;
      }

      // Only reload when assistant messages are saved to the database.
      // User messages are already added to local state before being sent,
      // so reloading on 'input' direction causes race conditions with streaming responses.
      if (data.direction !== 'output') {
        return;
      }

      scheduleSessionReload(data.sessionId, { reason: 'message-logged', minInterval: 120 });

      // Update session timestamp in SessionHistory without database reload
      setUpdatedSession({ id: data.sessionId, timestamp: Date.now() });

      // If this is the active tab, auto-mark as read after message completion
      // Use a delay to ensure the reload completes first
      if (data.sessionId === activeTabId) {
        setTimeout(async () => {
          const tab = sessionTabsRef.current.find(t => t.id === data.sessionId);
          if (tab) {
            const messages = tab.sessionData.messages || [];
            const lastMessage = messages[messages.length - 1];
            const lastMessageTimestamp = lastMessage?.timestamp ?? null;

            // console.log(`[AgenticPanel] Auto-marking active session ${data.sessionId} as read after message completion (timestamp: ${lastMessageTimestamp})`);

            // Update ref immediately
            readStateRef.current.set(data.sessionId, {
              lastReadMessageTimestamp: lastMessageTimestamp
            });

            // Update state
            setSessionTabs(prev => prev.filter(t => t != null).map(t => {
              if (t.id === data.sessionId) {
                return {
                  ...t,
                  sessionData: {
                    ...t.sessionData,
                    lastReadMessageTimestamp: lastMessageTimestamp
                  }
                };
              }
              return t;
            }));

            // Persist to database
            await window.electronAPI.invoke('sessions:mark-read', data.sessionId, lastMessageTimestamp);
          }
        }, 300); // Delay to allow reload to complete
      }

      // Note: We don't need to reload the entire session list here.
      // The session list will update its visual indicators (processing state, unread badges)
      // via the processingSessions and unreadSessions props, which update based on
      // sendingSessions state and message counts. No database query needed.
    };

    const cleanup = window.electronAPI.on('ai:message-logged', handleMessageLogged);

    return () => {
      cleanup?.();
    };
  }, [activeTabId, scheduleSessionReload]);

  // Listen for notification clicks to switch to session
  useEffect(() => {
    const handleNotificationClick = (data: { sessionId: string }) => {
      if (!data || !data.sessionId) return;
      // Find the session tab
      const sessionTab = sessionTabs.filter(tab => tab != null).find(tab => tab.id === data.sessionId);

      if (sessionTab) {
        // Session already open - just switch to it
        setActiveTabId(data.sessionId);
      } else {
        // Session not open - load it
        openSessionInTab(data.sessionId);
      }
    };

    const cleanup = window.electronAPI.on('notification-clicked', handleNotificationClick);

    return () => {
      cleanup?.();
    };
  }, [sessionTabs, openSessionInTab]);

  // Listen for session title updates (from automatic naming)
  useEffect(() => {
    const handleSessionTitleUpdated = (data: { sessionId: string; title: string }) => {
      if (!data || !data.sessionId || !data.title) return;

      // Update session tabs if the session is open
      setSessionTabs(prev => prev.map(tab => {
        if (tab && tab.id === data.sessionId) {
          return {
            ...tab,
            name: data.title,
            sessionData: {
              ...tab.sessionData,
              title: data.title
            }
          };
        }
        return tab;
      }));

      // Update available sessions list
      setAvailableSessions(prev => prev.map(session => {
        if (session.id === data.sessionId) {
          return { ...session, title: data.title, name: data.title };
        }
        return session;
      }));

      // Update session history efficiently without database reload
      setRenamedSession({ id: data.sessionId, title: data.title });
    };

    const cleanup = window.electronAPI.on('session:title-updated', handleSessionTitleUpdated);

    return () => {
      cleanup?.();
    };
  }, []);

  // Listen for streaming responses and completion
  // This handles real-time updates during AI streaming:
  // - Updates assistant message content as it streams in
  // - Adds tool calls as they execute
  // - Final completion triggers database reload for consistency
  useEffect(() => {
    const handleStreamResponse = async (data: any) => {
      if (!data || !data.sessionId) return;
      // Check if this session is relevant to this panel (any open tab)
      const isRelevantSession = sessionTabsRef.current.some(tab => tab.id === data.sessionId);
      if (!isRelevantSession) {
        return;
      }

      const reason = data.isComplete ? 'stream-complete' : 'stream-update';

      if (data.isComplete) {
        const holdForAutoContext = data.autoContextPending === true;

        if (holdForAutoContext) {
          autoContextSessionsRef.current.add(data.sessionId);
        } else {
          sendingSessionsRef.current.delete(data.sessionId);
          setSendingSessions(prev => {
            const next = new Set(prev);
            next.delete(data.sessionId);
            return next;
          });
        }
        // Schedule reload to get the latest message from database
        scheduleSessionReload(data.sessionId, { immediate: true, reason });

        // If this is the active tab, mark it as read immediately (after reload completes)
        // We need to wait a tiny bit for the reload to populate the message with an ID
        if (data.sessionId === activeTabId) {
          setTimeout(async () => {
            const tab = sessionTabsRef.current.find(t => t.id === data.sessionId);
            if (tab) {
              const messages = tab.sessionData.messages || [];
              const lastMessage = messages[messages.length - 1];
              const lastMessageTimestamp = lastMessage?.timestamp ?? null;

              if (lastMessageTimestamp) {
                // Update ref immediately (synchronous)
                readStateRef.current.set(data.sessionId, {
                  lastReadMessageTimestamp: lastMessageTimestamp
                });

                // Update local state immediately for responsive UI
                setSessionTabs(prev => prev.filter(t => t != null).map(t => {
                  if (t.id === data.sessionId) {
                    return {
                      ...t,
                      sessionData: {
                        ...t.sessionData,
                        lastReadMessageTimestamp: lastMessageTimestamp
                      }
                    };
                  }
                  return t;
                }));

                // Persist to database (don't await, fire and forget)
                window.electronAPI.invoke('sessions:mark-read', data.sessionId, lastMessageTimestamp).catch(err => {
                  console.error('[AgenticPanel] Failed to mark active session as read:', err);
                });
              }
            }
          }, 200); // Just enough time for the reload to complete
        }
        return;
      }

      scheduleSessionReload(data.sessionId, { reason, minInterval: 150 });
    };

    const handleStreamError = (error: any) => {
      console.error('[AgenticPanel] AI error:', error);

      if (typeof error?.sessionId === 'string') {
        const sessionId = error.sessionId;

        // Clear sending state immediately
        sendingSessionsRef.current.delete(sessionId);
        setSendingSessions(prev => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });

        // Also clear autoContext state if session was waiting for it
        // This ensures the UI is fully cleaned up even if completion signal is missing
        autoContextSessionsRef.current.delete(sessionId);

        // The error is logged to database by ClaudeCodeProvider.logError()
        // The message-logged event will fire when the write completes
        // and trigger a session reload automatically via handleMessageLogged
      }
    };

    const cleanupStreamResponse = window.electronAPI.onAIStreamResponse(handleStreamResponse);
    const cleanupError = window.electronAPI.onAIError(handleStreamError);

    // Handle queued prompt starting
    const handleQueuePromptStarting = (data: { sessionId: string; message: string }) => {
      if (!data || !data.sessionId) return;
      // Mark session as sending/loading
      sendingSessionsRef.current.add(data.sessionId);
      setSendingSessions(prev => new Set(prev).add(data.sessionId));

      // Add user message to UI immediately
      setSessionTabs(prev => prev.filter(tab => tab != null).map(tab => {
        if (tab.id === data.sessionId) {
          const baseMessages = tab.sessionData.messages || [];
          const userMessage = {
            role: 'user' as const,
            content: data.message,
            timestamp: Date.now()
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
              messages: [...baseMessages, userMessage, thinkingMessage]
            }
          };
        }
        return tab;
      }));
    };

    const cleanupQueuePromptStarting = window.electronAPI.on('ai:queue-prompt-starting', handleQueuePromptStarting);

    // Handle token usage updates
    const handleTokenUsageUpdated = (data: {
      sessionId: string;
      tokenUsage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        contextWindow: number;
        categories?: TokenUsageCategory[];
      }
    }) => {
      if (!data || !data.sessionId) return;
      // Update token usage in state
      setSessionTabs(prev => prev.filter(tab => tab != null).map(tab => {
        if (tab.id !== data.sessionId) return tab;
        return {
          ...tab,
          sessionData: {
            ...tab.sessionData,
            tokenUsage: data.tokenUsage
          }
        };
      }));

      // Reload session to get filtered messages (removes /context messages)
      scheduleSessionReload(data.sessionId, {
        reason: 'token-usage-updated',
        immediate: true,  // Reload immediately to show updated messages
        minInterval: 0
      });
    };

    const cleanupTokenUsageUpdated = window.electronAPI.on('ai:tokenUsageUpdated', handleTokenUsageUpdated);

    return () => {
      cleanupStreamResponse();
      cleanupError();
      cleanupQueuePromptStarting();
      cleanupTokenUsageUpdated();
    };
  }, [activeTabId, workspacePath, scheduleSessionReload]);

  useEffect(() => {
    const handleAutoContextEnd = (data: { sessionId: string }) => {
      if (!data || !data.sessionId) return;
      if (!autoContextSessionsRef.current.has(data.sessionId)) {
        return;
      }

      autoContextSessionsRef.current.delete(data.sessionId);
      sendingSessionsRef.current.delete(data.sessionId);
      setSendingSessions(prev => {
        const next = new Set(prev);
        next.delete(data.sessionId);
        return next;
      });
    };

    const cleanup = window.electronAPI.on('ai:auto-context-end', handleAutoContextEnd);

    return () => {
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      reloadTimersRef.current.forEach(timer => clearTimeout(timer));
      reloadTimersRef.current.clear();
      lastReloadAtRef.current.clear();
      reloadInProgressRef.current.clear();
    };
  }, []);

  // Handle draft input change (optimized to avoid recreating all tabs)
  const handleDraftInputChange = useCallback((sessionId: string, value: string) => {
    setSessionTabs(prev => {
      const filtered = prev.filter(tab => tab != null);
      const index = filtered.findIndex(tab => tab.id === sessionId);
      if (index === -1 || filtered[index].draftInput === value) {
        return filtered;
      }

      const newTabs = [...filtered];
      newTabs[index] = { ...filtered[index], draftInput: value };
      return newTabs;
    });
  }, []);

  // Persist draft input to database (debounced)
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    sessionTabs.forEach(tab => {
      if (tab.draftInput !== undefined) {
        // Clear existing timer for this session
        const existingTimer = timers.get(tab.id);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        // Set new timer to save after 500ms of inactivity
        const timer = setTimeout(async () => {
          try {
            await window.electronAPI.invoke('sessions:update-draft-input', tab.id, tab.draftInput || '');
          } catch (err) {
            console.error('[AgenticPanel] Failed to save draft input:', err);
          }
        }, 500);

        timers.set(tab.id, timer);
      }
    });

    return () => {
      timers.forEach(timer => clearTimeout(timer));
    };
  }, [sessionTabs]);

  // Handle draft attachments change (optimized to avoid recreating all tabs)
  const handleDraftAttachmentsChange = useCallback((sessionId: string, attachments: ChatAttachment[]) => {
    setSessionTabs(prev => {
      const filtered = prev.filter(tab => tab != null);
      const index = filtered.findIndex(tab => tab.id === sessionId);
      if (index === -1 || filtered[index].draftAttachments === attachments) return filtered;

      const newTabs = [...filtered];
      newTabs[index] = { ...filtered[index], draftAttachments: attachments };
      return newTabs;
    });
  }, []);

  // Handle history navigation (up/down arrow in input)
  const handleNavigateHistory = useCallback((sessionId: string, direction: 'up' | 'down') => {
    const currentTab = sessionTabs.filter(tab => tab != null).find(tab => tab.id === sessionId);
    if (!currentTab) return;

    // Extract user prompts from session messages, stripping system messages
    const userPrompts = currentTab.sessionData.messages
      .filter(msg => msg.role === 'user')
      .map(msg => stripSystemMessage(msg.content));

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
  const handleModeChange = useCallback(async (sessionId: string, newMode: AIMode) => {
    // Update local state
    setSessionTabs(prev => prev.filter(tab => tab != null).map(tab =>
      tab.id === sessionId ? { ...tab, mode: newMode } : tab
    ));

    // Persist mode to database
    try {
      await window.electronAPI.invoke('ai-sessions:update-metadata', sessionId, { mode: newMode });
    } catch (error) {
      console.error('[AgenticPanel] Failed to update session mode:', error);
    }
  }, []);

  // Handle model change
  const handleModelChange = useCallback(async (sessionId: string, newModel: string) => {
    console.log(`[AgenticPanel] handleModelChange called - sessionId: ${sessionId}, newModel: ${newModel}`);

    // Parse provider from model ID (format: "provider:model" or just "provider")
    const [newProvider, ...modelParts] = newModel.split(':');
    const actualModel = modelParts.length > 0 ? modelParts.join(':') : newModel;

    console.log(`[AgenticPanel] Parsed provider: ${newProvider}, model: ${actualModel}`);

    // Update local state immediately for responsive UI
    setSessionTabs(prev => prev.filter(tab => tab != null).map(tab => {
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

    sendingSessionsRef.current.add(sessionId);
    setSendingSessions(prev => new Set(prev).add(sessionId));

    // Get the session to determine sessionType
    const currentTab = sessionTabs.filter(tab => tab != null).find(tab => tab.id === sessionId);
    const sessionType = currentTab?.sessionData?.sessionType || (mode === 'agent' ? 'coding' : 'chat');

    // Add user message immediately
    setSessionTabs(prev => prev.filter(tab => tab != null).map(tab => {
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

        // In agent mode, strip out filePath - we work across entire codebase
        if (mode === 'agent') {
          delete serializableContext.filePath;
          delete serializableContext.content;
        }

        contextToSend = {
          ...serializableContext,
          workspacePath,  // CRITICAL: Add workspacePath for MCP tool routing
          sessionType,  // Include sessionType for MCP tool availability
          attachments: attachments.length > 0 ? attachments : undefined
        };

        // Debug log to verify filePath is included
        console.log('[AgenticPanel] Sending document context:', {
          hasFilePath: !!contextToSend.filePath,
          filePath: contextToSend.filePath,
          workspacePath: contextToSend.workspacePath,  // Log workspacePath
          sessionType: contextToSend.sessionType,
          hasContent: !!contextToSend.content,
          contentLength: contextToSend.content?.length
        });
      } else if (attachments.length > 0) {
        contextToSend = { attachments, sessionType, workspacePath };  // Include workspacePath even without document
      } else {
        // Even without document context or attachments, pass sessionType and workspacePath
        contextToSend = { sessionType, workspacePath };  // Include workspacePath for routing
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
      sendingSessionsRef.current.delete(sessionId);
      setSendingSessions(prev => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });

      // Remove thinking message on error
      setSessionTabs(prev => prev.filter(tab => tab != null).map(tab => {
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
      const result = await window.electronAPI.aiCancelRequest(sessionId);
      if (result.success) {
        sendingSessionsRef.current.delete(sessionId);
        setSendingSessions(prev => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });

        // Remove thinking message
        setSessionTabs(prev => prev.filter(tab => tab != null).map(tab => {
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
  const handleTabSelect = useCallback(async (tabId: string) => {
    setActiveTabId(tabId);
    if (onSessionChange) {
      onSessionChange(tabId);
    }

    // Mark the session as read when switching to it
    await markSessionAsRead(tabId);
  }, [onSessionChange, markSessionAsRead]);

  const handleTabClose = useCallback((tabId: string) => {
    const closingTab = sessionTabs.filter(t => t != null).find(t => t.id === tabId);
    if (closingTab) {
      setClosedSessions(prev => [closingTab, ...prev].slice(0, MAX_CLOSED_SESSION_HISTORY));
    }

    setSessionTabs(prev => {
      const filtered = prev.filter(t => t != null && t.id !== tabId);
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
      const newTabs = [...prev.filter(t => t != null)];
      const [movedTab] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, movedTab);
      return newTabs;
    });
  }, []);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    createNewSession,
    openSessionInTab,
    closeActiveTab: () => {
      if (activeTabId) {
        handleTabClose(activeTabId);
      }
    },
    nextTab: () => {
      const filtered = sessionTabs.filter(t => t != null);
      if (filtered.length === 0 || !activeTabId) return;
      const currentIndex = filtered.findIndex(t => t.id === activeTabId);
      const nextIndex = (currentIndex + 1) % filtered.length;
      handleTabSelect(filtered[nextIndex].id);
    },
    previousTab: () => {
      const filtered = sessionTabs.filter(t => t != null);
      if (filtered.length === 0 || !activeTabId) return;
      const currentIndex = filtered.findIndex(t => t.id === activeTabId);
      const prevIndex = currentIndex <= 0 ? filtered.length - 1 : currentIndex - 1;
      handleTabSelect(filtered[prevIndex].id);
    }
  }), [createNewSession, activeTabId, handleTabClose, sessionTabs, handleTabSelect]);

  const handleTogglePin = useCallback((tabId: string) => {
    setSessionTabs(prev => {
      const filtered = prev.filter(t => t != null);
      const tab = filtered.find(t => t.id === tabId);
      if (!tab) return filtered;

      const newIsPinned = !tab.isPinned;
      const updatedTab = { ...tab, isPinned: newIsPinned };

      let newTabs = filtered.map(t => t.id === tabId ? updatedTab : t);

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
    // Update the tab name in sessionTabs
    setSessionTabs(prev => prev.filter(tab => tab != null).map(tab => {
      if (tab.id === tabId) {
        return { ...tab, name: newName };
      }
      return tab;
    }));

    try {
      // Save to database
      await window.electronAPI.invoke('sessions:update-title', tabId, newName);

      // Update availableSessions so SessionDropdown (chat mode) shows the new name
      setAvailableSessions(prev => prev.map(session => {
        if (session.id === tabId) {
          return { ...session, title: newName, name: newName };
        }
        return session;
      }));

      // Update SessionHistory efficiently without database reload
      setRenamedSession({ id: tabId, title: newName });
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

  const handleOpenImportDialog = useCallback(() => {
    setImportDialogOpen(true);
  }, []);

  const handleImportSessions = useCallback(async (sessionIds: string[]) => {
    try {
      console.log('[AgenticPanel] Importing sessions:', sessionIds);

      const result = await window.electronAPI.invoke('claude-code:sync-sessions', {
        sessionIds,
        workspacePath
      });

      if (result.success) {
        console.log('[AgenticPanel] Import successful:', result);
        // Reload sessions to show imported ones
        await loadSessions();
        triggerSessionHistoryRefresh('import');
      } else {
        console.error('[AgenticPanel] Import failed:', result.error);
        // TODO: Show error notification to user
      }
    } catch (err) {
      console.error('[AgenticPanel] Failed to import sessions:', err);
      // TODO: Show error notification to user
    }
  }, [loadSessions, workspacePath, triggerSessionHistoryRefresh]);

  // Helper to determine if a session has unread messages
  const hasUnreadMessages = useCallback((tab: SessionTab): boolean => {
    const messages = tab.sessionData.messages || [];
    if (messages.length === 0) return false;

    // Get the last message
    const lastMessage = messages[messages.length - 1];

    // Only consider it unread if:
    // 1. Last message is from assistant
    // 2. It's not a thinking message
    if (lastMessage.role !== 'assistant' || lastMessage.isThinking) {
      return false;
    }

    // Check read state from ref first (synchronous, most up-to-date)
    // Fall back to session data if ref doesn't have it
    const refReadState = readStateRef.current.get(tab.id);
    const lastReadMessageTimestamp = refReadState?.lastReadMessageTimestamp ?? tab.sessionData.lastReadMessageTimestamp;
    const lastMessageTimestamp = lastMessage.timestamp;

    // console.log(`[AgenticPanel] hasUnreadMessages check for session ${tab.id}:`, {
    //   lastMessageTimestamp,
    //   lastReadMessageTimestamp,
    //   refHasData: !!refReadState,
    //   messagesLength: messages.length
    // });

    // If no read state is tracked yet (undefined or null), consider it unread
    if (!lastReadMessageTimestamp) {
      // console.log(`[AgenticPanel] Session ${tab.id} has no read state - marking as unread`);
      return true;
    }

    // Check if the last message is newer than the last read message
    const isUnread = lastMessageTimestamp > lastReadMessageTimestamp;
    // console.log(`[AgenticPanel] Session ${tab.id} unread status: ${isUnread} (last message: ${lastMessageTimestamp}, last read: ${lastReadMessageTimestamp})`);

    return isUnread;
  }, []);

  // Get sets of processing and unread session IDs
  // Memoize these Sets to prevent unnecessary re-renders of SessionHistory
  // Combines both local sending state and global running state from session state manager
  const processingSessions = React.useMemo(() => {
    const combined = new Set<string>();
    sendingSessions.forEach(id => combined.add(id));
    runningSessions.forEach(id => combined.add(id));
    return combined;
  }, [sendingSessions, runningSessions]);

  // Create a stable key for unread sessions based only on message state, not draft input
  // This prevents re-computation when only draft input changes (typing in the input field)
  const unreadSessionsKey = React.useMemo(() => {
    return sessionTabs.filter(tab => tab != null).map(tab => {
      const messages = tab.sessionData.messages || [];
      const lastMessage = messages[messages.length - 1];
      const refReadState = readStateRef.current.get(tab.id);
      const lastReadTimestamp = refReadState?.lastReadMessageTimestamp ?? tab.sessionData.lastReadMessageTimestamp;
      return `${tab.id}:${lastMessage?.timestamp ?? 0}:${lastReadTimestamp ?? 0}:${sendingSessions.has(tab.id)}`;
    }).join('|');
  }, [sessionTabs, sendingSessions]);

  const unreadSessions = React.useMemo(() => {
    const unreadIds = new Set<string>();
    sessionTabs.filter(tab => tab != null).forEach(tab => {
      if (hasUnreadMessages(tab) && !sendingSessions.has(tab.id)) {
        unreadIds.add(tab.id);
      }
    });
    return unreadIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadSessionsKey]);

  // Memoize loadedSessionIds to prevent creating new array on every render
  const loadedSessionIds = React.useMemo(() => {
    return sessionTabs.filter(tab => tab != null).map(tab => tab.id);
  }, [sessionTabs]);

  // Convert SessionTab to Tab format for TabBar
  const convertToTabs = (sessionTabs: SessionTab[]): Tab[] => {
    return sessionTabs.filter(tab => tab != null).map(tab => ({
      id: tab.id,
      filePath: `session://${tab.id}`,
      fileName: tab.name,
      content: '',
      isDirty: false,
      isPinned: tab.isPinned || false,
      isVirtual: true,
      isProcessing: processingSessions.has(tab.id),
      // Only show unread for inactive tabs that aren't processing
      hasUnread: tab.id !== activeTabId && !processingSessions.has(tab.id) && hasUnreadMessages(tab)
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
    const activeTab = sessionTabs.filter(tab => tab != null).find(tab => tab.id === activeTabId);

    // console.log('[AgenticPanel] Chat mode - onContentModeChange available:', !!onContentModeChange);

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-primary)' }}>
        {/* Header with session dropdown */}
        <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between' }}>
          <SessionDropdown
            currentSessionId={activeTabId}
            sessions={availableSessions}
            processingSessions={processingSessions}
            unreadSessions={unreadSessions}
            onSessionSelect={openSessionInTab}
            onNewSession={() => createNewSession()}
            onDeleteSession={deleteSession}
            onOpenSessionManager={onContentModeChange ? () => {
              console.log('[AgenticPanel] All Sessions clicked, switching to agent mode');
              onContentModeChange('agent');
            } : undefined}
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
            ref={getSessionViewRef(activeTab.id)}
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
            isLoading={sendingSessions.has(activeTab.id)}
            aiMode={activeTab.mode || 'agent'}
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
                data-testid="new-session-button"
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
            loadedSessionIds={loadedSessionIds}
            processingSessions={processingSessions}
            unreadSessions={unreadSessions}
            renamedSession={renamedSession}
            updatedSession={updatedSession}
            onSessionSelect={openSessionInTab}
            onSessionDelete={deleteSession}
            onSessionArchive={closeArchivedSession}
            onNewSession={() => createNewSession()}
            onImportSessions={handleOpenImportDialog}
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
            {sessionTabs.filter(tab => tab != null).map(tab => (
              <AISessionView
                key={tab.id}
                ref={getSessionViewRef(tab.id)}
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
                isLoading={sendingSessions.has(tab.id)}
                aiMode={tab.mode || 'agent'}
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

      {/* Session Import Dialog */}
      <SessionImportDialog
        isOpen={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImport={handleImportSessions}
        currentWorkspacePath={workspacePath}
        filterByWorkspace={true}  // Only show sessions for current workspace
      />
    </div>
  );
});
export default AgenticPanel
