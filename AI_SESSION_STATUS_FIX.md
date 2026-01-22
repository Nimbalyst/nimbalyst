# AI Session Status Tracking Fix

## Problem Statement

After migrating from the old `AgenticPanel` (React useState-based) to the new Jotai-based architecture (`AgentMode` + workstreams), AI session status tracking was broken:

### Symptoms
1. **Processing indicators not working**: Sessions show as idle when they're actually running
2. **Message synchronization issues**: Messages appear in mobile app but not in Electron desktop
3. **Stuck "running" state**: Sometimes sessions appear to be running forever

## Root Cause Analysis

### What Was Lost in the Migration

The old `AgenticPanel.tsx` had comprehensive session state listeners that were NOT migrated to the new architecture:

```typescript
// OLD CODE (AgenticPanel.tsx - lines 480-493)
const handleStateChange = (event: any) => {
  switch (event.type) {
    case 'session:started':
    case 'session:streaming':
    case 'session:waiting':
      store.set(sessionProcessingAtom(event.sessionId), true);
      break;
    case 'session:completed':
    case 'session:error':
    case 'session:interrupted':
      store.set(sessionProcessingAtom(event.sessionId), false);
      break;
  }
};
window.electronAPI.sessionState.onStateChange(handleStateChange);
```

### Why This Matters

1. **Processing State**: The `sessionProcessingAtom` is used by:
   - `SessionListItem` to show processing indicators (spinning icon)
   - `workstreamProcessingAtom` for workstream-level indicators
   - Input components to disable/enable send buttons

2. **Message Synchronization**: Without global listeners:
   - Only the active `SessionTranscript` component receives message updates
   - Inactive child sessions don't reload when they receive new messages
   - This causes the desktop/mobile discrepancy (mobile queries DB directly, desktop relies on atoms)

## Solution

Created a centralized session state listener module that:

### 1. Session Processing State (`sessionStateListeners.ts`)

Global listener that updates `sessionProcessingAtom` for ALL sessions:

```typescript
const handleStateChange = (event) => {
  switch (event.type) {
    case 'session:started':
    case 'session:streaming':
    case 'session:waiting':
      store.set(sessionProcessingAtom(event.sessionId), true);
      break;
    case 'session:completed':
    case 'session:error':
    case 'session:interrupted':
      store.set(sessionProcessingAtom(event.sessionId), false);
      break;
  }
};
```

### 2. Global Message Reload

Ensures all sessions reload when they receive messages, not just the active one:

```typescript
const handleMessageLogged = (data: { sessionId: string; direction: string }) => {
  const workspacePath = store.get(sessionListWorkspaceAtom);
  store.set(reloadSessionDataAtom, { sessionId, workspacePath });
};
```

This fixes the issue where:
- Child sessions in a workstream don't show new messages
- Inactive tabs don't update when they receive messages
- Mobile shows messages but desktop doesn't (mobile queries DB, desktop uses atoms)

### 3. Enhanced Logging

Added debug logging to track issues:
- Session state changes logged with session ID
- Message reload operations logged with message counts
- Clear indication when sessions load vs reload

### 4. Performance Optimization

Fixed severe performance issue where the transcript re-rendered on every keystroke:

**Problem**: `SessionTranscript` must re-render on every keystroke (for controlled input), but it was causing the expensive `AgentTranscriptPanel` to re-render too.

**Solution**:
1. Created derived atoms (`sessionMessagesAtom`, `sessionProviderAtom`, `sessionTokenUsageAtom`) so components subscribe only to fields they need
2. Wrapped `AgentTranscriptPanel` with `React.memo` and custom comparison function
3. Comparison function checks only the props that affect rendering (messages, provider, metadata, etc.)

This ensures that typing in the input only re-renders the input component, not the entire message transcript (which could have 694+ messages).

## Files Changed

1. **NEW**: `packages/electron/src/renderer/store/sessionStateListeners.ts`
   - Centralized session state and message listeners
   - Replaces scattered logic from old AgenticPanel

2. **MODIFIED**: `packages/electron/src/renderer/components/AgentMode/AgentMode.tsx`
   - Added `initSessionStateListeners()` call in useEffect
   - Ensures listeners are initialized once per app instance

3. **MODIFIED**: `packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx`
   - Enhanced `ai:message-logged` handler to reload on both input/output
   - Use derived atoms (sessionMessagesAtom, sessionProviderAtom, sessionTokenUsageAtom) instead of full sessionData
   - Prevents re-renders when unrelated sessionData fields change
   - Added logging for debugging

4. **MODIFIED**: `packages/electron/src/renderer/store/atoms/sessions.ts`
   - Added comprehensive logging to `reloadSessionDataAtom`
   - Added derived atoms: `sessionMessagesAtom`, `sessionProviderAtom`, `sessionTokenUsageAtom`
   - Helps diagnose message synchronization issues

5. **MODIFIED**: `packages/runtime/src/ui/AgentTranscript/components/AgentTranscriptPanel.tsx`
   - Wrapped component with React.memo to prevent unnecessary re-renders
   - Custom comparison function only re-renders when messages/provider/metadata actually change
   - Fixes performance issue where transcript re-rendered on every keystroke

## Testing

### Before Testing
1. Build and start Nimbalyst in development mode
2. Open AgentMode (Cmd+Shift+A)
3. Create or open a session

### Test Cases

#### 1. Processing Indicators
- [ ] Send a message to a session
- [ ] Verify spinning indicator appears in session list
- [ ] Verify indicator disappears when response completes
- [ ] For workstreams, verify parent shows processing when any child is running

#### 2. Message Synchronization
- [ ] Create a workstream with 2 child sessions
- [ ] Send message to Session A (active)
- [ ] Switch to Session B
- [ ] Send message to Session B
- [ ] Switch back to Session A - verify messages appear
- [ ] Check mobile app - verify same messages appear

#### 3. Error Handling
- [ ] Cancel a running session (Cmd+.)
- [ ] Verify processing state clears
- [ ] Verify session shows error message
- [ ] Send another message - verify it works

### Expected Console Output

```
[sessionStateListeners] Subscribed to session state changes
[sessionStateListeners] Subscribed to message-logged events
[sessionStateListeners] State change: session:started for session: abc-123
[sessionStateListeners] message-logged: output for session: abc-123
[reloadSessionDataAtom] Loading session: abc-123
[reloadSessionDataAtom] Loaded session data - DB messages: 5 Current messages: 4
[reloadSessionDataAtom] After merge - DB: 5 Local-only: 0 Total: 5
[sessionStateListeners] State change: session:completed for session: abc-123
```

## Cleanup After Verification

Once testing confirms everything works:

1. Remove debug logging from:
   - `sessionStateListeners.ts` (console.log statements)
   - `sessions.ts` reloadSessionDataAtom (console.log statements)
   - `SessionTranscript.tsx` message-logged handler (console.log statement)

2. Keep only error logging (console.error/warn)

## Architecture Notes

### Why Not in SessionTranscript?

`SessionTranscript` is only mounted for the active session. Listeners there won't catch:
- Messages for inactive child sessions in workstreams
- Messages for sessions in background tabs
- State changes for sessions not currently visible

### Why Global in AgentMode?

`AgentMode` is the top-level container for all AI sessions. Initializing listeners there ensures:
- Single subscription per app instance (not per session)
- Covers all sessions regardless of visibility
- Cleanup happens when AgentMode unmounts

### Relationship to Old Code

This is essentially extracting the session state logic from `AgenticPanel.tsx` (deprecated) into a reusable module that works with the new Jotai-based architecture.

## Related Files

- `/Users/ghinkle/sources/stravu-editor/nimbalyst-local/plans/unified-session-architecture.md` - Architecture plan
- `/Users/ghinkle/sources/stravu-editor/packages/electron/src/renderer/components/UnifiedAI/AgenticPanel.tsx` - Old code (deprecated)
- `/Users/ghinkle/sources/stravu-editor/packages/electron/src/renderer/store/atoms/sessions.ts` - Session atom definitions
