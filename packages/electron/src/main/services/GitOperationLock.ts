/**
 * GitOperationLock - Centralized lock manager for git operations
 *
 * Prevents concurrent destructive git operations on the same repository
 * that could corrupt git state (e.g., merge + commit, rebase + stage).
 *
 * Read-only operations (status, log, diff) do NOT require locks.
 */

import log from 'electron-log/main';

const logger = log.scope('GitOperationLock');

export interface LockOptions {
  /** Timeout in milliseconds waiting for lock (default: 30000) */
  timeout?: number;
}

/**
 * Centralized lock manager for git operations.
 *
 * Prevents concurrent destructive git operations on the same repository
 * that could corrupt git state (e.g., merge + commit, rebase + stage).
 *
 * Read-only operations (status, log, diff) do NOT require locks.
 */
class GitOperationLockService {
  /**
   * Per-repository operation locks.
   * Maps repository path to a promise that resolves when the current operation completes.
   */
  private operationLocks: Map<string, Promise<void>> = new Map();

  /**
   * Track pending waiters for debugging/metrics
   */
  private waitingCount: Map<string, number> = new Map();

  /**
   * Execute an operation with a lock on the repository.
   *
   * @param repoPath - Path to the repository (normalized)
   * @param operationName - Name of the operation (for logging)
   * @param operation - The async operation to execute
   * @param options - Lock options (timeout)
   * @returns The result of the operation
   * @throws Error if timeout exceeded waiting for lock
   */
  async withLock<T>(
    repoPath: string,
    operationName: string,
    operation: () => Promise<T>,
    options: LockOptions = {}
  ): Promise<T> {
    const { timeout = 30000 } = options;
    const startWait = Date.now();

    // Wait for any existing operation to complete
    const existingLock = this.operationLocks.get(repoPath);
    if (existingLock) {
      const currentWaiting = (this.waitingCount.get(repoPath) || 0) + 1;
      this.waitingCount.set(repoPath, currentWaiting);

      logger.info('Waiting for existing operation to complete', {
        repoPath,
        operationName,
        waitingCount: currentWaiting,
      });

      try {
        // Race between the existing lock and a timeout
        await Promise.race([
          existingLock,
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Lock timeout after ${timeout}ms`)), timeout)
          ),
        ]);
      } catch (error) {
        // Decrement waiting count
        this.waitingCount.set(repoPath, (this.waitingCount.get(repoPath) || 1) - 1);

        if (error instanceof Error && error.message.includes('Lock timeout')) {
          logger.error('Lock timeout exceeded', { repoPath, operationName, timeout });
          throw new Error(`Git operation '${operationName}' timed out waiting for lock on ${repoPath}`);
        }
        // Ignore errors from previous operation - we still want to proceed
      }

      // Decrement waiting count
      const newCount = (this.waitingCount.get(repoPath) || 1) - 1;
      if (newCount <= 0) {
        this.waitingCount.delete(repoPath);
      } else {
        this.waitingCount.set(repoPath, newCount);
      }

      const waitTime = Date.now() - startWait;
      if (waitTime > 1000) {
        logger.warn('Long wait for git lock', { repoPath, operationName, waitTimeMs: waitTime });
      }
    }

    // Create a new lock promise
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.operationLocks.set(repoPath, lockPromise);
    logger.info('Acquired operation lock', { repoPath, operationName });

    try {
      const result = await operation();
      return result;
    } finally {
      // Release the lock
      releaseLock!();
      // Clean up the map entry if it's still our lock
      if (this.operationLocks.get(repoPath) === lockPromise) {
        this.operationLocks.delete(repoPath);
      }
      logger.info('Released operation lock', { repoPath, operationName });
    }
  }

  /**
   * Check if a repository currently has an active lock
   */
  isLocked(repoPath: string): boolean {
    return this.operationLocks.has(repoPath);
  }

  /**
   * Get the number of operations waiting for a lock on a repository
   */
  getWaitingCount(repoPath: string): number {
    return this.waitingCount.get(repoPath) || 0;
  }
}

// Export singleton instance
export const gitOperationLock = new GitOperationLockService();
