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
import type { ChatAttachment, Message } from '@nimbalyst/runtime/ai/server/types';

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

// ============================================================
// Per-session draft input state
// These atoms encapsulate input state within AISessionView,
// eliminating the need for AgenticPanel to manage draft state.
// ============================================================

/**
 * Per-session draft input text.
 * AIInput subscribes directly - no props needed from parent.
 * Typing only causes AIInput to re-render, not the entire tree.
 */
export const sessionDraftInputAtom = atomFamily((_sessionId: string) =>
  atom<string>('')
);

/**
 * Per-session draft attachments.
 * File attachments being composed before sending.
 */
export const sessionDraftAttachmentsAtom = atomFamily((_sessionId: string) =>
  atom<ChatAttachment[]>([])
);

// ============================================================
// Per-session full data state
// AISessionView subscribes to this and loads/manages its own data.
// This eliminates the need for AgenticPanel to hold session state.
// ============================================================

import type { SessionData } from '@nimbalyst/runtime/ai/server/types';
import type { AIMode } from '../../components/UnifiedAI/ModeTag';

/**
 * Session tab state - the minimal data AgenticPanel needs for an open session.
 * This replaces the old SessionTab interface with just what's needed for tabs.
 */
export interface OpenSession {
  id: string;
  name: string;
  isPinned?: boolean;
}

/**
 * Per-session full data.
 * AISessionView subscribes directly - loads its own data, saves changes.
 * This allows the component to be fully self-contained.
 *
 * Initial value is null - AISessionView loads data on mount.
 */
export const sessionDataAtom = atomFamily((_sessionId: string) =>
  atom<SessionData | null>(null)
);

/**
 * Per-session loading state.
 * True while session data is being fetched from database.
 */
export const sessionLoadingAtom = atomFamily((_sessionId: string) =>
  atom<boolean>(true)
);

/**
 * Per-session AI mode (plan vs agent).
 */
export const sessionModeAtom = atomFamily((_sessionId: string) =>
  atom<AIMode>('agent')
);

/**
 * Per-session current model ID.
 */
export const sessionModelAtom = atomFamily((_sessionId: string) =>
  atom<string>('claude-code:sonnet')
);

/**
 * Per-session archived state.
 */
export const sessionArchivedAtom = atomFamily((_sessionId: string) =>
  atom<boolean>(false)
);

/**
 * Per-session active/visible state.
 * Components subscribe to this instead of receiving isActive as a prop.
 * This prevents parent re-renders from cascading to children.
 */
export const sessionActiveAtom = atomFamily((_sessionId: string) =>
  atom<boolean>(false)
);

// ============================================================
// Hierarchical session support (workstreams)
// These atoms enable parent-child session relationships for grouping
// related sessions without requiring git worktrees.
// ============================================================

/**
 * Per-session child IDs.
 * Populated when loading parent sessions that have children.
 * AISessionView uses this to render session tabs.
 */
export const sessionChildrenAtom = atomFamily((_sessionId: string) =>
  atom<string[]>([])
);

/**
 * Currently active child session within a parent.
 * Used for tab selection within a parent session view.
 * null means the parent session itself is active.
 */
export const sessionActiveChildAtom = atomFamily((_sessionId: string) =>
  atom<string | null>(null)
);

/**
 * Derived: whether a session has children.
 * Useful for conditionally rendering session tabs UI.
 */
export const sessionHasChildrenAtom = atomFamily((sessionId: string) =>
  atom((get) => {
    const children = get(sessionChildrenAtom(sessionId));
    return children.length > 0;
  })
);

/**
 * Per-session parent ID.
 * null for root sessions, set for child sessions.
 * Used to determine if session should be shown in main list or as a tab.
 */
export const sessionParentIdAtom = atomFamily((_sessionId: string) =>
  atom<string | null>(null)
);

/**
 * Load child sessions for a parent session.
 * Called when opening a parent session that has children.
 */
export const loadSessionChildrenAtom = atom(
  null,
  async (get, set, { parentSessionId, workspacePath }: { parentSessionId: string; workspacePath: string }) => {
    if (!parentSessionId || !workspacePath || !window.electronAPI) {
      return [];
    }

    try {
      const result = await window.electronAPI.invoke('sessions:list-children', parentSessionId, workspacePath);
      if (result.success && Array.isArray(result.children)) {
        const childIds = result.children.map((c: any) => c.id);
        set(sessionChildrenAtom(parentSessionId), childIds);

        // Set parent ID for each child
        for (const child of result.children) {
          set(sessionParentIdAtom(child.id), parentSessionId);
        }

        return childIds;
      }
    } catch (error) {
      console.error(`[sessions] Failed to load children for session ${parentSessionId}:`, error);
    }

    return [];
  }
);

/**
 * Set the active child session within a parent.
 * Marks the child as active and clears unread state.
 */
export const setActiveChildSessionAtom = atom(
  null,
  (get, set, { parentSessionId, childSessionId }: { parentSessionId: string; childSessionId: string | null }) => {
    set(sessionActiveChildAtom(parentSessionId), childSessionId);
    if (childSessionId) {
      set(markSessionReadAtom, childSessionId);
    }
  }
);

/**
 * Create a child session under a parent.
 * Returns the new session ID.
 */
export const createChildSessionAtom = atom(
  null,
  async (get, set, { parentSessionId, workspacePath, provider }: {
    parentSessionId: string;
    workspacePath: string;
    provider?: string;
  }) => {
    if (!parentSessionId || !workspacePath || !window.electronAPI) {
      return null;
    }

    try {
      // Get parent session to inherit worktree_id
      const parentData = get(sessionDataAtom(parentSessionId));
      const worktreeId = parentData?.worktreeId;

      const result = await window.electronAPI.invoke('sessions:create-child', {
        parentSessionId,
        workspacePath,
        worktreeId,
        provider: provider || 'claude-code',
      });

      if (result.success && result.sessionId) {
        // Add to children list
        const children = get(sessionChildrenAtom(parentSessionId));
        set(sessionChildrenAtom(parentSessionId), [...children, result.sessionId]);

        // Set parent ID for the new child
        set(sessionParentIdAtom(result.sessionId), parentSessionId);

        // Make it the active child
        set(sessionActiveChildAtom(parentSessionId), result.sessionId);

        return result.sessionId;
      }
    } catch (error) {
      console.error(`[sessions] Failed to create child session for ${parentSessionId}:`, error);
    }

    return null;
  }
);

/**
 * Open sessions list - just IDs and names for tab display.
 * AgenticPanel manages this list (open/close tabs).
 * AISessionView instances manage their own full session data.
 */
export const openSessionsAtom = atom<OpenSession[]>([]);

/**
 * Load session data into the atom.
 * Called by AISessionView on mount.
 */
export const loadSessionDataAtom = atom(
  null,
  async (get, set, { sessionId, workspacePath }: { sessionId: string; workspacePath: string }) => {
    if (!sessionId || !workspacePath || !window.electronAPI) {
      return null;
    }

    set(sessionLoadingAtom(sessionId), true);

    try {
      const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePath);
      if (sessionData) {
        set(sessionDataAtom(sessionId), sessionData);
        set(sessionModeAtom(sessionId), sessionData.mode || 'agent');
        set(sessionModelAtom(sessionId), sessionData.model || sessionData.provider || 'claude-code:sonnet');
        set(sessionArchivedAtom(sessionId), sessionData.isArchived || false);

        // Initialize draft input if session has saved draft
        if (sessionData.draftInput) {
          set(sessionDraftInputAtom(sessionId), sessionData.draftInput);
        }

        return sessionData;
      }
    } catch (error) {
      console.error(`[sessions] Failed to load session ${sessionId}:`, error);
    } finally {
      set(sessionLoadingAtom(sessionId), false);
    }

    return null;
  }
);

/**
 * Update session data in the atom (after streaming updates, etc.).
 */
export const updateSessionDataAtom = atom(
  null,
  (get, set, { sessionId, updates }: { sessionId: string; updates: Partial<SessionData> }) => {
    const current = get(sessionDataAtom(sessionId));
    if (current) {
      set(sessionDataAtom(sessionId), { ...current, ...updates });
    }
  }
);

/**
 * Reload session data from database.
 * Called after message-logged events, etc.
 */
export const reloadSessionDataAtom = atom(
  null,
  async (get, set, { sessionId, workspacePath }: { sessionId: string; workspacePath: string }) => {
    if (!sessionId || !workspacePath || !window.electronAPI) {
      return;
    }

    try {
      const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePath);
      if (sessionData) {
        const current = get(sessionDataAtom(sessionId));

        // Merge messages: preserve local-only messages not yet in database
        if (current) {
          const dbMessages = sessionData.messages || [];
          const localMessages = current.messages || [];

          const latestDbTimestamp = dbMessages.length > 0
            ? Math.max(...dbMessages.map((m: Message) => m.timestamp || 0))
            : 0;

          const localOnlyMessages = localMessages.filter((localMsg: Message) => {
            const localTs = localMsg.timestamp || 0;
            return localTs > latestDbTimestamp &&
              !dbMessages.some((dbMsg: Message) => dbMsg.timestamp === localTs);
          });

          sessionData.messages = [...dbMessages, ...localOnlyMessages];

          // Preserve read state
          const preservedTimestamp = current.lastReadMessageTimestamp || 0;
          const dbTimestamp = sessionData.lastReadMessageTimestamp || 0;
          sessionData.lastReadMessageTimestamp = Math.max(preservedTimestamp, dbTimestamp);

          // For claude-code, preserve tokenUsage (comes from /context IPC, not database)
          if (sessionData.provider === 'claude-code' && current.tokenUsage) {
            sessionData.tokenUsage = current.tokenUsage;
          }
        }

        set(sessionDataAtom(sessionId), sessionData);
        set(sessionArchivedAtom(sessionId), sessionData.isArchived || false);
      }
    } catch (error) {
      console.error(`[sessions] Failed to reload session ${sessionId}:`, error);
    }
  }
);

/**
 * Clean up session atoms when closing a session tab.
 */
export const cleanupSessionAtom = atom(null, (get, set, sessionId: string) => {
  // Remove all per-session atoms
  sessionDataAtom.remove(sessionId);
  sessionLoadingAtom.remove(sessionId);
  sessionModeAtom.remove(sessionId);
  sessionModelAtom.remove(sessionId);
  sessionArchivedAtom.remove(sessionId);
  sessionProcessingAtom.remove(sessionId);
  sessionUnreadAtom.remove(sessionId);
  sessionPendingPromptAtom.remove(sessionId);
  sessionPendingPermissionAtom.remove(sessionId);
  sessionLastReadAtom.remove(sessionId);
  sessionDraftInputAtom.remove(sessionId);
  sessionDraftAttachmentsAtom.remove(sessionId);
  // Hierarchical session atoms
  sessionChildrenAtom.remove(sessionId);
  sessionActiveChildAtom.remove(sessionId);
  sessionParentIdAtom.remove(sessionId);
});

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
  sessionDraftInputAtom.remove(sessionId);
  sessionDraftAttachmentsAtom.remove(sessionId);
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
  // Hierarchical session support (workstreams)
  parentSessionId?: string | null;  // Parent session ID (null for root sessions)
  childCount?: number;  // Number of child sessions (0 for leaf sessions)
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
          parentSessionId: s.parentSessionId || null,
          childCount: s.childCount || 0,
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
