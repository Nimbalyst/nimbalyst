---
planStatus:
  planId: plan-file-watcher-regression
  title: File Watcher Regression Investigation
  status: in-development
  planType: bugfix
  priority: high
  owner: ghinkle
  stakeholders:
    - editors
  tags:
    - electron
    - file-watcher
  created: "2025-10-04"
  updated: "2025-10-06T06:00:33.124Z"
  progress: 80
  dueDate: ""
  startDate: "2025-10-04"
---
# File Watcher Regression Investigation
<!-- plan-status -->

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


## Bugs
- File watcher doesn't see changes immediately after auto-save @bug[id:bug_mgffum864wffh0jy status:to-do priority:medium created:2025-10-06]



## Future Ideas
- Build a file cache to speed metadata parsing @idea[id:ida_mgffzyjqancja627 status:to-do priority:medium created:2025-10-06]
