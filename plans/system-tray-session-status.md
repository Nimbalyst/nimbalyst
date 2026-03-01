---
planStatus:
  planId: plan-system-tray-session-status
  title: System Tray Session Status Menu
  status: in-review
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags: [electron, tray, sessions, ux]
  created: "2026-02-17"
  updated: "2026-02-28T00:00:00.000Z"
  startDate: "2026-02-28"
  progress: 100
---

# System Tray Session Status Menu

## Implementation Progress

- [x] Create TrayManager singleton service with session cache and debounced menu rebuild
- [x] Create tray icon template images (splat outline with # hash)
- [x] Wire TrayManager into app lifecycle (static import in index.ts)
- [x] Subscribe to SessionStateManager events for running/completed state
- [x] Query database for session titles and workspace paths on session start
- [x] Detect blocked sessions via AIService prompt events (main-process EventEmitter)
- [x] Track unread state from session metadata
- [x] Build context menu with grouped sections (Needs Attention / Running / Unread)
- [x] Update tray icon based on aggregate session state (priority: Error > Attention > Running > Idle)
- [x] Add tray:navigate-to-session IPC channel (main handler, preload bridge, electron.d.ts type)
- [x] Create trayListeners.ts centralized listener in renderer
- [x] Handle session click -> focus window + navigate to session
- [x] Add macOS dock badge for attention count

## Overview

Add an Electron system tray icon to Nimbalyst that provides at-a-glance visibility into AI session status without needing to switch to the app. The tray icon reflects the aggregate state of all sessions, and the dropdown menu lists sessions grouped by status.

## Motivation

When users kick off AI sessions and switch to other apps (browser, terminal, etc.), they currently have no way to know when sessions complete, get blocked on input, or encounter errors without switching back to Nimbalyst. A tray icon solves this by surfacing session state in the OS menu bar.

## Mockup

![System Tray Session Status Menu](screenshot.png){mockup:nimbalyst-local/mockups/system-tray-session-status.mockup.html}

## Design

### Tray Icon States

The tray icon uses a small template image (macOS menu bar style) with visual variants:

| State | Icon | Condition |
|---|---|---|
| Idle | Monochrome logo | No active sessions |
| Running | Animated/pulsing indicator | Any session has `status === 'running'` |
| Needs Attention | Badge dot / attention color | Any session has `pendingAskUserQuestion` metadata flag set, or has pending interactive prompts (queried via `messages:get-pending-prompts`), or has unread messages (`hasUnread` metadata flag) |
| Error | Error indicator | Any session has `status === 'error'` |

Priority order for icon state: Error > Needs Attention > Running > Idle.

**Note:** On macOS, tray icons should be "template images" (monochrome) for proper dark/light menu bar adaptation. We can overlay a colored dot for attention states.

### Tray Menu Structure

```
-- Nimbalyst --
  [Needs Attention]              (section header, only if any)
    Session: "Fix auth bug"      (blocked - permission request)
    Session: "Refactor DB"       (blocked - waiting for answer)
  [Running]                      (section header, only if any)
    Session: "Add dark mode"     (streaming...)
  [Unread]                       (section header, only if any)
    Session: "CSS cleanup"       (completed, 3 new messages)
  ---
  Open Nimbalyst                 (focus/create main window)
  Quit                           (standard quit)
```

Clicking a session item focuses the correct workspace window and navigates to that session.

### Data Sources (Main Process)

All data the tray needs is already available in the main process:

1. **Active sessions + status**: `SessionStateManager.getActiveSessionIds()` and `getSessionState(id)` - gives `running`, `idle`, `error`, `isStreaming`
2. **Session titles**: Query from `ai_sessions` table via database worker
3. **Pending interactive prompts**: `pendingAskUserQuestion` flag in session `metadata` JSONB column (set when AskUserQuestion/ToolPermission/ExitPlanMode fires, cleared when resolved). Also accessible via `messages:get-pending-prompts` IPC handler which queries the database for unresolved prompt messages.
4. **Unread state**: `hasUnread` flag in session `metadata` JSONB column (persisted via `ai:updateSessionMetadata`, synced cross-device)
5. **Workspace path**: `workspace_id` column in `ai_sessions` table, used to find/focus the correct window via `findWindowByWorkspace()`

**Important nuance:** The `waiting_for_input` status exists in the `SessionStatus` type but is not actively set by the current codebase. Instead, "blocked on user input" is tracked separately via the `pendingAskUserQuestion` metadata flag and the `sessionHasPendingInteractivePromptAtom` in the renderer. The tray should detect blocked sessions by checking metadata, not the session status field.

The tray subscribes to `SessionStateManager` events for real-time updates on running/completed state, and also listens to IPC events for prompt creation/resolution to detect blocked state.

### Existing Infrastructure to Leverage

- **`SessionStateManager`** (singleton in main process): Already has `.subscribe(callback)` for `session:started`, `session:completed`, `session:waiting`, `session:error`, `session:interrupted`, `session:streaming` events
- **`hasActiveStreamingSessions()`**: Already exists in `SessionStateHandlers.ts` for quit confirmation - similar pattern
- **`SoundNotificationService`**: Already plays sounds on completion/permission requests when app is backgrounded - tray is a natural companion
- **`findWindowByWorkspace()`**: Can focus the right window when a session is clicked
- **Database worker**: Can query `ai_sessions` for titles, workspace paths, metadata

## Implementation Plan

### Step 1: Create TrayManager service

**File:** `packages/electron/src/main/tray/TrayManager.ts`

A singleton service that:
- Creates and owns the `Tray` instance
- Subscribes to `SessionStateManager` events
- Maintains a local cache of session display data (id, title, status, workspace, hasUnread, hasPendingPrompt)
- Rebuilds the context menu when state changes (debounced to avoid excessive rebuilds)
- Provides `initialize()` and `shutdown()` methods

```typescript
class TrayManager {
  private tray: Tray | null = null;
  private sessionCache: Map<string, TraySessionInfo> = new Map();
  private stateUnsubscribe: (() => void) | null = null;
  private menuRebuildTimer: NodeJS.Timeout | null = null;

  async initialize(): Promise<void>;
  shutdown(): void;
  private onSessionStateEvent(event: SessionStateEvent): void;
  private scheduleMenuRebuild(): void;
  private rebuildMenu(): void;
  private updateIcon(): void;
  private getIconForState(state: TrayIconState): NativeImage;
  private handleSessionClick(sessionId: string, workspacePath: string): void;
}
```

Key design decisions:
- **Debounced menu rebuilds**: Batch rapid state changes (e.g., multiple sessions starting) into a single menu rebuild with ~300ms debounce
- **Session cache**: Avoid querying the database on every event. Cache session metadata and update incrementally
- **Template images**: Use `nativeImage.createFromPath()` with template image naming convention for macOS

### Step 2: Create tray icon assets

**Directory:** `packages/electron/resources/tray/`

Need template images for macOS (and regular icons for Windows/Linux):
- `trayTemplate.png` / `trayTemplate@2x.png` - Normal state (monochrome, ~16x16 / 32x32)
- `tray-attention-dot.png` - Overlay for attention state (or we composite dynamically)

For the initial implementation, we can use a simple approach:
- Use the existing app icon scaled down as the base
- Use `tray.setTitle()` on macOS to show a count (e.g., "2" for 2 sessions needing attention)
- Or use `tray.setImage()` to swap between icon variants

### Step 3: Wire into app lifecycle

**File:** `packages/electron/src/main/index.ts`

- **Use a static top-level import** for `TrayManager` (NEVER dynamic `await import()` -- see CLAUDE.md critical rule)
- Initialize `TrayManager` after `app.whenReady()` and after `SessionStateManager` is initialized
- Shutdown on `before-quit`
- The tray persists even when all windows are closed (important for background session monitoring)
- `initialize()` must throw if `SessionStateManager` is not yet available (fail fast, fail loud -- never silently degrade to a tray with no data)

```typescript
import { TrayManager } from './tray/TrayManager';

// In app.whenReady():
const trayManager = TrayManager.getInstance();
await trayManager.initialize();

// In before-quit:
trayManager.shutdown();
```

### Step 4: Enrich session cache with metadata

When `SessionStateManager` fires a `session:started` event, query the database for the session's title and workspace path:

```sql
SELECT id, title, workspace_id, metadata
FROM ai_sessions
WHERE id = $1
```

Cache this alongside the runtime state. On `session:completed` or `session:interrupted`, keep the entry briefly (for "recently completed" visibility) then remove it after a timeout.

**Blocked state detection:** The tray also needs to listen to the same IPC events that the renderer's `sessionStateListeners.ts` uses for prompt detection. In the main process, these events are emitted by `AIService` when interactive prompts are created/resolved:
- `ai:askUserQuestion` / `ai:askUserQuestionAnswered`
- `ai:toolPermission` / `ai:toolPermissionResolved`
- `ai:exitPlanModeConfirm` / `ai:exitPlanModeResolved`
- `ai:gitCommitProposal` / `ai:gitCommitProposalResolved`

These are currently sent to renderer windows via `webContents.send()`. The TrayManager should subscribe to the same events. The cleanest approach: have `AIService` also emit these on a main-process EventEmitter (or call into TrayManager directly) so the tray can track blocked state without intercepting renderer-bound IPC.

**Unread state:** When a session completes (`session:completed` event), check if any window for that workspace is focused. If not, the session likely has unread messages. We can also query the metadata `hasUnread` flag which is already persisted by the renderer when messages arrive for non-active sessions.

### Step 5: Handle session click -> navigate

When a user clicks a session in the tray menu:

1. Find the window for the session's workspace: `findWindowByWorkspace(workspacePath)`
2. If found: focus it, then send an IPC message to navigate to the session
3. If not found: create a new window for that workspace, then navigate

New IPC channel needed: `tray:navigate-to-session` (sent from main to renderer). Following the centralized listener pattern (see `IPC_LISTENERS.md`), a dedicated `trayListeners.ts` file in `store/listeners/` subscribes ONCE at startup and updates the relevant Jotai atoms (`activeSessionIdAtom`, editor mode). Components NEVER subscribe to this IPC event directly.

### Step 6: Dock badge (macOS bonus)

While implementing the tray, also add a dock badge showing the count of sessions needing attention:

```typescript
if (process.platform === 'darwin' && app.dock) {
  const attentionCount = this.getAttentionCount();
  app.dock.setBadge(attentionCount > 0 ? String(attentionCount) : '');
}
```

## Platform Considerations

| Feature | macOS | Windows | Linux |
|---|---|---|---|
| Tray location | Menu bar (top-right) | System tray (bottom-right) | System tray (varies by DE) |
| Template images | Yes (auto dark/light) | No (use explicit icons) | No |
| Dock badge | Yes (`app.dock.setBadge`) | Taskbar overlay icon | N/A |
| `tray.setTitle()` | Shows text next to icon | N/A | N/A |

Initial implementation targets macOS only. Windows/Linux can be added later with platform-specific icon handling.

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `packages/electron/src/main/tray/TrayManager.ts` | Create | Core tray management service |
| `packages/electron/resources/tray/` | Create | Tray icon assets |
| `packages/electron/src/main/index.ts` | Modify | Initialize/shutdown TrayManager |
| `packages/electron/src/preload/index.ts` | Modify | Add `tray:navigate-to-session` preload bridge function |
| `packages/electron/src/preload/electron.d.ts` | Modify | Add type declaration for `tray:navigate-to-session` API |
| `packages/electron/src/renderer/store/listeners/trayListeners.ts` | Create | Centralized listener for tray navigation IPC (updates `activeSessionIdAtom`, navigates to Agent mode). Components NEVER subscribe to this IPC directly. |

## Open Questions

1. ~~**Tray icon design**~~: Decided -- use a simplified splat outline with `#` hash mark (see mockup). Template image for macOS.
2. **Session grouping**: Should the tray menu group by workspace (e.g., "stravu-editor" > sessions) or show a flat list?
3. **Unread tracking scope**: Should "unread" track at the session level (any new message) or only for sessions that completed while backgrounded?
4. **Recently completed**: Should completed sessions linger in the tray menu for a few minutes, or disappear immediately?
5. **macOS-only initially?**: Windows and Linux tray behavior varies significantly. Start macOS-only?
6. **Tray title text**: On macOS, `tray.setTitle()` can show text next to the icon (e.g., "2 running"). Worth doing?

## Error Handling

Follow the "fail fast, fail loud" principle:
- `TrayManager.initialize()` must **throw** if `SessionStateManager` is not initialized -- never silently create a tray with no data source
- `handleSessionClick()` must **throw** if the workspace path is missing from the session cache -- this indicates a cache bug, not a graceful degradation scenario
- Database query failures for session titles should log errors but not crash the tray (title is cosmetic, not functional)

## Keyboard Shortcuts

If any keyboard shortcuts are added for tray interactions, update `KeyboardShortcutsDialog.tsx` to keep the Help dialog in sync.

## Non-Goals (for initial version)

- Responding to prompts directly from the tray menu (too complex for a menu item)
- Showing full message previews
- Windows/Linux support (follow-up)
- Tray icon animation (follow-up, needs custom drawing)
