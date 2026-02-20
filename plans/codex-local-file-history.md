---
planStatus:
  planId: plan-codex-local-file-history
  title: Local File History for Codex Diff Support
  status: implemented
  planType: feature
  priority: high
  owner: jordanbentley
  stakeholders: []
  tags:
    - codex
    - diff
    - file-history
  created: "2026-02-19"
  updated: "2026-02-19T00:00:00.000Z"
  progress: 100
---

# Local File History for Codex Diff Support

## Problem

Red/green diff visualization works for Claude Code sessions because the Claude Code SDK provides tool-level hooks (`canUseTool`/`onToolResult`) that let us intercept file operations **before** they happen, snapshot the file, and then show the diff after the edit.

Codex has no such hooks. The Codex SDK runs autonomously - we get `file_change` events **after** files are already modified. Without the "before" state, we can't compute diffs.

## How it Works Today (Claude Code)

1. Claude Code calls a tool (e.g., `Edit`, `Write`, `Bash`)
2. `AgentToolHooks.preToolUse()` intercepts the call, reads the file content, and creates a **pre-edit tag** in the `document_history` table via `HistoryManager.createTag()`
3. The tool executes and modifies the file
4. Chokidar detects the change and sends `file-changed-on-disk` to the renderer
5. The renderer checks for pending tags via `HistoryManager.getDiffBaseline()` and enters diff mode, comparing the tagged "before" content with the current file content

**The critical gap for Codex**: Step 2 doesn't exist. There's no pre-tool hook to capture file state before Codex modifies it.

## Proposed Solution: Hybrid Git-Backed Snapshot Cache

When a Codex session starts, build a snapshot cache of file "before" states using a two-tier strategy:

1. **Tier 1 (in-memory):** Eagerly read files that have uncommitted changes (`git diff` dirty files). These are the files where `git show HEAD:<path>` would give the wrong baseline.
2. **Tier 2 (git on-demand):** For all other tracked files, resolve the "before" state on demand via `git show HEAD:<path>`. The working copy matches HEAD for these files, so git is the correct source of truth.
3. **Non-git fallback:** If the workspace isn't a git repo, eagerly read all text files at session start. This is the only case where we need a full scan.

When chokidar detects a file change during the session, the cache provides the "before" content, a pre-edit tag is created via `HistoryManager.createTag()`, and the existing diff UI takes over.

### Architecture Overview

```
Session Start (first sendMessage for Codex)
     |
     v
Detect git status
     |
     +-- Git repo:
     |     1. Capture starting commit: `git rev-parse HEAD` -> startSha
     |     2. Run `git diff --name-only` to find dirty files
     |     3. Read dirty files into in-memory cache (tier 1)
     |     4. Note: clean tracked files use git on-demand (tier 2)
     |
     +-- Not a git repo:
     |     1. Walk workspace, read all text files into cache
     |     2. Skip: node_modules, .git, dist, build, >1MB, binary
     |
     v
SessionFileWatcher starts watching workspace via chokidar
     |
     +-- On 'change' event:
     |     1. Look up "before" in cache (tier 1)
     |     2. If not cached, try `git show <startSha>:<path>` (tier 2)
     |     3. If git fails (non-git or untracked), treat as new file
     |     4. Read current file from disk (the "after")
     |     5. If before != after, create pre-edit tag via HistoryManager
     |     6. Update cache with current content (for subsequent edits)
     |
     +-- On 'add' event (new file):
     |     1. Create pre-edit tag with empty "before" content
     |     2. Cache the new file content
     |
     +-- On 'unlink' event:
     |     1. Remove from cache
     |
     v
Session End (stream completes, abort, or error)
     |
     v
Stop watcher, clear cache
```

### Key Design Decisions

#### 1. Session-scoped, not always-on

- Only active while a Codex session is streaming
- Start on first `sendMessage` call, persist across turns in the same session
- Stop when session is deleted, or when the Codex provider is destroyed
- Minimizes memory usage - no overhead when not using Codex

#### 2. Hybrid cache: git as primary, in-memory for dirty files

**Why not eager-read everything?**
- A medium workspace has ~3,000 text files totaling ~50MB on disk (~100MB as JS strings)
- Startup latency: ~500ms-1.5s for the file scan
- Most of these files won't be touched by the AI

**Why not lazy-only?**
- Lazy fails on the first edit: by the time chokidar fires `change`, the file is already overwritten. We'd have no "before" state.

**The hybrid approach:**
- `git diff --name-only` typically returns 0-20 files. Pre-reading those is instant (<10ms).
- For the other ~3,000 files, `git show <startSha>:<path>` on demand is fast (~5ms per file) and gives the correct baseline.
- The only files that can't use git are: (a) untracked files and (b) non-git workspaces.

#### 2a. Pin git baseline to starting HEAD SHA

At session start, capture `git rev-parse HEAD` and store it as `startSha`. All tier-2 git lookups use `git show <startSha>:<path>` instead of `git show HEAD:<path>`.

**Why:** Codex can make git commits mid-session. If it commits and then edits more files, `HEAD` has moved forward. Using `HEAD` would give the Codex-committed version as the "before" state instead of the true pre-session state. Pinning to `startSha` ensures all diffs are relative to the workspace state when the session began.

#### 3. Non-git workspace support

Not every workspace is a git repo (e.g., scratch directories, downloaded projects). In this case:

- At session start, detect non-git with `git rev-parse --git-dir` (exit code != 0)
- Fall back to eager scan: walk the workspace and read all text files into the cache
- Apply the same filters as git repos: skip node_modules, binary files, files >1MB
- This is the more expensive path (~500ms-1.5s), but non-git workspaces are the minority case

#### 4. Workspace watcher (not individual file watchers)

Unlike the existing `ChokidarFileWatcher` (which watches individual open files), this needs a workspace-level watcher that catches changes to ANY file the Codex agent might touch, including files not currently open in tabs.

Reuse the ignore patterns from `OptimizedWorkspaceWatcher` (skip node_modules, .git, dist, build, etc.), but watch **all files** not just expanded folders.

#### 5. Integration with existing HistoryManager

The snapshot cache doesn't replace HistoryManager - it feeds into it. When a change is detected during an active session:
1. Cache provides the "before" content
2. A pre-edit tag is created via `HistoryManager.createTag()` (same as Claude Code)
3. From there, the existing diff UI, approval bars, and accept/reject flows all work unchanged

#### 6. Integration at AIService level

Integrate at `AIService` rather than inside the Codex provider because:
- AIService already orchestrates session lifecycle and has access to `historyManager`
- Provider-agnostic: works for any future agent provider without tool hooks
- Codex provider emits `session:streaming-start` / `session:streaming-end` events; AIService listens and manages the watcher lifecycle

### Components

#### A. `FileSnapshotCache` (new - main process)

Location: `packages/electron/src/main/file/FileSnapshotCache.ts`

```typescript
class FileSnapshotCache {
  private cache = new Map<string, string>();
  private workspacePath: string | null = null;
  private sessionId: string | null = null;
  private isGitRepo: boolean = false;
  private startSha: string | null = null;  // Pinned HEAD at session start

  // Lifecycle
  async startSession(workspacePath: string, sessionId: string): Promise<void>;
  stopSession(): void;

  // "Before" state resolution (called by SessionFileWatcher on change events)
  // Returns cached content, or resolves via git, or null for new/unknown files
  async getBeforeState(filePath: string): Promise<string | null>;

  // Update cache after a change is processed
  updateSnapshot(filePath: string, content: string): void;
  removeSnapshot(filePath: string): void;

  // Stats for logging
  getStats(): { fileCount: number; totalBytes: number; sessionId: string | null; isGitRepo: boolean };
}
```

**`startSession` flow:**
1. Check if workspace is a git repo (`git rev-parse --git-dir`)
2. If git repo:
   - Capture starting commit: `git rev-parse HEAD` -> store as `startSha`
   - Run `git diff --name-only` + `git diff --name-only --cached` to find dirty files
   - Read each dirty file into cache (skip binary, skip >1MB)
3. If not git repo:
   - Set `startSha = null`
   - Walk workspace tree, read all text files into cache
   - Skip: `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.cache`, `.turbo`, `.svelte-kit`, files >1MB, binary extensions
4. Store `isGitRepo` flag for use in `getBeforeState`

**`getBeforeState` flow:**
1. If file is in cache, return cached content
2. If `isGitRepo` and `startSha`, try `git show <startSha>:<relative-path>`
   - Success: return content (and cache it for future lookups)
   - Failure (untracked at that commit): return `null` (caller treats as new file)
3. If not git repo and not in cache: return `null` (new file)

#### B. `SessionFileWatcher` (new - main process)

Location: `packages/electron/src/main/file/SessionFileWatcher.ts`

```typescript
class SessionFileWatcher {
  async start(
    workspacePath: string,
    sessionId: string,
    cache: FileSnapshotCache,
    historyManager: HistoryManager
  ): Promise<void>;

  async stop(): Promise<void>;
  isActive(): boolean;
}
```

**Responsibilities:**
- Starts a chokidar watcher on the workspace directory
- Ignore patterns (reused from `OptimizedWorkspaceWatcher`):
  - `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.cache`, `.turbo`, `.svelte-kit`, `worktrees/`
- On `change` event:
  1. Call `cache.getBeforeState(filePath)` to get the "before" content
  2. Read current file content from disk
  3. If before content exists and differs from current:
     - Check if a pre-edit tag already exists for this file (same as `AgentToolHooks.tagFileBeforeEdit`)
     - If no pending tag, create one via `historyManager.createTag()`
  4. Call `cache.updateSnapshot(filePath, currentContent)`
- On `add` event:
  1. Check if pre-edit tag already exists
  2. If not, create pre-edit tag with empty "before" content
  3. Cache the new file content
- On `unlink` event:
  1. Remove from cache
- Debounce: 50ms stabilityThreshold (fast enough for AI edits, avoids duplicate events)

#### C. Integration in `AIService`

In `packages/electron/src/main/services/ai/AIService.ts`:

- Maintain a `Map<sessionId, { cache: FileSnapshotCache, watcher: SessionFileWatcher }>` for active Codex sessions
- On Codex session first message: start cache + watcher if not already running
- On session delete / provider destroy: stop cache + watcher
- Gate on provider type: only for `openai-codex` (Claude Code has its own hooks)

### Memory Management

| Concern | Mitigation |
| --- | --- |
| Git repos (common case) | Only dirty files cached eagerly. Typically 0-20 files, <1MB total |
| Non-git repos | Full scan with filters. Skip >1MB, binary, ignored dirs. ~50MB worst case |
| Long-running sessions | Files cached on change accumulate. Cap at ~100MB; stop caching new files if exceeded (git fallback still works) |
| Multiple sessions | One cache+watcher pair per session. Clean up on session end |
| Memory leaks | Explicit `stopSession()` clears map. Also clear on app `before-quit` |

### What Already Works (no changes needed)

Once pre-edit tags are created, the entire existing diff pipeline works:

- `HistoryManager.getDiffBaseline()` retrieves the "before" content
- `TabEditor` / `useEditorState` checks for pending tags and enters diff mode
- `MonacoDiffViewer` renders red/green diffs for code files
- `DiffPreviewEditor` / `TextDiffViewer` renders diffs for markdown files
- `MonacoDiffApprovalBar` provides Accept All / Reject All buttons
- `CustomEditorAIEditedBar` handles custom editor types
- `WorkspaceHistoryDialog` shows workspace-level diff overview
- Accept/reject/clear-all flows update tag status correctly

### Edge Cases

| Scenario | Handling |
| --- | --- |
| File not in git and not in cache | Treat as new file (empty "before") |
| Binary file modified | Skip - don't cache or tag binary files |
| File >1MB | Skip caching; use git fallback if available, else skip |
| File renamed by AI | `unlink` + `add` events: old removed from cache, new treated as new file |
| Rapid successive edits to same file | First edit creates tag; subsequent edits skip (tag already pending, same as Claude Code behavior) |
| Codex creates files in new directories | `add` event fires; treated as new file with empty "before" |
| Workspace has `.gitignore`-only files | `git show` fails for these; falls back to cache (populated if dirty) or null (new file) |
| Codex makes git commits mid-session | `startSha` is pinned at session start. All git lookups use `git show <startSha>:<path>`, so commits during the session don't shift the baseline. Diffs always show changes relative to pre-session state. |
| Session resumes after app restart | Cache is lost (in-memory only). On resume, `startSession` runs again: re-captures current HEAD as new `startSha` and re-scans dirty files. Diffs for the resumed session will be relative to the state at resume time, not original session start. Acceptable tradeoff. |
| Codex modifies files outside workspace | Chokidar won't see them. Out of scope - same limitation as Claude Code. |

### Implementation Plan

#### Phase 1: Core infrastructure
1. Create `FileSnapshotCache` class with git detection, dirty-file scan, and `getBeforeState` resolver
2. Create `SessionFileWatcher` class with chokidar watcher and HistoryManager integration
3. Wire into `AIService`: start/stop around Codex sessions
4. Test: Codex modifies a file in git repo -> pre-edit tag created -> diff mode activates

#### Phase 2: Non-git and robustness
5. Implement non-git workspace full scan fallback
6. Add memory limits and size guards
7. Handle edge cases: renames, new dirs, binary files
8. Test: Codex modifies a file in non-git workspace -> diff works

#### Phase 3: Polish
9. Add logging/stats for debugging
10. Performance testing with large workspaces
11. Handle app restart / session resume gracefully

### Files to Create/Modify

| File | Action | Description |
| --- | --- | --- |
| `packages/electron/src/main/file/FileSnapshotCache.ts` | Create | In-memory file content cache with git-backed resolution |
| `packages/electron/src/main/file/SessionFileWatcher.ts` | Create | Workspace-level chokidar watcher for AI sessions |
| `packages/electron/src/main/services/ai/AIService.ts` | Modify | Start/stop snapshot cache + watcher around Codex sessions |
