---
planStatus:
  planId: plan-centralized-git-locking
  title: Centralized Git Locking System
  status: draft
  planType: refactor
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - git
    - worktree
    - safety
    - concurrency
  created: "2026-02-05"
  updated: "2026-02-05T19:00:00.000Z"
  progress: 0
---
# Centralized Git Locking System

## Overview

The current git locking mechanism in `GitWorktreeService.ts` only protects a subset of git operations (merge, rebase, squash). Other git operations across the codebase - including commits, staging, resets, and branch operations - run without any locking, creating potential for race conditions and git state corruption when multiple operations run concurrently.

This plan proposes extracting the locking mechanism into a centralized service that can be used by all git operations across the codebase.

## Current State Analysis

### Existing Lock Implementation

The lock in `GitWorktreeService.ts` (lines 128-177) uses a per-repository promise-based lock:

```typescript
private operationLocks: Map<string, Promise<void>> = new Map();

private async withLock<T>(repoPath: string, operationName: string, operation: () => Promise<T>): Promise<T>
```

**Currently locked operations:**
- `mergeToMain()` - line 1382
- `rebaseFromBase()` - line 1899
- `squashCommits()` - line 2348

### Unlocked Git Operations (Gap Analysis)

#### GitWorktreeService.ts
| Method | Operations | Risk |
| --- | --- | --- |
| `createWorktree()` | `git worktree add`, branch creation | Medium - parallel creates could collide |
| `deleteWorktree()` | `git worktree remove`, branch deletion | Medium - could conflict with other ops |
| `commitChanges()` | `git reset`, `git add`, `git commit` | High - staging/commit races |

#### GitHandlers.ts (IPC handlers)
| Handler | Operations | Risk |
| --- | --- | --- |
| `git:status` | `git status` | Low - read-only |
| `git:log` | `git log` | Low - read-only |
| `git:diff` | `git diff` | Low - read-only |
| `git:commit` | `git reset`, `git add`, `git commit` | High - staging/commit races |

#### WorktreeHandlers.ts (IPC handlers)
| Handler | Operations | Risk |
| --- | --- | --- |
| `worktree:stage-file` | `git add`, `git reset` | Medium - staging races |
| `worktree:stage-all` | `git add -A`, `git reset` | Medium - staging races |

#### GitStatusService.ts
Uses `execSync` for read-only operations - safe, no locking needed.

#### GitRefWatcher.ts
Uses `simpleGit` for read-only operations (`log`, `status`, `diffSummary`) - safe.

#### SessionHandlers.ts
Uses `simpleGit` for `git status` only - read-only, safe.

## Proposed Solution

### 1. Create Centralized GitOperationLock Service

Create a new singleton service that manages repository-level locks:

**File:** `packages/electron/src/main/services/GitOperationLock.ts`

```typescript
import log from 'electron-log/main';

const logger = log.scope('GitOperationLock');

export type LockPriority = 'high' | 'normal';

export interface LockOptions {
  priority?: LockPriority;
  timeout?: number;  // ms, default 30000
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
   * @param options - Lock options (timeout, priority)
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
        waitingCount: currentWaiting
      });

      try {
        // Race between the existing lock and a timeout
        await Promise.race([
          existingLock,
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Lock timeout after ${timeout}ms`)), timeout)
          )
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
      this.waitingCount.set(repoPath, (this.waitingCount.get(repoPath) || 1) - 1);

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
```

### 2. Operation Classification

Define which operations require locks vs. are read-only:

| Category | Operations | Needs Lock |
| --- | --- | --- |
| **Write Operations** | commit, add, reset, merge, rebase, checkout, stash, branch create/delete | Yes |
| **Read Operations** | status, log, diff, rev-parse, branch list | No |
| **Worktree Management** | worktree add, worktree remove | Yes |

### 3. Migration Plan

#### Phase 1: Extract and Create Service
1. Create `GitOperationLock.ts` with the centralized lock service
2. Add comprehensive tests for the locking mechanism
3. Export the singleton for use across the codebase

#### Phase 2: Migrate GitWorktreeService
1. Replace the private `withLock` method with calls to `gitOperationLock.withLock()`
2. Add locking to currently-unlocked operations:
  - `createWorktree()` - use worktree path as lock key
  - `deleteWorktree()` - use workspace path as lock key
  - `commitChanges()` - use worktree path as lock key

#### Phase 3: Migrate IPC Handlers

**GitHandlers.ts:**
- Wrap `git:commit` handler with lock (use workspace path)

**WorktreeHandlers.ts:**
- Wrap `worktree:stage-file` with lock (use worktree path)
- Wrap `worktree:stage-all` with lock (use worktree path)

### 4. Lock Scope Strategy

Different operations need different lock scopes:

| Operation Type | Lock Key | Rationale |
| --- | --- | --- |
| Worktree operations | `worktreePath` | Isolate parallel worktree work |
| Main repo operations (merge) | `mainRepoPath` | Prevent conflicts in main repo |
| Cross-repo operations | Both paths | Prevent any interference |

For operations that touch both worktree and main repo (like merge), the lock should be on the **main repo path** since that's where the actual state change occurs.

### 5. Error Handling

When lock timeout occurs:
1. Log detailed information about the waiting operation
2. Return a user-friendly error message
3. Do NOT leave the repository in an inconsistent state

## Implementation Steps

### Step 1: Create GitOperationLock Service
- [ ] Create `packages/electron/src/main/services/GitOperationLock.ts`
- [ ] Implement `withLock()` method with timeout support
- [ ] Add logging for lock acquisition/release
- [ ] Export singleton instance

### Step 2: Update GitWorktreeService
- [ ] Import `gitOperationLock` from new service
- [ ] Remove private `operationLocks` map and `withLock` method
- [ ] Update `mergeToMain()` to use centralized lock
- [ ] Update `rebaseFromBase()` to use centralized lock
- [ ] Update `squashCommits()` to use centralized lock
- [ ] Add locking to `createWorktree()`
- [ ] Add locking to `deleteWorktree()`
- [ ] Add locking to `commitChanges()`

### Step 3: Update GitHandlers.ts
- [ ] Import `gitOperationLock`
- [ ] Wrap `git:commit` handler with lock

### Step 4: Update WorktreeHandlers.ts
- [ ] Import `gitOperationLock`
- [ ] Wrap `worktree:stage-file` handler with lock
- [ ] Wrap `worktree:stage-all` handler with lock

### Step 5: Testing
- [ ] Write unit tests for GitOperationLock
- [ ] Test concurrent operation scenarios
- [ ] Test timeout handling
- [ ] Verify existing functionality still works

## Files to Modify

| File | Changes |
| --- | --- |
| `packages/electron/src/main/services/GitOperationLock.ts` | **NEW** - Centralized lock service |
| `packages/electron/src/main/services/GitWorktreeService.ts` | Replace private lock with centralized, add locking to more methods |
| `packages/electron/src/main/ipc/GitHandlers.ts` | Add lock to commit handler |
| `packages/electron/src/main/ipc/WorktreeHandlers.ts` | Add locks to staging handlers |

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Deadlock from nested locks | High | Lock is per-repo, not global; operations don't call each other |
| Performance degradation | Medium | Only lock destructive operations; reads remain unlocked |
| Timeout too short | Medium | Default 30s is generous; make configurable |
| Lock not released on crash | Low | Locks are in-memory; app restart clears them |

## Success Criteria

1. All destructive git operations are protected by the centralized lock
2. Read-only operations remain unaffected (no performance regression)
3. Concurrent operations on the **same repo** are serialized
4. Concurrent operations on **different repos** run in parallel
5. Timeout errors are handled gracefully with user-friendly messages
6. No changes to external behavior - only internal safety improvements

## Future Considerations

1. **Metrics/Analytics**: Track lock wait times to identify contention hotspots
2. **Lock Visualization**: UI indicator when operations are queued
3. **Priority Queuing**: Allow high-priority operations to jump the queue
4. **Distributed Locking**: If we ever support multi-process, consider file-based locks
