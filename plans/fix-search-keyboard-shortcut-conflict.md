---
planStatus:
  planId: plan-fix-search-keyboard-shortcut-conflict
  title: Fix Search Keyboard Shortcut Conflict
  status: completed
  planType: bug-fix
  priority: high
  owner: claude
  stakeholders:
    - users
  tags:
    - keyboard-shortcuts
    - search
    - ui-conflict
  created: "2025-11-16"
  updated: "2025-11-16T18:10:00.000Z"
  progress: 100
---

# Fix Search Keyboard Shortcut Conflict

## Problem

When we added search to the AgenticPanel (agent transcript search), we inadvertently broke the editor search by stealing the Cmd+F keyboard shortcut. This is happening because:

1. **Multiple active panels**: The app architecture keeps all editor and session tab panels active simultaneously (they're just hidden via CSS `display: none`)
2. **Direct keyboard listener**: The AgentTranscript search (`RichTranscriptView.tsx:279-302`) listens directly to `window.addEventListener('keydown')` and calls `e.preventDefault()` when Cmd+F is pressed
3. **No context awareness**: The search bar doesn't check which panel is currently visible/active before capturing the keyboard shortcut
4. **Result**: When a user presses Cmd+F in the editor, the hidden agent transcript's search bar activates instead of the editor's search dialog

## Root Cause

The keyboard shortcut is registered at the window level without checking:
- Which mode is active (editor/agent/files)
- Which tab is active within each mode
- Whether the agent panel is actually visible to the user

```typescript
// In RichTranscriptView.tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Cmd+F or Ctrl+F to open search
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();  // ❌ ALWAYS prevents default, even when not visible
      setShowSearchBar(true);
    }
    // ...
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [showSearchBar]);
```

## Architecture Issues

The current approach violates several architectural principles:

1. **Incorrect separation of concerns**: Search shortcuts should be handled by the Electron menu system (main process), not individual React components (renderer process)
2. **Race conditions**: Multiple components competing for the same keyboard shortcut creates unpredictable behavior
3. **No centralized routing**: No single source of truth for which component should receive keyboard events
4. **Hidden state**: All panels are mounted simultaneously, making it impossible to use React lifecycle or visibility checks

## Correct Solution

Implement search keyboard shortcuts via the **Application Menu** system (same pattern as File > Save, Edit > Undo, etc.):

### 1. Add Search Menu Items to ApplicationMenu.ts

```typescript
// In packages/electron/src/main/menu/ApplicationMenu.ts
{
  label: 'Edit',
  submenu: [
    // ... existing items (Undo, Redo, Cut, Copy, Paste)
    { type: 'separator' },
    {
      label: 'Find...',
      accelerator: 'CmdOrCtrl+F',
      click: (menuItem, focusedWindow) => {
        if (focusedWindow) {
          focusedWindow.webContents.send('menu:find');
        }
      }
    },
    {
      label: 'Find Next',
      accelerator: 'CmdOrCtrl+G',
      click: (menuItem, focusedWindow) => {
        if (focusedWindow) {
          focusedWindow.webContents.send('menu:find-next');
        }
      }
    },
    {
      label: 'Find Previous',
      accelerator: 'CmdOrCtrl+Shift+G',
      click: (menuItem, focusedWindow) => {
        if (focusedWindow) {
          focusedWindow.webContents.send('menu:find-previous');
        }
      }
    }
  ]
}
```

### 2. Route IPC Events Based on Active Mode/Tab

The window's main component (App.tsx or similar) should:
1. Track which mode is currently active (editor/agent/files)
2. Track which tab is active within agent mode
3. Route the IPC events to the correct component

```typescript
// In packages/electron/src/renderer/App.tsx or similar
useEffect(() => {
  const handleFind = () => {
    // Route based on current mode and active tab
    if (currentMode === 'editor') {
      // Trigger editor search (existing SearchReplacePlugin)
      // This already exists, just needs to be exposed
      editorRef.current?.openSearchDialog();
    } else if (currentMode === 'agent') {
      // Get the active session tab
      const activeSessionId = agenticPanelState.activeTabId;
      if (activeSessionId) {
        // Trigger transcript search for active session only
        window.dispatchEvent(new CustomEvent('menu:find', {
          detail: { sessionId: activeSessionId }
        }));
      }
    } else if (currentMode === 'files') {
      // Optional: Implement file tree search if needed
    }
  };

  const cleanup = window.electronAPI.on('menu:find', handleFind);
  return cleanup;
}, [currentMode, agenticPanelState.activeTabId]);
```

### 3. Update RichTranscriptView to Listen for Routed Events

Remove the global `window.addEventListener('keydown')` and instead listen for the routed event:

```typescript
// In RichTranscriptView.tsx
useEffect(() => {
  // Only handle search if this specific session is active
  const handleFind = (e: CustomEvent) => {
    if (e.detail?.sessionId === sessionId) {
      setShowSearchBar(true);
    }
  };

  const handleFindNext = (e: CustomEvent) => {
    if (e.detail?.sessionId === sessionId && showSearchBar) {
      window.dispatchEvent(new CustomEvent('transcript-search-next'));
    }
  };

  const handleFindPrevious = (e: CustomEvent) => {
    if (e.detail?.sessionId === sessionId && showSearchBar) {
      window.dispatchEvent(new CustomEvent('transcript-search-prev'));
    }
  };

  window.addEventListener('menu:find', handleFind as EventListener);
  window.addEventListener('menu:find-next', handleFindNext as EventListener);
  window.addEventListener('menu:find-previous', handleFindPrevious as EventListener);

  return () => {
    window.removeEventListener('menu:find', handleFind as EventListener);
    window.removeEventListener('menu:find-next', handleFindNext as EventListener);
    window.removeEventListener('menu:find-previous', handleFindPrevious as EventListener);
  };
}, [sessionId, showSearchBar]);
```

### 4. Update SearchReplacePlugin for Editor

Ensure the editor search plugin exposes a method to open the dialog programmatically:

```typescript
// In packages/rexical/src/plugins/SearchReplacePlugin/index.tsx
export function SearchReplacePlugin({ editorRef }: { editorRef?: React.MutableRefObject<SearchReplaceAPI | null> }) {
  // ... existing implementation

  // Expose API via ref
  useImperativeHandle(editorRef, () => ({
    openSearchDialog: () => {
      setShowDialog(true);
    },
    closeSearchDialog: () => {
      setShowDialog(false);
    }
  }));
}
```

## Benefits of This Approach

1. **Single source of truth**: Menu system controls all keyboard shortcuts
2. **Proper routing**: Main component routes events to the correct active component
3. **No conflicts**: Only one component receives the event at a time
4. **Consistent UX**: Search behaves the same as other menu commands (Save, Undo, etc.)
5. **Menu visibility**: Users can see search commands in the Edit menu
6. **OS integration**: Keyboard shortcuts work consistently with OS expectations

## Files to Modify

1. `packages/electron/src/main/menu/ApplicationMenu.ts` - Add Find menu items
2. `packages/electron/src/renderer/App.tsx` (or window manager) - Add IPC routing logic
3. `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx` - Replace window.addEventListener with routed event listeners
4. `packages/rexical/src/plugins/SearchReplacePlugin/index.tsx` - Expose openSearchDialog API
5. `packages/electron/src/renderer/components/UnifiedAI/AgenticPanel.tsx` - Pass sessionId in search events

## Testing

1. Open a workspace with an editor tab
2. Press Cmd+F - editor search should open
3. Switch to agent mode
4. Press Cmd+F - agent transcript search should open for active session only
5. Switch between session tabs - Cmd+F should work for the active tab
6. Verify Cmd+G and Cmd+Shift+G work correctly in both modes

## Acceptance Criteria

- [ ] Cmd+F opens editor search when editor is active
- [ ] Cmd+F opens transcript search when agent panel is active
- [ ] Search only activates for the currently visible/active component
- [ ] Cmd+G and Cmd+Shift+G navigate matches in the correct component
- [ ] Menu items appear in Edit menu
- [ ] No keyboard shortcut conflicts between components
