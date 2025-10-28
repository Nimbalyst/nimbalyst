---
planStatus:
  planId: plan-electron-back-forward-navigation
  title: Electron Back & Forward Navigation
  status: completed
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders:
    - electron
    - editor
  tags:
    - navigation
    - ux
  created: "2025-09-20"
  updated: "2025-09-20T12:00:00.000Z"
  progress: 100
  dueDate: "2025-10-04"
  startDate: "2025-09-20"
---
# Electron Back & Forward Navigation


## Overview
- Add Electron menu items and keyboard shortcuts for navigating backward/forward through recently opened tabs (max history depth 50).
- Maintain per-window tab navigation stacks shared between main and renderer processes.
- Ensure consistent behavior across macOS, Windows, and Linux builds.

## Objectives
- Track tab focus changes in the Electron shell and record them in a capped stack (50 entries).
- Provide intuitive shortcuts (e.g., `Alt+Cmd+Left` / `Alt+Cmd+Right` on macOS, `Ctrl+Alt+Left` / `Ctrl+Alt+Right` on Windows/Linux) with matching menu items.
- Synchronize navigation actions between renderer state and main process to keep the editor UI aligned.
- Cover feature with unit/integration tests and documentation for shortcuts.

## Non-Goals
- Rewriting existing tab management logic beyond what is required to capture navigation history.
- Implementing browser-style navigation for in-document editing history (undo/redo remains untouched).

## Risks & Mitigations
- **__Inconsistent tab identifiers__** could break history replay; mitigate by centralizing ID management and validating tab existence before navigation.
- **__Keyboard conflicts__** with existing shortcuts; coordinate with design to pick non-conflicting combos and expose compatibility configuration.
- **__State drift between renderer and main__** leading to incorrect stacks; ensure IPC events are idempotent and include timestamps to drop stale updates.

## Open Questions
- Should history stack persist across app restarts or remain in-memory only?
    - Yes! why not add it to the `WorkspaceState`?
- Do we need user-configurable shortcut overrides within settings?
    - no

## Testing Strategy
- Unit tests for stack push/pop logic and cap enforcement (50) in isolation.
- Integration test simulating tab changes to ensure IPC wiring produces expected navigation behavior.
- Playwright e2e covering keyboard shortcuts triggering the correct tab focus order on macOS and Windows runners.

## Implementation Notes

### Approach
- Navigation history is stored entirely in the renderer process to avoid IPC complexity
- Integrated with existing `WorkspaceState` for persistence across sessions
- Navigation state is saved alongside tab state through unified IPC channels

### Key Files Modified
- **__`src/renderer/hooks/useTabNavigation.ts`__**: New hook managing navigation history with back/forward logic
- **__`src/main/menu/ApplicationMenu.ts`__**: Added "Navigate Back/Forward" items to View menu
- **__`src/renderer/hooks/useTabs.ts`__**: Extended to include navigation state in tab persistence
- **__`src/main/utils/store.ts`__**: Updated to save/restore navigation history as part of WorkspaceState
- **__`src/renderer/App.tsx`__**: Orchestrates navigation and tab hooks with state restoration
