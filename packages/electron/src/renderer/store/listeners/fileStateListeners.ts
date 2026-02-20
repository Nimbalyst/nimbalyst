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
  worktreeGitStatusAtom,
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
      let edits: FileEditWithSession[] = fileResult.files.map((f: any) => ({
        filePath: f.filePath,
        linkType: 'edited' as const,
        operation: f.metadata?.operation,
        linesAdded: f.metadata?.linesAdded,
        linesRemoved: f.metadata?.linesRemoved,
        timestamp: f.createdAt || new Date().toISOString(),
        sessionId: f.sessionId,
      }));

      // Enrich with tool call match data
      edits = await enrichEditsWithToolCallMatches(sessionId, edits);

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
  await Promise.all([
    refreshWorktreeChangedFiles(worktreeId, worktreePath),
    refreshWorktreeGitStatus(worktreeId, worktreePath),
  ]);

  // Start watching the worktree for git changes (commits, staging)
  // This enables real-time updates when files are added/modified via command line
  try {
    await window.electronAPI.invoke('worktree:start-watching', worktreePath);
  } catch (error) {
    console.error('[fileStateListeners] Failed to start watching worktree:', worktreePath, error);
  }
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
          let edits: FileEditWithSession[] = result.files.map((f: any) => ({
            filePath: f.filePath,
            linkType: 'edited' as const,
            operation: f.metadata?.operation,
            linesAdded: f.metadata?.linesAdded,
            linesRemoved: f.metadata?.linesRemoved,
            timestamp: f.createdAt || new Date().toISOString(),
            sessionId: f.sessionId,
          }));

          // Enrich with tool call match data
          edits = await enrichEditsWithToolCallMatches(sessionId, edits);

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
      // Check if event is for current workspace OR any registered worktree
      const isCurrentWorkspace = data.workspacePath === currentWorkspacePath;
      const isRegisteredWorktree = Array.from(worktreePathRegistry.values()).includes(data.workspacePath);

      if (!isCurrentWorkspace && !isRegisteredWorktree) {
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

        // 4. Refresh worktree changed files and git status for worktrees matching this path
        const matchingWorktrees = Array.from(worktreePathRegistry.entries())
          .filter(([, worktreePath]) => worktreePath === data.workspacePath);

        await Promise.all(
          matchingWorktrees.flatMap(([worktreeId, worktreePath]) => [
            refreshWorktreeChangedFiles(worktreeId, worktreePath),
            refreshWorktreeGitStatus(worktreeId, worktreePath),
          ])
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
 * Enrich file edits with tool call match data.
 * Fetches matches from the database and merges tool call info into the edits.
 */
async function enrichEditsWithToolCallMatches(
  sessionId: string,
  edits: FileEditWithSession[]
): Promise<FileEditWithSession[]> {
  try {
    const matchResult = await window.electronAPI.invoke(
      'session-files:get-tool-call-matches',
      sessionId
    );

    if (!matchResult.success || !matchResult.matches || matchResult.matches.length === 0) {
      return edits;
    }

    // Build map of sessionFileId -> match
    // We need sessionFileId from the original files, but edits don't carry it.
    // Instead, map by (filePath, sessionId) since each file appears once per session.
    // The match has sessionFileId which maps to a session_files row.
    // For now, store match data on the match itself and merge by message info.
    const matchByFileId = new Map<string, any>();
    for (const match of matchResult.matches) {
      matchByFileId.set(match.sessionFileId, match);
    }

    // We need to correlate matches back to edits. The session_files.id isn't in the edit,
    // but the match has sessionFileId. Let's fetch the session files to get the mapping.
    const filesResult = await window.electronAPI.invoke(
      'session-files:get-by-session',
      sessionId,
      'edited'
    );

    if (!filesResult.success || !filesResult.files) return edits;

    // Build filePath -> sessionFileId mapping
    const filePathToId = new Map<string, string>();
    for (const f of filesResult.files) {
      filePathToId.set(f.filePath, f.id);
    }

    // Enrich edits with match data
    return edits.map(edit => {
      const fileId = filePathToId.get(edit.filePath);
      if (!fileId) return edit;

      const match = matchByFileId.get(fileId);
      if (!match) return edit;

      // Extract tool name from match_reason
      const toolNameMatch = match.matchReason?.match(/tool=(.+)$/);
      const toolName = toolNameMatch ? toolNameMatch[1] : undefined;

      return {
        ...edit,
        toolCallMessageId: match.messageId,
        toolCallName: toolName,
        matchScore: match.matchScore,
      };
    });
  } catch (error) {
    // Non-critical - return edits without match data
    console.error('[fileStateListeners] Failed to enrich edits with tool call matches:', error);
    return edits;
  }
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
 * Exported so components can trigger a refresh (e.g., refresh button in GitOperationsPanel).
 */
export async function refreshWorktreeChangedFiles(worktreeId: string, worktreePath: string): Promise<void> {
  try {
    const result = await window.electronAPI.invoke('worktree:get-changed-files', worktreePath);
    if (result.success && result.files) {
      store.set(worktreeChangedFilesAtom(worktreeId), result.files);
    } else if (!result.success) {
      console.error('[fileStateListeners] Failed to get worktree changed files:', worktreeId, result.error);
    }
  } catch (error) {
    console.error('[fileStateListeners] Failed to refresh worktree changes:', worktreeId, error);
  }
}

/**
 * Worktree git status response from IPC.
 */
interface WorktreeStatusResponse {
  success: boolean;
  status?: {
    ahead?: number;
    behind?: number;
    commitsAhead?: number;
    commitsBehind?: number;
    hasUncommittedChanges?: boolean;
  };
}

/**
 * Refresh worktree git status (ahead/behind counts).
 */
async function refreshWorktreeGitStatus(worktreeId: string, worktreePath: string): Promise<void> {
  try {
    const result: WorktreeStatusResponse = await window.electronAPI.invoke('worktree:get-status', worktreePath);
    if (result.success && result.status) {
      store.set(worktreeGitStatusAtom(worktreeId), {
        ahead: result.status.ahead ?? result.status.commitsAhead ?? 0,
        behind: result.status.behind ?? result.status.commitsBehind ?? 0,
        hasUncommittedChanges: result.status.hasUncommittedChanges ?? false,
      });
    }
  } catch (error) {
    console.error('[fileStateListeners] Failed to refresh worktree git status:', worktreeId, error);
  }
}
