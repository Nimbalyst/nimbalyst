# Consolidate File Watchers with .gitignore Support

## Implementation Progress

- [x] Create WorkspaceEventBus.ts with single fs.watch/chokidar per workspace, .gitignore loading, and filtered events
- [x] Refactor OptimizedWorkspaceWatcher to subscribe to WorkspaceEventBus instead of creating own watchers
- [x] Refactor SessionFileWatcher to use WorkspaceEventBus (delete acquireSharedWatcher, releaseSharedWatcher, sharedWatchers, loadGitignoreFilter)
- [x] Update WorkspaceFileEditAttributionService to import getSubscriberIds from WorkspaceEventBus
- [x] Update WorkspaceWatcher.ts stopAll to also stop WorkspaceEventBus
- [x] Delete dead code: SimpleFileWatcher.ts and SimpleWorkspaceWatcher.ts
- [x] Update SessionFileWatcher tests to mock WorkspaceEventBus
- [x] TypeScript compiles with zero errors
- [x] All 14 SessionFileWatcher unit tests passing

## Context

Two separate watchers (OptimizedWorkspaceWatcher + SessionFileWatcher) independently watch the same workspace tree with `fs.watch(recursive: true)`. Neither the main workspace watcher nor ChokidarFileWatcher respects `.gitignore`. SessionFileWatcher recently watched the wrong path (`/Users/ghinkle/sources` instead of the project dir), causing 12,000+ EMFILE retry errors. The watchers need consolidation and `.gitignore` awareness.

## Current Watcher Inventory

| Watcher | Purpose | FDs (macOS) | .gitignore? | Active? |
|---------|---------|-------------|-------------|---------|
| ChokidarFileWatcher | Per-file watchers for open tabs | 1 per file | No | Yes |
| OptimizedWorkspaceWatcher | Workspace tree for file UI | 1 per workspace | No (hardcoded) | Yes |
| SessionFileWatcher | AI change tracking | 1 per workspace | Yes | Yes |
| GitRefWatcher | Git commit/staging detection | 2 per workspace | N/A | Yes |
| SimpleFileWatcher | Legacy per-file watcher | - | No | No (dead code) |
| SimpleWorkspaceWatcher | Legacy workspace watcher | - | No | No (dead code) |

**Problem**: OptimizedWorkspaceWatcher and SessionFileWatcher both create a separate `fs.watch(dir, { recursive: true })` for the same workspace. That's 2 FDs and 2 event streams for the same directory tree.

## Approach

Create a **WorkspaceEventBus** that owns the single `fs.watch`/chokidar watcher per workspace, loads `.gitignore`, and emits filtered events. Both OptimizedWorkspaceWatcher and SessionFileWatcher become subscribers instead of creating their own watchers.

## Changes

### 1. Create `WorkspaceEventBus.ts` (new file)
**Path:** `packages/electron/src/main/file/WorkspaceEventBus.ts`

Single source of filesystem events per workspace:
- Keyed by workspace path, ref-counted (reuse SessionFileWatcher's existing pattern)
- Loads `.gitignore` via `ignore` npm package (reuse `loadGitignoreFilter()` from SessionFileWatcher)
- macOS/Windows: `fs.watch(dir, { recursive: true })` - 1 FD
- Linux: chokidar fallback with `.gitignore`-aware `ignored` function
- Normalizes `fs.watch` events (`change`/`rename`) into `change`/`add`/`unlink` (port logic from SessionFileWatcher lines 126-139)
- Hardcoded `IGNORED_DIRS` (node_modules, .git, dist, etc.) as a fast pre-filter before `.gitignore` check (reuse from OptimizedWorkspaceWatcher)
- Subscribers register with `subscribe(workspacePath, id, listener)` / `unsubscribe(workspacePath, id)`
- Linux folder expansion: `addWatchedPath()` / `removeWatchedPath()` (no-op on macOS/Windows)
- Exposes `getSubscriberIds(workspacePath)` for WorkspaceFileEditAttributionService (replaces `getSharedWatcherSessionIds`)

### 2. Refactor `OptimizedWorkspaceWatcher.ts`
**Path:** `packages/electron/src/main/file/OptimizedWorkspaceWatcher.ts`

- Remove internal `fs.watch`/chokidar creation
- `start()` calls `workspaceEventBus.subscribe()` with a listener that does:
  - `change` -> send `file-changed-on-disk` to window
  - `add`/`unlink` -> trigger debounced `getFolderContents` + send `workspace-file-tree-updated`
- `stop()` calls `workspaceEventBus.unsubscribe()`
- `addWatchedFolder()` / `removeWatchedFolder()` forward to bus on Linux
- Keep `getStats()` but pull data from bus

### 3. Refactor `SessionFileWatcher.ts`
**Path:** `packages/electron/src/main/file/SessionFileWatcher.ts`

- **Delete** `acquireSharedWatcher()`, `releaseSharedWatcher()`, `sharedWatchers` map, `loadGitignoreFilter()` (~120 lines)
- `start()` calls `workspaceEventBus.subscribe(workspacePath, sessionId, listener)`
- `stop()` calls `workspaceEventBus.unsubscribe(workspacePath, sessionId)`
- Keep all session-specific logic: binary filtering, editor save exclusion, content comparison, FileSnapshotCache, dedup
- Move `getSharedWatcherSessionIds` to WorkspaceEventBus as `getSubscriberIds`

### 4. Update `WorkspaceFileEditAttributionService.ts`
**Path:** `packages/electron/src/main/services/WorkspaceFileEditAttributionService.ts`

- Change import from `getSharedWatcherSessionIds` (SessionFileWatcher) to `getSubscriberIds` (WorkspaceEventBus)

### 5. Update `WorkspaceWatcher.ts`
**Path:** `packages/electron/src/main/file/WorkspaceWatcher.ts`

- `stopAllWorkspaceWatchers()` also calls `workspaceEventBus.stopAll()`

### 6. Fix ChokidarFileWatcher bugs (already done)
- Directory guard: refuse to watch directories
- EMFILE: close watcher on first error, don't let chokidar retry-spam

### 7. Delete dead code
- `packages/electron/src/main/file/SimpleFileWatcher.ts` (unused legacy)
- `packages/electron/src/main/file/SimpleWorkspaceWatcher.ts` (unused legacy)

## .gitignore behavior

- Loaded once per workspace when bus starts (matches current SessionFileWatcher behavior)
- Falls back to hardcoded patterns if no `.gitignore` exists
- Hardcoded `IGNORED_DIRS` (node_modules, .git, dist, etc.) always applied as fast pre-filter
- `.gitignore` reload on file change is out of scope (future enhancement)

## Verification

1. Open workspace - file tree should update on file add/rename/delete
2. Files in `.gitignore`'d directories should NOT trigger file tree updates
3. Start AI session - file changes should be tracked and attributed
4. Multiple AI sessions on same workspace should share one watcher (ref-counted)
5. Close all sessions/windows for a workspace - watcher should be released
6. Run existing SessionFileWatcher tests (adapted for bus)
7. Verify with `lsof -p <pid>` that only 1 FD is used per workspace tree (not 2)
