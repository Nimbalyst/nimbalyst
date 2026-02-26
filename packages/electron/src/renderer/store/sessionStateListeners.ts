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
  sessionLastReadAtom,
  sessionHasPendingInteractivePromptAtom,
  sessionRegistryAtom,
  sessionStoreAtom,
} from './atoms/sessions';
import { workstreamActiveChildAtom, workstreamStateAtom } from './atoms/workstreamState';
import { setWindowModeAtom } from './atoms/windowMode';
import { triggerWorktreeRefreshAtom } from './atoms/gitOperations';

// Per-session debounce timers for reloadSessionDataAtom.
// During active streaming, message-logged fires on every chunk, which would
// trigger a full DB reload of ALL messages each time. Debouncing collapses
// these into one reload per RELOAD_DEBOUNCE_MS window per session.
const reloadDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const RELOAD_DEBOUNCE_MS = 1000;

// Per-session verification reload timers.
// After session:completed fires the immediate reload, a second "verification" reload
// runs after a short delay. This catches race conditions where:
// - The immediate reload raced with DB writes and got stale data
// - The reload was aborted by version tracking due to concurrent reloads
// - The IPC call failed silently
const verificationReloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
const VERIFICATION_RELOAD_DELAY_MS = 2000;

// Per-session debounce timers for syncing lastReadAt to other devices.
// When the user is actively viewing a session that's streaming, we need to
// push lastReadAt so iOS doesn't show it as unread. But message-logged fires
// on every chunk, so we debounce to avoid spamming the sync server.
const readStateSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const READ_STATE_SYNC_DEBOUNCE_MS = 5000;

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
        // Also clear pending interactive prompt state - if session ended, no longer waiting
        store.set(sessionHasPendingInteractivePromptAtom(sessionId), false);

        // Clear any pending debounce timer for this session - the final reload below
        // will fetch the complete state, so a stale debounced reload is unnecessary
        {
          const pendingTimer = reloadDebounceTimers.get(sessionId);
          if (pendingTimer) {
            clearTimeout(pendingTimer);
            reloadDebounceTimers.delete(sessionId);
          }
        }

        // Trigger a final session data reload as a safety net.
        // During streaming, ai:message-logged events trigger debounced reloads.
        // But those events can be silently dropped if sessionListWorkspaceAtom
        // is null (e.g., after HMR re-evaluates the sessions module, or during
        // a race between listener init and session list init). This final reload
        // on session:completed ensures all messages are loaded regardless.
        {
          let workspacePath = store.get(sessionListWorkspaceAtom);
          // Fallback: get workspace path from session registry if the global atom is null
          if (!workspacePath) {
            const registry = store.get(sessionRegistryAtom);
            const sessionMeta = registry.get(sessionId);
            if (sessionMeta?.workspaceId) {
              workspacePath = sessionMeta.workspaceId;
            }
          }
          if (workspacePath) {
            // Immediate reload
            store.set(reloadSessionDataAtom, { sessionId, workspacePath });

            // Schedule a verification reload after a short delay.
            // This is a safety net that catches multiple failure modes:
            // 1. The immediate reload raced with final DB writes and got stale data
            // 2. The reload was aborted by version tracking (concurrent reload events)
            // 3. The IPC call failed silently
            // 4. Non-blocking writes hadn't flushed despite the provider's flush call
            // The cost is one extra DB read per session completion - negligible.
            const verificationWorkspacePath = workspacePath;
            const existingVerification = verificationReloadTimers.get(sessionId);
            if (existingVerification) {
              clearTimeout(existingVerification);
            }
            verificationReloadTimers.set(sessionId, setTimeout(() => {
              verificationReloadTimers.delete(sessionId);
              store.set(reloadSessionDataAtom, { sessionId, workspacePath: verificationWorkspacePath });
            }, VERIFICATION_RELOAD_DELAY_MS));
          }
        }

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
    let workspacePath = store.get(sessionListWorkspaceAtom);

    // Fallback: get workspace path from session registry if the global atom is null
    // This can happen after HMR re-evaluates the sessions module, or during
    // a race between listener init and session list init.
    if (!workspacePath) {
      const registry = store.get(sessionRegistryAtom);
      const sessionMeta = registry.get(sessionId);
      if (sessionMeta?.workspaceId) {
        workspacePath = sessionMeta.workspaceId;
      }
    }

    if (!workspacePath || !sessionId) {
      return;
    }

    // Debounce session data reload per session.
    // During active streaming, message-logged fires on every chunk which would
    // trigger a full DB reload of ALL messages (2000+) each time. PGLite is
    // single-threaded, so these reads queue up and block writes, causing a
    // cascading slowdown. Debouncing collapses rapid events into one reload.
    const existingTimer = reloadDebounceTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    reloadDebounceTimers.set(sessionId, setTimeout(() => {
      reloadDebounceTimers.delete(sessionId);
      store.set(reloadSessionDataAtom, { sessionId, workspacePath });
    }, RELOAD_DEBOUNCE_MS));

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
      } else {
        // Session IS currently viewed - push lastReadAt (debounced) so other
        // devices (iOS) know the user is reading these messages in real time.
        // Without this, iOS would show the session as unread because it sees
        // lastMessageAt increasing but lastReadAt staying stale.
        const existingReadTimer = readStateSyncTimers.get(sessionId);
        if (existingReadTimer) {
          clearTimeout(existingReadTimer);
        }
        readStateSyncTimers.set(sessionId, setTimeout(() => {
          readStateSyncTimers.delete(sessionId);
          window.electronAPI?.invoke('ai:updateSessionMetadata', sessionId, {
            metadata: { hasUnread: false, lastReadAt: Date.now() },
          }).catch((err: Error) => {
            console.error('[sessionStateListeners] Failed to sync read state:', err);
          });
        }, READ_STATE_SYNC_DEBOUNCE_MS));
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
   * Sets the pending interactive prompt indicator for the sidebar.
   */
  const handleAskUserQuestion = (data: { sessionId: string; questionId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    store.set(sessionHasPendingInteractivePromptAtom(sessionId), true);
  };

  /**
   * Handle AskUserQuestion answered/cancelled events globally.
   * Clears the pending interactive prompt indicator.
   */
  const handleAskUserQuestionResolved = (data: { sessionId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    store.set(sessionHasPendingInteractivePromptAtom(sessionId), false);
  };

  /**
   * Handle ExitPlanMode confirm events globally.
   * Sets pending interactive prompt indicator for the sidebar.
   */
  const handleExitPlanModeConfirm = (data: { sessionId: string; requestId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    store.set(sessionHasPendingInteractivePromptAtom(sessionId), true);
  };

  /**
   * Handle ExitPlanMode response events globally.
   * Clears pending indicator and updates session mode if approved.
   */
  const handleExitPlanModeResolved = (data: { sessionId: string; approved?: boolean }) => {
    const { sessionId, approved } = data;
    if (!sessionId) return;
    store.set(sessionHasPendingInteractivePromptAtom(sessionId), false);

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
   * Sets pending interactive prompt indicator for the sidebar.
   */
  const handleToolPermission = (data: { sessionId: string; requestId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    store.set(sessionHasPendingInteractivePromptAtom(sessionId), true);
  };

  /**
   * Handle ToolPermission resolved events globally.
   * Clears pending interactive prompt indicator.
   */
  const handleToolPermissionResolved = (data: { sessionId: string; requestId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    store.set(sessionHasPendingInteractivePromptAtom(sessionId), false);
  };

  /**
   * Handle GitCommitProposal events globally.
   * Sets pending interactive prompt indicator for the sidebar.
   */
  const handleGitCommitProposal = (data: { sessionId: string; proposalId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    store.set(sessionHasPendingInteractivePromptAtom(sessionId), true);
  };

  /**
   * Handle GitCommitProposal resolved events globally.
   * Clears pending interactive prompt indicator.
   */
  const handleGitCommitProposalResolved = (data: { sessionId: string; proposalId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;
    store.set(sessionHasPendingInteractivePromptAtom(sessionId), false);
  };

  /**
   * Handle notification click events.
   * Switches to the session that was clicked in the OS notification.
   * If the session is a child of a workstream, selects the parent instead.
   */
  const handleNotificationClicked = (data: { sessionId: string }) => {
    const { sessionId } = data;
    if (!sessionId) return;

    const workspacePath = store.get(sessionListWorkspaceAtom);
    if (!workspacePath) {
      console.warn('[sessionStateListeners] No workspace path available for notification click');
      return;
    }

    // Switch to agent mode so the session is visible
    store.set(setWindowModeAtom, 'agent');

    // Check if this is a child session - if so, select the parent workstream
    const registry = store.get(sessionRegistryAtom);
    const sessionMeta = registry.get(sessionId);
    if (sessionMeta?.parentSessionId) {
      // Child session - select parent and set this child as active
      const parentState = store.get(workstreamStateAtom(sessionMeta.parentSessionId));
      const parentType = parentState.type === 'worktree' ? 'worktree'
        : parentState.type === 'workstream' ? 'workstream'
        : 'workstream'; // Default to workstream since it has children
      store.set(setSelectedWorkstreamAtom, {
        workspacePath,
        selection: { type: parentType, id: sessionMeta.parentSessionId },
      });
      return;
    }

    // Root session - determine its type
    const state = store.get(workstreamStateAtom(sessionId));
    const type = state.type === 'worktree' ? 'worktree'
      : state.type === 'workstream' ? 'workstream'
      : 'session';

    store.set(setSelectedWorkstreamAtom, {
      workspacePath,
      selection: { type, id: sessionId },
    });
  };

  /**
   * Handle cross-device read state from sync.
   * When another device (e.g. mobile) reads a session, update the unread atom.
   */
  const handleSyncReadState = (data: { sessionId: string; lastReadAt: number; lastMessageAt: number }) => {
    const { sessionId, lastReadAt, lastMessageAt } = data;
    if (!sessionId) return;

    // If the session was read after the last message, mark it as read
    if (lastReadAt >= lastMessageAt) {
      store.set(sessionUnreadAtom(sessionId), false);
      store.set(sessionLastReadAtom(sessionId), lastReadAt);
    }
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
  let cleanupGitCommitProposalResolved: (() => void) | undefined;
  let cleanupNotificationClicked: (() => void) | undefined;
  let cleanupSyncReadState: (() => void) | undefined;
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
    cleanupGitCommitProposalResolved = window.electronAPI.on('ai:gitCommitProposalResolved', handleGitCommitProposalResolved);
    cleanupNotificationClicked = window.electronAPI.on('notification-clicked', handleNotificationClicked);
    cleanupSyncReadState = window.electronAPI.on('sessions:sync-read-state', handleSyncReadState);
  }

  // Return cleanup function
  return () => {
    // Clear all pending debounce timers
    for (const timer of reloadDebounceTimers.values()) {
      clearTimeout(timer);
    }
    reloadDebounceTimers.clear();

    for (const timer of verificationReloadTimers.values()) {
      clearTimeout(timer);
    }
    verificationReloadTimers.clear();

    for (const timer of readStateSyncTimers.values()) {
      clearTimeout(timer);
    }
    readStateSyncTimers.clear();

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
    cleanupGitCommitProposalResolved?.();
    cleanupNotificationClicked?.();
    cleanupSyncReadState?.();
  };
}
