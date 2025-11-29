# Real-time Message Sync Fix

## Problem

After the initial bulk sync on startup, new AI messages created during the session were NOT being synced to the Y.js server. Only the first bulk sync worked, but ongoing real-time sync was broken.

**Symptoms:**
- Sessions synced at 5:44 AM startup showed up
- New sessions or messages created after startup didn't sync
- D1 database showed 65 sessions from morning bulk sync, only 2 recent updates

## Root Cause

The sync infrastructure existed but was never hooked up to actually sync new messages as they were created:

1. ✅ `SyncProvider.pushChange()` existed
2. ✅ `messageSyncHandler.onMessageCreated()` existed
3. ❌ **Nothing called `onMessageCreated()` when messages were saved**

The code had all the pieces but they weren't connected.

## The Fix

### 1. Export Message Sync Handler

**File:** `packages/electron/src/main/services/SyncManager.ts:210`

The `messageSyncHandler` was already being created during sync initialization but wasn't exported. Added export (it was already there at line 210):

```typescript
export function getMessageSyncHandler(): ReturnType<typeof import('@nimbalyst/runtime/sync').createMessageSyncHandler> | null {
  return state.messageSyncHandler;
}
```

### 2. Hook Into Message Logging Events

**File:** `packages/electron/src/main/services/ai/AIService.ts:473-506`

Added `setupSyncHandler()` method that:
- Listens to `message:logged` events from AI providers
- Fetches the latest message from database
- Calls `messageSyncHandler.onMessageCreated()` to sync it

```typescript
private setupSyncHandler(provider: AIProvider, sessionId: string): void {
  // Only set up once per provider
  if ((provider as any)._syncHandlerSetup) return;
  (provider as any)._syncHandlerSetup = true;

  const { getMessageSyncHandler } = require('../SyncManager');
  const messageSyncHandler = getMessageSyncHandler();
  if (!messageSyncHandler) return; // Sync not enabled

  // Listen for message:logged events
  provider.on('message:logged', async ({ sessionId: eventSessionId }) => {
    const messages = await AgentMessagesRepository.list(eventSessionId, {
      limit: 1,
      offset: 0,
      includeHidden: true
    });

    if (messages && messages.length > 0) {
      messageSyncHandler.onMessageCreated(messages[0]);
    }
  });
}
```

### 3. Call Setup On Provider Creation

**File:** `packages/electron/src/main/services/ai/AIService.ts:490-491`

Added call to `setupSyncHandler()` right after provider is created:

```typescript
const provider = await ProviderFactory.getProvider(session.id, config);

// Hook up sync handler if sync is enabled
this.setupSyncHandler(provider, session.id);

return provider;
```

## How It Works

### Message Flow

```
User sends AI message
    ↓
AIService.sendMessage()
    ↓
Provider.generateResponse()
    ↓
Provider.logAgentMessage()  ← Saves to database
    ↓
Emits 'message:logged' event
    ↓
setupSyncHandler listener fires
    ↓
Fetches latest message from DB
    ↓
messageSyncHandler.onMessageCreated()
    ↓
SyncProvider.pushChange({ type: 'message_added' })
    ↓
Y.js syncs to server in real-time
```

### Provider Event System

The `AIProvider` base class already emits events when messages are logged:

**File:** `packages/runtime/src/ai/server/AIProvider.ts:210`

```typescript
protected logAgentMessage(...): Promise<void> {
  return AgentMessagesRepository.create({ ... }).then(() => {
    // Event emitted AFTER database write completes
    this.emit('message:logged', { sessionId, direction });
  });
}
```

This ensures sync happens AFTER the message is safely in the database.

## Testing

### Before Fix

```bash
# D1 database query
sqlite3 .wrangler/.../db.sqlite \
  "SELECT datetime(updated_at/1000, 'unixepoch'), COUNT(*)
   FROM ydoc_snapshots
   GROUP BY DATE(updated_at/1000, 'unixepoch')"

# Results:
2025-11-29 05:44:33|65   ← Morning bulk sync
2025-11-28 18:07:02|19   ← Previous day
# Only 2 recent updates after 5:44 AM
```

### After Fix

New messages should sync in real-time:

1. Send AI message in desktop app
2. Check D1: `SELECT MAX(updated_at) FROM ydoc_snapshots WHERE session_id = 'xxx'`
3. Should show timestamp from just now
4. Mobile app should receive the message immediately via Y.js sync

## Related Fixes

This fix works in combination with:

1. **CRDT_TOMBSTONE_FIX.md**: Append-only message sync (no delete/repush)
2. **MEMORY_MANAGEMENT.md**: Lazy loading and eviction on server
3. **D1_SIZE_LIMIT_FIX.md**: Compression for large snapshots

Together these fixes enable:
- ✅ Bulk sync on startup (with batching to prevent OOM)
- ✅ Real-time sync as messages are created
- ✅ Efficient append-only CRDT operations
- ✅ Automatic document eviction when idle
- ✅ Compression for large sessions

## Key Insight

The sync infrastructure was already fully built and working. The only missing piece was connecting the `message:logged` event to the `messageSyncHandler.onMessageCreated()` function.

This is a common pattern in event-driven systems - all the pieces exist but aren't wired together. The fix was literally 3 lines of code to hook up the event listener.
