---
planStatus:
  planId: plan-welcome-tab
  title: Workspace Welcome Tab
  status: completed
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders:
    - agents
  tags:
    - onboarding
    - editor
  created: "2025-09-24"
  updated: "2025-09-30T05:45:00.000Z"
  progress: 100
  dueDate: ""
  startDate: "2025-09-30"
---
# Workspace Welcome Tab


- Add intro to welcome.md explaining how to add PLANS instructions via .nimbalyst.md #task[id:tsk_mgl00yiyppmezd3j status:to-do priority:medium created:2025-10-10]
- Recommend changes to .gitignore #task[id:tsk_mgl01h4u886ef5ed status:to-do priority:medium created:2025-10-10]

## Overview
- Show a bundled markdown "Welcome" document when opening a workspace with no files/tabs selected.
- Load welcome content from packaged assets and display it in an editable tab with a warning that edits are not persisted.
- Ensure autosave, dirty state, and file watchers ignore this virtual document and resume normal behavior once a real file opens.
- Explore providing a future-ready location for bundled user documentation without impacting workspace storage.

## Implementation Files

### Electron Package
- `packages/electron/assets/welcome.md` - New welcome document content with basic Preditor usage guide
- `packages/electron/src/main/services/DocumentService.ts` - Add virtual document support and welcome doc loading
- `packages/electron/src/renderer/components/Editor/EditorTab.tsx` - Add virtual document UI state and warning banner

### Runtime Package
- `packages/runtime/src/components/VirtualDocumentBanner.tsx` - New component for non-persistent document warning
- `packages/runtime/src/constants/virtualDocs.ts` - Constants and types for virtual documents
- `packages/runtime/src/documents/VirtualDocumentHandler.ts` - Handler for virtual document state management
- `packages/runtime/src/documents/virtualDocTypes.ts` - Type definitions for virtual documents
- `packages/runtime/src/documents/VirtualDocumentHandler.ts` - Handler for virtual document state management
- `packages/runtime/src/documents/virtualDocTypes.ts` - Type definitions for virtual documents

## Key Implementation Points
- Add isVirtual flag to document state tracking
- Modify autosave to skip virtual documents
- Add file watcher exclusions for virtual paths
- Create distinct tab styling for virtual documents
- Implement warning banner for non-persistent state
- Design asset bundling strategy for documentation
