/**
 * Centralized IPC listeners for Super Loop events
 *
 * Follows the centralized IPC listener architecture (see docs/IPC_LISTENERS.md):
 * - Components NEVER subscribe to IPC events directly
 * - Central listeners update atoms
 * - Components read from atoms
 *
 * Events handled:
 * - super-loop:event -> processSuperEventAtom (loop state changes)
 * - super-loop:iteration-prompt -> orchestrates AI session for iteration
 *
 * Call initSuperLoopListeners() once in AgentMode.tsx on mount.
 */

import { store } from '../index';
import { processSuperEventAtom } from '../atoms/superLoop';
import type { SuperLoopEvent } from '../../../shared/types/superLoop';

/**
 * Initialize Super Loop IPC listeners.
 * Should be called once at app startup.
 *
 * @returns Cleanup function to call on unmount
 */
export function initSuperLoopListeners(): () => void {
  const cleanups: Array<() => void> = [];

  // Track pending sessions so we can clean up listeners on shutdown.
  // Maps sessionId -> cleanup function for its ai:streamResponse/ai:error listeners.
  const pendingSessionCleanups = new Map<string, () => void>();

  // =========================================================================
  // Super Loop Events (state changes)
  // =========================================================================
  cleanups.push(
    window.electronAPI.on('super-loop:event', (superLoopEvent: SuperLoopEvent) => {
      if (!superLoopEvent || typeof superLoopEvent !== 'object') {
        console.warn('[superLoopListeners] Received invalid super loop event:', superLoopEvent);
        return;
      }
      store.set(processSuperEventAtom, superLoopEvent);
    })
  );

  // =========================================================================
  // Super Loop Iteration Prompts (session orchestration)
  // =========================================================================
  cleanups.push(
    window.electronAPI.on('super-loop:iteration-prompt', async (
      data: {
        superLoopId: string;
        sessionId: string;
        prompt: string;
        worktreePath: string;
        workspaceId: string;
      }
    ) => {
      if (!data || typeof data !== 'object' || !data.superLoopId || !data.sessionId) {
        console.warn('[superLoopListeners] Received invalid iteration prompt data:', data);
        return;
      }

      try {
        console.log('[superLoopListeners] Processing iteration prompt:', {
          superLoopId: data.superLoopId,
          sessionId: data.sessionId,
        });

        // Set up listener for stream completion BEFORE sending message.
        // Clean up listeners immediately on resolve to prevent stale handlers.
        const streamCompletePromise = new Promise<void>((resolve) => {
          let resolved = false;

          const doResolve = () => {
            if (resolved) return;
            resolved = true;
            // Clean up listeners immediately to prevent stale handlers
            const cleanup = pendingSessionCleanups.get(data.sessionId);
            if (cleanup) {
              cleanup();
              pendingSessionCleanups.delete(data.sessionId);
            }
            resolve();
          };

          const handleStreamResponse = (response: {
            sessionId: string;
            isComplete?: boolean;
          }) => {
            if (response.sessionId === data.sessionId && response.isComplete) {
              console.log('[superLoopListeners] Session stream complete:', data.sessionId);
              doResolve();
            }
          };

          const handleError = (error: { sessionId: string }) => {
            if (error.sessionId === data.sessionId) {
              console.log('[superLoopListeners] Session error, resolving:', data.sessionId);
              doResolve();
            }
          };

          const cleanupStream = window.electronAPI.on('ai:streamResponse', handleStreamResponse);
          const cleanupError = window.electronAPI.on('ai:error', handleError);

          pendingSessionCleanups.set(data.sessionId, () => {
            cleanupStream?.();
            cleanupError?.();
          });
        });

        // Send the message to the AI service
        await window.electronAPI.invoke(
          'ai:sendMessage',
          data.prompt,
          undefined, // No document context
          data.sessionId,
          data.workspaceId
        );

        // Wait for the stream to complete
        await streamCompletePromise;

        // Notify main process that session completed successfully
        console.log('[superLoopListeners] Notifying session complete:', data.sessionId);
        window.electronAPI.send('super-loop:session-complete', data.sessionId, true);
      } catch (err) {
        console.error('[superLoopListeners] Failed to process iteration prompt:', err);
        // Clean up any pending listeners
        const cleanup = pendingSessionCleanups.get(data.sessionId);
        if (cleanup) {
          cleanup();
          pendingSessionCleanups.delete(data.sessionId);
        }
        // Still notify completion so the loop can continue/handle error
        window.electronAPI.send('super-loop:session-complete', data.sessionId, false);
      }
    })
  );

  // Cleanup function
  return () => {
    // Remove IPC listeners
    cleanups.forEach(fn => fn?.());

    // Clean up any pending session listeners
    for (const cleanupFn of pendingSessionCleanups.values()) {
      cleanupFn();
    }
    pendingSessionCleanups.clear();
  };
}
