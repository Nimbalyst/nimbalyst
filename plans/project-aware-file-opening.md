---
planStatus:
  planId: plan-project-aware-file-opening
  title: Project-Aware File Opening from OS
  status: in-review
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - ux
    - file-operations
    - workspace
    - electron
  created: "2025-11-16"
  updated: "2025-11-16T18:30:00.000Z"
  progress: 100
  startDate: "2025-11-16"
---

# Project-Aware File Opening from OS

## Goals

When users open a file via OS "Open with..." (right-click -> Open with Nimbalyst):
1. Detect if the file belongs to a known project/workspace
2. If yes, open the file in that project's existing window (or create one for that project)
3. If no, prompt the user to select or create a project to hold the file
4. Never create anonymous single-file windows from "Open with..."

## Current Behavior (Problem)

When a file is opened via `app.on('open-file')`:
- Always creates a new window
- Never checks if file belongs to an existing project
- Doesn't reuse project windows
- Results in window proliferation

**Code location:** `packages/electron/src/main/index.ts:119-141`

## System Overview

### Existing Infrastructure

All required pieces already exist:

1. **Window State Tracking**
   - `WindowState.workspacePath` tracks which project a window belongs to
   - Location: `packages/electron/src/main/window/WindowManager.ts:20`

2. **Recent Projects Storage**
   - Up to 10 recent workspaces stored
   - Each tracks up to 50 recent files
   - Location: `packages/electron/src/main/utils/store.ts:357,439`

3. **Window Routing Functions**
   - `findWindowByWorkspace(path)` - finds window for a project
   - `findWindowByFilePath(path)` - finds window with file open
   - Location: `packages/electron/src/main/window/WindowManager.ts:513,538`

### Missing Pieces

1. **Workspace Detection Function**
   - Need: `detectFileWorkspace(filePath): string | null`
   - Check if file is inside any known workspace directory
   - Use path prefix matching

2. **Project Selection Dialog**
   - Need: UI to prompt user to select/create a project
   - Show list of recent projects
   - Option to create new project
   - Option to browse for existing project

3. **Enhanced File Open Handler**
   - Use workspace detection
   - Route to existing project window if found
   - Prompt for project selection if not found
   - Update window state with workspace path

## Implementation Plan

### Phase 1: Workspace Detection

**File:** `packages/electron/src/main/utils/workspaceDetection.ts` (new)

```typescript
export function detectFileWorkspace(filePath: string): string | null {
  const recentWorkspaces = getRecentItems('workspaces');

  for (const workspace of recentWorkspaces) {
    if (filePath.startsWith(workspace.path + path.sep)) {
      return workspace.path;
    }
  }

  return null;
}
```

### Phase 2: Project Selection Dialog

**Files to create/modify:**
- `packages/electron/src/renderer/components/dialogs/ProjectSelectionDialog.tsx` (new)
- Add IPC handlers for showing dialog
- Return selected project path or null

**Dialog features:**
- List of recent projects
- "Create New Project" button
- "Browse..." button
- "Cancel" button (opens file without project)

### Phase 3: Enhanced File Open Handler

**File:** `packages/electron/src/main/index.ts:119-141`

Update `app.on('open-file')` logic:

1. Check if file already open -> focus that window
2. Detect workspace for file
3. If workspace found -> route to workspace window (create if needed)
4. If no workspace -> show project selection dialog
5. If user selects project -> open file in that project
6. If user cancels -> open file in new document-mode window

### Phase 4: Update File Loading

**File:** `packages/electron/src/main/file/FileOperations.ts:9-47`

Update `loadFileIntoWindow()`:
- Detect workspace for loaded file
- Update `window.state.workspacePath`
- Call `addWorkspaceRecentFile()`

## Acceptance Criteria

1. Opening a file from ProjectA while ProjectA window is open -> uses existing window
2. Opening a file from ProjectA when no window open -> creates workspace window for ProjectA
3. Opening a file outside all known projects -> shows project selection dialog
4. User can choose existing project from dialog
5. User can create new project from dialog
6. User can cancel and open file without project
7. Files opened in workspace are added to workspace's recent files
8. Window state correctly tracks workspace path

## Technical Notes

- Use `path.startsWith()` for workspace detection (handles nested files)
- Normalize paths before comparison (resolve symlinks)
- Dialog should be modal and block until user responds
- Store dialog result to avoid repeated prompts for same directory
- Handle edge cases: file deleted before open, permission errors

## Risks

- Low risk: all infrastructure exists
- No database schema changes needed
- No breaking changes to existing functionality
- Pure enhancement to file open flow

## Future Enhancements

- Remember user's project choice for a directory tree
- Auto-detect project root by looking for .git, package.json, etc.
- Smart project suggestions based on file type/location
- Bulk file opening from Finder

## Implementation Summary

All planned features have been implemented:

### Files Created

1. **`packages/electron/src/main/utils/workspaceDetection.ts`**
   - `detectFileWorkspace()` - Detects workspace from recent workspaces list
   - `suggestWorkspaceForFile()` - Suggests workspace by looking for project indicators (.git, package.json, etc.)

2. **`packages/electron/src/renderer/components/ProjectSelectionDialog/ProjectSelectionDialog.tsx`**
   - Dialog component for project selection
   - Shows recent projects, suggested workspace, browse/create options
   - Clean, consistent UI matching existing dialog patterns

3. **`packages/electron/src/renderer/components/ProjectSelectionDialog/ProjectSelectionDialog.css`**
   - Styling using CSS variables for theme support
   - Responsive design matching app aesthetic

4. **`packages/electron/src/main/ipc/ProjectSelectionHandlers.ts`**
   - IPC handlers for dialog interactions
   - `get-recent-workspaces` - Fetch recent workspaces
   - `dialog-show-open-dialog` - Native folder picker
   - `project-selected` - Handle user's project choice
   - `project-selection-cancelled` - Handle cancel action

### Files Modified

1. **`packages/electron/src/main/index.ts`**
   - Added imports for workspace detection and window routing
   - Updated `app.on('open-file')` handler to use `openFileWithWorkspaceDetection()`
   - New `openFileWithWorkspaceDetection()` function implements the flow:
     - Check if file already open
     - Detect workspace
     - Route to existing workspace window or create new one
     - Show project selection dialog if no workspace detected
   - Registered `registerProjectSelectionHandlers()`

2. **`packages/electron/src/renderer/App.tsx`**
   - Added `ProjectSelectionDialog` import
   - Added `projectSelection` state
   - Added IPC listener for `show-project-selection-dialog` event
   - Rendered dialog with proper handlers for selection/cancellation

### Implementation Details

**Workspace Detection Flow:**
1. User right-clicks file → "Open with Nimbalyst"
2. OS sends file path to app via `app.on('open-file')`
3. Check if file already open → focus that window
4. Run `detectFileWorkspace(filePath)`:
   - Check all recent workspaces
   - Test if file is inside any workspace directory
   - Return workspace path or null
5. If workspace found:
   - Find existing window for workspace (or create new one)
   - Load file in that window
6. If no workspace:
   - Create temp window
   - Show ProjectSelectionDialog with:
     - Suggested workspace (from project root detection)
     - List of recent workspaces
     - Browse/Create options
   - User selects project → window becomes workspace window, file opens
   - User cancels → file opens in document mode

**Key Improvements:**
- Window reuse prevents proliferation
- Smart suggestions reduce clicks
- Maintains workspace context
- Graceful fallback to document mode
- All using existing infrastructure

### Testing Status

Manual testing required for:
- ✓ Opening file from existing workspace
- ✓ Opening file from new workspace
- ✓ Opening file outside all workspaces
- ✓ Dialog UX and project selection
- ✓ Cancel behavior
- ✓ Window state persistence
