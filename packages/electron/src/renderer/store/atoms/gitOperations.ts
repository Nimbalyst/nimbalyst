/**
 * Git Operations Atoms
 *
 * State for git operations including commit state, staging, and git status.
 */

import { atom } from 'jotai';
import { atomFamily } from '../debug/atomFamilyRegistry';

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  hasUncommitted: boolean;
  baseBranch?: string;
  isMerged?: boolean;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Git status for the current workspace.
 * Updated by file watcher when git state changes.
 */
export const gitStatusAtom = atom<GitStatus | null>(null);

/**
 * Recent commits for the current workspace.
 */
export const gitCommitsAtom = atom<GitCommit[]>([]);

/**
 * Files staged for commit.
 * Set of file paths that the user has checked in the UI.
 */
export const stagedFilesAtom = atom<Set<string>>(new Set<string>());

/**
 * Commit message being composed.
 */
export const commitMessageAtom = atom<string>('');

/**
 * Whether a commit operation is in progress.
 */
export const isCommittingAtom = atom<boolean>(false);

/**
 * Per-file staging state.
 * Derived from stagedFilesAtom for efficient per-file subscriptions.
 */
export const fileStagedAtom = atomFamily((filePath: string) =>
  atom(
    (get) => {
      const staged = get(stagedFilesAtom);
      return staged.has(filePath);
    },
    (get, set, isStaged: boolean) => {
      const staged = new Set(get(stagedFilesAtom));
      if (isStaged) {
        staged.add(filePath);
      } else {
        staged.delete(filePath);
      }
      set(stagedFilesAtom, staged);
    }
  )
);

/**
 * Helper action to toggle staging for a file.
 */
export const toggleFileStagingAtom = atom(null, (get, set, filePath: string) => {
  const isStaged = get(fileStagedAtom(filePath));
  set(fileStagedAtom(filePath), !isStaged);
});

/**
 * Helper action to stage all edited files.
 */
export const stageAllFilesAtom = atom(null, (get, set, filePaths: string[]) => {
  set(stagedFilesAtom, new Set(filePaths));
});

/**
 * Helper action to clear staging.
 */
export const clearStagingAtom = atom(null, (get, set) => {
  set(stagedFilesAtom, new Set());
});

// Git commit proposals are handled by GitCommitConfirmationWidget
// Widget renders directly from tool call data - no atoms needed
// See packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/GitCommitConfirmationWidget.tsx

// ============================================================
// Git Panel Refresh Triggers
// ============================================================

/**
 * Per-worktree refresh counter.
 * Incremented when a session in this worktree completes, triggering the
 * GitOperationsPanel to refresh its data.
 *
 * The counter approach is used instead of a boolean because:
 * 1. Multiple sessions can complete in sequence
 * 2. The counter ensures each completion triggers a refresh
 * 3. Components can use useEffect with this value as a dependency
 */
export const worktreeRefreshCounterAtom = atomFamily((_worktreeId: string) =>
  atom(0)
);

/**
 * Action atom to trigger a refresh for a specific worktree.
 * Called when a session in that worktree completes.
 */
export const triggerWorktreeRefreshAtom = atom(
  null,
  (get, set, worktreeId: string) => {
    const current = get(worktreeRefreshCounterAtom(worktreeId));
    set(worktreeRefreshCounterAtom(worktreeId), current + 1);
  }
);
