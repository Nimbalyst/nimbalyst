---
planStatus:
  planId: plan-files-edited-sidebar-git-state-filter
  title: FilesEditedSidebar Git State Filter and Root Checkbox
  status: in-development
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - agent-mode
    - ux
    - file-sidebar
    - git
  created: "2026-01-30"
  updated: "2026-01-30T12:00:00.000Z"
  progress: 90
---

# FilesEditedSidebar Git State Filter and Root Checkbox

## Summary

This plan adds two features to the FilesEditedSidebar:

1. **Root checkbox in grouped mode** - A checkbox at the top that allows quickly selecting/deselecting all uncommitted files
2. **Unified dropdown for grouping and file scope** - Replace the current "Group" button with a dropdown that contains both grouping options and a new file scope filter

## Current State Analysis

### Current UI Structure

The FilesEditedSidebar header currently has:
- Title ("Files Edited in Session/Workstream/Worktree")
- Three icon buttons:
  - Group by directory toggle (folder icon)
  - Expand all (unfold_more)
  - Collapse all (unfold_less)

Below the header is an optional session filter dropdown (only shown when there are multiple sessions in a workstream).

### Existing File Scopes

Currently, the sidebar shows different files based on context:
- **Session mode**: Files from the current session
- **Workstream mode**: Files from all sessions in the workstream (deduplicated)
- **Worktree mode**: Files from the worktree plus worktreeChangedFiles from git

There's also an "Other Uncommitted Files" section that shows files with uncommitted changes that weren't edited by AI.

### Current Checkbox Behavior

- Checkboxes are always shown (`showCheckboxes={true}`)
- Individual file checkboxes toggle file selection
- Directory checkboxes toggle all uncommitted files in that directory
- `onSelectAll` callback exists but there's no root-level UI to trigger it

## Requirements

### Feature 1: Root Checkbox in Grouped Mode

When `groupByDirectory` is true, add a root-level checkbox that:
- Appears at the top of the file tree (before any directories)
- Shows indeterminate state when some but not all uncommitted files are selected
- Clicking selects/deselects all uncommitted files
- Uses the existing `onSelectAll` callback

### Feature 2: Unified Dropdown for Options

Replace the current icon buttons with a single dropdown that contains:

**Grouping Options:**
- [ ] Group by directory

**File Scope Options:**
- ( ) Current changes only - Files with uncommitted changes
- ( ) Session/workstream files - All files touched in this session/workstream
- ( ) All uncommitted - All uncommitted files in the repo

The dropdown should:
- Use a button that shows the current state (e.g., dropdown icon + indicator)
- Support both checkbox-style options (grouping) and radio-style options (scope)
- Persist the scope selection in workspace state

## Implementation Plan

### Phase 1: Add Root Checkbox to FileEditsSidebarComponent

**File: `packages/runtime/src/ui/AgentTranscript/components/FileEditsSidebar.tsx`**

1. Add new prop `showRootCheckbox?: boolean` (default: true when showCheckboxes is true)
2. Add root checkbox row at top of file list that:
   - Calculates tri-state from all uncommitted files (none/some/all selected)
   - Shows count of uncommitted files: "Select all (X uncommitted)"
   - Calls `onSelectAll(true/false)` when clicked
3. Works in both grouped and flat mode

### Phase 2: Add File Scope State

**File: `packages/electron/src/renderer/store/atoms/workstreamState.ts`**

Add new type and state:

```typescript
export type FileScopeMode = 'current-changes' | 'session-files' | 'all-uncommitted';

// Add to workstream state interface
fileScopeMode?: FileScopeMode;  // defaults to 'session-files'
```

Create derived atom for getting/setting scope per workstream.

### Phase 3: Create Unified Options Dropdown Component

**File: `packages/electron/src/renderer/components/AgentMode/FilesEditedOptionsDropdown.tsx`**

Create a new dropdown component that:
- Uses a button trigger (perhaps a filter/settings icon)
- Opens a popover/dropdown with three sections:
  - **Display**: Checkbox for "Group by directory"
  - **Show**: Radio group for scope (Current changes / Session files / All uncommitted)
  - **Session**: Radio group for session filter (only when multiple sessions exist)
- Each option change immediately updates state and closes dropdown

### Phase 4: Update FilesEditedSidebar Header

**File: `packages/electron/src/renderer/components/AgentMode/FilesEditedSidebar.tsx`**

1. Replace the current Group button with the new FilesEditedOptionsDropdown
2. Keep expand/collapse buttons as-is
3. Remove the separate session filter dropdown (now in unified dropdown)
4. Update title to just "Files Edited" (scope/session shown in dropdown state)

### Phase 5: Implement File Scope Filtering Logic

**File: `packages/electron/src/renderer/components/AgentMode/FilesEditedSidebar.tsx`**

Update the `fileEdits` memo to filter based on scope:

```typescript
const filteredFileEdits = useMemo(() => {
  switch (fileScopeMode) {
    case 'current-changes':
      // Filter to files that have uncommitted git changes
      return fileEdits.filter(f => !isFileCommitted(f.filePath));

    case 'session-files':
      // Current behavior - all files from session(s)
      return fileEdits;

    case 'all-uncommitted':
      // Merge session files with all uncommitted files from repo
      // Include otherUncommittedFiles as FileEditSummary items
      return [...fileEdits, ...otherUncommittedAsEdits];
  }
}, [fileEdits, fileScopeMode, gitStatus, otherUncommittedFiles]);
```

### Phase 6: State Persistence

Update workspace state persistence to save/restore:
- `fileScopeMode` per workstream
- Existing `groupByDirectory` (already persisted)

## Detailed Component Changes

### FileEditsSidebar.tsx (runtime) - Root Checkbox

```typescript
// New code at top of file list
{showCheckboxes && (
  <div className="file-edits-sidebar__root-checkbox flex items-center gap-2 px-2 py-1 border-b border-[var(--nim-border)]">
    <div
      onClick={() => onSelectAll?.(rootSelectionState !== 'all')}
      className={`w-4 h-4 rounded-[3px] border-[1.5px] cursor-pointer flex items-center justify-center ${
        rootSelectionState === 'all' ? 'bg-[var(--nim-file-edited)] border-[var(--nim-file-edited)]' :
        rootSelectionState === 'some' ? 'bg-[var(--nim-file-edited)] border-[var(--nim-file-edited)] opacity-60' :
        'border-[var(--nim-text-faint)] bg-transparent hover:border-[var(--nim-text-muted)]'
      }`}
    >
      {/* Check or dash icon based on state */}
    </div>
    <span className="text-sm text-[var(--nim-text-muted)]">
      Select all ({uncommittedCount} uncommitted)
    </span>
  </div>
)}
```

### FilesEditedOptionsDropdown.tsx - New Component

```typescript
interface FilesEditedOptionsDropdownProps {
  groupByDirectory: boolean;
  onGroupByDirectoryChange: (value: boolean) => void;
  fileScopeMode: FileScopeMode;
  onFileScopeModeChange: (mode: FileScopeMode) => void;
  // Session filter props (optional, only when multiple sessions)
  sessions?: Array<{ id: string; title: string }>;
  filterSessionId: string | null;
  onFilterSessionIdChange: (sessionId: string | null) => void;
}
```

## UI Mockup Structure

### Header with Unified Dropdown

```
+----------------------------------------------------------+
| [icon] Files Edited        [dropdown v] [+] [-]          |
+----------------------------------------------------------+
```

The dropdown contains:
- Display section (checkbox for grouping)
- Show section (radio for scope)
- Session section (radio for session filter, only when multiple sessions)

### Dropdown Content (Expanded)

```
+----------------------------------------------+
| Display                                      |
| [x] Group by directory                       |
+----------------------------------------------+
| Show                                         |
| (o) Current changes                          |
| ( ) Session files                            |
| ( ) All uncommitted                          |
+----------------------------------------------+
| Session  (only if multiple sessions)         |
| (o) All sessions                             |
| ( ) Session: "Add login feature"             |
| ( ) Session: "Fix auth bug"                  |
+----------------------------------------------+
```

### File Tree with Root Checkbox (Grouped Mode)

```
+----------------------------------------------------------+
| [x] Select all (5 uncommitted files)     <- root row     |
+----------------------------------------------------------+
| v [x] src/components (3 files)                           |
|     [x] NewFile.tsx                                      |
|     [x] EditedFile.tsx                                   |
|     [ ] AnotherFile.tsx (committed - no checkbox)        |
| v [x] src/services (2 files)                             |
|     [x] ApiService.ts                                    |
|     [x] AuthService.ts                                   |
+----------------------------------------------------------+
```

### File Tree with Root Checkbox (Flat Mode)

```
+----------------------------------------------------------+
| [x] Select all (5 uncommitted files)     <- root row     |
+----------------------------------------------------------+
| [x] NewFile.tsx                                          |
| [x] EditedFile.tsx                                       |
| [ ] AnotherFile.tsx (committed - no checkbox)            |
| [x] ApiService.ts                                        |
| [x] AuthService.ts                                       |
+----------------------------------------------------------+
```

## Design Decisions

1. **Scope terminology**: Use "Current changes" / "Session files" / "All uncommitted" - descriptive names based on what's being shown.

2. **Expand/collapse controls**: Keep as separate icon buttons for faster access to frequently used actions.

3. **Session filter integration**: Add session options into the unified dropdown. When in workstream mode with multiple sessions, the dropdown will have a "Session" section with radio options for "All sessions" and individual session names.

## Files to Modify

1. `packages/runtime/src/ui/AgentTranscript/components/FileEditsSidebar.tsx`
   - Add root checkbox rendering when in grouped mode
   - Accept new props for scope mode

2. `packages/electron/src/renderer/components/AgentMode/FilesEditedSidebar.tsx`
   - Replace header controls with unified dropdown
   - Add scope state management
   - Update file fetching based on scope

3. `packages/electron/src/renderer/store/atoms/workstreamState.ts`
   - Add file scope mode to workstream state

4. `packages/electron/src/renderer/store/atoms/projectState.ts`
   - May need updates for project-level default scope

## Testing Considerations

- Test root checkbox in various states (none/some/all selected)
- Test scope switching with files in different states
- Test persistence of settings across sessions
- Test worktree mode vs regular session mode
- Test dropdown interactions and state updates
- Test session filter within unified dropdown

## Implementation Checklist

- [x] Add root checkbox to FileEditsSidebar.tsx (runtime)
- [x] Add FileScopeMode type and atoms to workstreamState.ts
- [x] Create FilesEditedOptionsDropdown.tsx component
- [x] Update FilesEditedSidebar.tsx header to use new dropdown
- [x] Implement file scope filtering logic
- [x] Move session filter into unified dropdown
- [x] Persist scope mode in workspace state (via workstreamState atoms)
- [ ] Test all combinations of scope/session/grouping
