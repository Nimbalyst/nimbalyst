/**
 * Git Commit Proposal Atoms
 *
 * Stores pending git commit proposals for the GitCommitConfirmationWidget.
 * This is a cross-platform atom that works in both Electron and Capacitor.
 *
 * In Electron, this is populated by the DB-backed sessionPendingGitCommitProposalAtom
 * via a sync effect in the SessionTranscript component.
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
// Import directly from store.ts to avoid circular dependency with index.ts
import { store } from '../store.js';

export interface GitCommitProposalData {
  proposalId: string;
  workspacePath: string;
  filesToStage: Array<string | { path: string; status: 'added' | 'modified' | 'deleted' }>;
  commitMessage: string;
  reasoning?: string;
  timestamp: number;
}

/**
 * Atom family tracking pending git commit proposals by session ID.
 * Returns the proposal data if one exists for the session, null otherwise.
 */
export const sessionPendingGitCommitProposalAtom = atomFamily((sessionId: string) =>
  atom<GitCommitProposalData | null>(null)
);

/**
 * Set atom for updating a session's pending git commit proposal.
 * Pass null to clear.
 */
export const setSessionGitCommitProposalAtom = atom(
  null,
  (get, set, update: { sessionId: string; proposal: GitCommitProposalData | null }) => {
    set(sessionPendingGitCommitProposalAtom(update.sessionId), update.proposal);
  }
);

/**
 * Check if a session has a pending git commit proposal.
 */
export function sessionHasPendingGitCommitProposal(sessionId: string): boolean {
  const proposal = store.get(sessionPendingGitCommitProposalAtom(sessionId));
  return proposal !== null;
}

/**
 * Clear pending git commit proposal for a session.
 */
export function clearPendingGitCommitProposal(sessionId: string): void {
  store.set(sessionPendingGitCommitProposalAtom(sessionId), null);
}
