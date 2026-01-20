/**
 * AI Session Atoms
 *
 * Per-session state using atom families keyed by session ID.
 * Allows efficient updates where only the affected session's UI re-renders.
 *
 * Key principle: Session service WRITES to these atoms via IPC handlers,
 * UI components (SessionListItem, badge) READ via subscriptions.
 *
 * Session list loading pattern:
 * 1. Call initSessionList(workspacePath) at app startup
 * 2. Components use useAtomValue(sessionListAtom) to read sessions
 * 3. Use refreshSessionListAtom to refresh from database
 * 4. Use addSessionAtom/removeSessionAtom for optimistic updates
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { store } from '@nimbalyst/runtime/store';

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

// ============================================================
// Session list loading and refresh
// ============================================================

/**
 * Extended session info returned from the database.
 * Contains more fields than SessionInfo for display purposes.
 */
export interface SessionListItem {
  id: string;
  name: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model?: string;
  sessionType?: 'chat' | 'planning' | 'coding' | 'terminal';
  messageCount: number;
  projectPath: string;
  isArchived?: boolean;
  isPinned?: boolean;
  worktreeId?: string | null;
}

/**
 * Full session list with extended info.
 * This is what SessionHistory uses for display.
 */
export const sessionListFullAtom = atom<SessionListItem[]>([]);

/**
 * Whether the session list is currently loading.
 */
export const sessionListLoadingAtom = atom<boolean>(false);

/**
 * Current workspace path for session list.
 * Used to know when to refresh.
 */
export const sessionListWorkspaceAtom = atom<string | null>(null);

/**
 * Show archived sessions toggle.
 */
export const showArchivedSessionsAtom = atom<boolean>(false);

/**
 * Refresh the session list from the database.
 * This is an action atom that fetches from IPC and updates the list.
 */
export const refreshSessionListAtom = atom(
  null,
  async (get, set) => {
    const workspacePath = get(sessionListWorkspaceAtom);
    if (!workspacePath || !window.electronAPI) {
      return;
    }

    const showArchived = get(showArchivedSessionsAtom);

    try {
      set(sessionListLoadingAtom, true);
      const result = await window.electronAPI.invoke('sessions:list', workspacePath, {
        includeArchived: showArchived,
      });

      if (result.success && Array.isArray(result.sessions)) {
        const sessions: SessionListItem[] = result.sessions.map((s: any) => ({
          id: s.id,
          name: s.title || s.name || 'Untitled Session',
          title: s.title || s.name || 'Untitled Session',
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          provider: s.provider || 'claude',
          model: s.model,
          sessionType: s.sessionType || 'chat',
          messageCount: s.messageCount || 0,
          projectPath: workspacePath,
          isArchived: s.isArchived || false,
          isPinned: s.isPinned || false,
          worktreeId: s.worktreeId || null,
        }));

        set(sessionListFullAtom, sessions);

        // Also update the basic sessionListAtom for derived atoms
        const basicSessions: SessionInfo[] = sessions.map((s) => ({
          id: s.id,
          name: s.name,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          projectPath: s.projectPath,
        }));
        set(sessionListAtom, basicSessions);
      }
    } catch (error) {
      console.error('[sessions] Failed to refresh session list:', error);
    } finally {
      set(sessionListLoadingAtom, false);
    }
  }
);

/**
 * Initialize the session list for a workspace.
 * Call this when the workspace is opened.
 */
export async function initSessionList(workspacePath: string): Promise<void> {
  store.set(sessionListWorkspaceAtom, workspacePath);
  // Trigger initial load
  await store.set(refreshSessionListAtom);
}

/**
 * Add a new session to the full list (optimistic update).
 */
export const addSessionFullAtom = atom(
  null,
  (get, set, session: SessionListItem) => {
    const sessions = get(sessionListFullAtom);
    // Avoid duplicates
    if (sessions.some((s) => s.id === session.id)) {
      return;
    }
    set(sessionListFullAtom, [session, ...sessions]);

    // Also update basic list
    set(addSessionAtom, {
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      projectPath: session.projectPath,
    });
  }
);

/**
 * Update a session in the full list.
 */
export const updateSessionFullAtom = atom(
  null,
  (get, set, update: Partial<SessionListItem> & { id: string }) => {
    const sessions = get(sessionListFullAtom);
    set(
      sessionListFullAtom,
      sessions.map((s) => (s.id === update.id ? { ...s, ...update } : s))
    );

    // Also update basic list if name changed
    if (update.name) {
      set(updateSessionAtom, {
        id: update.id,
        name: update.name,
        updatedAt: update.updatedAt,
      });
    }
  }
);

/**
 * Remove a session from the full list.
 */
export const removeSessionFullAtom = atom(null, (get, set, sessionId: string) => {
  const sessions = get(sessionListFullAtom);
  set(
    sessionListFullAtom,
    sessions.filter((s) => s.id !== sessionId)
  );

  // Also remove from basic list
  set(removeSessionAtom, sessionId);
});
