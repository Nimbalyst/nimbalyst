import chokidar, { FSWatcher } from 'chokidar';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import { clearGitStatusCache } from '../ipc/GitStatusHandlers';

interface WatcherEntry {
  refWatcher: FSWatcher;
  indexWatcher: FSWatcher;
  lastCommitHash: string;
  currentBranch: string;
  git: SimpleGit;
}

/**
 * GitRefWatcher watches .git/refs/heads/<branch> and .git/index to detect all git operations.
 *
 * This provides real-time git status updates by detecting:
 * - Commits (via .git/refs/heads/<branch> changes)
 * - Staging changes (via .git/index changes)
 *
 * When commits are detected, it auto-approves pending reviews for committed files.
 */
export class GitRefWatcher {
  // Map<workspacePath, WatcherEntry>
  private watchers = new Map<string, WatcherEntry>();

  // Debounce index changes to avoid rapid fire during staging operations
  private indexDebounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly INDEX_DEBOUNCE_MS = 100;

  /**
   * Start watching a workspace for git state changes
   */
  async start(workspacePath: string): Promise<void> {
    // Already watching this workspace
    if (this.watchers.has(workspacePath)) {
      return;
    }

    try {
      const gitDir = path.join(workspacePath, '.git');

      // Verify .git directory exists
      const fs = await import('fs/promises');
      try {
        await fs.access(gitDir);
      } catch {
        // Not a git repository
        return;
      }

      const git: SimpleGit = simpleGit(workspacePath);

      // Get current branch
      const status = await git.status();
      const currentBranch = status.current;
      if (!currentBranch) {
        // Not on a branch (detached HEAD) - skip watching
        logger.main.info('[GitRefWatcher] Skipping detached HEAD workspace:', workspacePath);
        return;
      }

      // Get current commit hash as baseline
      const log = await git.log({ maxCount: 1 });
      const lastCommitHash = log.latest?.hash || '';

      // Watch .git/refs/heads/<current-branch> for commit detection
      const branchRefPath = path.join(workspacePath, '.git/refs/heads', currentBranch);
      const refWatcher = chokidar.watch(branchRefPath, {
        ignoreInitial: true,
        persistent: true,
        usePolling: false,
        awaitWriteFinish: {
          stabilityThreshold: 50,
          pollInterval: 10,
        },
      });

      refWatcher.on('change', async () => {
        await this.handleRefChange(workspacePath);
      });

      refWatcher.on('add', async () => {
        // Handle case where ref file is recreated (e.g., after branch switch)
        await this.handleRefChange(workspacePath);
      });

      refWatcher.on('error', (error) => {
        logger.main.error('[GitRefWatcher] Ref watcher error:', error);
      });

      // Watch .git/index for staging changes
      const indexPath = path.join(workspacePath, '.git/index');
      const indexWatcher = chokidar.watch(indexPath, {
        ignoreInitial: true,
        persistent: true,
        usePolling: false,
        awaitWriteFinish: {
          stabilityThreshold: 50,
          pollInterval: 10,
        },
      });

      indexWatcher.on('change', () => {
        this.handleIndexChangeDebounced(workspacePath);
      });

      indexWatcher.on('error', (error) => {
        logger.main.error('[GitRefWatcher] Index watcher error:', error);
      });

      this.watchers.set(workspacePath, {
        refWatcher,
        indexWatcher,
        lastCommitHash,
        currentBranch,
        git,
      });

      logger.main.info('[GitRefWatcher] Started watching:', {
        workspace: path.basename(workspacePath),
        branch: currentBranch,
      });
    } catch (error) {
      logger.main.error('[GitRefWatcher] Failed to start watching:', error);
    }
  }

  /**
   * Stop watching a workspace
   */
  async stop(workspacePath: string): Promise<void> {
    const entry = this.watchers.get(workspacePath);
    if (entry) {
      await entry.refWatcher.close();
      await entry.indexWatcher.close();
      this.watchers.delete(workspacePath);

      // Clear any pending debounce timer
      const timer = this.indexDebounceTimers.get(workspacePath);
      if (timer) {
        clearTimeout(timer);
        this.indexDebounceTimers.delete(workspacePath);
      }

      logger.main.info('[GitRefWatcher] Stopped watching:', path.basename(workspacePath));
    }
  }

  /**
   * Stop watching all workspaces
   */
  async stopAll(): Promise<void> {
    logger.main.info(`[GitRefWatcher] Stopping all watchers (${this.watchers.size} active)`);

    const promises: Promise<void>[] = [];
    for (const workspacePath of this.watchers.keys()) {
      promises.push(this.stop(workspacePath));
    }
    await Promise.all(promises);

    logger.main.info('[GitRefWatcher] All watchers stopped');
  }

  /**
   * Handle .git/refs/heads/<branch> file changes (new commits)
   */
  private async handleRefChange(workspacePath: string): Promise<void> {
    try {
      const entry = this.watchers.get(workspacePath);
      if (!entry) return;

      // Get the latest commit
      const log = await entry.git.log({ maxCount: 1 });
      if (!log.latest) return;

      const newCommitHash = log.latest.hash;

      // If this is the same commit we already processed, skip
      if (entry.lastCommitHash === newCommitHash) {
        return;
      }

      // logger.main.info('[GitRefWatcher] New commit detected:', {
      //   workspace: path.basename(workspacePath),
      //   hash: newCommitHash.slice(0, 7),
      //   message: log.latest.message?.substring(0, 50),
      // });

      // Update our tracking
      const oldCommitHash = entry.lastCommitHash;
      entry.lastCommitHash = newCommitHash;

      // Get the files that were changed in this commit
      let committedFiles: string[] = [];
      try {
        // Handle initial commit case (no parent)
        const diffRef = oldCommitHash ? `${oldCommitHash}..${newCommitHash}` : newCommitHash;
        const diffSummary = await entry.git.diffSummary([diffRef]);
        committedFiles = diffSummary.files.map((file) =>
          path.join(workspacePath, file.file)
        );
      } catch (diffError) {
        // Fallback: just get the files from the latest commit
        try {
          const diffSummary = await entry.git.diffSummary([`${newCommitHash}~1`, newCommitHash]);
          committedFiles = diffSummary.files.map((file) =>
            path.join(workspacePath, file.file)
          );
        } catch {
          // Initial commit or other edge case - get files from show
          logger.main.warn('[GitRefWatcher] Could not get diff summary, skipping auto-approve');
        }
      }

      // logger.main.info('[GitRefWatcher] Committed files:', committedFiles.length);

      // Auto-approve pending reviews for committed files
      if (committedFiles.length > 0) {
        await this.autoApprovePendingReviews(workspacePath, committedFiles);
      }

      // Clear git status cache so next query gets fresh data
      clearGitStatusCache(workspacePath);

      // Emit events to update UI
      this.emitToAllWindows('git:commit-detected', {
        workspacePath,
        commitHash: newCommitHash,
        commitMessage: log.latest.message,
        committedFiles,
      });

      this.emitToAllWindows('git:status-changed', {
        workspacePath,
      });
    } catch (error) {
      logger.main.error('[GitRefWatcher] Error handling ref change:', error);
    }
  }

  /**
   * Handle .git/index changes with debouncing
   */
  private handleIndexChangeDebounced(workspacePath: string): void {
    // Clear existing timer
    const existingTimer = this.indexDebounceTimers.get(workspacePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.indexDebounceTimers.delete(workspacePath);
      this.handleIndexChange(workspacePath);
    }, this.INDEX_DEBOUNCE_MS);

    this.indexDebounceTimers.set(workspacePath, timer);
  }

  /**
   * Handle .git/index changes (staging changes)
   */
  private handleIndexChange(workspacePath: string): void {
    // Clear git status cache so next query gets fresh data
    clearGitStatusCache(workspacePath);

    // Emit event to update UI
    this.emitToAllWindows('git:status-changed', {
      workspacePath,
    });
  }

  /**
   * Auto-approve pending reviews for committed files
   */
  private async autoApprovePendingReviews(
    workspacePath: string,
    committedFiles: string[]
  ): Promise<void> {
    try {
      const { historyManager } = await import('../HistoryManager');

      let approvedCount = 0;
      for (const filePath of committedFiles) {
        const pendingTags = await historyManager.getPendingTags(filePath);

        if (pendingTags.length > 0) {
          // logger.main.info('[GitRefWatcher] Auto-approving pending review:', {
          //   file: path.basename(filePath),
          //   tags: pendingTags.length,
          // });

          for (const tag of pendingTags) {
            await historyManager.updateTagStatus(filePath, tag.id, 'reviewed', workspacePath);
            approvedCount++;
          }
        }
      }

      if (approvedCount > 0) {
        // logger.main.info('[GitRefWatcher] Auto-approved pending reviews:', {
        //   workspace: path.basename(workspacePath),
        //   count: approvedCount,
        // });

        // Emit pending count changed event to update UI
        // The historyManager.updateTagStatus already emits this, but we emit
        // a final one to ensure the UI is up to date
        const count = await historyManager.getPendingCount(workspacePath);
        this.emitToAllWindows('history:pending-count-changed', {
          workspacePath,
          count,
        });
      }
    } catch (error) {
      logger.main.error('[GitRefWatcher] Error auto-approving pending reviews:', error);
    }
  }

  /**
   * Emit an event to all browser windows
   */
  private emitToAllWindows(channel: string, data: unknown): void {
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, data);
      }
    }
  }

  /**
   * Get statistics for debugging
   */
  getStats(): { type: string; activeWatchers: number; workspaces: string[] } {
    return {
      type: 'GitRefWatcher',
      activeWatchers: this.watchers.size,
      workspaces: Array.from(this.watchers.keys()).map((p) => path.basename(p)),
    };
  }
}

export const gitRefWatcher = new GitRefWatcher();
