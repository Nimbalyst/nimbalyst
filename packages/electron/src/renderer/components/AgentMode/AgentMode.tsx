/**
 * AgentMode - Clean rewrite of AgenticPanel with state pushed down.
 *
 * Key principles:
 * 1. NO useState in this component - it's just a layout shell
 * 2. All state comes from Jotai atoms
 * 3. WorkstreamList subscribes to atoms internally (no props except workspacePath)
 * 4. AgentWorkstreamPanel is fully self-contained
 *
 * This replaces AgenticPanel with a simpler architecture that eliminates
 * the massive re-renders caused by holding sessionTabs[] in useState.
 */

import React, { forwardRef, useImperativeHandle, useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { defaultAgentModelAtom } from '../../store/atoms/appSettings';
import { ResizablePanel } from '../AgenticCoding/ResizablePanel';
import { SessionHistory } from '../AgenticCoding/SessionHistory';
import { AgentWorkstreamPanel, type AgentWorkstreamPanelRef } from './AgentWorkstreamPanel';
import {
  selectedWorkstreamAtom,
  setSelectedWorkstreamAtom,
  sessionHistoryWidthAtom,
  sessionHistoryCollapsedAtom,
  collapsedGroupsAtom,
  sortOrderAtom,
  setSessionHistoryWidthAtom,
  setCollapsedGroupsAtom,
  setSortOrderAtom,
  initSessionList,
  initAgentModeLayout,
  initSessionEditors,
  addSessionFullAtom,
  setWorkstreamActiveChildAtom,
  loadSessionChildrenAtom,
  store,
  refreshSessionListAtom,
  removeSessionFullAtom,
  updateSessionStoreAtom,
  sessionRegistryAtom,
} from '../../store';
import { errorNotificationService } from '../../services/ErrorNotificationService';
import { initWorkstreamState, loadWorkstreamStates, workstreamStateAtom, workstreamActiveChildAtom } from '../../store/atoms/workstreamState';
import { initSessionStateListeners } from '../../store/sessionStateListeners';

export interface AgentModeRef {
  createNewSession: () => Promise<void>;
  openSessionInTab: (sessionId: string) => Promise<void>;
  closeActiveTab: () => void;
  reopenLastClosedSession: () => void;
  nextTab: () => void;
  previousTab: () => void;
}

export interface AgentModeProps {
  workspacePath: string;
  workspaceName?: string;
  isActive?: boolean;
  onFileOpen?: (filePath: string) => Promise<void>;
  onOpenQuickSearch?: () => void;
}

/**
 * AgentMode is the top-level container for the agent workspace.
 *
 * Layout:
 * - Left sidebar: WorkstreamList (session/workstream list)
 * - Right side: AgentWorkstreamPanel (selected workstream)
 *
 * Most state comes from atoms. The isGitRepo state is local since it's
 * only needed for the SessionHistory component's worktree button.
 */
export const AgentMode = forwardRef<AgentModeRef, AgentModeProps>(function AgentMode({
  workspacePath,
  workspaceName,
  isActive = true,
  onFileOpen,
  onOpenQuickSearch,
}, ref) {
  // Ref to the workstream panel for closing tabs
  const workstreamPanelRef = useRef<AgentWorkstreamPanelRef>(null);

  // Git repo status for worktree feature
  const [isGitRepo, setIsGitRepo] = useState(false);

  // Layout state from atoms
  const historyWidth = useAtomValue(sessionHistoryWidthAtom);
  const historyCollapsed = useAtomValue(sessionHistoryCollapsedAtom);
  const collapsedGroups = useAtomValue(collapsedGroupsAtom);
  const sortOrder = useAtomValue(sortOrderAtom);

  // Selection state
  const selectedWorkstream = useAtomValue(selectedWorkstreamAtom(workspacePath));
  const setSelectedWorkstream = useSetAtom(setSelectedWorkstreamAtom);

  // Layout setters
  const setHistoryWidth = useSetAtom(setSessionHistoryWidthAtom);
  const setCollapsedGroups = useSetAtom(setCollapsedGroupsAtom);
  const setSortOrder = useSetAtom(setSortOrderAtom);
  const addSession = useSetAtom(addSessionFullAtom);

  // Default model for new sessions (user's last selected model)
  const defaultModel = useAtomValue(defaultAgentModelAtom);

  // Get the active child session ID if the selected workstream has one
  const activeChildAtom = useMemo(
    () => selectedWorkstream ? workstreamActiveChildAtom(selectedWorkstream.id) : atom(null),
    [selectedWorkstream?.id]
  );
  const activeChildId = useAtomValue(activeChildAtom);

  // The actual active session is either the active child OR the workstream parent
  const actualActiveSessionId = activeChildId || selectedWorkstream?.id || null;

  // Initialize on mount
  useEffect(() => {
    initSessionList(workspacePath);
    initAgentModeLayout(workspacePath);
    initSessionEditors(workspacePath);
    // Initialize unified workstream state
    initWorkstreamState(workspacePath);
    loadWorkstreamStates(workspacePath);
  }, [workspacePath]);

  // Initialize session state listeners (global, runs once)
  useEffect(() => {
    const cleanup = initSessionStateListeners();
    return cleanup;
  }, []);

  // Check if workspace is a git repository (needed for worktree feature)
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.invoke) {
      setIsGitRepo(false);
      return;
    }

    window.electronAPI.invoke('git:is-repo', workspacePath)
      .then(result => {
        if (result?.success) {
          setIsGitRepo(result.isRepo);
        } else {
          setIsGitRepo(false);
        }
      })
      .catch(() => {
        setIsGitRepo(false);
      });
  }, [workspacePath]);

  // Create new session
  const createNewSession = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      const sessionId = crypto.randomUUID();
      const result = await window.electronAPI.invoke('sessions:create', {
        session: {
          id: sessionId,
          provider: 'claude-code',
          model: defaultModel,
          title: 'New Session',
        },
        workspaceId: workspacePath,
      });

      if (result.success && result.id) {
        // Add to session list
        addSession({
          id: result.id,
          name: 'New Session',
          title: 'New Session',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          provider: 'claude-code',
          model: defaultModel,
          sessionType: 'coding',
          messageCount: 0,
          projectPath: workspacePath,
        });

        // Select the new session
        setSelectedWorkstream({
          workspacePath,
          selection: { type: 'session', id: result.id },
        });
      }
    } catch (error) {
      console.error('[AgentMode] Failed to create session:', error);
    }
  }, [workspacePath, addSession, setSelectedWorkstream, defaultModel]);

  // Create new worktree session
  const createNewWorktreeSession = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      // Create the worktree
      const worktreeResult = await window.electronAPI.invoke('worktree:create', workspacePath);
      if (!worktreeResult?.success || !worktreeResult.worktree) {
        throw new Error(worktreeResult?.error || 'Failed to create worktree');
      }

      const worktree = worktreeResult.worktree;

      // Create session with worktree association
      const sessionId = crypto.randomUUID();
      const result = await window.electronAPI.invoke('sessions:create', {
        session: {
          id: sessionId,
          provider: 'claude-code',
          model: defaultModel,
          title: `Worktree: ${worktree.name}`,
          worktreeId: worktree.id,
        },
        workspaceId: workspacePath,
      });

      if (result.success && result.id) {
        // Add to session list
        addSession({
          id: result.id,
          name: `Worktree: ${worktree.name}`,
          title: `Worktree: ${worktree.name}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          provider: 'claude-code',
          model: defaultModel,
          sessionType: 'coding',
          messageCount: 0,
          projectPath: workspacePath,
          worktreeId: worktree.id,
        });

        // Initialize workstream state with worktree type
        store.set(workstreamStateAtom(result.id), {
          type: 'worktree',
          worktreeId: worktree.id,
        });

        // Select the new worktree session
        setSelectedWorkstream({
          workspacePath,
          selection: { type: 'worktree', id: result.id },
        });
      }
    } catch (error) {
      console.error('[AgentMode] Failed to create worktree session:', error);
    }
  }, [workspacePath, addSession, setSelectedWorkstream, defaultModel]);

  // Add session to an existing worktree
  const addSessionToWorktree = useCallback(async (worktreeId: string) => {
    if (!window.electronAPI) return;

    try {
      // Get the worktree data to use its name
      const worktreeResult = await window.electronAPI.invoke('worktree:get', worktreeId);
      if (!worktreeResult?.worktree) {
        throw new Error('Worktree not found');
      }

      const worktree = worktreeResult.worktree;

      // Create session with worktree association (no parentSessionId - this is NOT a workstream)
      const sessionId = crypto.randomUUID();
      const result = await window.electronAPI.invoke('sessions:create', {
        session: {
          id: sessionId,
          provider: 'claude-code',
          model: defaultModel,
          title: `Session in ${worktree.displayName || worktree.name}`,
          worktreeId: worktree.id,
        },
        workspaceId: workspacePath,
      });

      if (result.success && result.id) {
        // Add to session list
        addSession({
          id: result.id,
          name: `Session in ${worktree.displayName || worktree.name}`,
          title: `Session in ${worktree.displayName || worktree.name}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          provider: 'claude-code',
          model: defaultModel,
          sessionType: 'coding',
          messageCount: 0,
          projectPath: workspacePath,
          worktreeId: worktree.id,
        });

        // Initialize workstream state with worktree type
        store.set(workstreamStateAtom(result.id), {
          type: 'worktree',
          worktreeId: worktree.id,
        });

        // Select the new session within the worktree
        setSelectedWorkstream({
          workspacePath,
          selection: { type: 'worktree', id: result.id },
        });
      } else {
        throw new Error(result.error || 'Failed to create session');
      }
    } catch (error) {
      errorNotificationService.showError(
        'Failed to Create Session',
        error instanceof Error ? error.message : 'An unexpected error occurred while adding a session to the worktree.',
        { duration: 5000 }
      );
    }
  }, [workspacePath, addSession, setSelectedWorkstream, defaultModel]);

  // Open session by ID
  const openSessionInTab = useCallback(async (sessionId: string) => {
    console.log('[AgentMode] openSessionInTab called with:', sessionId);

    // Check session list for parentSessionId (more reliable than aiLoadSession)
    try {
      const result = await window.electronAPI.invoke('sessions:list', workspacePath, { includeArchived: false });
      if (!result.success) {
        throw new Error('Failed to load session list');
      }

      const sessionListItem = result.sessions.find((s: any) => s.id === sessionId);
      console.log('[AgentMode] Session list item:', sessionListItem?.id, 'parentSessionId:', sessionListItem?.parentSessionId);

      // Check if session is in the registry - if not, add it
      // This handles cases where a session was just created (e.g., via rebase conflict resolution)
      const registry = store.get(sessionRegistryAtom);
      if (sessionListItem && !registry.has(sessionId)) {
        console.log('[AgentMode] Session not in registry, adding it');
        addSession({
          id: sessionListItem.id,
          name: sessionListItem.title || sessionListItem.name || 'Untitled Session',
          title: sessionListItem.title || sessionListItem.name || 'Untitled Session',
          createdAt: sessionListItem.createdAt,
          updatedAt: sessionListItem.updatedAt,
          provider: sessionListItem.provider || 'claude-code',
          model: sessionListItem.model,
          sessionType: sessionListItem.sessionType || 'coding',
          messageCount: sessionListItem.messageCount || 0,
          projectPath: workspacePath,
          isArchived: sessionListItem.isArchived || false,
          isPinned: sessionListItem.isPinned || false,
          worktreeId: sessionListItem.worktreeId || null,
          parentSessionId: sessionListItem.parentSessionId || null,
          childCount: sessionListItem.childCount || 0,
        });

        // If it's a worktree session, initialize workstream state
        if (sessionListItem.worktreeId) {
          console.log('[AgentMode] Initializing worktree state for session');
          store.set(workstreamStateAtom(sessionId), {
            type: 'worktree',
            worktreeId: sessionListItem.worktreeId,
          });
        }
      }

      if (sessionListItem?.parentSessionId) {
        // This is a child session in a workstream
        console.log('[AgentMode] Child session detected, parent:', sessionListItem.parentSessionId);

        // CRITICAL: Load the parent's children first to populate the workstream state
        // This ensures the child session IDs are in the state before we set active child
        await store.set(loadSessionChildrenAtom, {
          parentSessionId: sessionListItem.parentSessionId,
          workspacePath,
        });
        console.log('[AgentMode] Parent children loaded');

        // Now set the active child in the workstream state
        store.set(setWorkstreamActiveChildAtom, {
          workstreamId: sessionListItem.parentSessionId,
          childId: sessionId,
        });
        console.log('[AgentMode] Active child set to:', sessionId);

        // Finally, select the parent workstream
        const parentState = store.get(workstreamStateAtom(sessionListItem.parentSessionId));
        const parentType = parentState.type === 'worktree' ? 'worktree'
          : parentState.type === 'workstream' ? 'workstream'
          : 'session';

        console.log('[AgentMode] Selecting parent workstream:', sessionListItem.parentSessionId, 'type:', parentType);
        setSelectedWorkstream({
          workspacePath,
          selection: { type: parentType, id: sessionListItem.parentSessionId },
        });
      } else {
        // This is a root session - check its type
        const state = store.get(workstreamStateAtom(sessionId));
        const type = state.type === 'worktree' ? 'worktree'
          : state.type === 'workstream' ? 'workstream'
          : 'session';

        setSelectedWorkstream({
          workspacePath,
          selection: { type, id: sessionId },
        });
      }
    } catch (error) {
      console.error('[AgentMode] Failed to load session data:', error);
      // Fallback: treat as a simple session
      setSelectedWorkstream({
        workspacePath,
        selection: { type: 'session', id: sessionId },
      });
    }
  }, [workspacePath, setSelectedWorkstream, addSession]);

  // Handle session selection from list (for root sessions/workstreams)
  const handleSessionSelect = useCallback((sessionId: string) => {
    // Determine the actual type by checking the workstream state
    const state = store.get(workstreamStateAtom(sessionId));
    // Map internal state type ('single') to selection type ('session')
    const type = state.type === 'worktree' ? 'worktree'
      : state.type === 'workstream' ? 'workstream'
      : 'session';

    setSelectedWorkstream({
      workspacePath,
      selection: { type, id: sessionId },
    });
  }, [workspacePath, setSelectedWorkstream]);

  // Handle child session selection from workstream group
  // Opens the parent workstream and sets the child as active
  const handleChildSessionSelect = useCallback(async (
    childSessionId: string,
    parentId: string,
    parentType: 'workstream' | 'worktree'
  ) => {
    // Load the parent's children to populate workstream state
    await store.set(loadSessionChildrenAtom, {
      parentSessionId: parentId,
      workspacePath,
    });

    // Set the clicked child as active
    store.set(setWorkstreamActiveChildAtom, {
      workstreamId: parentId,
      childId: childSessionId,
    });

    // Select the parent workstream
    setSelectedWorkstream({
      workspacePath,
      selection: { type: parentType, id: parentId },
    });
  }, [workspacePath, setSelectedWorkstream]);

  // Session management atoms
  const refreshSessions = useSetAtom(refreshSessionListAtom);
  const removeSessionFromAtom = useSetAtom(removeSessionFullAtom);
  const updateSessionStore = useSetAtom(updateSessionStoreAtom);

  // Branch a session - creates a fork at the current message
  const handleSessionBranch = useCallback(async (sessionId: string) => {
    try {
      console.log('[AgentMode] Branching session:', sessionId);

      // Call IPC to create a branch
      const result = await window.electronAPI.invoke('sessions:branch', {
        parentSessionId: sessionId,
        workspacePath
      });

      if (result.success && result.session) {
        console.log('[AgentMode] Branch created:', result.session.id);

        // Refresh session list to show the new branch
        refreshSessions();

        // Open the new branch
        await openSessionInTab(result.session.id);
      } else {
        console.error('[AgentMode] Failed to branch session:', result.error);
        errorNotificationService.showError('Failed to branch conversation', result.error || 'Unknown error');
      }
    } catch (err) {
      console.error('[AgentMode] Error branching session:', err);
      errorNotificationService.showError('Failed to branch conversation', String(err));
    }
  }, [workspacePath, refreshSessions, openSessionInTab]);

  // Delete a session
  const handleSessionDelete = useCallback(async (sessionId: string) => {
    try {
      const result = await window.electronAPI.invoke('sessions:delete', sessionId);
      if (result.success) {
        // Remove from atom store
        removeSessionFromAtom(sessionId);

        // If this was the selected session, clear selection
        if (selectedWorkstream?.id === sessionId) {
          setSelectedWorkstream({ workspacePath, selection: null });
        }
      } else {
        console.error('[AgentMode] Failed to delete session:', result.error);
        errorNotificationService.showError('Failed to delete session', result.error || 'Unknown error');
      }
    } catch (err) {
      console.error('[AgentMode] Error deleting session:', err);
      errorNotificationService.showError('Failed to delete session', String(err));
    }
  }, [removeSessionFromAtom, selectedWorkstream, workspacePath, setSelectedWorkstream]);

  // Archive a session
  const handleSessionArchive = useCallback(async (sessionId: string) => {
    try {
      const result = await window.electronAPI.invoke('sessions:update-metadata', sessionId, { isArchived: true });
      if (result.success) {
        // Update in atom store (syncs both sessionStoreAtom and sessionRegistryAtom)
        updateSessionStore({ sessionId, updates: { isArchived: true } });

        // If this was the selected session, clear selection
        if (selectedWorkstream?.id === sessionId) {
          setSelectedWorkstream({ workspacePath, selection: null });
        }
      } else {
        console.error('[AgentMode] Failed to archive session:', result.error);
      }
    } catch (err) {
      console.error('[AgentMode] Error archiving session:', err);
    }
  }, [updateSessionStore, selectedWorkstream, workspacePath, setSelectedWorkstream]);

  // Rename a session
  const handleSessionRename = useCallback(async (sessionId: string, newName: string) => {
    try {
      const result = await window.electronAPI.invoke('sessions:update-metadata', sessionId, { title: newName });
      if (result.success) {
        // Update in atom store (syncs both sessionStoreAtom and sessionRegistryAtom)
        updateSessionStore({ sessionId, updates: { title: newName, updatedAt: Date.now() } });
      } else {
        console.error('[AgentMode] Failed to rename session:', result.error);
      }
    } catch (err) {
      console.error('[AgentMode] Error renaming session:', err);
    }
  }, [updateSessionStore]);

  // Expose ref methods
  useImperativeHandle(ref, () => ({
    createNewSession,
    openSessionInTab,
    closeActiveTab: () => {
      // Route to workstream panel - it will only close editor tabs if they have focus
      workstreamPanelRef.current?.closeActiveTab();
    },
    reopenLastClosedSession: () => {
      // TODO: Implement closed session stack
    },
    nextTab: () => {
      // TODO: Implement tab navigation
    },
    previousTab: () => {
      // TODO: Implement tab navigation
    },
  }), [createNewSession, openSessionInTab, workspacePath, setSelectedWorkstream]);

  // Handle worktree archived - refresh the session list to show updated state
  const handleWorktreeArchived = useCallback(() => {
    console.log('[AgentMode] Worktree archived, refreshing sessions');
    refreshSessions();
  }, [refreshSessions]);

  // Content for the right side
  const rightContent = selectedWorkstream ? (
    <AgentWorkstreamPanel
      ref={workstreamPanelRef}
      workspacePath={workspacePath}
      workstreamId={selectedWorkstream.id}
      workstreamType={selectedWorkstream.type}
      onFileOpen={onFileOpen}
      onAddSessionToWorktree={addSessionToWorktree}
      onWorktreeArchived={handleWorktreeArchived}
    />
  ) : (
    <div className="agent-mode-empty flex flex-col items-center justify-center h-full gap-4 text-nim-text-secondary">
      <p className="m-0 text-sm">Select a session or create a new one to get started</p>
      <button
        onClick={createNewSession}
        className="agent-mode-new-button py-2 px-4 rounded-md border border-nim-border bg-nim-bg-secondary text-nim-text-primary cursor-pointer text-sm transition-colors hover:bg-nim-bg-active"
      >
        New Session
      </button>
    </div>
  );

  // Content for the left side (session history)
  const leftContent = (
    <SessionHistory
      workspacePath={workspacePath}
      activeSessionId={actualActiveSessionId}
      onSessionSelect={handleSessionSelect}
      onChildSessionSelect={handleChildSessionSelect}
      onSessionDelete={handleSessionDelete}
      onSessionArchive={handleSessionArchive}
      onSessionRename={handleSessionRename}
      onSessionBranch={handleSessionBranch}
      onNewSession={createNewSession}
      onNewWorktreeSession={createNewWorktreeSession}
      onAddSessionToWorktree={addSessionToWorktree}
      isGitRepo={isGitRepo}
      collapsedGroups={collapsedGroups}
      onCollapsedGroupsChange={(groups) => setCollapsedGroups(groups)}
      sortOrder={sortOrder}
      onSortOrderChange={(order) => setSortOrder(order)}
      onOpenQuickSearch={onOpenQuickSearch}
      mode="agent"
    />
  );

  return (
    <div className="agent-mode flex flex-row h-full w-full overflow-hidden">
      <ResizablePanel
        leftPanel={leftContent}
        rightPanel={rightContent}
        leftWidth={historyWidth}
        minWidth={200}
        maxWidth={500}
        onWidthChange={(width) => setHistoryWidth(width)}
        collapsed={historyCollapsed}
      />
    </div>
  );
});
