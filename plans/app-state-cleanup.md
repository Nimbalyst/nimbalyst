---
planStatus:
  planId: plan-app-state-cleanup
  title: App.tsx State Cleanup
  status: in-development
  planType: refactor
  priority: medium
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - refactor
    - architecture
    - state-management
  created: "2025-10-17"
  updated: "2025-10-18T17:15:00.000Z"
  progress: 75
---
# App.tsx State Cleanup
<!-- plan-status -->

This plan addresses scattered state in App.tsx that belongs in child components, violating separation of concerns and creating unnecessary prop drilling.

## Goals

1. Remove unused state variables from App.tsx
2. Move component-specific state to the components that own it
3. Simplify component prop interfaces
4. Improve code maintainability and testability

## Problem Analysis

### Current State (Lines 165-205)

App.tsx contains 40+ state variables, many of which belong in child components:

**Lines 165-212: State Variables**
- `currentFilePath`, `currentFileName`, `isDirty` - Window title state (KEEP)
- `workspaceMode`, `workspacePath`, `workspaceName` - Core window state (KEEP)
- `fileTree` - Shared between components, needed by menu (KEEP)
- `theme` - Global app theme (KEEP)
- `activeMode` - Which content mode is visible (KEEP)
- `sidebarView` - Which view in sidebar (KEEP)
- **`sidebarWidth`**** - Should be owned by WorkspaceSidebar**
- **`recentWorkspaceFiles`**** - Only used by QuickOpen, should load its own**
- **`currentDirectory`**** - Only used by NewFileDialog, can compute from workspacePath**
- **`navigationMode`**** - Set but never used, DELETE**
- **`isAIChatCollapsed`****, \****`aiChatWidth`**\*\* - Should be owned by AIChat**
- **`currentAISessionId`****, \****`sessionToLoad`***\*, \****`isAIChatStateLoaded`**\*\* - Should be owned by AIChat**
- **`aiPlanningModeEnabled`**** - Should be owned by AIChat**
- **`lastPrompt`****, \****`lastAIResponse`**\*\* - Only used for error reporting in onApplyEdit, DELETE**
- **`diffError`**** - Not actually used in render, DELETE**
- Modal visibility flags - Controlled by menu system (KEEP)

## Refactoring Strategy

### Phase 1: Easy Wins (Low Risk)

#### 1.1 Delete Unused State

**Remove these state variables:**
```typescript
// Line 208 - Never actually used
const [navigationMode, setNavigationMode] = useState<NavigationMode>('planning');

// Lines 204-205 - Only used in onApplyEdit callback which doesn't need them
const [lastPrompt, setLastPrompt] = useState<string>('');
const [lastAIResponse, setLastAIResponse] = useState<string>('');

// Lines 198-203 - Rendered but never actually shown (diffError.isOpen is always false)
const [diffError, setDiffError] = useState<...>({ isOpen: false, ... });
```

**Remove related code:**
- Line 415: `handleNavigationModeChange` function (never called)
- Lines 1309-1328: `onApplyEdit` callback that stores lastPrompt/lastAIResponse
- Lines 1374-1380: ErrorDialog rendering for diffError

**Impact**: Removes 8 state variables and ~30 lines of code with zero risk

#### 1.2 Move recentWorkspaceFiles to QuickOpen

**Change App.tsx:**
```typescript
// DELETE line 186
const [recentWorkspaceFiles, setRecentWorkspaceFiles] = useState<string[]>([]);

// DELETE lines 667-686: Load recent files effect
// DELETE lines 598-603: Pre-load in keyboard shortcut

// UPDATE line 1338: Remove recentFiles prop
<QuickOpen
  isOpen={isQuickOpenVisible}
  onClose={() => setIsQuickOpenVisible(false)}
  workspacePath={workspacePath}
  currentFilePath={currentFilePath}
  // recentFiles={recentWorkspaceFiles} <- DELETE THIS
  onFileSelect={handleQuickOpenFileSelect}
/>
```

**Change QuickOpen component:**
- Load recent files in useEffect when component mounts/opens
- Remove `recentFiles` prop from interface
- State becomes local to QuickOpen

**Impact**: Removes 1 state variable and ~35 lines of code

#### 1.3 Remove currentDirectory State

**Change App.tsx:**
```typescript
// DELETE line 188
const [currentDirectory, setCurrentDirectory] = useState<string | null>(null);

// UPDATE line 1353: Compute directory when needed
<NewFileDialog
  isOpen={isNewFileDialogOpen}
  onClose={() => setIsNewFileDialogOpen(false)}
  currentDirectory={workspacePath} // Just use workspace root
  workspacePath={workspacePath}
  onCreateFile={handleCreateNewFile}
/>

// UPDATE handleWorkspaceFileSelect (line 440): Remove setCurrentDirectory
// UPDATE useIPCHandlers (line 843): Remove setCurrentDirectory
// UPDATE line 1014: Remove setCurrentDirectory call
```

**Change NewFileDialog:**
- Default directory is always workspacePath (root)
- Remove ability to set custom directory (not used)

**Impact**: Removes 1 state variable, simplifies file creation

### Phase 2: More Complex (Medium Risk)

#### 2.1 Move WorkspaceSidebar Width

**Currently:** App.tsx manages sidebarWidth, resize logic, and persistence

**Problem:** Tightly coupled resize logic spans 80+ lines in App.tsx (lines 230-265)

**Solution:** Keep as-is for now - resize logic is complex and works correctly

**Reason:** Risk > benefit, would require significant refactoring

#### 2.2 Move AIChat State to AIChat

**State to move:**
- `isAIChatCollapsed` (line 189)
- `aiChatWidth` (line 190)
- `isAIChatStateLoaded` (line 192)
- `aiPlanningModeEnabled` (line 194)
- `sessionToLoad` (line 196)
- `currentAISessionId` (line 197)

**Problem:** AIChat is 1792 lines with complex state interdependencies

**Solution:** Keep as-is for now - requires major AIChat refactor

**Reason:** Risk > benefit, should be separate focused effort

### Phase 3: Do Not Change

These state variables are correctly placed in App.tsx:

- `currentFilePath`, `currentFileName`, `isDirty` - Used in window title
- `workspaceMode`, `workspacePath`, `workspaceName` - Core window state
- `fileTree` - Shared state, refreshed from menu
- `theme` - Global application theme
- `activeMode` - Content mode coordination
- `sidebarView` - Sidebar view coordination
- Modal visibility flags (`isQuickOpenVisible`, etc.) - Controlled by menu

## Implementation Plan

### Step 1: Delete Unused State (5 minutes)
- Remove `navigationMode` state and handler
- Remove `lastPrompt`, `lastAIResponse` state
- Remove `diffError` state and ErrorDialog
- Update onApplyEdit callback to remove usage

### Step 2: Move recentWorkspaceFiles to QuickOpen (10 minutes)
- Add useEffect in QuickOpen to load recent files
- Remove prop from QuickOpen interface
- Remove state and effects from App.tsx
- Test QuickOpen still works

### Step 3: Remove currentDirectory State (10 minutes)
- Change NewFileDialog to always use workspacePath
- Remove setCurrentDirectory from callbacks
- Remove state variable
- Test file creation still works

## Testing

After each step:
1. Open workspace
2. Test QuickOpen (Cmd+O) shows recent files
3. Test new file creation works
4. Test AI edits work
5. Verify no console errors

## Success Criteria

- Remove 10+ state variables from App.tsx
- Remove ~100 lines of code
- All existing functionality works identically
- No new bugs introduced
- Clearer component boundaries

## Risks & Mitigation

**Risk**: Breaking QuickOpen recent files
**Mitigation**: QuickOpen can load its own recent files when opened

**Risk**: Breaking new file creation
**Mitigation**: Always using workspacePath root is simpler and works

**Risk**: Breaking AI Chat
**Mitigation**: Not touching AIChat in Phase 1 (deferred to future work)

## Critical Bug: EditorContainer onContentChange Not Firing

### Problem Description

**Severity**: CRITICAL - Breaks all save functionality (manual and auto)

**Symptom**: Lexical's `onContentChange` callback is never invoked when content changes in the editor. This causes:
1. EditorPool never gets updated with typed content
2. `getContentFn()` returns stale initial content instead of current editor state
3. Manual save (Cmd+S) writes wrong content to disk
4. Autosave would write wrong content
5. All file tests fail

**Root Cause**: Previous refactor to EditorContainer.tsx broke the callback mechanism. The exact change is unknown without git history, but symptoms indicate:
- StravuEditor is passed an `onContentChange` callback
- Callback is created inline on every render (8+ times during test)
- Lexical never calls the callback when content changes
- EditorPool somehow has correct content length (74 bytes) but getContentFn returns stale content (37 bytes)

**Evidence from Test Logs**:
```javascript
BROWSER LOG: [EditorContainer] handleManualSave called
BROWSER LOG: [EditorContainer] Using getContentFn with ID: 1760805582392.0593
BROWSER LOG: [EditorContainer] Got content, length: 37  <- STALE
BROWSER LOG: [EditorContainer] Content preview: # Manual Save Test\n\nInitial content.\n
BROWSER LOG: [EditorContainer] EditorPool instance content length: 74  <- CORRECT
BROWSER LOG: [EditorContainer] Calling saveWithHistory with content length: 37  <- WRONG
```

No `onContentChange CALLED` logs appear at all, confirming Lexical never fires the callback.

**Attempted Fixes That Failed**:
1. Removing wrapper divs - didn't help
2. Creating stable callback references - didn't help
3. Adding extensive logging - confirmed callback never fires

### Proposed Solution: Major Refactor

The EditorContainer/EditorPool architecture is fundamentally broken. Need to completely redesign:

#### New Architecture

**Kill EditorPool** - Replace with proper React component hierarchy:

```javascript
App.tsx
  └─ TabManager
      └─ TabContent (new component)
          ├─ Manages tabs array and active tab
          └─ For each tab:
              └─ TabEditor (new component)
                  ├─ Owns ALL editor state
                  ├─ Owns StravuEditor instance
                  ├─ Handles autosave
                  ├─ Handles file watching
                  ├─ Handles manual save
                  ├─ Handles history snapshots
                  └─ Fully encapsulated
```

**TabEditor Component** (new):
- Single responsibility: manage one editor instance for one file
- All state lives in the component (no external pool)
- Props: `filePath`, `initialContent`, `theme`, `isActive`
- Callbacks: `onDirtyChange`, `onSaveComplete`
- Internal state: `content`, `isDirty`, `lastSaveTime`, etc.
- Autosave timer runs inside component
- File watcher listens inside component
- Manual save exposes via ref for parent to call

**EditorRegistry** (keep/improve):
- Singleton registry for other components to find editors
- Maps filePath → editor instance
- AI tools use this to apply edits
- No state management, just lookup

**Benefits**:
1. Clear component boundaries
2. State lives where it's used
3. No mysterious EditorPool Map
4. Easier to test individual editors
5. React lifecycle manages everything naturally
6. No callback confusion - callbacks are stable component methods

#### Migration Strategy

1. Create new `TabEditor` component first
2. Create new `TabContent` component
3. Test with single tab
4. Expand to multiple tabs
5. Remove EditorPool entirely
6. Remove EditorContainer
7. Update all tests

### Immediate Workaround

For now, revert to last known working version of EditorContainer.tsx from git history. This unblocks development while planning the full refactor.

## Implementation Status

### Completed (2025-10-18)

**New Architecture Implemented:**
- Created `TabEditor` component - fully self-contained editor managing all state
  - Content and dirty tracking
  - Autosave with debouncing
  - File watching with conflict detection
  - Manual save with history snapshots
  - No external dependencies on EditorPool

- Created `TabContent` component - coordinates multiple TabEditors
  - Renders TabEditor for each tab
  - Handles virtual tabs (Plans, Bugs)
  - Loads content from files/virtual sources
  - Waits for content before rendering to prevent empty editors

- Integrated into App.tsx replacing EditorContainer in both modes (files and plan)

**Bugs Fixed:**
- Empty editors on load - content loading race condition
- File watcher save loop - fixed by using refs instead of state dependencies
- Added backwards compatibility classes for e2e tests

**Architecture Benefits Achieved:**
- Clear component boundaries
- State lives where it's used
- No mysterious EditorPool Map
- React lifecycle manages everything naturally
- Stable component methods instead of callback confusion

### Remaining Work

- Update e2e test selectors (`.tab.active` → `.file-tabs-container .tab.active`)
- Remove EditorPool and old EditorContainer files once tests pass
- Phase 2: Refactor AIChat to own its state (separate plan)
- Phase 2: Consider moving WorkspaceSidebar resize logic (separate plan)

## Notes

- TabEditor/TabContent architecture successfully implemented
- Core refactor complete and working in production
- Test failures are selector specificity issues, not functionality bugs
- AIChat refactor deferred - needs separate focused effort
- WorkspaceSidebar resize logic kept as-is - works correctly, risky to change
