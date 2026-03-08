---
planStatus:
  planId: plan-workspace-local-history-dialog
  title: Workspace Local History Dialog
  status: in-review
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - history
    - file-recovery
    - ui
  created: "2025-12-09"
  updated: "2025-12-09T21:30:00.000Z"
  progress: 100
  startDate: "2025-12-09"
---
# Workspace Local History Dialog

## Implementation Progress

- [x] Add `listWorkspaceFiles` method to HistoryManager
- [x] Add `history:list-workspace-files` IPC handler
- [x] Add `history:check-files-exist` IPC handler
- [x] Add `history:restore-deleted-file` IPC handler
- [x] Add `history:batch-restore-deleted-files` IPC handler
- [x] Create WorkspaceHistoryDialog component
- [x] Create WorkspaceHistoryFileTree component
- [x] Add multi-select support for deleted files
- [x] Implement batch restore functionality
- [x] Add context menu entry for folders
- [x] Add global menu entry (Edit > View Folder History, Cmd+Shift+H)
- [x] Style deleted files (grayed out with "(deleted)" label)
- [x] Keyboard navigation (Escape to close)

## Visual Mockup

[![workspace-local-history-dialog.mockup.png](./assets/workspace-local-history-dialog.mockup.png)](workspace-local-history-dialog.mockup.html)


[nibalyst](https://nimbalyst.com)

[screenshotUtils.ts](./packages/electron/src/renderer/components/CustomEditors/MockupEditor/screenshotUtils.ts) 

[AGENTS.md](./AGENTS.md) 

## Goals

1. Allow users to browse all files (including deleted ones) that have local history in a workspace
2. Enable recovery of deleted files from any point in their local history
3. Provide a familiar file-tree-based navigation experience
4. Integrate with the existing single-file history dialog for viewing file snapshots

## System Overview

### Current State

The existing `HistoryDialog` component (`packages/electron/src/renderer/components/HistoryDialog/HistoryDialog.tsx`) provides:
- Single-file history viewing with snapshot list on left, diff preview on right
- Snapshot types: auto-save, manual, ai-diff, pre-apply, external-change, incremental-approval
- Diff viewing between versions (rich markdown diff and text diff modes)
- Restore functionality to bring back a previous version

The `HistoryManager` service (`packages/electron/src/main/HistoryManager.ts`):
- Stores snapshots in PGLite database with `workspace_id` and `file_path` columns
- Has existing `deleteWorkspaceHistory(workspacePath)` method
- Database has index on `(workspace_id, file_path)` for efficient workspace queries

### Proposed Architecture

A new `WorkspaceHistoryDialog` component that:
1. Queries all unique file paths with history in the workspace
2. Cross-references with current filesystem to identify deleted files
3. Displays a file tree with deleted files shown in a distinct "deleted" style (grayed out)
4. Shows the existing single-file history view when a file is selected

## Implementation Details

### 1. Backend Changes - HistoryManager

Add new methods to `HistoryManager`:

```typescript
// List all files with history in a workspace
async listWorkspaceFiles(workspacePath: string): Promise<{
  path: string;
  latestTimestamp: number;
  snapshotCount: number;
}[]>

// Query to use:
// SELECT file_path, MAX(timestamp) as latest, COUNT(*) as count
// FROM document_history
// WHERE workspace_id = $1
// GROUP BY file_path
// ORDER BY latest DESC
```

### 2. IPC Handlers

Add new IPC channel in `HistoryHandlers.ts`:
- `history:list-workspace-files` - Returns all files with history for a workspace

### 3. New Component: WorkspaceHistoryDialog

**Location:** `packages/electron/src/renderer/components/WorkspaceHistoryDialog/`

**Files:**
- `WorkspaceHistoryDialog.tsx` - Main dialog component
- `WorkspaceHistoryDialog.css` - Styles
- `WorkspaceHistoryFileTree.tsx` - File tree subcomponent

**Layout:**
```
+------------------------------------------+
| Workspace History            [X] Close   |
+------------------------------------------+
|  File Tree    |  File History View       |
|  (left panel) |  (right panel)           |
| ------------- | ------------------------ |
| > src/        |  [Reuse existing         |
|   file1.md    |   HistoryDialog content  |
|   [deleted]   |   for selected file]     |
|   file2.md    |                          |
| > docs/       |                          |
|   [deleted]   |                          |
|   readme.md   |                          |
+------------------------------------------+
```

**File Tree Features:**
- Build tree structure from flat file paths
- Mark files as "deleted" if they don't exist on disk currently
- Deleted files: grayed out text, strikethrough or ghost icon
- Clicking a file loads its history in the right panel
- Expand/collapse directories

### 4. Deleted File Detection

When the dialog opens:
1. Query all file paths with history from HistoryManager
2. For each file path, check if file exists using `fs.access()`
3. Mark non-existent files as "deleted" in the UI state
4. This check happens in the main process (via IPC) for security

New IPC channel:
- `history:check-files-exist` - Takes array of paths, returns map of path -> exists boolean

### 5. Restoring Deleted Files

When restoring a version of a deleted file:
1. Show confirmation: "This file has been deleted. Restore will recreate the file."
2. Get the snapshot content from HistoryManager
3. Write content to the original file path (recreating the file)
4. Refresh the file tree in the workspace sidebar
5. Optionally open the restored file in the editor

New IPC channel:
- `history:restore-deleted-file` - Takes filePath and timestamp, restores file to disk

### 6. Entry Points

**Context Menu on File Tree:**
- Add "View Workspace History..." to folder context menu
- Add "View Workspace History..." to root workspace context menu

**Global Menu:**
- File > View Workspace History... (Cmd+Shift+H or similar)
- Only enabled when a workspace is open

### 7. Styling for Deleted Files

CSS classes to add:
```css
.workspace-history-file.deleted {
  opacity: 0.5;
  color: var(--text-tertiary);
}

.workspace-history-file.deleted .file-icon {
  filter: grayscale(100%);
}

.workspace-history-file.deleted::after {
  content: ' (deleted)';
  font-style: italic;
  font-size: 0.9em;
}
```

## UI Flow

1. User right-clicks on a folder or opens from menu
2. Dialog opens showing file tree on left (initially collapsed or showing files at root)
3. User expands directories to navigate
4. Deleted files appear grayed out with "(deleted)" indicator
5. User clicks any file to see its history in right panel
6. Right panel shows snapshots list and preview (like existing HistoryDialog)
7. User can restore any version - for deleted files this recreates the file

## Acceptance Criteria

- [ ] Can access workspace history from folder context menu
- [ ] Can access workspace history from global menu
- [ ] Dialog shows all files with history in the workspace
- [ ] Deleted files are visually distinct (grayed out)
- [ ] Clicking a file shows its history snapshots
- [ ] Can view diffs between versions for any file
- [ ] Can restore any version of any file (including deleted)
- [ ] Restoring a deleted file recreates it on disk
- [ ] Dialog handles large workspaces with many files efficiently
- [ ] Keyboard navigation works (Escape to close, arrow keys for tree)

## Technical Considerations

### Performance
- Lazy load file existence checks (check visible files first)
- Cache existence checks for the dialog session
- Paginate snapshot lists for files with many snapshots

### Error Handling
- Handle case where file path is in a directory that no longer exists
- Handle permission errors when recreating files
- Handle case where snapshot content is corrupted

### Edge Cases
- File renamed (shows as old path deleted, new path exists)
- File moved (same as rename)
- Very long file paths
- Unicode file names
- Files outside the workspace (shouldn't appear but handle gracefully)
