/**
 * Session State Listeners
 *
 * Centralized subscription to session state change events.
 * Updates Jotai atoms based on session lifecycle events from the AI provider.
 *
 * This replaces the scattered session state listeners that were in the old
 * AgenticPanel component. Now session state updates are centralized and
 * consistent across the entire app.
 *
 * ## Problem
 * The old AgenticPanel was subscribing to session:started/completed events
 * and updating sessionProcessingAtom. When we switched to the new Jotai-based
 * architecture, these listeners were removed, causing:
 * - Sessions showing as not running when they are
 * - Processing indicators not updating
 * - Messages not reloading properly
 *
 * ## Solution
 * This module provides centralized, global listeners for:
 * - Session processing state (session:started/completed/error)
 * - Message reloads (ai:message-logged) for sessions not currently mounted
 */

import { store } from '@nimbalyst/runtime/store';
import {
  sessionProcessingAtom,
  reloadSessionDataAtom,
  sessionListWorkspaceAtom,
  updateSessionStoreAtom,
  selectedWorkstreamAtom,
  setSelectedWorkstreamAtom,
  sessionUnreadAtom,
  sessionWaitingForQuestionAtom,
  sessionWaitingForPlanApprovalAtom,
  sessionRegistryAtom,
  sessionStoreAtom,
  refreshPendingPromptsAtom,
} from './atoms/sessions';
import { workstreamActiveChildAtom, workstreamStateAtom } from './atoms/workstreamState';
import { triggerWorktreeRefreshAtom } from './atoms/gitOperations';

/**
 * Initialize global session state listeners.
 * Should be called once at app startup (or when AgentMode mounts).
 *
 * @returns Cleanup function to remove listeners
 */
export function initSessionStateListeners(): () => void {
  if (!window.electronAPI?.sessionState) {
    console.warn('[sessionStateListeners] sessionState API not available');
    return () => {};
  }

  /**
   * Handle session state change events.
   * These events come from the AI provider and track the session lifecycle.
   */
  const handleStateChange = (event: {
    type: string;
    sessionId: string;
    [key: string]: any;
  }) => {
    const { type, sessionId } = event;

    switch (type) {
      // Session is actively running
      case 'session:started':
      case 'session:streaming':
      case 'session:waiting':
        store.set(sessionProcessingAtom(sessionId), true);
        break;

      // Session has finished (successfully or with error)
      case 'session:completed':
      case 'session:error':
      case 'session:interrupted':
        store.set(sessionProcessingAtom(sessionId), false);
        // Also clear waiting states - if session ended, no longer waiting
        store.set(sessionWaitingForQuestionAtom(sessionId), false);
        store.set(sessionWaitingForPlanApprovalAtom(sessionId), false);

        // If this session is in a worktree, trigger a git panel refresh
        // This ensures the GitOperationsPanel shows updated status after agent work
        //
        // We check multiple sources for worktreeId since there can be race conditions
        // between IPC events and renderer state updates:
        // 1. sessionRegistryAtom - populated by addSessionFullAtom (optimistic)
        // 2. sessionStoreAtom - loaded session data from database
        // 3. workstreamStateAtom - initialized when session is selected
        {
          let worktreeId: string | null = null;

          // Try registry first (most common case)
          const registry = store.get(sessionRegistryAtom);
          const sessionMeta = registry.get(sessionId);
          if (sessionMeta?.worktreeId) {
            worktreeId = sessionMeta.worktreeId;
          }

          // Fallback to session store (loaded session data)
          if (!worktreeId) {
            const sessionData = store.get(sessionStoreAtom(sessionId));
            if (sessionData?.worktreeId) {
              worktreeId = sessionData.worktreeId;
            }
          }

          // Fallback to workstream state (set when session is initialized)
          if (!worktreeId) {
            const workstreamState = store.get(workstreamStateAtom(sessionId));
            if (workstreamState?.worktreeId) {
              worktreeId = workstreamState.worktreeId;
            }
          }

          if (worktreeId) {
            store.set(triggerWorktreeRefreshAtom, worktreeId);
          }
        }
        break;

      default:
        // Unknown event type - ignore
        break;
    }
  };

  /**
   * Handle message-logged events globally.
   * This ensures that sessions get reloaded even when their SessionTranscript
   * component is not currently mounted (e.g., inactive tabs, child sessions not selected).
   *
   * SessionTranscript also subscribes to this event for the active session,
   * but this handler provides a safety net for all other sessions.
   *
   * Also marks sessions as unread when they receive output messages while not being
   * the currently viewed session.
   */
  const handleMessageLogged = (data: { sessionId: string; direction: string }) => {
    const { sessionId, direction } = data;
    const workspacePath = store.get(sessionListWorkspaceAtom);

    if (!workspacePath || !sessionId) {
      return;
    }

    // Reload session data to pick up the new message
    // Note: SessionTranscript also does this for mounted sessions, but this
    // ensures unmounted sessions (child sessions, inactive tabs) get updated too
    store.set(reloadSessionDataAtom, { sessionId, workspacePath });

    // Update session metadata with updatedAt timestamp and ensure it's unarchived
    // The database layer already sets is_archived = FALSE when a message is added,
    // but we need to update the UI state to match
    // This automatically syncs both sessionStoreAtom and sessionRegistryAtom
    store.set(updateSessionStoreAtom, { sessionId, updates: { updatedAt: Date.now(), isArchived: false } });

    // Mark as unread if this is an output message (agent response) and the session
    // is not currently being viewed
    if (direction === 'output') {
      const selectedWorkstream = store.get(selectedWorkstreamAtom(workspacePath));

      // Determine the currently viewed session ID
      // For a single session, it's the workstream ID itself
      // For a workstream/worktree, it's the active child within it
      let currentlyViewedSessionId: string | null = null;
      if (selectedWorkstream) {
        const activeChild = store.get(workstreamActiveChildAtom(selectedWorkstream.id));
        currentlyViewedSessionId = activeChild || selectedWorkstream.id;
      }

      // If this message is for a session that's not currently viewed, mark it as unread
      if (sessionId !== currentlyViewedSessionId) {
        store.set(sessionUnreadAtom(sessionId), true);

        // Persist to database metadata for cross-device sync
        window.electronAPI?.invoke('ai:updateSessionMetadata', sessionId, {
          metadata: { hasUnread: true },
        }).catch((err: Error) => {
          console.error('[sessionStateListeners] Failed to persist unread state:', err);
        });
      }
    }
  };

  /**
   * Handle session title updates globally.
   * This ensures the session list updates when the agent names a session via MCP tool.
   */
  const handleTitleUpdated = (data: { sessionId: string; title: string }) => {
    const { sessionId, title } = data;
    if (!sessionId || !title) return;

    // Update session with new title
    // This automatically syncs both sessionStoreAtom and sessionRegistryAtom
    store.set(updateSessionStoreAtom, { sessionId, updates: { title, updatedAt: Date.now() } });
  };

  /**
   * Handle AskUserQuestion events globally.
   * Refreshes pending prompts from DB to update all relevant atoms.
   * The DB is the source of truth - IPC is just a notification to refresh.
   */
  const handleAskUserQuestion = (data: { sessionId: string; questionId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    // Refresh pending prompts from DB - this updates all derived atoms
    store.set(refreshPendingPromptsAtom, sessionId);
  };

  /**
   * Handle AskUserQuestion answered/cancelled events globally.
   * Refreshes pending prompts from DB to remove the answered question.
   */
  const handleAskUserQuestionResolved = (data: { sessionId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    // Refresh pending prompts from DB
    store.set(refreshPendingPromptsAtom, sessionId);
  };

  /**
   * Handle ExitPlanMode confirmation events globally.
   * Refreshes pending prompts from DB to update all relevant atoms.
   */
  const handleExitPlanModeConfirm = (data: { sessionId: string; requestId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    // Refresh pending prompts from DB
    store.set(refreshPendingPromptsAtom, sessionId);
  };

  /**
   * Handle ExitPlanMode response events globally.
   * Refreshes pending prompts from DB to remove the approved/denied plan.
   * Also updates the session mode to 'agent' if the plan was approved.
   */
  const handleExitPlanModeResolved = (data: { sessionId: string; approved?: boolean }) => {
    const { sessionId, approved } = data;
    if (!sessionId) return;
    // Refresh pending prompts from DB
    store.set(refreshPendingPromptsAtom, sessionId);

    // If approved, update the session mode atom to 'agent' to sync with database
    if (approved) {
      store.set(updateSessionStoreAtom, {
        sessionId,
        updates: { mode: 'agent' },
      });
    }
  };

  /**
   * Handle ToolPermission events globally.
   * Refreshes pending prompts from DB.
   */
  const handleToolPermission = (data: { sessionId: string; requestId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    store.set(refreshPendingPromptsAtom, sessionId);
  };

  /**
   * Handle ToolPermission resolved events globally.
   * Refreshes pending prompts from DB.
   */
  const handleToolPermissionResolved = (data: { sessionId: string; requestId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    store.set(refreshPendingPromptsAtom, sessionId);
  };

  /**
   * Handle GitCommitProposal events globally.
   * Refreshes pending prompts from DB to update all relevant atoms.
   */
  const handleGitCommitProposal = (data: { sessionId: string; proposalId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    store.set(refreshPendingPromptsAtom, sessionId);
  };

  /**
   * Handle notification click events.
   * Switches to the session that was clicked in the OS notification.
   */
  const handleNotificationClicked = (data: { sessionId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;

    const workspacePath = store.get(sessionListWorkspaceAtom);
    if (!workspacePath) {
      console.warn('[sessionStateListeners] No workspace path available for notification click');
      return;
    }

    // Switch to the session
    store.set(setSelectedWorkstreamAtom, {
      workspacePath,
      selection: { type: 'session', id: sessionId },
    });
  };

  // First, subscribe to the session state manager (IPC call to register this window)
  window.electronAPI.sessionState.subscribe()
    .then((result: any) => {
      if (!result.success) {
        console.error('[sessionStateListeners] Failed to subscribe to session state manager:', result.error);
      }
    })
    .catch((error: any) => {
      console.error('[sessionStateListeners] Error subscribing to session state manager:', error);
    });

  // Fetch currently active sessions and restore their processing state
  // This handles the case where the renderer refreshes while sessions are running
  window.electronAPI.sessionState.getActiveSessionIds?.()
    .then((result: { success: boolean; sessionIds: string[] }) => {
      if (result.success && result.sessionIds.length > 0) {
        for (const sessionId of result.sessionIds) {
          store.set(sessionProcessingAtom(sessionId), true);
        }
      }
    })
    .catch((error: any) => {
      console.error('[sessionStateListeners] Error fetching active sessions:', error);
    });

  // Then, listen for state change events
  window.electronAPI.sessionState.onStateChange(handleStateChange);

  // Subscribe to message logged events and interactive prompt events
  let cleanupMessageLogged: (() => void) | undefined;
  let cleanupTitleUpdated: (() => void) | undefined;
  let cleanupAskUserQuestion: (() => void) | undefined;
  let cleanupAskUserQuestionAnswered: (() => void) | undefined;
  let cleanupSessionCancelled: (() => void) | undefined;
  let cleanupExitPlanModeConfirm: (() => void) | undefined;
  let cleanupExitPlanModeResolved: (() => void) | undefined;
  let cleanupToolPermission: (() => void) | undefined;
  let cleanupToolPermissionResolved: (() => void) | undefined;
  let cleanupGitCommitProposal: (() => void) | undefined;
  let cleanupNotificationClicked: (() => void) | undefined;
  if (window.electronAPI?.on) {
    cleanupMessageLogged = window.electronAPI.on('ai:message-logged', handleMessageLogged);
    cleanupTitleUpdated = window.electronAPI.on('session:title-updated', handleTitleUpdated);
    cleanupAskUserQuestion = window.electronAPI.on('ai:askUserQuestion', handleAskUserQuestion);
    cleanupAskUserQuestionAnswered = window.electronAPI.on('ai:askUserQuestionAnswered', handleAskUserQuestionResolved);
    cleanupSessionCancelled = window.electronAPI.on('ai:sessionCancelled', handleAskUserQuestionResolved);
    cleanupExitPlanModeConfirm = window.electronAPI.on('ai:exitPlanModeConfirm', handleExitPlanModeConfirm);
    cleanupExitPlanModeResolved = window.electronAPI.on('ai:exitPlanModeResolved', handleExitPlanModeResolved);
    cleanupToolPermission = window.electronAPI.on('ai:toolPermission', handleToolPermission);
    cleanupToolPermissionResolved = window.electronAPI.on('ai:toolPermissionResolved', handleToolPermissionResolved);
    cleanupGitCommitProposal = window.electronAPI.on('ai:gitCommitProposal', handleGitCommitProposal);
    cleanupNotificationClicked = window.electronAPI.on('notification-clicked', handleNotificationClicked);
  }

  // Return cleanup function
  return () => {
    window.electronAPI.sessionState?.removeStateChangeListener?.(handleStateChange);
    window.electronAPI.sessionState?.unsubscribe?.();
    cleanupMessageLogged?.();
    cleanupTitleUpdated?.();
    cleanupAskUserQuestion?.();
    cleanupAskUserQuestionAnswered?.();
    cleanupSessionCancelled?.();
    cleanupExitPlanModeConfirm?.();
    cleanupExitPlanModeResolved?.();
    cleanupToolPermission?.();
    cleanupToolPermissionResolved?.();
    cleanupGitCommitProposal?.();
    cleanupNotificationClicked?.();
  };
}
