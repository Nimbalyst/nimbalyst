/**
 * Git operations utilities
 *
 * These functions call IPC handlers in the main process to perform git operations.
 */

import type { GitCommit } from '../types';

// Type-safe IPC invoke wrapper
declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
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
