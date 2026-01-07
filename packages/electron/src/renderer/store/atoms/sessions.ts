/**
 * AI Session Atoms
 *
 * Per-session state using atom families keyed by session ID.
 * Allows efficient updates where only the affected session's UI re-renders.
 *
 * Key principle: Session service WRITES to these atoms via IPC handlers,
 * UI components (SessionListItem, badge) READ via subscriptions.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

/**
 * Session info stored in the session list.
 */
export interface SessionInfo {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  projectPath: string;
}

/**
 * Session list at workspace level.
 * SessionHistory subscribes to this for the list of sessions to display.
 */
export const sessionListAtom = atom<SessionInfo[]>([]);

/**
 * Currently active session ID.
 * Used to determine which session panel is shown and
 * whether new messages should mark a session as unread.
 */
export const activeSessionIdAtom = atom<string | null>(null);

/**
 * Per-session processing state.
 * Set when AI is actively generating a response.
 * SessionListItem subscribes to show processing indicator.
 */
export const sessionProcessingAtom = atomFamily((_sessionId: string) =>
  atom(false)
);

/**
 * Per-session unread state.
 * Set when new messages arrive while session is not active.
 * SessionListItem subscribes to show unread indicator.
 */
export const sessionUnreadAtom = atomFamily((_sessionId: string) =>
  atom(false)
);

/**
 * Per-session pending prompt state.
 * Set when there's a queued prompt waiting to be processed.
 * SessionListItem subscribes to show pending indicator.
 */
export const sessionPendingPromptAtom = atomFamily((_sessionId: string) =>
  atom(false)
);

/**
 * Per-session pending permission request state.
 * Set when there's a tool call waiting for user approval.
 */
export const sessionPendingPermissionAtom = atomFamily((_sessionId: string) =>
  atom(false)
);

/**
 * Last read timestamp per session.
 * Used to calculate unread message count.
 */
export const sessionLastReadAtom = atomFamily((_sessionId: string) =>
  atom<number>(0)
);

/**
 * Derived: total unread session count.
 * Badge component subscribes to show count in sidebar.
 */
export const totalUnreadCountAtom = atom((get) => {
  const sessions = get(sessionListAtom);
  return sessions.filter((s) => get(sessionUnreadAtom(s.id))).length;
});

/**
 * Derived: any session processing.
 * Useful for global processing indicator.
 */
export const anySessionProcessingAtom = atom((get) => {
  const sessions = get(sessionListAtom);
  return sessions.some((s) => get(sessionProcessingAtom(s.id)));
});

/**
 * Derived: any session with pending permission.
 * Useful for global attention indicator.
 */
export const anyPendingPermissionAtom = atom((get) => {
  const sessions = get(sessionListAtom);
  return sessions.some((s) => get(sessionPendingPermissionAtom(s.id)));
});

/**
 * Actions for managing sessions.
 */

/**
 * Mark a session as read (clear unread).
 * Called when user views the session.
 */
export const markSessionReadAtom = atom(null, (get, set, sessionId: string) => {
  set(sessionUnreadAtom(sessionId), false);
  set(sessionLastReadAtom(sessionId), Date.now());
});

/**
 * Set session as active.
 * Also marks it as read.
 */
export const setActiveSessionAtom = atom(
  null,
  (get, set, sessionId: string | null) => {
    set(activeSessionIdAtom, sessionId);
    if (sessionId) {
      set(markSessionReadAtom, sessionId);
    }
  }
);

/**
 * Remove a session and clean up its atoms.
 */
export const removeSessionAtom = atom(null, (get, set, sessionId: string) => {
  // Remove from list
  const sessions = get(sessionListAtom);
  set(
    sessionListAtom,
    sessions.filter((s) => s.id !== sessionId)
  );

  // If this was active, clear active
  if (get(activeSessionIdAtom) === sessionId) {
    set(activeSessionIdAtom, null);
  }

  // Clean up per-session atoms
  sessionProcessingAtom.remove(sessionId);
  sessionUnreadAtom.remove(sessionId);
  sessionPendingPromptAtom.remove(sessionId);
  sessionPendingPermissionAtom.remove(sessionId);
  sessionLastReadAtom.remove(sessionId);
});

/**
 * Add a new session to the list.
 */
export const addSessionAtom = atom(
  null,
  (get, set, session: SessionInfo) => {
    const sessions = get(sessionListAtom);
    // Avoid duplicates
    if (sessions.some((s) => s.id === session.id)) {
      return;
    }
    set(sessionListAtom, [...sessions, session]);
  }
);

/**
 * Update session metadata (name, updatedAt).
 */
export const updateSessionAtom = atom(
  null,
  (get, set, update: Partial<SessionInfo> & { id: string }) => {
    const sessions = get(sessionListAtom);
    set(
      sessionListAtom,
      sessions.map((s) => (s.id === update.id ? { ...s, ...update } : s))
    );
  }
);
