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
import { workstreamStateAtom, setWorkstreamActiveChildAtom } from './workstreamState';

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

/**
 * Derived: Session title from sessionData.
 * For use in tabs and lists where only the title is needed.
 */
export const sessionTitleAtom = atomFamily((sessionId: string) =>
  atom((get) => {
    const data = get(sessionDataAtom(sessionId));
    return data?.title || data?.name || 'Untitled';
  })
);

/**
 * Derived: Session provider from sessionData.
 * For use in tabs and lists where the provider icon is needed.
 */
export const sessionProviderAtom = atomFamily((sessionId: string) =>
  atom((get) => {
    const data = get(sessionDataAtom(sessionId));
    return data?.provider || 'claude';
  })
);

/**
 * Derived: Session messages from sessionData.
 * Allows components to subscribe only to messages without re-rendering on other field changes.
 */
export const sessionMessagesAtom = atomFamily((sessionId: string) =>
  atom((get) => {
    const data = get(sessionDataAtom(sessionId));
    return data?.messages || [];
  })
);

/**
 * Derived: Session token usage from sessionData.
 * Allows components to subscribe only to token usage without re-rendering on other field changes.
 */
export const sessionTokenUsageAtom = atomFamily((sessionId: string) =>
  atom((get) => {
    const data = get(sessionDataAtom(sessionId));
    return data?.tokenUsage;
  })
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

// Note: activeSessionInWorkstreamAtom has been moved to workstreamState.ts
// Use workstreamActiveChildAtom from workstreamState instead

/**
 * Derived: whether a session is a workstream (has type 'workstream' or 'worktree').
 * Uses the explicit type from workstreamState instead of counting children.
 */
export const sessionHasChildrenAtom = atomFamily((sessionId: string) =>
  atom((get) => {
    const state = get(workstreamStateAtom(sessionId));
    return state.type === 'workstream' || state.type === 'worktree';
  })
);

/**
 * Derived: whether a session OR any of its children is processing.
 * For workstreams, the parent header should show processing if ANY child is running.
 * This atom provides that aggregated view - subscribe to this instead of sessionProcessingAtom
 * when displaying processing state for a session that might be a workstream parent.
 */
export const sessionOrChildProcessingAtom = atomFamily((sessionId: string) =>
  atom((get) => {
    // Check if this session itself is processing
    if (get(sessionProcessingAtom(sessionId))) {
      return true;
    }

    // Check if any child session is processing
    const children = get(sessionChildrenAtom(sessionId));
    for (const childId of children) {
      if (get(sessionProcessingAtom(childId))) {
        return true;
      }
    }

    return false;
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
    console.log('[loadSessionChildrenAtom] Called with:', { parentSessionId, workspacePath });
    if (!parentSessionId || !workspacePath || !window.electronAPI) {
      console.log('[loadSessionChildrenAtom] Early return - missing params');
      return [];
    }

    try {
      const result = await window.electronAPI.invoke('sessions:list-children', parentSessionId, workspacePath);
      console.log('[loadSessionChildrenAtom] IPC result:', result);
      if (result.success && Array.isArray(result.children)) {
        const childIds = result.children.map((c: any) => c.id);
        console.log('[loadSessionChildrenAtom] Setting children:', childIds);
        set(sessionChildrenAtom(parentSessionId), childIds);

        // Set parent ID for each child and load their session data
        for (const child of result.children) {
          set(sessionParentIdAtom(child.id), parentSessionId);

          // Load full session data for each child so titles appear immediately
          set(loadSessionDataAtom, { sessionId: child.id, workspacePath });
        }

        // Update the unified workstream state with children
        // This is critical for workstreamHasChildrenAtom to work
        const currentState = store.get(workstreamStateAtom(parentSessionId));
        const currentActive = currentState.activeChildId;
        console.log('[loadSessionChildrenAtom] Current workstream state:', currentState);
        console.log('[loadSessionChildrenAtom] Current active child:', currentActive, 'childIds:', childIds);

        // Determine the active child:
        // - If has children: use current active if valid, else first child
        // - If no children (single session): use the parent session itself
        const newActiveChild = childIds.length > 0
          ? (currentActive && childIds.includes(currentActive) ? currentActive : childIds[0])
          : parentSessionId;
        console.log('[loadSessionChildrenAtom] Setting activeChildId to:', newActiveChild);

        set(workstreamStateAtom(parentSessionId), {
          type: childIds.length > 0 ? 'workstream' : 'single',
          childSessionIds: childIds,
          activeChildId: newActiveChild,
        });

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
    console.log(`[sessions:createChildSessionAtom] Creating child for parent ${parentSessionId}`);
    if (!parentSessionId || !workspacePath || !window.electronAPI) {
      console.error(`[sessions:createChildSessionAtom] Missing required params: parentSessionId=${parentSessionId}, workspacePath=${workspacePath}, electronAPI=${!!window.electronAPI}`);
      return null;
    }

    try {
      // Get parent session to inherit worktree_id
      const parentData = get(sessionDataAtom(parentSessionId));
      const worktreeId = parentData?.worktreeId;
      console.log(`[sessions:createChildSessionAtom] Parent data: worktreeId=${worktreeId}, hasMessages=${!!parentData?.messages?.length}`);

      console.log(`[sessions:createChildSessionAtom] Invoking sessions:create-child IPC...`);
      const result = await window.electronAPI.invoke('sessions:create-child', {
        parentSessionId,
        workspacePath,
        worktreeId,
        provider: provider || 'claude-code',
      });
      console.log(`[sessions:createChildSessionAtom] IPC result:`, result);

      if (result.success && result.sessionId) {
        // Add to children list
        const children = get(sessionChildrenAtom(parentSessionId));
        set(sessionChildrenAtom(parentSessionId), [...children, result.sessionId]);

        // Set parent ID for the new child
        set(sessionParentIdAtom(result.sessionId), parentSessionId);

        // Make it the active child (both atoms need to be updated)
        set(sessionActiveChildAtom(parentSessionId), result.sessionId);
        set(setWorkstreamActiveChildAtom, { workstreamId: parentSessionId, childId: result.sessionId });

        // Update unified workstream state
        const { addWorkstreamChildAtom } = await import('./workstreamState');
        set(addWorkstreamChildAtom, {
          workstreamId: parentSessionId,
          childId: result.sessionId,
        });

        return result.sessionId;
      }
    } catch (error) {
      console.error(`[sessions] Failed to create child session for ${parentSessionId}:`, error);
    }

    return null;
  }
);

/**
 * Reparent a session by changing its parent_session_id.
 * Used for drag-and-drop to move sessions between workstreams.
 *
 * @param sessionId - The session to reparent
 * @param oldParentId - Current parent ID (null if orphan)
 * @param newParentId - New parent ID (null to make orphan)
 * @param workspacePath - Workspace path for validation
 * @returns true if successful, false otherwise
 */
export const reparentSessionAtom = atom(
  null,
  async (get, set, {
    sessionId,
    oldParentId,
    newParentId,
    workspacePath
  }: {
    sessionId: string;
    oldParentId: string | null;
    newParentId: string | null;
    workspacePath: string;
  }) => {
    if (!sessionId || !workspacePath || !window.electronAPI) {
      return false;
    }

    try {
      // Call IPC to update database
      const result = await window.electronAPI.invoke(
        'sessions:set-parent',
        {
          sessionId,
          newParentId,
          workspacePath
        }
      );

      if (!result.success) {
        console.error('[sessions] Failed to reparent session:', result.error);
        return false;
      }

      // Update atoms
      // 1. Update dragged session's parent
      set(sessionParentIdAtom(sessionId), newParentId);

      // 2. Remove from old parent's children (if had a parent)
      if (oldParentId) {
        const oldChildren = get(sessionChildrenAtom(oldParentId));
        const newOldChildren = oldChildren.filter(id => id !== sessionId);
        set(sessionChildrenAtom(oldParentId), newOldChildren);

        // Update old parent's workstream state
        set(workstreamStateAtom(oldParentId), {
          childSessionIds: newOldChildren,
        });
      }

      // 3. Add to new parent's children (if has a new parent)
      if (newParentId) {
        const newChildren = get(sessionChildrenAtom(newParentId));
        const updatedNewChildren = [...newChildren, sessionId];
        set(sessionChildrenAtom(newParentId), updatedNewChildren);

        // Update new parent's workstream state
        set(workstreamStateAtom(newParentId), {
          childSessionIds: updatedNewChildren,
        });

        // Make the reparented session the active child in the new parent
        set(setWorkstreamActiveChildAtom, { workstreamId: newParentId, childId: sessionId });
      }

      // 4. Update session list
      set(updateSessionFullAtom, {
        id: sessionId,
        parentSessionId: newParentId,
      });

      // Update child counts in session list
      if (oldParentId) {
        const oldChildren = get(sessionChildrenAtom(oldParentId));
        set(updateSessionFullAtom, {
          id: oldParentId,
          childCount: oldChildren.length,
        });
      }
      if (newParentId) {
        const newChildren = get(sessionChildrenAtom(newParentId));
        set(updateSessionFullAtom, {
          id: newParentId,
          childCount: newChildren.length,
        });
      }

      return true;
    } catch (error) {
      console.error(`[sessions] Failed to reparent session ${sessionId}:`, error);
      return false;
    }
  }
);

/**
 * Convert a single session into a workstream by:
 * 1. Creating a new parent session (the workstream root)
 * 2. Making the current session a child of the new parent
 * 3. Creating a new sibling session
 * Returns the new parent session ID.
 *
 * IMPORTANT: This operation is guarded against:
 * - Converting a session that already has a parent (is already a child)
 * - Converting a session that is already a workstream root (has children)
 * - Partial failures (rolls back parent creation if subsequent steps fail)
 */
export const convertToWorkstreamAtom = atom(
  null,
  async (get, set, { sessionId, workspacePath }: {
    sessionId: string;
    workspacePath: string;
  }) => {
    if (!sessionId || !workspacePath || !window.electronAPI) {
      return null;
    }

    try {
      // Get current session data
      const sessionData = get(sessionDataAtom(sessionId));
      if (!sessionData) {
        console.error(`[sessions] Cannot convert to workstream: session ${sessionId} not found`);
        return null;
      }

      // Don't convert if already has a parent (is already a child session)
      if (sessionData.parentSessionId) {
        console.error(`[sessions] Cannot convert to workstream: session ${sessionId} already has a parent`);
        return null;
      }

      // Don't convert if already a workstream root (has children or isWorkstreamRoot flag)
      // Check children in the atom first
      const existingChildren = get(sessionChildrenAtom(sessionId));
      if (existingChildren.length > 0) {
        console.error(`[sessions] Cannot convert to workstream: session ${sessionId} already has children`);
        return null;
      }

      // Also check database via session list for childCount
      const allSessions = get(sessionListFullAtom);
      const sessionListItem = allSessions.find(s => s.id === sessionId);
      if (sessionListItem?.childCount && sessionListItem.childCount > 0) {
        console.error(`[sessions] Cannot convert to workstream: session ${sessionId} already has ${sessionListItem.childCount} children in database`);
        return null;
      }

      // Check isWorkstreamRoot metadata flag
      if (sessionData.metadata?.isWorkstreamRoot) {
        console.error(`[sessions] Cannot convert to workstream: session ${sessionId} is already marked as workstream root`);
        return null;
      }

      // Create a new parent session (the workstream root)
      const parentId = crypto.randomUUID();
      const createResult = await window.electronAPI.invoke('sessions:create', {
        session: {
          id: parentId,
          provider: sessionData.provider || 'claude-code',
          model: sessionData.model,
          metadata: {
            isWorkstreamRoot: true,
          },
        },
        workspaceId: workspacePath,
      });

      if (!createResult.success || !createResult.id) {
        console.error('[sessions] Failed to create workstream parent session');
        return null;
      }

      const parentSessionId = createResult.id;

      // Helper to clean up parent on failure
      const rollbackParent = async () => {
        try {
          await window.electronAPI.invoke('sessions:delete', parentSessionId);
          console.log(`[sessions] Rolled back parent session ${parentSessionId}`);
        } catch (rollbackError) {
          console.error(`[sessions] Failed to rollback parent session ${parentSessionId}:`, rollbackError);
        }
      };

      // Set the title for the workstream parent
      try {
        await window.electronAPI.invoke('sessions:update-metadata', parentSessionId, {
          title: sessionData.title || 'Workstream',
        });
      } catch (error) {
        console.error('[sessions] Failed to set parent title, rolling back:', error);
        await rollbackParent();
        return null;
      }

      // Update current session to be a child of the new parent
      try {
        await window.electronAPI.invoke('sessions:update-metadata', sessionId, {
          parentSessionId,
        });
      } catch (error) {
        console.error('[sessions] Failed to set parent on original session, rolling back:', error);
        await rollbackParent();
        return null;
      }

      // Create a new sibling session
      let siblingResult: { success: boolean; sessionId?: string; error?: string } = { success: false };
      try {
        siblingResult = await window.electronAPI.invoke('sessions:create-child', {
          parentSessionId,
          workspacePath,
          worktreeId: sessionData.worktreeId,
          provider: sessionData.provider || 'claude-code',
        });
      } catch (error) {
        // Sibling creation failed - rollback: remove parentSessionId from original, delete parent
        console.error('[sessions] Failed to create sibling session (exception), rolling back:', error);
        try {
          await window.electronAPI.invoke('sessions:update-metadata', sessionId, {
            parentSessionId: null,
          });
        } catch (revertError) {
          console.error('[sessions] Failed to revert parentSessionId on original session:', revertError);
        }
        await rollbackParent();
        return null;
      }

      // Check if IPC returned an error (didn't throw but returned { success: false })
      if (!siblingResult.success) {
        console.error('[sessions] Failed to create sibling session (IPC error), rolling back:', siblingResult.error);
        try {
          await window.electronAPI.invoke('sessions:update-metadata', sessionId, {
            parentSessionId: null,
          });
        } catch (revertError) {
          console.error('[sessions] Failed to revert parentSessionId on original session:', revertError);
        }
        await rollbackParent();
        return null;
      }

      // All database operations succeeded - now update atoms
      // Set parent ID for the original session
      set(sessionParentIdAtom(sessionId), parentSessionId);

      // Initialize children list with both sessions
      const children = [sessionId];
      if (siblingResult.success && siblingResult.sessionId) {
        children.push(siblingResult.sessionId);
        set(sessionParentIdAtom(siblingResult.sessionId), parentSessionId);
      }
      set(sessionChildrenAtom(parentSessionId), children);

      // Set the new sibling as active (user wants to work in the new session)
      if (siblingResult.success && siblingResult.sessionId) {
        set(sessionActiveChildAtom(parentSessionId), siblingResult.sessionId);
        set(setWorkstreamActiveChildAtom, { workstreamId: parentSessionId, childId: siblingResult.sessionId });
      }

      // Update unified workstream state
      const { convertToWorkstreamAtom: convertToWorkstreamStateAtom } = await import('./workstreamState');
      set(convertToWorkstreamStateAtom, {
        sessionId,
        parentId: parentSessionId,
        siblingId: siblingResult.sessionId!,
      });

      // Add the new parent session to the session list so it appears in the sidebar
      const now = Date.now();
      set(addSessionFullAtom, {
        id: parentSessionId,
        name: sessionData.title || 'Workstream',
        title: sessionData.title || 'Workstream',
        provider: sessionData.provider || 'claude-code',
        model: sessionData.model,
        createdAt: now,
        updatedAt: now,
        projectPath: workspacePath,
        messageCount: 0,
        isArchived: false,
        isPinned: false,
        worktreeId: sessionData.worktreeId || null,
        parentSessionId: null, // This is the root
        childCount: children.length,
      });

      // Update the original session in the list to show it now has a parent
      set(updateSessionFullAtom, {
        id: sessionId,
        parentSessionId: parentSessionId,
      });

      // Update the selected workstream to point to the new parent
      // This is critical - without it, the sidebar still shows the old session
      set(selectedWorkstreamAtom(workspacePath), {
        type: 'workstream' as WorkstreamType,
        id: parentSessionId,
      });

      return parentSessionId;
    } catch (error) {
      console.error(`[sessions] Failed to convert session ${sessionId} to workstream:`, error);
      return null;
    }
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

        // Initialize workstream state if this is a worktree session
        // This ensures type='worktree' is set even when loading from DB
        if (sessionData.worktreeId) {
          const currentState = store.get(workstreamStateAtom(sessionId));
          if (currentState.type !== 'worktree') {
            set(workstreamStateAtom(sessionId), {
              type: 'worktree',
              worktreeId: sessionData.worktreeId,
            });
          }
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
  uncommittedCount?: number;  // Number of uncommitted files in this session
}

/**
 * Full session list with extended info.
 * This is what SessionHistory uses for display.
 */
export const sessionListFullAtom = atom<SessionListItem[]>([]);

/**
 * Derived: Root sessions only (no parent).
 * These are the sessions that should show in the main session history list.
 * Child sessions are displayed as tabs within their parent.
 */
export const sessionListRootAtom = atom<SessionListItem[]>((get) => {
  const sessions = get(sessionListFullAtom);
  return sessions.filter(s => !s.parentSessionId);
});

/**
 * Derived: Sessions for chat mode dropdown.
 * Includes standalone sessions and workstream children, but excludes:
 * - Workstream parent sessions (they're just containers)
 * - Worktree sessions (they're against different directories)
 */
export const sessionListChatAtom = atom<SessionListItem[]>((get) => {
  const sessions = get(sessionListFullAtom);
  return sessions.filter(s => {
    // Exclude worktree sessions
    if (s.worktreeId) return false;
    // Exclude workstream parents (childCount > 0 means it's a parent)
    if (s.childCount && s.childCount > 0) return false;
    return true;
  });
});

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
          uncommittedCount: s.uncommittedCount || 0,
        }));

        // Debug: log sessions with uncommittedCount
        const withCounts = sessions.filter(s => s.uncommittedCount && s.uncommittedCount > 0);
        console.log(`[refreshSessionListAtom] Received ${sessions.length} sessions, ${withCounts.length} have uncommittedCount:`,
          withCounts.slice(0, 3).map(s => ({ id: s.id.substring(0, 8), title: s.title?.substring(0, 30), uncommittedCount: s.uncommittedCount })));

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

// ============================================================
// Workstream atoms for AgentMode rewrite
// A "workstream" represents whatever is selected in the left sidebar:
// - A single session (no children)
// - A workstream set (parent + child sessions)
// - A worktree set (worktree + associated sessions)
// ============================================================

/**
 * Type of workstream currently selected.
 */
export type WorkstreamType = 'session' | 'workstream' | 'worktree';

/**
 * Selection state for the workstream list.
 * Keyed by workspace path - each workspace has its own selection.
 */
export const selectedWorkstreamAtom = atomFamily((_workspacePath: string) =>
  atom<{ type: WorkstreamType; id: string } | null>(null)
);

// Debounce timer for selected workstream persistence
let selectedWorkstreamPersistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Set the selected workstream.
 * Handles marking the session as active/read.
 * Persists to workspace state for restore on reload.
 */
export const setSelectedWorkstreamAtom = atom(
  null,
  (get, set, { workspacePath, selection }: {
    workspacePath: string;
    selection: { type: WorkstreamType; id: string } | null;
  }) => {
    const prev = get(selectedWorkstreamAtom(workspacePath));
    console.log(`[setSelectedWorkstreamAtom] Changing selection from ${prev?.type}:${prev?.id} to ${selection?.type}:${selection?.id}`);
    console.trace('[setSelectedWorkstreamAtom] Call stack');
    set(selectedWorkstreamAtom(workspacePath), selection);

    // If selecting a single session, also set it as the global active session
    if (selection?.type === 'session') {
      set(setActiveSessionAtom, selection.id);
      // For single sessions, the session is both the workstream and the active session
      set(setWorkstreamActiveChildAtom, { workstreamId: selection.id, childId: selection.id });
    }
    // For workstreams and worktrees, do NOT set activeChildId here
    // Let loadSessionChildren or the persisted state handle it

    // Persist to workspace state (debounced)
    if (selectedWorkstreamPersistTimer) {
      clearTimeout(selectedWorkstreamPersistTimer);
    }
    selectedWorkstreamPersistTimer = setTimeout(async () => {
      try {
        await window.electronAPI.invoke('workspace:update-state', workspacePath, {
          agenticCodingWindowState: {
            selectedWorkstream: selection,
          },
        });
      } catch (err) {
        console.error('[sessions] Failed to persist selected workstream:', err);
      }
    }, 300);
  }
);

/**
 * Session IDs belonging to a workstream.
 * For single sessions: [sessionId]
 * For workstreams: [childIds] (parent is just a container, not displayed)
 * For worktrees: [sessionId1, sessionId2, ...]
 *
 * This is a derived atom that reads from existing session state.
 */
export const workstreamSessionsAtom = atomFamily((workstreamId: string) =>
  atom((get) => {
    // Check if this is a parent with children already loaded
    const children = get(sessionChildrenAtom(workstreamId));
    console.log('[workstreamSessionsAtom]', workstreamId, 'children:', children);
    if (children.length > 0) {
      // This is a workstream parent - only return children
      // The parent is a structural container, not a displayable session
      console.log('[workstreamSessionsAtom]', workstreamId, 'returning children:', children);
      return children;
    }

    // Get session list and session data for further checks
    const allSessions = get(sessionListFullAtom);
    const sessionData = get(sessionDataAtom(workstreamId));

    // Check if this session has a worktree_id
    if (sessionData?.worktreeId) {
      // This is a worktree session - find all sessions with the same worktreeId
      const worktreeSessions = allSessions
        .filter(s => s.worktreeId === sessionData.worktreeId)
        .map(s => s.id);
      // If no sessions found in list (might not be populated yet), at least include self
      if (worktreeSessions.length === 0) {
        console.log('[workstreamSessionsAtom]', workstreamId, 'worktree session - returning self');
        return [workstreamId];
      }
      console.log('[workstreamSessionsAtom]', workstreamId, 'returning worktree sessions:', worktreeSessions);
      return worktreeSessions;
    }

    // Check if this is a workstream root that hasn't had children loaded yet
    // Look up childCount from the session list (more reliable than metadata)
    const sessionListItem = allSessions.find(s => s.id === workstreamId);
    console.log('[workstreamSessionsAtom]', workstreamId, 'sessionListItem:', sessionListItem?.id, 'childCount:', sessionListItem?.childCount);
    if (sessionListItem?.childCount && sessionListItem.childCount > 0) {
      // This is a workstream parent waiting for children to load
      // Return empty array - children will be loaded and this will re-derive
      console.log('[workstreamSessionsAtom]', workstreamId, 'returning empty (waiting for children)');
      return [];
    }

    // Single session with no children and no worktree
    console.log('[workstreamSessionsAtom]', workstreamId, 'returning self as single session');
    return [workstreamId];
  })
);

/**
 * Set the active session within a workstream.
 * Handles marking the session as read.
 * Note: This wraps setWorkstreamActiveChildAtom from workstreamState.ts
 */
export const setActiveSessionInWorkstreamAtom = atom(
  null,
  (get, set, { workstreamId, sessionId }: { workstreamId: string; sessionId: string }) => {
    set(setWorkstreamActiveChildAtom, { workstreamId, childId: sessionId });
    set(markSessionReadAtom, sessionId);
  }
);

/**
 * Derived: Is any session in this workstream processing?
 */
export const workstreamProcessingAtom = atomFamily((workstreamId: string) =>
  atom((get) => {
    const sessions = get(workstreamSessionsAtom(workstreamId));
    return sessions.some(id => get(sessionProcessingAtom(id)));
  })
);

/**
 * Derived: Does any session in this workstream have unread messages?
 */
export const workstreamUnreadAtom = atomFamily((workstreamId: string) =>
  atom((get) => {
    const sessions = get(workstreamSessionsAtom(workstreamId));
    return sessions.some(id => get(sessionUnreadAtom(id)));
  })
);

/**
 * Derived: Does any session in this workstream have a pending prompt?
 */
export const workstreamPendingPromptAtom = atomFamily((workstreamId: string) =>
  atom((get) => {
    const sessions = get(workstreamSessionsAtom(workstreamId));
    return sessions.some(id => get(sessionPendingPromptAtom(id)));
  })
);

/**
 * Derived: Does any session in this workstream have a pending permission?
 */
export const workstreamPendingPermissionAtom = atomFamily((workstreamId: string) =>
  atom((get) => {
    const sessions = get(workstreamSessionsAtom(workstreamId));
    return sessions.some(id => get(sessionPendingPermissionAtom(id)));
  })
);

/**
 * Workstream title - derived from the root session or worktree name.
 */
export const workstreamTitleAtom = atomFamily((workstreamId: string) =>
  atom((get) => {
    const sessionData = get(sessionDataAtom(workstreamId));
    return sessionData?.title || sessionData?.name || 'Untitled';
  })
);

