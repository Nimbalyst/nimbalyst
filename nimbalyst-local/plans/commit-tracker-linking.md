---
planStatus:
  planId: plan-commit-tracker-linking
  title: Commit-Tracker Item Linking
  status: in-review
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - tracker
    - git
    - developer-workflow
  created: "2026-04-03"
  updated: "2026-04-03T00:00:00.000Z"
  progress: 100
---
# Commit-Tracker Item Linking

## Implementation Progress

- [x] Add `trackerAutomation` to ai-settings store (AIService.ts get/save handlers)
- [x] Add project-level `trackerAutomationOverride` to WorkspaceState
- [x] Create `trackerAutomationAtoms.ts` (atom + setter + init)
- [x] Add "Tracker Automation" section to AdvancedPanel.tsx
- [x] Add project override UI to project settings
- [x] Update data model: add `linkedCommits` array to TrackerRecordSystem + TrackerPayloadSystem
- [x] Thread `linkedCommits` through sync payload (recordToPayload / payloadToRecord)
- [x] Thread `linkedCommits` through tracker tool handlers (create/update/read)
- [x] Create `CommitTrackerLinker` service
- [x] Issue key regex parser with closing keyword detection
- [x] Hook CommitTrackerLinker into GitRefWatcher commit listeners
- [x] Session-based linking in post-commit flow
- [x] Deduplication logic (same SHA not added twice)
- [x] Auto-close on closing keywords (gated by settings)
- [x] Activity log entries for linking and status changes
- [x] "Commits" section in TrackerItemDetail UI
- [x] Typecheck passes

## Problem

When an AI session fixes a bug or implements a feature tracked in the Nimbalyst tracker, there's no connection between the git commit and the tracker item. The user manually closes the bug with no record of which commit resolved it. This loses valuable traceability.

## Current State

- `linkedCommitSha` field **already exists** on tracker items (JSONB data) and syncs via collabv3
- Sessions already link bidirectionally to tracker items (`linkedSessions[]` / `linkedTrackerItemIds[]`)
- The git commit proposal widget shows file lists, commit messages, and success state with commit hash
- After commit, the commit hash is available but **never written back to tracker items**
- **No UI** for commit-tracker relationships exists today
- **GitRefWatcher already exists** -- watches `.git/refs/heads/<branch>` and emits `git:commit-detected` with `{ workspacePath, commitHash, commitMessage, committedFiles }` for every commit (including terminal, external tools, etc.)

## Decisions

- **Auto-close on commit**: Enabled by default (when tracker automation is enabled). `Fixes`/`Closes`/`Resolves NIM-123` in a commit message automatically sets the tracker item status to "done." Can be disabled in settings.
- **All commits, not just widget commits**: Issue key parsing applies to ALL commits detected by GitRefWatcher, including those made from the terminal or other tools. This gives full traceability regardless of how the commit was made.
- **Agent auto-appends issue keys**: When the agent proposes a commit and the session has linked tracker items, it automatically appends `Resolves NIM-X` to the commit message. User can edit it out in the widget.
- **Opt-in via settings**: All automatic tracker behaviors are gated behind an "Advanced Tracker Automation" toggle. Disabled by default. Overridable per-project.

## Design

### Data Model Change

The current `linkedCommitSha: string` field is limited to a single commit. A tracker item may have multiple commits (e.g., initial fix + follow-up). Change to:

```typescript
// In tracker item JSONB data
linkedCommits?: Array<{
  sha: string;          // Full commit hash
  message: string;      // First line of commit message
  sessionId?: string;   // AI session that produced the commit (if any)
  timestamp: string;    // ISO date
}>;

// Keep linkedCommitSha as read alias for backwards compat during migration
linkedCommitSha?: string; // Deprecated: use linkedCommits[0].sha
```

Update `TrackerItemPayload` in `trackerSyncTypes.ts` to sync the new field. Cap at 50 commits per item (oldest trimmed) to keep payload size reasonable.

### Three Linking Mechanisms

#### 1. Automatic linking via session (zero friction, proposal-widget commits only)

After a successful commit through the proposal widget (both auto-commit and manual), if the session has linked tracker items:

```
Commit succeeds -> get commitHash
  -> look up session's linkedTrackerItemIds
  -> for each linked tracker item:
    -> append to item's linkedCommits[] (with sessionId)
    -> broadcast update to renderer
```

This is the primary path for AI-assisted work. Most AI sessions that work on bugs/tasks will already have `tracker_link_session` called by the agent, so this "just works."

**Implementation**: Add post-commit hook in `interactiveToolHandlers.ts` (auto-commit path) and in the `git:commit` IPC response handler (manual path).

#### 2. Issue key parsing from ALL commits (via GitRefWatcher)

The existing `git:commit-detected` event fires for every new commit on the current branch, regardless of how it was made. Hook into this to parse commit messages for tracker issue keys:

```
GitRefWatcher emits git:commit-detected
  -> { commitHash, commitMessage, committedFiles, workspacePath }
  -> parse commitMessage for issue keys (NIM-123)
  -> for each matched tracker item:
    -> append to item's linkedCommits[] (no sessionId for external commits)
    -> if closing keyword (Fixes/Closes/Resolves): set status to "done"
    -> add activity log entry
    -> broadcast update to renderer
```

**Issue key patterns** (case-insensitive):
- `NIM-123` -- bare reference, link only
- `Fixes NIM-123` / `Closes NIM-123` / `Resolves NIM-123` -- link + auto-close
- Also match `fix:`, `fixed`, `close`, `closed`, `resolve`, `resolved` variants

**Deduplication**: If a commit was already linked via mechanism 1 (session linking), don't duplicate it when the same commit is detected by GitRefWatcher. Check `sha` uniqueness in `linkedCommits[]`.

**Implementation**: New `CommitTrackerLinker` service in `packages/electron/src/main/services/`. Listens for `git:commit-detected` events from GitRefWatcher. Queries tracker items by `issue_key` column.

#### 3. Manual selection in commit widget (explicit control)

Add a "Linked Items" section to the GitCommitConfirmationWidget:

- **Auto-populated**: Pre-select items linked to the current session
- **Searchable**: Typeahead search across all tracker items
- **Status action**: Optional "Close on commit" checkbox per linked item
- Appears between the file list and the commit message

### Commit Widget UI Enhancement

```
+---------------------------------------------+
| Commit Proposal                              |
+---------------------------------------------+
| Analysis: Fixed the auth null check...       |
+---------------------------------------------+
| Files (3/3 selected)                         |
|  > src/auth/                                 |
|    [x] handler.ts          (modified)        |
|    [x] middleware.ts        (modified)        |
|  > tests/                                    |
|    [x] auth.test.ts         (modified)       |
+---------------------------------------------+
| Linked Items                                 |
|  [x] bug NIM-42  Auth crash on logout [Close]|
|  + Search tracker items...                   |
+---------------------------------------------+
| fix: null check in auth handler              |
|                                              |
| Resolves NIM-42                              |
+---------------------------------------------+
| [ ] Auto-approve commits   [Cancel] [Commit] |
+---------------------------------------------+
```

### Agent Commit Message Enhancement

When the `developer_git_commit_proposal` tool is called by an agent, the agent's instructions (via CLAUDE.md or MCP tool description) should direct it to:

1. Check if the session has linked tracker items
2. If so, append `Resolves NIM-X` (or `Fixes NIM-X` for bugs) to the proposed commit message
3. The user can edit this out in the widget before committing

This is a prompt-level change, not a code change -- update the MCP tool description for `developer_git_commit_proposal` to include this instruction.

### Tracker Item Detail: Commits Display

In TrackerItemDetail, add a "Commits" section below the existing "Sessions" section:

```
+-- Commits (2) ----------------------------+
|  a1b2c3d  Fix null check in auth handler  |
|           2 hours ago  [session icon]      |
|  f4e5d6c  Add regression test             |
|           1 hour ago                       |
+--------------------------------------------+
```

Each commit entry:
- Short SHA (7 chars, clickable to copy full SHA)
- First line of commit message
- Relative timestamp
- Session link icon if commit came from an AI session (clickable to navigate)

### Auto-Commit Path

For auto-commit (no widget interaction), linking is fully automatic:
1. Session's linked tracker items are found and linked
2. Commit message is parsed for additional issue keys by GitRefWatcher path
3. All matched items get the commit appended (deduplicated)
4. Items with `Fixes`/`Closes`/`Resolves` keyword get status changed to "done"
5. No user interaction needed

### Post-Commit Status Updates

When a commit references a tracker item with a closing keyword:
- `Fixes NIM-123` -> set status to "done"
- Enabled by default, configurable in settings
- Activity log entry: "Status changed to done via commit a1b2c3d"
- Syncs to team via collabv3

## Architecture

```
                    +------------------+
                    | GitRefWatcher    |
                    | (already exists) |
                    +--------+---------+
                             |
                    git:commit-detected
                             |
                             v
+-------------------+   +-------------------+
| Commit Proposal   |   | CommitTrackerLinker|  <-- NEW SERVICE
| Widget (manual/   |-->| (main process)    |
| auto-commit)      |   +--------+----------+
+-------------------+            |
                          +------+------+
                          |             |
                     session-based   issue-key
                     linking         parsing
                          |             |
                          v             v
                    +---------------------+
                    | Tracker Item Update  |
                    | (linkedCommits[],    |
                    |  status change,      |
                    |  activity log)       |
                    +----------+----------+
                               |
                          IPC broadcast
                               |
                    +----------v----------+
                    | TrackerItemDetail UI |
                    | (Commits section)    |
                    +---------------------+
```

## Settings: Opt-In Tracker Automation

All automatic commit-tracker behaviors are gated behind settings. The user must explicitly enable them. This follows the existing `autoCommitEnabled` pattern (atom + debounced IPC + electron-store).

### Settings Schema

Add to the `ai-settings` electron-store:

```typescript
// In AISettingsSchema (or wherever ai-settings types live)
trackerAutomation?: {
  enabled: boolean;                    // Master toggle (default: false)
  autoLinkCommitsToSessions: boolean;  // Link commits to session's tracker items (default: true when enabled)
  parseIssueKeysFromCommits: boolean;  // Parse NIM-123 from all commit messages (default: true when enabled)
  autoCloseOnCommit: boolean;          // Fixes/Closes/Resolves changes status (default: true when enabled)
  agentAppendIssueKeys: boolean;       // Agent adds Resolves NIM-X to commit messages (default: true when enabled)
};
```

The sub-toggles only matter when `enabled` is true. This gives power users granular control while keeping the common case simple (one toggle to turn it all on).

### Project-Level Override

Add to `WorkspaceState.aiProviderOverrides` (or a new `WorkspaceState.trackerAutomation` field):

```typescript
// In WorkspaceState
trackerAutomationOverride?: {
  enabled?: boolean;         // true/false to force, undefined to inherit global
  autoCloseOnCommit?: boolean;
  // ... same sub-fields, all optional (undefined = inherit)
};
```

Merge logic follows the existing `aiSettingsMerge.ts` pattern:
- `undefined` in project settings = inherit from global
- Explicit `true`/`false` = override global

### Settings UI

**Global**: Add "Tracker Automation" section to AdvancedPanel.tsx:

```
Tracker Automation
  [ ] Enable automatic commit-tracker linking
      When enabled, commits are automatically linked to tracker
      items via session relationships and issue key parsing.

  (When enabled, show sub-toggles:)
  [x] Link commits to session's tracker items
  [x] Parse issue keys (NIM-123) from commit messages
  [x] Auto-close items on Fixes/Closes/Resolves keywords
  [x] Agent appends issue keys to commit messages
```

**Project-level**: Add override section to project settings panel:

```
Tracker Automation (Project Override)
  Inherit from global settings  [v]
  -- or --
  ( ) Enable for this project
  ( ) Disable for this project
```

### Atoms

Follow the `autoCommitAtoms.ts` pattern:

```typescript
// trackerAutomationAtoms.ts
export const trackerAutomationAtom = atom<TrackerAutomationSettings>({
  enabled: false,
  autoLinkCommitsToSessions: true,
  parseIssueKeysFromCommits: true,
  autoCloseOnCommit: true,
  agentAppendIssueKeys: true,
});

export const setTrackerAutomationAtom = atom(
  null,
  (_get, set, update: Partial<TrackerAutomationSettings>) => {
    set(trackerAutomationAtom, prev => ({ ...prev, ...update }));
    scheduleTrackerAutomationPersist(/* merged value */);
  }
);
```

### Main Process Access

The `CommitTrackerLinker` service reads settings before acting:

```typescript
// In CommitTrackerLinker.handleCommitDetected()
const settings = mergeTrackerAutomation(globalSettings, workspacePath);
if (!settings.enabled) return; // Bail early -- automation disabled

if (settings.autoLinkCommitsToSessions) { /* ... session linking ... */ }
if (settings.parseIssueKeysFromCommits) { /* ... issue key parsing ... */ }
if (settings.autoCloseOnCommit) { /* ... status change ... */ }
```

### Why Opt-In

- Tracker is a power-user feature; not everyone uses it
- Auto-closing bugs on commit is opinionated behavior
- Parsing commit messages for issue keys could produce false positives on repos with `FOO-123` style branch names
- Agent appending `Resolves NIM-X` to commit messages may not be wanted in all projects
- Per-project override lets users enable it for their main project but not for side repos

## Implementation Phases

### Phase 1: Settings + data model
- Add `trackerAutomation` to ai-settings store schema
- Add project-level override to workspace state
- Create `trackerAutomationAtoms.ts` (atom + setter + init)
- Add merge logic to `aiSettingsMerge.ts`
- Add "Tracker Automation" section to AdvancedPanel.tsx
- Add project override UI to project settings
- Update data model (`linkedCommits` array) with backwards compat for `linkedCommitSha`
- Update tracker sync payload (`trackerSyncTypes.ts`)

### Phase 2: Core linking service
- **Fix async listener gap in GitRefWatcher**: `CommitDetectedListener` is typed as returning `void`, but `CommitTrackerLinker.handleCommitDetected()` will be async (DB queries, settings reads). Currently `handleRefChange` calls `listener(commitEvent)` without awaiting or catching, so a rejected promise becomes an unhandled rejection. Fix: change listener type to `void | Promise<void>` and wrap calls with `Promise.resolve(listener(commitEvent)).catch(err => logger.main.error(...))` to isolate failures.
- Create `CommitTrackerLinker` service in `packages/electron/src/main/services/`
- Hook into `git:commit-detected` for issue key parsing (gated by settings)
- Hook into post-commit flow for session-based linking (gated by settings)
- Issue key regex parser with closing keyword detection
- Deduplication logic (same SHA not added twice)
- Auto-close on `Fixes`/`Closes`/`Resolves` keywords (gated by settings)
- Activity log entries for linking and status changes

### Phase 3: TrackerItemDetail commits display
- "Commits" section in TrackerItemDetail UI (below Sessions section)
- Short SHA, message, timestamp, session icon
- Copy-to-clipboard on SHA click
- Navigate to session on session icon click

### Phase 4: Commit widget UI enhancement
- "Linked Items" section in GitCommitConfirmationWidget
- Auto-populate from session's linked tracker items
- Typeahead search for manual item linking
- "Close on commit" per-item toggle
- Agent instruction update for auto-appending issue keys to commit messages (gated by settings)
