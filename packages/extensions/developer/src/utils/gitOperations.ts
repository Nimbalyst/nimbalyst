/**
 * Git operations utilities
 *
 * These functions call IPC handlers in the main process to perform git operations.
 */

import type { GitStatus, GitCommit } from '../types';

// Type-safe IPC invoke wrapper
declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}

/**
 * Get git status for a workspace or worktree
 */
export async function getGitStatus(workspacePath: string): Promise<GitStatus> {
  if (!window.electronAPI) {
    throw new Error('Electron IPC not available');
  }

  return (await window.electronAPI.invoke('git:status', workspacePath)) as GitStatus;
}

/**
 * Get recent commits
 */
export async function getGitLog(
  workspacePath: string,
  limit: number = 10
): Promise<GitCommit[]> {
  if (!window.electronAPI) {
    throw new Error('Electron IPC not available');
  }

  return (await window.electronAPI.invoke('git:log', workspacePath, limit)) as GitCommit[];
}

/**
 * Get file diff
 */
export async function getFileDiff(filePath: string, workspacePath: string): Promise<string> {
  if (!window.electronAPI) {
    throw new Error('Electron IPC not available');
  }

  return (await window.electronAPI.invoke('git:diff', workspacePath, filePath)) as string;
}

/**
 * Execute git commit
 */
export async function executeGitCommit(
  workspacePath: string,
  message: string,
  filesToStage: string[]
): Promise<{ success: boolean; commitHash?: string; error?: string }> {
  if (!window.electronAPI) {
    throw new Error('Electron IPC not available');
  }

  return (await window.electronAPI.invoke(
    'git:commit',
    workspacePath,
    message,
    filesToStage
  )) as { success: boolean; commitHash?: string; error?: string };
}
