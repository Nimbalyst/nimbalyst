---
planStatus:
  planId: plan-encapsulate-mode-components
  title: Encapsulate Mode-Specific UI into Dedicated Components
  status: in-development
  planType: refactor
  priority: high
  owner: developer
  stakeholders:
    - developer
  tags:
    - architecture
    - refactor
    - app-structure
    - cleanup
  created: "2025-01-29"
  updated: "2025-01-29T23:15:00.000Z"
  progress: 75
---
# Encapsulate Mode-Specific UI into Dedicated Components

## Goals

- Extract mode-specific UI logic from App.tsx into dedicated components
- Create EditorMode component to encapsulate workspace file editing mode
- Clean up App.tsx to only handle mode routing and global concerns
- Establish clear component boundaries and responsibilities
- Make it easier to add new modes in the future

## Problem

Currently, App.tsx directly manages UI for workspace/editor mode:
- File tree state and operations
- Tab management (tabs, activeTab, switching, closing)
- Editor rendering and configuration
- AI Chat panel state and operations
- File dialogs and modals

This creates several issues:
- App.tsx is bloated with mode-specific logic (1500+ lines)
- Hard to reason about what belongs where
- Mode-specific state bleeds across the entire component
- Adding new modes requires modifying App.tsx extensively
- IPC event routing logic is scattered

Agent mode already has AgenticPanel which properly encapsulates its concerns. Workspace mode needs the same treatment.

## High-Level Approach

Create a new EditorMode component that owns all workspace/editor mode concerns, similar to how AgenticPanel owns agent mode.

### Component Responsibilities

**App.tsx (after refactor):**
- Window-level state (workspace path, theme, mode switching)
- Navigation gutter (mode selector)
- Mode routing (show active mode component)
- Global IPC listeners (window close, theme changes)
- Global dialogs (settings, session manager)

**EditorMode component (new):**
- File tree management and state
- Tab management (create, switch, close, reorder)
- Editor rendering and TabContent
- AI Chat panel (right sidebar)
- File dialogs (new file, history)
- Mode-specific IPC listeners (close-active-tab for workspace)

**AgenticPanel (existing):**
- Already properly encapsulates agent mode
- Session tabs and management
- Agent UI and interactions
- Mode-specific IPC listeners (close-active-tab for agent)

## Key Components to Create

### EditorMode Component

**Location:** `packages/electron/src/renderer/components/EditorMode/EditorMode.tsx`

**Props:**
- `workspacePath: string`
- `theme: string`
- `isActive: boolean` - whether this mode is currently visible
- `onModeChange?: (mode: string) => void` - callback to switch to other modes

**Responsibilities:**
- Owns file tree state and operations
- Owns tab state via useTabs hook
- Manages TabManager and TabContent
- Manages AI Chat panel state and visibility
- Handles file dialogs (new file, history)
- Listens for close-active-tab IPC when active
- Exposes ref methods for parent if needed (e.g., closeActiveTab)

**State it owns:**
- File tree state
- Tab state (tabs array, activeTabId, etc.)
- AI Chat collapsed state
- Dialog open states (new file, history)
- Current file state (path, name, dirty)

### Files to Modify

**App.tsx:**
- Remove file tree state and operations
- Remove tab state and operations
- Remove AI Chat panel state
- Remove file dialog state
- Replace editor mode UI with `<EditorMode>` component
- Simplify IPC routing to delegate to active mode component

**New files:**
- `packages/electron/src/renderer/components/EditorMode/EditorMode.tsx`
- `packages/electron/src/renderer/components/EditorMode/EditorMode.css` (if needed)

## IPC Event Routing

After refactor, App.tsx routes close-active-tab to the active mode component:

```javascript
Menu → 'close-active-tab' → App.tsx → Routes to active mode:
  - EditorMode (if mode='files' or 'plan')
  - AgenticPanel (if mode='agent')
```

Each mode component handles its own tab closing logic internally.

## Migration Strategy

### Phase 1: Create EditorMode Component (COMPLETED)

1. ✅ Create EditorMode component shell with basic structure
2. ✅ Move file tree state and operations to EditorMode
3. ✅ Move tab state and useTabs hook to EditorMode
4. ✅ Move TabManager, TabContent, and AI Chat rendering to EditorMode
5. ✅ Move dialog state and handlers to EditorMode (NewFileDialog, HistoryDialog)
6. ✅ Update IPC routing in App.tsx to use EditorMode ref
7. ✅ Add sidebar resize functionality to EditorMode
8. ✅ Remove duplicate state from App.tsx (fileTree, sidebarWidth, dialog states, resize handlers)

### Phase 2: Eliminate Duplicate Tabs State (IN PROGRESS)

**Problem:** App.tsx still has its own `tabs` state via useTabs hook, creating duplicate tabs state:
- EditorMode has tabs for workspace mode
- App.tsx has tabs for... what exactly?
- This causes confusion and potential state sync issues

**Current state in App.tsx that needs refactoring:**
- `tabs` state from useTabs hook (lines 454-480)
- `getContentRef` used to build documentContext
- `documentContext` passed to AgenticPanel
- `handleNew`, `handleOpen`, `handleSaveAs` - use App-level tabs
- `navigation` hook for tab navigation
- Tab-related refs (tabsRef, tabStatesRef)

**Progress:**

1. ✅ **Remove tabs from App.tsx** - Replaced with stub object for backward compatibility
  - Removed useTabs hook and useTabNavigation hook
  - Created stub tabs object that logs warnings when called
  - Build documentContext manually from currentFilePath and getContentRef
  - EditorMode syncs getContentRef back to App.tsx via onGetContentReady callback

2. **Move handleOpen/handleSaveAs to EditorMode** (TODO)
  - These operations still use App-level stub tabs
  - Need to be moved to EditorMode and exposed via ref
  - Or delegate to EditorMode when in workspace mode

3. ✅ **Refactor AgenticPanel document context**
  - App.tsx builds documentContext from currentFilePath and getContentRef
  - EditorMode notifies App of changes via onCurrentFileChange and onGetContentReady
  - AgenticPanel continues to receive documentContext as prop

4. **Update IPC handlers** (TODO)
  - `file-open` → needs to route to EditorMode
  - `file-save-as` → needs to route to EditorMode
  - `file-new` → needs investigation (window-level vs workspace-level)

5. ✅ **Clean up navigation state**
  - Removed useTabNavigation from App.tsx
  - EditorMode has its own tab navigation (already implemented)

### Phase 3: Test and Validate (PENDING)

1. Test all workspace mode functionality
2. Test mode switching (files ↔ agent)
3. Test keyboard shortcuts (Cmd+W, Cmd+Shift+W)
4. Verify no regressions in file operations
5. Verify AI Chat panel works in both modes

## Acceptance Criteria

### Phase 1 (COMPLETED)
- ✅ EditorMode component created and properly encapsulates workspace mode
- ✅ File tree, tabs, editor, and AI chat rendering moved to EditorMode
- ✅ Cmd+W closes active tab via EditorMode ref
- ✅ Sidebar resize works in EditorMode
- ✅ Dialogs (new file, history) managed by EditorMode

### Phase 2 (IN PROGRESS - 75%)
- ✅ No duplicate tabs state between App.tsx and EditorMode (stub for backward compat)
- ✅ EditorMode syncs getContentRef to App.tsx via callback
- [ ] handleOpen/handleSaveAs moved to EditorMode or properly delegated
- ✅ AgenticPanel document context works without App-level tabs
- ✅ Tab navigation moved to EditorMode
- [ ] IPC handlers properly route to mode components

### Phase 3 (PENDING)
- [ ] App.tsx reduced to primarily mode routing logic
- [ ] Cmd+Shift+W closes project window
- [ ] Switching between modes (agent/editor) works correctly
- [ ] All file operations (open, save, close) work
- [ ] AI Chat panel toggles and state persists in both modes
- [ ] No regression in existing functionality

## Issues Discovered

### Duplicate Tabs State
After Phase 1, we discovered that both App.tsx and EditorMode maintain tabs state:
- **App.tsx:** Creates tabs via useTabs (line 454), used by handleOpen/handleSaveAs and to build documentContext for AgenticPanel
- **EditorMode:** Creates its own tabs via useTabs (line 73), used for actual editor tab management

This duplication is problematic because:
- State can get out of sync between the two
- Unclear which is the "source of truth" for workspace mode
- Wastes memory and causes unnecessary re-renders
- Makes debugging difficult

### Document Context Architecture
AgenticPanel receives documentContext as a prop, which is built from App-level tabs and getContentRef. But in workspace mode, EditorMode owns the actual tabs. This creates a disconnect where AgenticPanel might not have access to current document state.

### IPC Handler Coupling
handleOpen, handleSaveAs, and handleNew are in App.tsx and directly manipulate App-level tabs. But workspace mode operations should go through EditorMode. These handlers need to either:
1. Be moved to EditorMode and exposed via ref
2. Delegate to EditorMode when in workspace mode
3. Be split into window-level vs workspace-level operations

## Benefits

- Clear separation of concerns
- Each mode is self-contained and testable
- Easier to add new modes in the future
- App.tsx becomes simple mode router
- Better code organization and maintainability
- Easier to reason about component responsibilities
- Eliminates duplicate state management
- Simplifies IPC routing and event handling
