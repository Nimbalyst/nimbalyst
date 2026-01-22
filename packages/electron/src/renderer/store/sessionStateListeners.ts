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
} from './atoms/sessions';

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
   */
  const handleMessageLogged = (data: { sessionId: string; direction: string }) => {
    const { sessionId } = data;
    const workspacePath = store.get(sessionListWorkspaceAtom);

    if (!workspacePath || !sessionId) {
      return;
    }

    // Reload session data to pick up the new message
    // Note: SessionTranscript also does this for mounted sessions, but this
    // ensures unmounted sessions (child sessions, inactive tabs) get updated too
    store.set(reloadSessionDataAtom, { sessionId, workspacePath });
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

  // Then, listen for state change events
  window.electronAPI.sessionState.onStateChange(handleStateChange);

  // Subscribe to message logged events
  let cleanupMessageLogged: (() => void) | undefined;
  if (window.electronAPI?.on) {
    cleanupMessageLogged = window.electronAPI.on('ai:message-logged', handleMessageLogged);
  }

  // Return cleanup function
  return () => {
    window.electronAPI.sessionState?.removeStateChangeListener?.(handleStateChange);
    window.electronAPI.sessionState?.unsubscribe?.();
    cleanupMessageLogged?.();
  };
}
