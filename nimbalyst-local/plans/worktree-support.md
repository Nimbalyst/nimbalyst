---
planStatus:
  planId: plan-worktree-support
  title: Git Worktree Support for Agent Sessions
  status: draft
  planType: feature
  priority: high
  owner: jordan
  stakeholders:
    - jordan
  tags:
    - git
    - worktrees
    - agent-sessions
    - version-control
  created: "2025-12-11"
  updated: "2025-12-11T00:00:00.000Z"
  progress: 0
---
# Git Worktree Support for Agent Sessions

## Human Specified Requirements

<!-- AI: Do not modify this section unless explicitly directed by the user -->

1. Git worktree support will be added to the agent view
2. Group multiple agent sessions under a single worktree
3. Display git status indicators showing uncommitted changes or commits ahead of main
4. Provide a dedicated diff view for reviewing changes
5. Enable commit and merge operations from within the app
6. Worktree status and merging should be done relative to the branch of the project repo root
7. Default worktree directory should be `../<project_name>_worktrees/` relative to the project root
8. New Worktree button creates worktree with random folder name; worktree gets named after first session's name when first prompt is sent
9. No session tabs in agent mode; all session navigation happens via the left sidebar

## Overview

Add git worktree integration to Nimbalyst's agent view, allowing users to organize agent sessions by worktree, view git status, review diffs, and commit/merge changes directly from the interface.

## Visual Design

### Layout Overview
- **Mode toggle header bar**: Horizontal toggle with Agent | Files buttons (centered in header)
- **Left sidebar**: Sessions list showing worktree groups and standalone sessions (primary session navigation)
- **Center area**: Editor content (shows diff when Changes tab is active in right panel)
- **Right panel**: Tabbed panel with Chat | Files | Changes tabs
- **No session tabs**: Session navigation is entirely handled by the left sidebar; no tabs for switching sessions

### Dual-Mode UI (Agent and Files)

#### Agent Mode
![Agent mode with sessions sidebar and chat](screenshot.png){mockup:nimbalyst-local/mockups/worktrees-mockups/agent-mode.mockup.html}

- Mode toggle: Agent (active) | Files
- Left sidebar: Agent Sessions list with worktree groups (sole method for session navigation)
- Center area: Full-width chat conversation for selected session
- Right panel: Files panel showing edited/read files from session
- No session tabs in agent mode; all session switching happens via left sidebar

#### Files Mode
![Files mode with file tree panel](screenshot.png){mockup:nimbalyst-local/mockups/worktrees-mockups/file-mode.mockup.html}

- Mode toggle: Agent | Files (active)
- Left sidebar: Same Agent Sessions list
- Center area: File tabs + editor content
- Right panel tabs: Chat (active) | Files - shows chat conversation for active session

#### Files Mode with Tree Panel
![Files mode showing file tree in right panel](screenshot.png){mockup:nimbalyst-local/mockups/worktrees-mockups/file-mode-tree-panel.mockup.html}

- Right panel tabs: Chat | Files (active)
- Shows worktree file tree with git status badges (M for modified, A for added)
- Filter dropdown with options: All Files, Markdown Only, Known Files, Uncommitted Changes, Worktree Changes

### Changes Tab (Diff View in Right Panel)
![Changes tab showing diff view](screenshot.png){mockup:nimbalyst-local/mockups/worktrees-mockups/diff-alt1-three-tabs.mockup.html}

- Mode toggle: Agent | Files (active)
- Center area: Diff file tabs showing changed files with M/A badges, unified diff view below
- Right panel tabs: Chat | Files | Changes (active)
- Changes panel shows:
  - Changed files header with count (e.g., "9 files")
  - Hierarchical file tree with checkboxes for staging
  - Folders show path prefix (e.g., "renderer packages/electron/src/")
  - Commit message textarea
  - Commit and Merge buttons
  - Commits history section showing previous commits

### Session Sidebar Components

#### New Worktree Button
- Button in sidebar header (next to + button for new session)
- Creates new worktree with random folder name (e.g., "wt-abc123")
- Creates first session in the worktree automatically
- Worktree name updates to match session name after first prompt is sent

#### Multi-Session Worktree Group
- Expandable group with chevron, worktree icon, name, and git status badge
- Shows nested sessions when expanded
- Git status badge colors: modified (orange), ahead (blue), merged (green)
- Hover actions: View Diff button, Browse Files button

#### Single-Session Worktree (Alt 3 Design)
- Uses AI icon with small worktree badge overlay in corner
- Shows session title on first line
- Shows worktree name and git status badge on second line (meta row)
- More compact than multi-session groups

#### Standalone Sessions Section
- Divider with "Sessions" label
- Regular session items without worktree association

## Implementation Plan

### Phase 1: Data Model and Backend

#### 1.1 Worktree Data Model
- Create `Worktree` interface with properties:
  - `id: string` - Unique identifier
  - `name: string` - User-friendly name
  - `path: string` - File system path to worktree
  - `branch: string` - Git branch name
  - `baseBranch: string` - Branch to compare against (usually main)
  - `createdAt: number` - Timestamp
  - `sessionIds: string[]` - Associated agent session IDs

#### 1.2 Database Schema
- Add `worktrees` table to PGLite database
- Add `worktree_id` foreign key to `ai_sessions` table
- Create migration for existing sessions (null worktree_id)

#### 1.3 Git Service (Main Process)
- Create `GitWorktreeService` in main process
- Implement methods:
  - `createWorktree(name: string, branch: string): Promise<Worktree>`
  - `deleteWorktree(id: string): Promise<void>`
  - `getWorktreeStatus(id: string): Promise<GitStatus>`
  - `getWorktreeDiff(id: string): Promise<DiffResult>`
  - `getWorktreeCommits(id: string): Promise<Commit[]>`
  - `commitChanges(id: string, message: string): Promise<Commit>`
  - `mergeToMain(id: string): Promise<MergeResult>`

#### 1.4 IPC Handlers
- Add IPC channels for worktree operations:
  - `worktree:create`
  - `worktree:delete`
  - `worktree:get-status`
  - `worktree:get-diff`
  - `worktree:get-commits`
  - `worktree:commit`
  - `worktree:merge`

### Phase 2: Session Sidebar UI

#### 2.1 New Worktree Button
- Add "New Worktree" button in sidebar header (worktree icon with +)
- On click:
  - Generate random folder name (e.g., "wt-abc123")
  - Create git worktree in default directory
  - Create new session associated with worktree
  - Open the new session
- On first prompt sent:
  - Session gets auto-named (existing behavior)
  - Update worktree name to match session name
  - Rename worktree folder to match (sanitized)

#### 2.2 Worktree Group Component (Multi-Session)
- Create `WorktreeGroup.tsx` component for worktrees with 2+ sessions
- Display worktree header with:
  - Worktree name
  - Git status badge
  - Expand/collapse chevron
  - Worktree icon (git branch icon)
- Hover state shows action buttons (View Diff, Browse Files)
- Render nested session items when expanded (indented)

#### 2.2 Single-Session Worktree Component
- Create `WorktreeSingle.tsx` component for worktrees with 1 session
- Compact display using AI icon with worktree badge overlay:
  - AI icon with small worktree badge in bottom-right corner
  - Session title on first line
  - Meta row showing worktree name (blue) + git status badge
  - Message count badge on right

#### 2.3 Git Status Badge Component
- Create GitStatusBadge.tsx component
- Badge styles: modified (orange), ahead (blue), merged (green)

#### 2.4 Session List Updates
- Group sessions by worktree_id
- Render multi-session worktrees as expandable groups
- Render single-session worktrees as compact items with badge overlay
- Standalone sessions section below divider with "Sessions" label
- Update drag-and-drop to allow moving sessions into worktrees

### Phase 3: Changes Tab (Diff View)

#### 3.1 Changes Tab in Right Panel
- Add "Changes" tab to right panel: Chat | Files | Changes
- When Changes tab is selected, center area shows diff view
- Title bar shows "Diff View - worktree-name - Nimbalyst"
- Selected worktree in sidebar gets visual highlight (selected state)

#### 3.2 Center Area: Diff File Tabs
- File tabs showing changed files from worktree
- Each tab shows: file icon, filename, git status badge (M/A)
- Tab close button on right
- Clicking tab loads diff for that file

#### 3.3 Center Area: Diff Content
- Unified diff view with hunk headers, line numbers, diff content
- Green background for additions, red for deletions

#### 3.4 Right Panel: Changes Tab
- Add "Changes" tab to right panel: Chat | Files | Changes
- Changed Files Header with file count badge
- Hierarchical File Tree with checkboxes for staging files
- Commit Section with message textarea, Commit and Merge buttons
- Commits History showing previous commits with timestamps

#### 3.5 Inline Commit Flow
- Enter commit message in textarea
- Check/uncheck files in tree to stage
- Click Commit to create commit
- Commits list updates immediately

#### 3.6 Merge Confirmation Dialog
- Modal before merging to main
- Shows source and target branch names
- Warning if uncommitted changes exist

### Phase 4: Git Operations

#### 4.1 Real-time Status Updates
- Poll git status periodically (every 30s)
- Update badges when files change
- Use file watcher for immediate updates on save

#### 4.2 Commit Flow
- Stage all changes (or selected files)
- Create commit with message
- Update commit list in diff view
- Update git status badge

#### 4.3 Merge Flow
- Check for uncommitted changes (warn if present)
- Perform merge to main branch
- Handle merge conflicts (show conflict resolution UI)
- Update git status badge to "merged"

### Phase 5: Polish and Edge Cases

#### 5.1 Error Handling
- Handle git command failures gracefully
- Show user-friendly error messages
- Provide retry options

#### 5.2 Loading States
- Show loading indicators during git operations
- Skeleton UI for diff view while loading

#### 5.3 Empty States
- No changed files message
- No commits message
- First worktree onboarding

#### 5.4 Keyboard Shortcuts
- `Cmd+K Cmd+D` - Open diff for current worktree
- `Cmd+Enter` - Commit (when in diff view)
- `[` / `]` - Navigate between changes

## File Structure

```
packages/electron/src/
  main/
    services/
      GitWorktreeService.ts      # Git operations
    handlers/
      WorktreeHandlers.ts        # IPC handlers
    database/
      migrations/
        005_worktrees.sql        # Database migration
  renderer/
    components/
      AgenticCoding/
        WorktreeGroup.tsx        # Multi-session worktree group
        WorktreeGroup.css
        WorktreeSingle.tsx       # Single-session worktree (badge overlay)
        WorktreeSingle.css
        GitStatusBadge.tsx       # Status badge component
      DiffMode/
        DiffModeView.tsx         # Main diff mode container
        DiffModeView.css
        DiffFileTabs.tsx         # Changed file tabs
        DiffContent.tsx          # Unified diff display
        ChangesPanel.tsx         # Right panel Changes tab
        ChangedFilesTree.tsx     # File tree with checkboxes
        CommitSection.tsx        # Message and buttons
        CommitsHistory.tsx       # List of commits
        MergeConfirmDialog.tsx   # Merge confirmation modal
    hooks/
      useWorktree.ts             # Worktree state hook
      useGitStatus.ts            # Git status polling hook
      useDiffMode.ts             # Diff mode state
    services/
      RendererWorktreeService.ts # IPC wrapper for renderer
```

## Dependencies

- `simple-git` - Git operations in Node.js (already available)
- No new dependencies required

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Git operations blocking UI | Run git commands in worker thread |
| Large diffs slow to render | Virtual scrolling for diff lines |
| Merge conflicts complex to handle | Start with "abort on conflict" option |
| Multiple worktrees = disk space | Warn user about disk usage |

## Success Criteria

- Sessions are grouped by worktree in the sidebar
- Git status is visible at a glance (modified/ahead/merged)
- Diff view shows all changes with syntax highlighting
- Commit and merge operations complete successfully
- No data loss when merging or deleting worktrees

## Out of Scope (Future)

- Converting existing agent sessions into a worktree
- Conflict resolution UI (Phase 2)
- Cherry-pick commits between worktrees
- Stash support
- Remote push/pull operations
- Branch comparison beyond main
