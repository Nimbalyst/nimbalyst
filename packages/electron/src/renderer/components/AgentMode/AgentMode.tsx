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

import React, { forwardRef, useImperativeHandle, useEffect, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { ResizablePanel } from '../AgenticCoding/ResizablePanel';
import { SessionHistory } from '../AgenticCoding/SessionHistory';
import { AgentWorkstreamPanel } from './AgentWorkstreamPanel';
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
} from '../../store';
import { errorNotificationService } from '../../services/ErrorNotificationService';
import { initWorkstreamState, loadWorkstreamStates, workstreamStateAtom } from '../../store/atoms/workstreamState';
import { initSessionStateListeners } from '../../store/sessionStateListeners';
import './AgentMode.css';

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
 * This component has NO useState. All state comes from atoms.
 */
export const AgentMode = forwardRef<AgentModeRef, AgentModeProps>(function AgentMode({
  workspacePath,
  workspaceName,
  isActive = true,
  onFileOpen,
  onOpenQuickSearch,
}, ref) {
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

  // Create new session
  const createNewSession = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      const sessionId = crypto.randomUUID();
      const result = await window.electronAPI.invoke('sessions:create', {
        session: {
          id: sessionId,
          provider: 'claude-code',
          model: 'claude-code:sonnet',
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
          model: 'claude-code:sonnet',
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
  }, [workspacePath, addSession, setSelectedWorkstream]);

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
          model: 'claude-code:sonnet',
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
          model: 'claude-code:sonnet',
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
  }, [workspacePath, addSession, setSelectedWorkstream]);

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
  }, [workspacePath, setSelectedWorkstream]);

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
      // TODO: Implement when we have tab management
      setSelectedWorkstream({ workspacePath, selection: null });
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

  // Content for the right side
  const rightContent = selectedWorkstream ? (
    <AgentWorkstreamPanel
      workspacePath={workspacePath}
      workstreamId={selectedWorkstream.id}
      workstreamType={selectedWorkstream.type}
      onFileOpen={onFileOpen}
    />
  ) : (
    <div className="agent-mode-empty">
      <p>Select a session or create a new one to get started</p>
      <button onClick={createNewSession} className="agent-mode-new-button">
        New Session
      </button>
    </div>
  );

  // Content for the left side (session history)
  const leftContent = (
    <SessionHistory
      workspacePath={workspacePath}
      activeSessionId={selectedWorkstream?.id || null}
      onSessionSelect={handleSessionSelect}
      onChildSessionSelect={handleChildSessionSelect}
      onSessionDelete={handleSessionDelete}
      onSessionArchive={handleSessionArchive}
      onSessionRename={handleSessionRename}
      onSessionBranch={handleSessionBranch}
      onNewSession={createNewSession}
      onNewWorktreeSession={createNewWorktreeSession}
      collapsedGroups={collapsedGroups}
      onCollapsedGroupsChange={(groups) => setCollapsedGroups(groups)}
      sortOrder={sortOrder}
      onSortOrderChange={(order) => setSortOrder(order)}
      onOpenQuickSearch={onOpenQuickSearch}
      mode="agent"
    />
  );

  return (
    <div className="agent-mode">
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
