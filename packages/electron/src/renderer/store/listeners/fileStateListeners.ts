/**
 * Central File State Listeners
 *
 * Subscribes to all file/git-related IPC events ONCE and updates atoms.
 * Components read from atoms, never subscribe to IPC directly.
 *
 * Events handled:
 * - session-files:updated → sessionFileEditsAtom
 * - git:status-changed → sessionGitStatusAtom, workspaceUncommittedFilesAtom, worktreeChangedFilesAtom
 * - history:pending-count-changed → sessionPendingReviewFilesAtom
 *
 * Call initFileStateListeners() once in App.tsx on mount.
 */

import { store } from '@nimbalyst/runtime/store';
import {
  sessionFileEditsAtom,
  sessionGitStatusAtom,
  sessionPendingReviewFilesAtom,
  workspaceUncommittedFilesAtom,
  worktreeChangedFilesAtom,
  type FileEditWithSession,
} from '../atoms/sessionFiles';
import { workstreamStagedFilesAtom, setWorkstreamStagedFilesAtom } from '../atoms/workstreamState';
import { getRelativeWorkspacePath } from '../../../shared/pathUtils';

/**
 * Track which workspace path is currently open.
 * Set by initFileStateListeners(workspacePath).
 */
let currentWorkspacePath: string | null = null;

/**
 * Registry of session ID → workspace path.
 * Used to find which sessions belong to which workspace for git status updates.
 */
const sessionWorkspaceRegistry = new Map<string, string>();

/**
 * Registry of worktree ID → worktree path.
 * Used to fetch worktree changed files on git:status-changed.
 */
const worktreePathRegistry = new Map<string, string>();

/**
 * Register a session with its workspace path.
 * Call this when a session is created or loaded.
 */
export function registerSessionWorkspace(sessionId: string, workspacePath: string): void {
  sessionWorkspaceRegistry.set(sessionId, workspacePath);
}

/**
 * Unregister a session (when deleted).
 */
export function unregisterSessionWorkspace(sessionId: string): void {
  sessionWorkspaceRegistry.delete(sessionId);
}

/**
 * Register a worktree with its path.
 * Call this when a worktree session is created or loaded.
 */
export function registerWorktreePath(worktreeId: string, worktreePath: string): void {
  worktreePathRegistry.set(worktreeId, worktreePath);
}

/**
 * Unregister a worktree (when deleted).
 */
export function unregisterWorktreePath(worktreeId: string): void {
  worktreePathRegistry.delete(worktreeId);
}

/**
 * Load initial file state for a session.
 * Call this when a session is created or loaded to populate atoms with initial data.
 */
export async function loadInitialSessionFileState(sessionId: string, workspacePath: string): Promise<void> {
  // Debug logging - uncomment if needed
  // console.log('[fileStateListeners] Loading initial state for session:', sessionId);

  // Register session
  registerSessionWorkspace(sessionId, workspacePath);

  try {
    // Load file edits
    const fileResult = await window.electronAPI.invoke(
      'session-files:get-by-session',
      sessionId,
      'edited'
    );

    // Debug logging - uncomment if needed
    // console.log('[fileStateListeners] File result for', sessionId, ':', fileResult);

    if (fileResult.success && fileResult.files) {
      const edits: FileEditWithSession[] = fileResult.files.map((f: any) => ({
        filePath: f.filePath,
        linkType: 'edited' as const,
        operation: f.metadata?.operation,
        linesAdded: f.metadata?.linesAdded,
        linesRemoved: f.metadata?.linesRemoved,
        timestamp: f.createdAt || new Date().toISOString(),
        sessionId: f.sessionId,
      }));

      // Debug logging - uncomment if needed
      // console.log('[fileStateListeners] Setting', edits.length, 'file edits for session:', sessionId);
      store.set(sessionFileEditsAtom(sessionId), edits);

      // Load git status for these files
      await refreshSessionGitStatus(sessionId);
    }

    // Load pending review files
    const pendingFiles: string[] = await window.electronAPI.invoke(
      'history:get-pending-files-for-session',
      workspacePath,
      sessionId
    );
    store.set(sessionPendingReviewFilesAtom(sessionId), new Set(pendingFiles));

  } catch (error) {
    console.error('[fileStateListeners] Failed to load initial state for session:', sessionId, error);
  }
}

/**
 * Load initial worktree state.
 * Call this when a worktree session is loaded.
 */
export async function loadInitialWorktreeState(worktreeId: string, worktreePath: string): Promise<void> {
  registerWorktreePath(worktreeId, worktreePath);
  await refreshWorktreeChangedFiles(worktreeId, worktreePath);
}

/**
 * Initialize file state listeners.
 * Call once in App.tsx on mount.
 *
 * @param workspacePath - Current workspace path
 * @returns Cleanup function to call on unmount
 */
export function initFileStateListeners(workspacePath: string): () => void {
  currentWorkspacePath = workspacePath;
  const cleanups: Array<() => void> = [];

  // Load all uncommitted files for workspace immediately
  (async () => {
    try {
      const result = await window.electronAPI.invoke('git:get-uncommitted-files', workspacePath);
      if (result.success && result.files) {
        store.set(workspaceUncommittedFilesAtom(workspacePath), result.files);
      }
    } catch (error) {
      console.error('[fileStateListeners] Failed to load initial uncommitted files:', error);
    }
  })();

  // =========================================================================
  // Session Files Updated
  // =========================================================================

  cleanups.push(
    window.electronAPI.on('session-files:updated', async (sessionId: string) => {
      try {
        const result = await window.electronAPI.invoke(
          'session-files:get-by-session',
          sessionId,
          'edited'
        );

        if (result.success && result.files) {
          const edits: FileEditWithSession[] = result.files.map((f: any) => ({
            filePath: f.filePath,
            linkType: 'edited' as const,
            operation: f.metadata?.operation,
            linesAdded: f.metadata?.linesAdded,
            linesRemoved: f.metadata?.linesRemoved,
            timestamp: f.createdAt || new Date().toISOString(),
            sessionId: f.sessionId,
          }));

          store.set(sessionFileEditsAtom(sessionId), edits);

          // Also refresh git status for these files
          await refreshSessionGitStatus(sessionId);
        }
      } catch (error) {
        console.error('[fileStateListeners] Failed to fetch file edits for session:', sessionId, error);
      }
    })
  );

  // =========================================================================
  // Git Status Changed
  // =========================================================================

  cleanups.push(
    window.electronAPI.on('git:status-changed', async (data: { workspacePath: string }) => {
      console.log('[fileStateListeners] git:status-changed received', {
        receivedPath: data.workspacePath,
        currentWorkspacePath,
        match: data.workspacePath === currentWorkspacePath,
        worktreePathRegistry: Array.from(worktreePathRegistry.entries())
      });

      // Check if event is for current workspace OR any registered worktree
      const isCurrentWorkspace = data.workspacePath === currentWorkspacePath;
      const isRegisteredWorktree = Array.from(worktreePathRegistry.values()).includes(data.workspacePath);

      if (!isCurrentWorkspace && !isRegisteredWorktree) {
        console.log('[fileStateListeners] Ignoring git:status-changed for unrelated workspace');
        return;
      }

      try {
        // 1. Refresh all uncommitted files for the workspace/worktree
        const uncommittedResult = await window.electronAPI.invoke(
          'git:get-uncommitted-files',
          data.workspacePath
        );
        if (uncommittedResult.success && uncommittedResult.files) {
          store.set(workspaceUncommittedFilesAtom(data.workspacePath), uncommittedResult.files);
        }

        // 2. Refresh git status for ALL sessions in this workspace
        const sessionsInWorkspace = Array.from(sessionWorkspaceRegistry.entries())
          .filter(([, wsPath]) => wsPath === data.workspacePath)
          .map(([sessionId]) => sessionId);

        await Promise.all(sessionsInWorkspace.map(sessionId => refreshSessionGitStatus(sessionId)));

        // 3. Auto-prune committed files from staging for all sessions
        for (const sessionId of sessionsInWorkspace) {
          await pruneCommittedFilesFromStaging(sessionId, data.workspacePath);
        }

        // 4. Refresh worktree changed files for worktrees matching this path
        const matchingWorktrees = Array.from(worktreePathRegistry.entries())
          .filter(([, worktreePath]) => worktreePath === data.workspacePath);

        console.log('[fileStateListeners] Refreshing worktree changed files', {
          matchingWorktrees: matchingWorktrees.map(([id, path]) => ({ id, path }))
        });

        await Promise.all(
          matchingWorktrees.map(([worktreeId, worktreePath]) =>
            refreshWorktreeChangedFiles(worktreeId, worktreePath)
          )
        );
      } catch (error) {
        console.error('[fileStateListeners] Failed to handle git:status-changed:', error);
      }
    })
  );

  // =========================================================================
  // Pending Review Changed
  // =========================================================================

  cleanups.push(
    window.electronAPI.on('history:pending-count-changed', async () => {
      // Refresh pending files for all sessions
      const allSessions = Array.from(sessionWorkspaceRegistry.keys());

      await Promise.all(
        allSessions.map(async (sessionId) => {
          const wsPath = sessionWorkspaceRegistry.get(sessionId);
          if (!wsPath) return;

          try {
            const pendingFiles: string[] = await window.electronAPI.invoke(
              'history:get-pending-files-for-session',
              wsPath,
              sessionId
            );
            store.set(sessionPendingReviewFilesAtom(sessionId), new Set(pendingFiles));
          } catch (error) {
            console.error('[fileStateListeners] Failed to fetch pending files for session:', sessionId, error);
          }
        })
      );
    })
  );

  return () => {
    cleanups.forEach(cleanup => cleanup?.());
  };
}

/**
 * Refresh git status for a specific session's files.
 */
async function refreshSessionGitStatus(sessionId: string): Promise<void> {
  const workspacePath = sessionWorkspaceRegistry.get(sessionId);
  if (!workspacePath) return;

  const edits = store.get(sessionFileEditsAtom(sessionId));
  if (edits.length === 0) return;

  try {
    // Get relative paths using proper path boundary checking
    const filePaths = edits.map(f => {
      const relativePath = getRelativeWorkspacePath(f.filePath, workspacePath);
      return relativePath !== null ? relativePath : f.filePath;
    });

    const result = await window.electronAPI.invoke('git:get-file-status', workspacePath, filePaths);
    if (result.success && result.status) {
      store.set(sessionGitStatusAtom(sessionId), result.status);
    }
  } catch (error) {
    console.error('[fileStateListeners] Failed to refresh git status for session:', sessionId, error);
  }
}

/**
 * Auto-prune committed files from staging.
 * When files are committed (via any method), remove them from the staged set.
 */
async function pruneCommittedFilesFromStaging(sessionId: string, workspacePath: string): Promise<void> {
  const stagedFiles = store.get(workstreamStagedFilesAtom(sessionId));
  if (stagedFiles.length === 0) return;

  try {
    // Get relative paths for checking using proper path boundary checking
    const relativePaths = stagedFiles.map(fp => {
      const relativePath = getRelativeWorkspacePath(fp, workspacePath);
      return relativePath !== null ? relativePath : fp;
    });

    const result = await window.electronAPI.invoke('git:get-file-status', workspacePath, relativePaths);

    if (result.success && result.status) {
      // Filter out files that are now committed (unchanged)
      const stillUncommitted = stagedFiles.filter(fp => {
        const relativePath = getRelativeWorkspacePath(fp, workspacePath) ?? fp;
        const status = result.status[relativePath];
        return status && status.status !== 'unchanged';
      });

      // Only update if some files were pruned
      if (stillUncommitted.length !== stagedFiles.length) {
        // Debug logging - uncomment if needed
        // console.log('[fileStateListeners] Pruning committed files from staging:',
        //   stagedFiles.length - stillUncommitted.length, 'files');

        // Use the action atom to update
        store.set(setWorkstreamStagedFilesAtom, {
          workstreamId: sessionId,
          files: stillUncommitted
        });
      }
    }
  } catch (error) {
    console.error('[fileStateListeners] Failed to prune committed files:', error);
  }
}

/**
 * Refresh worktree changed files.
 */
async function refreshWorktreeChangedFiles(worktreeId: string, worktreePath: string): Promise<void> {
  try {
    const result = await window.electronAPI.invoke('worktree:get-changed-files', worktreePath);
    if (result.success && result.files) {
      store.set(worktreeChangedFilesAtom(worktreeId), result.files);
    }
  } catch (error) {
    console.error('[fileStateListeners] Failed to refresh worktree changes:', worktreeId, error);
  }
}
