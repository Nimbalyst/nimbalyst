/**
 * NotificationSessionChecker
 *
 * Listens for requests from main process to check if the user is viewing a specific session.
 * Used to suppress OS notifications when the user is already looking at that session.
 */

import { useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { activeSessionIdAtom } from '../store/atoms/sessions';

export function NotificationSessionChecker(): null {
  const activeSessionId = useAtomValue(activeSessionIdAtom);

  useEffect(() => {
    if (!window.electronAPI?.on || !window.electronAPI?.send) {
      return;
    }

    const handleCheckActiveSession = (data: { requestId: string; sessionId: string }) => {
      const { requestId, sessionId } = data;
      const isViewing = activeSessionId === sessionId;

      // Respond to the main process (use 'send' not 'invoke' since main uses 'once' listener)
      window.electronAPI.send(`notifications:session-check-response:${requestId}`, isViewing);
    };

    const cleanup = window.electronAPI.on('notifications:check-active-session', handleCheckActiveSession);

    return () => {
      cleanup?.();
    };
  }, [activeSessionId]);

  return null;
}
