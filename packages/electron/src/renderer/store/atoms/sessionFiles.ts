/**
 * Session Files Atoms
 *
 * Per-session state for files edited by AI, git status, and pending reviews.
 * Updated by central listeners in store/listeners/fileStateListeners.ts
 * Read by FilesEditedSidebar and other file-related UI.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { workstreamSessionsAtom } from './sessions';

// ============================================================================
// Types
// ============================================================================

export interface FileEditWithSession {
  filePath: string;
  linkType: 'edited';
  operation?: 'create' | 'edit' | 'delete' | 'rename';
  linesAdded?: number;
  linesRemoved?: number;
  timestamp: string;
  sessionId: string;
}

export interface FileGitStatus {
  status: 'modified' | 'staged' | 'untracked' | 'unchanged' | 'deleted';
  gitStatusCode?: string;
}

export interface WorktreeChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  staged: boolean;
}

// ============================================================================
// Per-Session Atoms
// ============================================================================

/**
 * File edits for a session.
 * Updated by: session-files:updated IPC event
 */
export const sessionFileEditsAtom = atomFamily((sessionId: string) =>
  atom<FileEditWithSession[]>([])
);

/**
 * Git status for files in a session.
 * Updated by: git:status-changed IPC event
 *
 * Map key is relative file path (from workspace root).
 */
export const sessionGitStatusAtom = atomFamily((sessionId: string) =>
  atom<Record<string, FileGitStatus>>({})
);

/**
 * Files with pending AI edits awaiting review for a session.
 * Updated by: history:pending-count-changed IPC event
 */
export const sessionPendingReviewFilesAtom = atomFamily((sessionId: string) =>
  atom<Set<string>>(new Set<string>())
);

// ============================================================================
// Per-Workstream Derived Atoms
// ============================================================================

/**
 * All file edits across all sessions in a workstream.
 * Combines fileEdits from all child sessions.
 */
export const workstreamFileEditsAtom = atomFamily((workstreamId: string) =>
  atom((get) => {
    // Get all child session IDs for this workstream
    const childSessionIds = get(workstreamSessionsAtom(workstreamId));

    // If no children, just return this session's files
    if (childSessionIds.length === 0) {
      return get(sessionFileEditsAtom(workstreamId));
    }

    // Combine files from all child sessions
    const allFiles: FileEditWithSession[] = [];
    for (const sessionId of childSessionIds) {
      const files = get(sessionFileEditsAtom(sessionId));
      allFiles.push(...files);
    }

    return allFiles;
  })
);

/**
 * Git status for all files across all sessions in a workstream.
 * Combines git status from all child sessions.
 */
export const workstreamGitStatusAtom = atomFamily((workstreamId: string) =>
  atom((get) => {
    // Get all child session IDs for this workstream
    const childSessionIds = get(workstreamSessionsAtom(workstreamId));

    // Combine git status from all child sessions
    const combinedStatus: Record<string, FileGitStatus> = {};

    // Include parent's status
    const parentStatus = get(sessionGitStatusAtom(workstreamId));
    Object.assign(combinedStatus, parentStatus);

    // Include all children's status
    for (const sessionId of childSessionIds) {
      const status = get(sessionGitStatusAtom(sessionId));
      Object.assign(combinedStatus, status);
    }

    return combinedStatus;
  })
);

/**
 * All pending review files across all sessions in a workstream.
 * Combines pending files from all child sessions.
 */
export const workstreamPendingReviewFilesAtom = atomFamily((workstreamId: string) =>
  atom((get) => {
    // Get all child session IDs for this workstream
    const childSessionIds = get(workstreamSessionsAtom(workstreamId));

    // Combine pending files from all child sessions
    const allPendingFiles = new Set<string>();

    // Include parent's pending files
    const parentFiles = get(sessionPendingReviewFilesAtom(workstreamId));
    parentFiles.forEach(f => allPendingFiles.add(f));

    // Include all children's pending files
    for (const sessionId of childSessionIds) {
      const files = get(sessionPendingReviewFilesAtom(sessionId));
      files.forEach(f => allPendingFiles.add(f));
    }

    return allPendingFiles;
  })
);

// ============================================================================
// Per-Workspace Atoms
// ============================================================================

/**
 * All uncommitted files in the workspace (entire repo).
 * Updated by: git:status-changed IPC event
 *
 * Array of absolute file paths.
 */
export const workspaceUncommittedFilesAtom = atomFamily((workspacePath: string) =>
  atom<string[]>([])
);

// ============================================================================
// Per-Worktree Atoms
// ============================================================================

/**
 * Changed files in a worktree.
 * Updated by: git:status-changed IPC event (when worktree path is set)
 *
 * Array of files with relative paths and staging status.
 */
export const worktreeChangedFilesAtom = atomFamily((worktreeId: string) =>
  atom<WorktreeChangedFile[]>([])
);

/**
 * Worktree git status (ahead/behind counts).
 * Updated by: git:status-changed IPC event via centralized listener.
 */
export interface WorktreeGitStatus {
  ahead: number;
  behind: number;
  hasUncommittedChanges: boolean;
}

export const worktreeGitStatusAtom = atomFamily((worktreeId: string) =>
  atom<WorktreeGitStatus | null>(null)
);

// ============================================================================
// Action Atoms
// ============================================================================

/**
 * Clear all file state for a session (when session is deleted).
 */
export const clearSessionFileStateAtom = atom(
  null,
  (get, set, sessionId: string) => {
    set(sessionFileEditsAtom(sessionId), []);
    set(sessionGitStatusAtom(sessionId), {});
    set(sessionPendingReviewFilesAtom(sessionId), new Set());

    // Clean up atom family instances
    sessionFileEditsAtom.remove(sessionId);
    sessionGitStatusAtom.remove(sessionId);
    sessionPendingReviewFilesAtom.remove(sessionId);
  }
);
