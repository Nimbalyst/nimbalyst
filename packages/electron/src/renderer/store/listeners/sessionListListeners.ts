/**
 * Centralized IPC listeners for session list events
 *
 * Follows the pattern from centralized-ipc-listener-architecture.md:
 * - Components NEVER subscribe to IPC events directly
 * - Central listeners update atoms
 * - Components read from atoms
 */

import { store } from '../index';
import { refreshSessionListAtom, sessionListWorkspaceAtom } from '../atoms/sessions';

// Track pending refresh to debounce rapid-fire events
let pendingRefreshTimer: NodeJS.Timeout | null = null;
const DEBOUNCE_MS = 150; // Debounce rapid refreshes within 150ms

/**
 * Initialize session list IPC listeners.
 * Should be called once at app startup.
 */
export function initSessionListListeners(): () => void {
  const cleanups: Array<() => void> = [];

  // Handle session list refresh requests (e.g., from mobile sync, session creation)
  const handleRefreshRequest = (data: { workspacePath: string; sessionId?: string }) => {
    const { workspacePath } = data;

    // Only refresh if the event is for the current workspace
    const currentWorkspace = store.get(sessionListWorkspaceAtom);
    if (currentWorkspace !== workspacePath) {
      return;
    }

    // Clear any pending refresh
    if (pendingRefreshTimer) {
      clearTimeout(pendingRefreshTimer);
    }

    // Debounce: Only refresh after 150ms of no more events
    pendingRefreshTimer = setTimeout(async () => {
      pendingRefreshTimer = null;

      // Trigger atom refresh which queries database
      await store.set(refreshSessionListAtom);
    }, DEBOUNCE_MS);
  };

  cleanups.push(
    window.electronAPI.on('sessions:refresh-list', handleRefreshRequest)
  );

  // Cleanup function
  return () => {
    // Clear pending timer
    if (pendingRefreshTimer) {
      clearTimeout(pendingRefreshTimer);
      pendingRefreshTimer = null;
    }

    // Remove IPC listeners
    cleanups.forEach(fn => fn?.());
  };
}
