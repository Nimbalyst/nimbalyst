# Centralized IPC Listener Architecture

**CRITICAL: Components NEVER subscribe to IPC events directly.**

All IPC event handling follows this architecture:

1. **Central listeners** subscribe to IPC events ONCE at app startup
2. **Listeners update atoms** when events fire (with debouncing where appropriate)
3. **Components read from atoms** and re-render automatically

## Pattern

```typescript
// BAD: Component subscribing to IPC directly
useEffect(() => {
  const handler = (data) => {
    setLocalState(data);
  };
  window.electronAPI.on('some:event', handler);
  return () => window.electronAPI.off('some:event', handler);
}, []);

// GOOD: Central listener updates atom, component reads atom
// In store/listeners/someListeners.ts:
export function initSomeListeners(): () => void {
  const handleEvent = (data) => {
    store.set(someAtom, data);
  };
  return window.electronAPI.on('some:event', handleEvent);
}

// In component:
const data = useAtomValue(someAtom);
```

## Benefits

- No race conditions when switching contexts (session, workspace, etc.)
- No stale closures capturing old component state
- No MaxListenersExceededWarning from N components subscribing
- Debouncing in one place instead of every component
- State persists across component unmounts

## Reaction patterns

How components consume the atoms depends on what the listener writes:

- **State atoms** (current value matters): subscribe with `useAtomValue` and render directly. Used by `themeIdAtom`, `sessionFileEditsAtom`, `syncStatusUpdateAtom`, etc.
- **Counter atoms** (fire-and-forget commands): the listener bumps a number; the component captures the initial value in a ref and runs side effects only when the counter changes. Used for menu commands like `file-save`, `navigation:go-back`, `confirm-close-unsaved`.
- **Request atoms** (`{ version, payload } | null`): same idea as counter atoms but the payload travels with the bump. Used for `set-content-mode`, `extension-marketplace:install-request`, `open-navigation-dialog`.
- **Per-key atom families** (per-file, per-session): the listener routes to `atomFamily(key)` so consumers only react to their own key. Used for `file-changed-on-disk` (per file path) and `history:pending-tag-created`.

The "skip the initial mount" idiom for counter/request atoms:

```typescript
const version = useAtomValue(somethingRequestAtom);
const initialRef = useRef(version);
useEffect(() => {
  if (version === initialRef.current) return;
  // ...react to the command
}, [version]);
```

This prevents the side effect from firing on first render with whatever value happened to be in the atom.

## Already Implemented

DO NOT add component-level IPC subscriptions for these events. Use the existing listener or extend it.

### State listeners (atom holds current value)

- **File state** (`store/listeners/fileStateListeners.ts`): `session-files:updated`, `git:status-changed`, `history:pending-count-changed`
- **Session list** (`store/listeners/sessionListListeners.ts`): `sessions:refresh-list`, `sessions:session-updated`, `session-linked-tracker-changed`, `worktree:session-created`
- **Session state** (`store/sessionStateListeners.ts`): `transcript:event`, `ai:message-logged`, `session:title-updated`, `ai:askUserQuestion(+Answered)`, `ai:sessionCancelled`, `ai:exitPlanModeConfirm(+Resolved)`, `ai:toolPermission(+Resolved)`, `ai:gitCommitProposal(+Resolved)`, `notification-clicked`, `sessions:sync-read-state`, `sessions:sync-draft-input`
- **Session transcript** (`store/listeners/sessionTranscriptListeners.ts`): `ai:tokenUsageUpdated`, `ai:error`, `ai:streamResponse`, `ai:promptAdditions`, `ai:queuedPromptsReceived`
- **Super loop** (`store/listeners/superLoopListeners.ts`): `super-loop:event`, `super-loop:iteration-prompt`, `ai:streamResponse`, `ai:error`
- **Claude usage** (`store/listeners/claudeUsageListeners.ts`): `claude-usage:update`
- **Codex usage** (`store/listeners/codexUsageListeners.ts`): `codex-usage:update`
- **File tree** (`store/listeners/fileTreeListeners.ts`): `workspace-file-tree-updated`
- **Voice mode** (`store/listeners/voiceModeListeners.ts`): all `voice-mode:*` events
- **Theme** (`store/listeners/themeListeners.ts`): `theme-change` -> `themeIdAtom`
- **Permissions** (`store/listeners/permissionListeners.ts`): `permissions:changed` -> `permissionsChangedVersionAtom` (counter; consumers re-fetch)
- **Sync** (`store/listeners/syncListeners.ts`): `sync:status-changed` -> `syncStatusUpdateAtom`
- **Update toast** (`store/listeners/updateListeners.ts`): all `update-toast:*` events
- **Tracker sync** (`store/listeners/trackerSyncListeners.ts`): `document-service:tracker-items-changed`, `document-service:metadata-changed`
- **Network availability** (`store/listeners/networkAvailabilityListeners.ts`): `sync:network-available`
- **Tray** (`store/listeners/trayListeners.ts`): `tray:navigate-to-session`, `tray:new-session`, `sync:config-updated`
- **Wakeup** (`store/listeners/wakeupListener.ts`): `wakeup:changed`
- **MCP** (`store/listeners/mcpListeners.ts`): `mcp-config:test-progress` -> `mcpTestProgressAtom`
- **Walkthrough** (`store/listeners/walkthroughListeners.ts`): `trigger-walkthrough`, `reset-walkthroughs`, `trigger-tip`, `reset-tips`
- **Notifications** (`store/listeners/notificationListeners.ts`): `notifications:check-active-session` (responds via send, no atom needed)
- **AI command** (`store/listeners/aiCommandListeners.ts`): `ai:promptClaimed` (re-dispatched as DOM CustomEvent)
- **Terminals** (`store/atoms/terminals.ts`, module-level init): `terminal:list-changed`

### Command listeners (counter or request atoms)

- **App commands** (`store/listeners/appCommandListeners.ts`): menu/main-process commands -- `file-new-mockup`, `toggle-ai-chat-panel`, `file-save`, `show-unified-onboarding`, `show-windows-claude-code-warning`, `open-navigation-dialog`, `navigation:go-back`/`go-forward`, `extension-marketplace:install-request`, `set-content-mode`, `agent:insert-plan-reference`, `show-project-selection-dialog`, `show-discord-invitation`, `show-trust-toast`, `show-session-import-dialog`, `show-extension-project-intro-dialog`, `show-figma-mcp-migration`, `confirm-close-unsaved`, `close-active-tab`, `reopen-last-closed-tab`
- **Menu commands** (`store/listeners/menuCommandListeners.ts`): `menu:find`, `menu:find-next`, `menu:find-previous` -> counter atoms; `useIPCHandlers` reacts and routes per active mode
- **Sound commands** (`store/listeners/soundListeners.ts`): `play-completion-sound`, `play-permission-sound` (plays sound directly; no atom)

### Per-key atom families

- **File watch** (`store/listeners/fileChangeListeners.ts`): `file-changed-on-disk` -> `fileChangedOnDiskAtomFamily(path)`, `history:pending-tag-created` -> `historyPendingTagCreatedAtomFamily(path)`. Backing stores like `DiskBackedStore` subscribe via `store.sub` with their own file path.

## When Adding New IPC Events

1. Create or extend a centralized listener file in `store/listeners/`
2. Initialize it in `App.tsx` alongside the other `init*Listeners()` calls (one shared `useEffect` registers them all)
3. Update atoms from the listener, never from components
4. Add debouncing if events can fire rapidly (e.g., file system watchers, sync events)
5. Decide which atom shape fits the use case (state vs counter vs request vs per-key family) -- see "Reaction patterns" above

## File Structure

```
packages/electron/src/renderer/store/
  listeners/
    aiCommandListeners.ts
    appCommandListeners.ts
    claudeUsageListeners.ts
    codexUsageListeners.ts
    fileChangeListeners.ts
    fileStateListeners.ts
    fileTreeListeners.ts
    mcpListeners.ts
    menuCommandListeners.ts
    networkAvailabilityListeners.ts
    notificationListeners.ts
    permissionListeners.ts
    sessionListListeners.ts
    sessionTranscriptListeners.ts
    soundListeners.ts
    superLoopListeners.ts
    syncListeners.ts
    themeListeners.ts
    trackerSyncListeners.ts
    trayListeners.ts
    updateListeners.ts
    voiceModeListeners.ts
    wakeupListener.ts
    walkthroughListeners.ts
  atoms/
    (state atoms updated by listeners)
  sessionStateListeners.ts
```

## Approved exceptions

These remain `electronAPI.on(...)` callers because they are infrastructure, not state-replicating UI:

- `plugins/registerExtensionSystem.ts` -- request/response RPC handlers (`screenshot:capture`, `editor:capture-screenshot`, `extension:get-status`, `renderer:eval`, `extension-test:open-file`, `extension-test:ai-tool`)
- `services/RendererDocumentService.ts` -- singleton document service with its own lifecycle
- `extensions/panels/PanelHostImpl.ts` -- generic event pass-through exposed to extensions; the channel is supplied by the extension at runtime, so it cannot be enumerated up front
- `store/atoms/terminals.ts` -- module-level init that runs once

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `useEffect` with `electronAPI.on()` in a component | Race conditions, stale closures | Use centralized listener |
| Multiple components subscribing to same event | MaxListenersExceededWarning | Single listener updates atom |
| Component-local state from IPC | State lost on unmount | Store in atom |
| No debouncing on rapid events | Performance issues | Debounce in listener |
| Reacting to a counter/request atom without skipping the initial mount value | Side effect runs on every refresh, not just on the IPC event | Capture the initial value in a ref and bail out when it matches |
