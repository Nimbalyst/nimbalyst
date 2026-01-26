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
  sessionUnreadAtom,
} from './atoms/sessions';
import { workstreamActiveChildAtom } from './atoms/workstreamState';

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

    // Update session metadata with updatedAt timestamp
    // This automatically syncs both sessionStoreAtom and sessionRegistryAtom
    store.set(updateSessionStoreAtom, { sessionId, updates: { updatedAt: Date.now() } });

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

  // Subscribe to message logged events
  let cleanupMessageLogged: (() => void) | undefined;
  let cleanupTitleUpdated: (() => void) | undefined;
  if (window.electronAPI?.on) {
    cleanupMessageLogged = window.electronAPI.on('ai:message-logged', handleMessageLogged);
    cleanupTitleUpdated = window.electronAPI.on('session:title-updated', handleTitleUpdated);
  }

  // Return cleanup function
  return () => {
    window.electronAPI.sessionState?.removeStateChangeListener?.(handleStateChange);
    window.electronAPI.sessionState?.unsubscribe?.();
    cleanupMessageLogged?.();
    cleanupTitleUpdated?.();
  };
}
