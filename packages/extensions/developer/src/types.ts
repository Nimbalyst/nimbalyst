/**
 * Types for Developer Extension
 */

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

export interface SessionFileEdit {
  path: string;
  gitStatus: string | null;
  operation: string;
}

export interface CommitProposal {
  filesToStage: string[];
  commitMessage: string;
  reasoning: string;
}
