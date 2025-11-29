# Memory Management Implementation

## Problem

The collabv2 Y.js sync server was experiencing JavaScript heap out of memory errors when handling multiple large AI chat sessions. Each Durable Object loaded the entire Y.Doc into memory on startup and kept it there indefinitely, causing memory exhaustion with documents ranging from 200KB to 1.6MB.

## Solution

Implemented intelligent memory management with lazy loading, size limits, and automatic eviction:

### 1. Lazy Loading

Documents are **not loaded on Durable Object creation**. Instead, they load on-demand when the first client connects:

- **Before**: Each DO immediately loaded full Y.Doc snapshot (~1.6MB each)
- **After**: DOs start empty and only load when needed
- **Benefit**: Inactive sessions consume minimal memory

### 2. Size Limits and Warnings

Added configurable thresholds for document sizes:

```typescript
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  maxDocumentSizeBytes: 10 * 1024 * 1024,  // 10MB max per document
  warnThresholdBytes: 5 * 1024 * 1024,     // 5MB warning threshold
  evictionTimeoutMs: 5 * 60 * 1000,        // 5 minutes idle before eviction
  enableLazyLoading: true,                  // Load on-demand by default
};
```

**Document loading behavior:**
- Documents > 10MB: Rejected, create empty doc (preserves write capability)
- Documents > 5MB: Logged as warning
- All loads: Logged with size in bytes and MB

### 3. Automatic Eviction

Idle documents are automatically evicted from memory:

- **Alarm system**: Checks every 60 seconds
- **Eviction criteria**: No connected clients + idle > 5 minutes
- **Safe eviction**: Always saves dirty state before evicting
- **Reload on demand**: Evicted documents reload when clients reconnect

### 4. Activity Tracking

All WebSocket messages update `lastActivityTime`, enabling accurate idle detection:

```typescript
async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
  this.lastActivityTime = Date.now();  // Track activity
  // ... rest of message handling
}
```

### 5. Enhanced Status Endpoint

The `/status` endpoint now includes memory diagnostics:

```json
{
  "documentId": "userId:sessionId",
  "connectedClients": 2,
  "documentLoaded": true,
  "documentSizeBytes": 1693306,
  "documentSizeMB": "1.61",
  "idleTimeMs": 12500,
  "memoryConfig": {
    "maxDocumentSizeBytes": 10485760,
    "warnThresholdBytes": 5242880,
    "evictionTimeoutMs": 300000,
    "enableLazyLoading": true
  }
}
```

## Architecture Changes

### Before
```
DO Creation → Load full Y.Doc → Keep in memory forever → OOM
```

### After
```
DO Creation → Empty state
           ↓
First client connects → Load Y.Doc (if under limits)
           ↓
Process messages → Update lastActivityTime
           ↓
Clients disconnect → Start idle timer
           ↓
Idle timeout → Save state → Evict document → Free memory
           ↓
New client connects → Reload Y.Doc → Resume sync
```

## Configuration

Memory limits can be adjusted by modifying `DEFAULT_MEMORY_CONFIG` in `src/persistence.ts`:

- **`maxDocumentSizeBytes`**: Absolute maximum document size to load
- **`warnThresholdBytes`**: Size that triggers warnings (for monitoring)
- **`evictionTimeoutMs`**: How long to wait before evicting idle documents
- **`enableLazyLoading`**: Toggle lazy loading (set to `false` for eager loading)

## Monitoring

The system logs memory-related events:

```
✓ Loaded snapshot for <id>, size: 1693306 bytes (1.61MB)
⚠ Large document <id>: 5.23MB (warning threshold: 5.00MB)
✗ Document <id> exceeds max size: 12.45MB > 10.00MB
ℹ Evicting idle document <id> to free memory
```

## Scaling Characteristics

With these changes, the server can handle:

- **Thousands of sessions**: Only active sessions consume memory
- **Large documents**: Up to 10MB per session (configurable)
- **Long-running sessions**: Inactive sessions automatically evicted
- **Burst traffic**: Documents load on-demand as clients connect

## Testing

To test the implementation:

1. **Check status**: `curl http://localhost:8787/sync/session-id/status`
2. **Monitor logs**: Watch for load/evict messages
3. **Connect/disconnect**: Verify documents evict after timeout
4. **Large docs**: Test with sessions > 5MB to see warnings

## D1 Size Limits and Compression

### The Challenge

Cloudflare D1 has a **2MB maximum BLOB size limit** ([documentation](https://developers.cloudflare.com/d1/platform/limits/)), which is much smaller than standard SQLite's 1GB limit. Large AI chat sessions can easily exceed this limit, causing `SQLITE_TOOBIG` errors.

### The Solution: Automatic Compression

The persistence layer now automatically compresses large snapshots using gzip compression:

- **Threshold**: Snapshots > 1.5MB are automatically compressed
- **Compression**: Uses native Web Streams API `CompressionStream('gzip')`
- **Transparent**: Decompression happens automatically on load
- **Fallback**: If compression doesn't help, the system throws a clear error

**Typical compression ratios for Y.js documents:**
- Text-heavy chat sessions: 70-80% reduction
- Mixed content (code + text): 60-70% reduction
- Binary-heavy content: 20-40% reduction

**Database schema:**
```sql
ALTER TABLE ydoc_snapshots ADD COLUMN compressed INTEGER DEFAULT 0 NOT NULL;
```

The `compressed` flag (0 or 1) indicates whether the `state_vector` BLOB is gzip-compressed.

### Monitoring Compression

The system logs compression events:

```
✓ Compressed snapshot for <id>: 3.45MB → 0.82MB (76.2% reduction)
⚠ Large snapshot for <id>: 1.61MB (approaching D1 limit of 2MB) [compressed]
✗ Cannot save snapshot for <id>: size 2.34MB exceeds D1 BLOB limit of 2MB even after compression
```

### When Compression Isn't Enough

If a session still exceeds 2MB after compression, consider:

1. **Session archival**: Archive old messages and start a fresh session
2. **Message pruning**: Remove old messages from Y.Doc (requires app-level logic)
3. **Chunking strategy**: Split very large sessions into multiple D1 rows (future enhancement)

## Future Improvements

Potential enhancements for even better scaling:

1. **Incremental loading**: Load only recent messages, fetch history on-demand
2. **Chunked storage**: Split very large documents across multiple D1 rows
3. **Archival tier**: Move very old messages to separate storage (R2)
4. **Memory pressure API**: React to system memory constraints
5. **Metrics**: Export memory usage to observability platform
6. **Better compression**: Experiment with brotli or custom Y.js-aware compression
