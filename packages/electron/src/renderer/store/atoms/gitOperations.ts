/**
 * Git Operations Atoms
 *
 * State for git operations including commit state, staging, and git status.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

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

// ============================================================
// Pending Git Commit Proposals (from MCP tools)
// ============================================================

export interface PendingGitCommitProposal {
  proposalId: string;
  workspacePath: string;
  sessionId: string;  // Required: proposals must be scoped to a specific session
  filesToStage: string[];
  commitMessage: string;
  reasoning?: string;
  timestamp: number;
}

/**
 * Map of pending git commit proposals keyed by proposalId.
 * Used by GitCommitConfirmationWidget to show interactive UI.
 */
export const pendingGitCommitProposalsAtom = atom<Map<string, PendingGitCommitProposal>>(new Map());

/**
 * Add a pending git commit proposal.
 */
export const addPendingGitCommitProposalAtom = atom(
  null,
  (get, set, proposal: PendingGitCommitProposal) => {
    const current = new Map(get(pendingGitCommitProposalsAtom));
    current.set(proposal.proposalId, proposal);
    set(pendingGitCommitProposalsAtom, current);
  }
);

/**
 * Remove a pending git commit proposal.
 */
export const removePendingGitCommitProposalAtom = atom(
  null,
  (get, set, proposalId: string) => {
    const current = new Map(get(pendingGitCommitProposalsAtom));
    current.delete(proposalId);
    set(pendingGitCommitProposalsAtom, current);
  }
);

/**
 * Get pending proposal for a specific workstream.
 * Matches proposals where sessionId equals the workstreamId OR is a child session of the workstream.
 * This properly scopes proposals to the correct workstream, preventing cross-session pollution.
 *
 * @param workstreamId - The workstream ID (parent session ID)
 * @param childSessionIds - Array of child session IDs to also check
 */
export const pendingProposalForWorkstreamAtom = atomFamily(
  ({ workstreamId, childSessionIds }: { workstreamId: string; childSessionIds: string[] }) =>
    atom((get) => {
      const proposals = get(pendingGitCommitProposalsAtom);
      let mostRecent: PendingGitCommitProposal | null = null;

      // Build a set of valid session IDs (workstream + all children)
      const validSessionIds = new Set([workstreamId, ...childSessionIds]);

      for (const proposal of proposals.values()) {
        if (validSessionIds.has(proposal.sessionId)) {
          if (!mostRecent || proposal.timestamp > mostRecent.timestamp) {
            mostRecent = proposal;
          }
        }
      }
      return mostRecent;
    }),
  // Custom equality function for atomFamily key
  (a, b) => a.workstreamId === b.workstreamId && JSON.stringify(a.childSessionIds) === JSON.stringify(b.childSessionIds)
);
