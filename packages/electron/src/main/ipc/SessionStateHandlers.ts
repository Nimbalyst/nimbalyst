/**
 * IPC Handlers for Session State Management
 *
 * Provides cross-process communication for session state tracking.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getSessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import type { SessionStateEvent } from '@nimbalyst/runtime/ai/server/types/SessionState';

// Track if handlers are registered to prevent double registration
let handlersRegistered = false;

// Track active subscriptions per window
const windowSubscriptions = new Map<number, () => void>();

// Track sync subscription cleanup
let syncSubscriptionCleanup: (() => void) | null = null;

export async function registerSessionStateHandlers() {
  if (handlersRegistered) {
    console.log('[SessionStateHandlers] Handlers already registered, skipping');
    return;
  }

  const stateManager = getSessionStateManager();

  // Initialize the state manager
  await stateManager.initialize();

  // Subscribe to state changes and sync to mobile
  setupSyncSubscription(stateManager);

  // Get active session IDs
  ipcMain.handle('ai-session-state:get-active', async (_event) => {
    try {
      const activeIds = stateManager.getActiveSessionIds();
      return { success: true, sessionIds: activeIds };
    } catch (error) {
      console.error('[SessionStateHandlers] Error getting active sessions:', error);
      return { success: false, error: String(error), sessionIds: [] };
    }
  });

  // Get state for a specific session
  ipcMain.handle('ai-session-state:get-state', async (_event, sessionId: string) => {
    try {
      const state = stateManager.getSessionState(sessionId);
      return { success: true, state };
    } catch (error) {
      console.error('[SessionStateHandlers] Error getting session state:', error);
      return { success: false, error: String(error), state: null };
    }
  });

  // Check if session is active
  ipcMain.handle('ai-session-state:is-active', async (_event, sessionId: string) => {
    try {
      const isActive = stateManager.isSessionActive(sessionId);
      return { success: true, isActive };
    } catch (error) {
      console.error('[SessionStateHandlers] Error checking session active:', error);
      return { success: false, error: String(error), isActive: false };
    }
  });

  // Subscribe to state changes
  ipcMain.handle('ai-session-state:subscribe', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return { success: false, error: 'No window found for sender' };
      }

      const windowId = window.id;

      // Unsubscribe any existing subscription for this window
      const existingUnsubscribe = windowSubscriptions.get(windowId);
      if (existingUnsubscribe) {
        existingUnsubscribe();
      }

      // Create new subscription
      const unsubscribe = stateManager.subscribe((stateEvent: SessionStateEvent) => {
        // Send event to renderer
        if (!window.isDestroyed()) {
          window.webContents.send('ai-session-state:event', stateEvent);
        }
      });

      // Store unsubscribe function
      windowSubscriptions.set(windowId, unsubscribe);

      // Clean up when window closes
      window.once('closed', () => {
        const unsub = windowSubscriptions.get(windowId);
        if (unsub) {
          unsub();
          windowSubscriptions.delete(windowId);
        }
      });

      return { success: true };
    } catch (error) {
      console.error('[SessionStateHandlers] Error subscribing to state changes:', error);
      return { success: false, error: String(error) };
    }
  });

  // Unsubscribe from state changes
  ipcMain.handle('ai-session-state:unsubscribe', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return { success: false, error: 'No window found for sender' };
      }

      const windowId = window.id;
      const unsubscribe = windowSubscriptions.get(windowId);

      if (unsubscribe) {
        unsubscribe();
        windowSubscriptions.delete(windowId);
      }

      return { success: true };
    } catch (error) {
      console.error('[SessionStateHandlers] Error unsubscribing:', error);
      return { success: false, error: String(error) };
    }
  });

  // Start tracking a session (called when AI starts processing)
  ipcMain.handle('ai-session-state:start', async (_event, sessionId: string) => {
    try {
      await stateManager.startSession({ sessionId });
      return { success: true };
    } catch (error) {
      console.error('[SessionStateHandlers] Error starting session:', error);
      return { success: false, error: String(error) };
    }
  });

  // Update session activity
  ipcMain.handle('ai-session-state:update-activity', async (_event, sessionId: string, status?: string, isStreaming?: boolean) => {
    try {
      await stateManager.updateActivity({
        sessionId,
        status: status as any,
        isStreaming,
      });
      return { success: true };
    } catch (error) {
      console.error('[SessionStateHandlers] Error updating activity:', error);
      return { success: false, error: String(error) };
    }
  });

  // End tracking a session (called when AI completes)
  ipcMain.handle('ai-session-state:end', async (_event, sessionId: string) => {
    try {
      await stateManager.endSession(sessionId);
      return { success: true };
    } catch (error) {
      console.error('[SessionStateHandlers] Error ending session:', error);
      return { success: false, error: String(error) };
    }
  });

  // Interrupt a session (called on error or force stop)
  ipcMain.handle('ai-session-state:interrupt', async (_event, sessionId: string) => {
    try {
      await stateManager.interruptSession(sessionId);
      return { success: true };
    } catch (error) {
      console.error('[SessionStateHandlers] Error interrupting session:', error);
      return { success: false, error: String(error) };
    }
  });

  handlersRegistered = true;
  console.log('[SessionStateHandlers] Handlers registered successfully');
}

/**
 * Setup sync subscription to push execution state changes to mobile
 */
function setupSyncSubscription(stateManager: ReturnType<typeof getSessionStateManager>): void {
  // Lazy load sync manager to avoid circular dependencies
  import('../services/SyncManager').then(({ getSyncProvider }) => {
    const syncProvider = getSyncProvider();
    if (!syncProvider) {
      console.log('[SessionStateHandlers] Sync not enabled, skipping execution state sync');
      return;
    }

    console.log('[SessionStateHandlers] Setting up execution state sync to mobile');

    const unsubscribe = stateManager.subscribe((event: SessionStateEvent) => {
      // Sync execution state changes to mobile
      if (event.type === 'started' || event.type === 'ended' || event.type === 'interrupted') {
        const isExecuting = event.type === 'started';
        const sessionId = event.sessionId;

        console.log('[SessionStateHandlers] Syncing execution state:', { sessionId, isExecuting });

        // Push metadata update with isExecuting state
        syncProvider.pushChange(sessionId, {
          type: 'metadata_updated',
          metadata: {
            isExecuting,
            updatedAt: Date.now(),
          },
        });
      }
    });

    syncSubscriptionCleanup = unsubscribe;
  }).catch((error) => {
    console.error('[SessionStateHandlers] Failed to setup sync subscription:', error);
  });
}

/**
 * Shutdown handler - called when app is closing
 */
export async function shutdownSessionStateHandlers() {
  const stateManager = getSessionStateManager();
  await stateManager.shutdown();

  // Clean up sync subscription
  if (syncSubscriptionCleanup) {
    syncSubscriptionCleanup();
    syncSubscriptionCleanup = null;
  }

  // Clean up all subscriptions
  for (const unsubscribe of windowSubscriptions.values()) {
    unsubscribe();
  }
  windowSubscriptions.clear();

  console.log('[SessionStateHandlers] Shutdown complete');
}
