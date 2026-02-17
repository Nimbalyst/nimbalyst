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

## Already Implemented

DO NOT add component-level IPC subscriptions for these events:

- **File state** (`store/listeners/fileStateListeners.ts`): `session-files:updated`, `git:status-changed`, `history:pending-count-changed`
- **Session list** (`store/listeners/sessionListListeners.ts`): `sessions:refresh-list` (with 150ms debouncing)
- **Session state** (`store/sessionStateListeners.ts`): Session-level state updates
- **Session transcript** (`store/listeners/sessionTranscriptListeners.ts`): Message reloads
- **Claude usage** (`store/listeners/claudeUsageListeners.ts`): Usage tracking
- **File tree** (`store/listeners/fileTreeListeners.ts`): `workspace-file-tree-updated` → `rawFileTreeAtom`

## When Adding New IPC Events

1. Create or extend a centralized listener file in `store/listeners/`
2. Initialize it in `AgentMode.tsx` or appropriate top-level component
3. Update atoms from the listener, never from components
4. Add debouncing if events can fire rapidly (e.g., file system watchers, sync events)

## File Structure

```
packages/electron/src/renderer/store/
  listeners/
    fileStateListeners.ts
    sessionListListeners.ts
    sessionTranscriptListeners.ts
    claudeUsageListeners.ts
    ...
  atoms/
    (state atoms updated by listeners)
  sessionStateListeners.ts
```

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `useEffect` with `electronAPI.on()` | Race conditions, stale closures | Use centralized listener |
| Multiple components subscribing to same event | MaxListenersExceededWarning | Single listener updates atom |
| Component-local state from IPC | State lost on unmount | Store in atom |
| No debouncing on rapid events | Performance issues | Debounce in listener |
