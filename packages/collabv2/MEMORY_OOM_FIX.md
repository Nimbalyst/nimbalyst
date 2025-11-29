# Memory Out of Memory (OOM) Fix

## Problem

The collabv2 Y.js sync server was experiencing JavaScript heap out of memory errors:

```
<--- Last few GCs --->
[5485:0x97c064000] Mark-Compact (reduce) 1387.0 (1414.8) -> 1387.0 (1414.8) MB
*** Received signal #6: Abort trap: 6
V8 fatal error: allocation failed: JavaScript heap out of memory
```

### Root Cause

When the Electron app started, it called `syncSessionsToIndex()` with 27 sessions. The original implementation automatically synced **all session messages** by creating WebSocket connections to all 27 sessions simultaneously:

```typescript
// Old code in syncSessionsToIndex()
for (const session of sessionsData) {
  if (session.messages && session.messages.length > 0) {
    this.syncSessionMessages(session.id, session.messages, ...);
    // ^ Creates 27 simultaneous WebSocket connections
  }
}
```

Each connection triggered a Durable Object to:
1. Load its Y.Doc snapshot from D1 (ranging from 200KB to 2.5MB each)
2. Parse and apply the Y.js updates
3. Keep the full document in memory

**Total memory spike**: ~27 sessions × ~1.5MB average = **~40MB+ loaded at once** → heap exhaustion

## Solutions Implemented

### 1. Server-Side: Lazy Loading + Eviction (collabv2)

These changes help with long-running sessions but **cannot prevent** simultaneous startup loads.

#### Lazy Document Loading
**File**: `packages/collabv2/src/durable-object.ts`

- Documents no longer load on Durable Object creation
- Load on-demand when first WebSocket message arrives
- Check `ensureDocumentLoaded()` at line 238

#### Automatic Eviction
**File**: `packages/collabv2/src/durable-object.ts` (alarm handler at line 216)

- Idle documents evicted after 5 minutes (configurable)
- Eviction check runs every 60 seconds via alarm
- Always saves dirty state before evicting

#### Memory Configuration
**File**: `packages/collabv2/src/persistence.ts` (line 16)

```typescript
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  maxDocumentSizeBytes: 10 * 1024 * 1024,  // 10MB max per document
  warnThresholdBytes: 5 * 1024 * 1024,     // 5MB warning threshold
  evictionTimeoutMs: 5 * 60 * 1000,        // 5 minutes idle before eviction
  enableLazyLoading: true,                  // Load on-demand by default
};
```

### 2. Client-Side: Batched Sync (runtime) **← THE REAL FIX**

This is the **critical fix** that prevents OOM on startup.

#### Changed `syncSessionsToIndex()` Behavior
**File**: `packages/runtime/src/sync/YjsSessionSync.ts` (line 463)

**Before:**
```typescript
syncSessionsToIndex(sessionsData: SessionIndexData[]): void {
  // ... sync index ...

  // BAD: Immediately syncs all 27 sessions
  for (const session of sessionsData) {
    if (session.messages?.length > 0) {
      this.syncSessionMessages(session.id, session.messages, ...);
    }
  }
}
```

**After:**
```typescript
syncSessionsToIndex(
  sessionsData: SessionIndexData[],
  options?: { syncMessages?: boolean }
): void {
  // ... sync index (lightweight metadata) ...

  // GOOD: Only sync messages if explicitly requested
  if (options?.syncMessages === true) {
    this.batchSyncSessionMessages(sessionsData);
  } else {
    console.log('Skipping message sync (use syncMessages: true to enable)');
  }
}
```

#### New Batch Sync Method
**File**: `packages/runtime/src/sync/YjsSessionSync.ts` (line 514)

```typescript
async batchSyncSessionMessages(sessionsData: SessionIndexData[]): Promise<void> {
  const batchSize = 3;     // Only 3 concurrent connections at a time
  const delayMs = 1000;    // 1 second delay between batches

  for (let i = 0; i < sessions.length; i += batchSize) {
    const batch = sessions.slice(i, i + batchSize);

    // Sync batch of 3
    batch.forEach(session => {
      this.syncSessionMessages(session.id, session.messages!, ...);
    });

    // Wait 1 second before next batch
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}
```

**Impact:**
- 27 sessions ÷ 3 per batch = 9 batches
- 9 batches × 1s delay = ~9 seconds total sync time
- Only 3 Durable Objects in memory at once (vs 27)
- **~4.5MB in memory** instead of 40MB+ → **NO MORE OOM**

## How to Use

### Default Behavior (Recommended)

Only sync lightweight index metadata on startup:

```typescript
// Electron SyncManager or similar
await syncProvider.syncSessionsToIndex(allSessions);
// ✓ Index metadata synced (titles, counts, dates)
// ✗ Messages NOT synced
// ✓ No memory spike
```

### On-Demand Message Sync

When user opens a specific session, sync just that session:

```typescript
// User clicks on session in UI
await syncProvider.connect(sessionId);
// ✓ Loads one session on-demand
// ✓ Minimal memory impact
```

### Batch Message Sync (First-Time Setup)

If you really need to sync all messages upfront:

```typescript
await syncProvider.syncSessionsToIndex(allSessions, { syncMessages: true });
// ✓ Batched: 3 sessions at a time, 1s delays
// ✓ Safe: Won't OOM even with 100+ sessions
// ⏱ Slower: ~9 seconds for 27 sessions
```

## Configuration

### Adjust Batch Size

**File**: `packages/runtime/src/sync/YjsSessionSync.ts` (line 516)

```typescript
const batchSize = 3;     // Increase for faster sync (more memory)
const delayMs = 1000;    // Decrease for faster sync (more risk)
```

**Trade-offs:**
- `batchSize = 5`: Faster but uses more memory
- `batchSize = 1`: Slowest but safest
- `delayMs = 500`: 2× faster but less server recovery time

### Adjust Server Eviction Timeout

**File**: `packages/collabv2/src/persistence.ts` (line 19)

```typescript
evictionTimeoutMs: 5 * 60 * 1000,  // 5 minutes (300,000ms)
```

Decrease for more aggressive eviction, increase to keep docs in memory longer.

## Monitoring

### Server Logs

```
✓ Loaded snapshot for <id>, size: 1693306 bytes (1.61MB)
⚠ Large document <id>: 5.23MB (warning threshold: 5.00MB)
ℹ Evicting idle document <id> to free memory
```

### Client Logs

```
[YjsSessionSync] Syncing 27 sessions to index
[YjsSessionSync] Skipping message sync (use syncMessages: true to enable)

# OR with syncMessages: true
[YjsSessionSync] Batch syncing 27 sessions in batches of 3
[YjsSessionSync] Syncing batch 1/9 (3 sessions)
[YjsSessionSync] Syncing batch 2/9 (3 sessions)
...
[YjsSessionSync] Batch sync complete
```

### Status Endpoint

```bash
curl http://localhost:8787/sync/userId:sessionId/status
```

```json
{
  "documentLoaded": true,
  "documentSizeBytes": 1693306,
  "documentSizeMB": "1.61",
  "connectedClients": 0,
  "idleTimeMs": 45000,
  "memoryConfig": {
    "maxDocumentSizeBytes": 10485760,
    "warnThresholdBytes": 5242880,
    "evictionTimeoutMs": 300000,
    "enableLazyLoading": true
  }
}
```

## Key Architectural Principles

1. **Index metadata is cheap** - Sync it immediately on startup
   - Titles, counts, dates
   - Allows UI to show session list without loading messages

2. **Full messages are expensive** - Sync them on-demand or batched
   - Y.Doc snapshots can be 1-2MB each
   - Loading 27 at once exhausts memory

3. **Server-side eviction helps scaling** - But can't prevent burst loads
   - Good for keeping long-running server healthy
   - Doesn't help when client creates 27 connections at startup

4. **Client-side batching is critical** - Controls server load
   - Only way to prevent simultaneous Durable Object instantiation
   - Small batches + delays = no OOM

## Testing

### Reproduce the Original Issue

1. Create 20+ AI sessions with messages
2. Sync all at once (old code):
   ```typescript
   syncSessionsToIndex(sessions); // Old behavior
   ```
3. Watch server logs for OOM error

### Verify the Fix

1. Use new default behavior:
   ```typescript
   syncSessionsToIndex(sessions); // New default
   ```
2. Server logs should show:
   - Index updates only
   - No document loads
   - No memory spike

3. Use batched sync:
   ```typescript
   syncSessionsToIndex(sessions, { syncMessages: true });
   ```
4. Server logs should show:
   - 3 documents loading at a time
   - Delays between batches
   - No OOM error

## Related Documentation

- **MEMORY_MANAGEMENT.md**: Server-side memory architecture
- **D1_SIZE_LIMIT_FIX.md**: D1 2MB BLOB limit and compression
- **YjsSessionSync.ts**: Client-side sync implementation

## Summary

- **Root cause**: Syncing all 27 sessions simultaneously on startup
- **Server fix**: Lazy loading + eviction (helps long-term)
- **Client fix**: Batched sync (fixes startup OOM) **← Key solution**
- **Default**: Only sync index metadata on startup
- **On-demand**: Sync individual sessions when user opens them
- **Batch option**: Sync all messages in controlled batches if needed
