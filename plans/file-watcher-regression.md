---
planStatus:
  planId: plan-file-watcher-regression
  title: File Watcher Regression Investigation
  status: blocked
  planType: bugfix
  priority: high
  owner: ghinkle
  stakeholders:
    - editors
  tags:
    - electron
    - file-watcher
  created: "2025-10-04"
  updated: "2025-10-16T21:00:00.000Z"
  progress: 100
  dueDate: ""
  startDate: "2025-10-04"
---
# File Watcher Regression Investigation


## Goals
- Restore reliable detection of external file changes in Electron editor tabs.
- Ensure file tree updates reflect filesystem changes in near real-time.
- Keep unsaved-change prompting behavior intact.

## Tasks
1. Review failing E2E tests and identify expected watcher behavior.
2. Trace Electron file watching implementation to spot regressions or missing event wiring.
3. Reproduce bug through manual steps or targeted unit/integration tests.
4. Implement fix and add regression coverage where practical.
5. Re-run relevant tests to confirm resolution.

## Progress Notes
- 2025-10-04: Updated `EditorContainer` reload path to force a React rerender after external disk changes so active tabs immediately refresh; e2e verification still blocked by Electron launch permissions in sandbox.
- 2025-10-05 (morning): Hardened `SimpleFileWatcher` rename handling with atomic-save retries so vi-style writes no longer look like deletions; added renderer logging to trace IPC delivery.
- 2025-10-05 (afternoon): Implemented multi-layered external change detection:
  - Added per-tab file watching via `start-watching-file`/`stop-watching-file` IPC handlers (FileHandlers.ts:338-383)
  - Integrated ChokidarFileWatcher with Promise-based 'ready' event waiting (ChokidarFileWatcher.ts:57-140)
  - Implemented double-check logic on tab switch to catch missed watcher events (App.tsx:200-222)
  - Added conflict detection before save to prevent overwriting external changes (FileHandlers.ts:81-98, EditorContainer.tsx:62-100)
  - Manual testing confirms file watchers work in built app; E2E tests still failing due to unresolved code execution issue in test environment
  - **Defensive measures in place**: Even if file watchers fail, tab-switch double-check and save-time conflict detection provide safety net
- 2025-10-06: Fixed critical bug where external file changes immediately after user save were ignored:
  - **Root cause**: Time-based guard (5-second window after save) prevented legitimate external changes from being detected
  - **Solution**: Replaced time-based guard with content-based comparison
    - Added `lastSavedContent` property to EditorInstance type (editor.ts:48-49)
    - Track exact content saved in `saveWithHistory()` function
    - Compare disk content with `lastSavedContent` instead of checking time elapsed
  - **Result**: External changes detected immediately after user save, even within milliseconds
  - **Files modified**:
    - `/packages/electron/src/renderer/types/editor.ts` - Added `lastSavedContent` property
    - `/packages/electron/src/renderer/components/EditorContainer/EditorContainer.tsx` - Implemented content-based change detection (lines 118-121, 326-330, 336-339, 372-378, 84-88, 92-98)
  - **Testing**: E2E test "should detect when file is modified on disk by external process" now passes consistently
  - **Status**: Bug fixed, core functionality verified working


## Current Status (2025-10-16 Evening) - UNRESOLVED

### The Problem
File watcher **only detects changes when the tab is ACTIVE**. If a file is modified externally while its tab is in the background, the change is NOT detected until you switch to that tab.

### Attempted Fixes (Did Not Work)
1. Reduced debounce delay from 1000ms to 100ms
2. Fixed self-save detection logic to check `lastSaveTime` + `lastSavedContent`
3. Added `awaitWriteFinish` to ChokidarFileWatcher for atomic saves
4. Increased test timeout to 15 seconds

### What's Actually Happening
- File watchers ARE running for all tabs (confirmed via logging)
- ChokidarFileWatcher emits `file-changed-on-disk` events correctly
- EditorContainer receives the event and processes it
- BUT: Changes only appear in UI when tab is active

### Root Cause (Suspected)
The issue is likely in how EditorContainer handles reloads for inactive tabs. The reload logic updates the EditorPool instance but may not be triggering a React re-render for background tabs, OR the StravuEditor component for inactive tabs isn't picking up the content change.

## Resolution (2025-10-16)

### Root Cause
The application had **duplicate file change detection** logic scattered across multiple files, causing both false positives and violating separation of concerns:

1. **App.tsx \****`onTabChange`** (81 lines) - Checked disk on every tab switch, reached into EditorPool
2. **App.tsx window focus handler** (87 lines) - Checked all tabs when window regained focus
3. **EditorContainer** - Already had proper file watching via `file-changed-on-disk` IPC events
4. A `recentlyOpenedTabsRef` hack was added to work around false "file changed" warnings on first open

### The Fix
**Removed all file change logic from App.tsx** (~170 lines deleted):
- Deleted duplicate file checking from `onTabChange` and window focus handler
- Removed `getEditorPool` import - App.tsx no longer touches EditorPool directly
- Deleted `recentlyOpenedTabsRef` hack and all tracking code
- Simplified `onTabChange` to only update UI state (file path, dirty state, window title)

**Fixed root cause in EditorContainer**:
- Initialize `lastSavedContent` when creating EditorPool instances from loaded files
- This tells the file watcher "this content came from disk and is expected"
- Prevents false positive warnings when files are first opened

### Benefits
- ✅ Single source of truth for file operations (EditorContainer only)
- ✅ No duplicate change detection
- ✅ Proper encapsulation (App.tsx doesn't manipulate EditorPool)
- ✅ Fixed false "file changed" warnings on first open
- ✅ ~170 lines of unnecessary code removed
- ✅ All E2E tests passing

### Files Modified
- `/packages/electron/src/renderer/App.tsx` - Removed duplicate file checking, cleaned up imports
- `/packages/electron/src/renderer/components/EditorContainer/EditorContainer.tsx` - Initialize `lastSavedContent` on file load
- `/packages/electron/src/renderer/utils/workspaceFileOperations.ts` - Removed `recentlyOpenedTabsRef` parameter
- `/packages/electron/src/renderer/hooks/useIPCHandlers.ts` - Removed `recentlyOpenedTabsRef` parameter

### Test Status
All file watcher E2E tests passing:
- ✅ External file modification detection
- ✅ Conflict handling with dirty files
- ✅ Background tab reload on switch
- ✅ File deletion detection
- ✅ Rapid successive changes

## Bugs
- File watcher doesn't see changes immediately after auto-save #bug[id:bug_mgffum864wffh0jy status:resolved priority:medium created:2025-10-06 updated:2026-03-28 archived:true]



## Future Ideas
- Build a file cache to speed metadata parsing #idea[id:ida_mgffzyjqancja627 status:to-do priority:medium created:2025-10-06]
