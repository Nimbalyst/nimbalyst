/**
 * Centralized IPC listeners for Ralph Loop events
 *
 * Follows the centralized IPC listener architecture (see docs/IPC_LISTENERS.md):
 * - Components NEVER subscribe to IPC events directly
 * - Central listeners update atoms
 * - Components read from atoms
 *
 * Events handled:
 * - ralph:event -> processRalphEventAtom (loop state changes)
 * - ralph:iteration-prompt -> orchestrates AI session for iteration
 *
 * Call initRalphLoopListeners() once in AgentMode.tsx on mount.
 */

import { store } from '../index';
import { processRalphEventAtom } from '../atoms/ralphLoop';
import type { RalphLoopEvent } from '../../../shared/types/ralph';

/**
 * Initialize Ralph Loop IPC listeners.
 * Should be called once at app startup.
 *
 * @returns Cleanup function to call on unmount
 */
export function initRalphLoopListeners(): () => void {
  const cleanups: Array<() => void> = [];

  // Track pending sessions so we can clean up listeners on shutdown.
  // Maps sessionId -> cleanup function for its ai:streamResponse/ai:error listeners.
  const pendingSessionCleanups = new Map<string, () => void>();

  // =========================================================================
  // Ralph Loop Events (state changes)
  // =========================================================================
  cleanups.push(
    window.electronAPI.on('ralph:event', (ralphEvent: RalphLoopEvent) => {
      if (!ralphEvent || typeof ralphEvent !== 'object') {
        console.warn('[ralphLoopListeners] Received invalid ralph event:', ralphEvent);
        return;
      }
      store.set(processRalphEventAtom, ralphEvent);
    })
  );

  // =========================================================================
  // Ralph Iteration Prompts (session orchestration)
  // =========================================================================
  cleanups.push(
    window.electronAPI.on('ralph:iteration-prompt', async (
      data: {
        ralphId: string;
        sessionId: string;
        prompt: string;
        worktreePath: string;
        workspaceId: string;
      }
    ) => {
      if (!data || typeof data !== 'object' || !data.ralphId || !data.sessionId) {
        console.warn('[ralphLoopListeners] Received invalid iteration prompt data:', data);
        return;
      }

      try {
        console.log('[ralphLoopListeners] Processing iteration prompt:', {
          ralphId: data.ralphId,
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
              console.log('[ralphLoopListeners] Session stream complete:', data.sessionId);
              doResolve();
            }
          };

          const handleError = (error: { sessionId: string }) => {
            if (error.sessionId === data.sessionId) {
              console.log('[ralphLoopListeners] Session error, resolving:', data.sessionId);
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
        console.log('[ralphLoopListeners] Notifying session complete:', data.sessionId);
        window.electronAPI.send('ralph:session-complete', data.sessionId, true);
      } catch (err) {
        console.error('[ralphLoopListeners] Failed to process iteration prompt:', err);
        // Clean up any pending listeners
        const cleanup = pendingSessionCleanups.get(data.sessionId);
        if (cleanup) {
          cleanup();
          pendingSessionCleanups.delete(data.sessionId);
        }
        // Still notify completion so the loop can continue/handle error
        window.electronAPI.send('ralph:session-complete', data.sessionId, false);
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
