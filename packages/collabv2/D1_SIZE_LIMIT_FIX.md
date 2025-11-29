# D1 SQLITE_TOOBIG Error Fix

## Problem

The collabv2 Y.js sync server was encountering `SQLITE_TOOBIG` errors when trying to save large AI chat sessions to Cloudflare D1:

```
Error: D1_ERROR: string or blob too big: SQLITE_TOOBIG
```

## Root Cause

Cloudflare D1 has a **2MB maximum BLOB size limit** ([documentation](https://developers.cloudflare.com/d1/platform/limits/)), which is significantly smaller than standard SQLite's ~1GB limit. Large AI chat sessions with extensive conversation history can easily exceed this 2MB limit.

The original implementation:
- Loaded documents up to 10MB from D1
- Had NO size validation when SAVING to D1
- Would fail with cryptic SQLITE_TOOBIG errors when attempting to save large snapshots

## Solution

Implemented automatic gzip compression with size validation:

### 1. Added Compression Support

```typescript
// New compression functions using Web Streams API
async function compressData(data: Uint8Array): Promise<Uint8Array>
async function decompressData(compressed: Uint8Array): Promise<Uint8Array>
```

Uses the native `CompressionStream('gzip')` API available in Cloudflare Workers.

### 2. Automatic Compression

The `saveSnapshot()` function now:
- Checks if snapshot exceeds 1.5MB warning threshold
- Automatically attempts gzip compression
- Uses compressed version if it's smaller AND fits within 2MB limit
- Logs compression ratio for monitoring
- Throws clear error if even compressed data exceeds 2MB

### 3. Transparent Decompression

The `loadSnapshot()` function:
- Reads new `compressed` flag from database
- Automatically decompresses gzip data when loading
- Backwards compatible with existing uncompressed snapshots

### 4. Database Migration

Added new migration `0002_add_compression.sql`:

```sql
ALTER TABLE ydoc_snapshots ADD COLUMN compressed INTEGER DEFAULT 0 NOT NULL;
CREATE INDEX idx_compressed ON ydoc_snapshots(compressed);
```

The `compressed` column tracks whether each snapshot is gzip-compressed (0 = no, 1 = yes).

### 5. Enhanced Error Handling

The Durable Object now handles size limit errors gracefully:
- Detects when documents exceed limits even after compression
- Logs critical warnings but keeps document operational in memory
- Prevents repeated failed save attempts
- Documents continue to sync between devices even if persistence fails

## Expected Compression Ratios

Based on Y.js document characteristics:

- **Text-heavy chat sessions**: 70-80% reduction (typical AI chat)
- **Mixed content (code + text)**: 60-70% reduction
- **Binary-heavy content**: 20-40% reduction

For example:
- 3.5MB uncompressed → ~0.8MB compressed (77% reduction)
- 2.5MB uncompressed → ~0.6MB compressed (76% reduction)

## Changes Made

### Files Modified

1. **`src/persistence.ts`**:
  - Added compression/decompression functions
  - Updated `saveSnapshot()` with automatic compression
  - Updated `loadSnapshot()` with automatic decompression
  - Added size validation and detailed logging
  - Set correct D1 limits: 2MB max, 1.5MB warning

2. **`src/durable-object.ts`**:
  - Enhanced error handling in `snapshotToD1()`
  - Added size-limit-specific error detection
  - Prevents document from becoming unusable

3. **`MEMORY_MANAGEMENT.md`**:
  - Added section on D1 size limits and compression
  - Documented compression ratios and monitoring
  - Added guidance for when compression isn't enough

### Files Created

1. **`migrations/0002_add_compression.sql`**: Database migration to add compression support
2. **`D1_SIZE_LIMIT_FIX.md`**: This documentation

## Deployment Steps

1. **Run database migration** (both local and production):
```bash
   npm run db:migrate        # Local
   npm run db:migrate:prod   # Production
```

2. **Deploy updated code**:
```bash
   npm run build
   npm run deploy
```

3. **Monitor logs** for compression events:
```
   ✓ Compressed snapshot for <id>: 3.45MB → 0.82MB (76.2% reduction)
   ⚠ Large snapshot for <id>: 1.61MB (approaching D1 limit of 2MB) [compressed]
```

## Backwards Compatibility

The solution is fully backwards compatible:

- Existing uncompressed snapshots (compressed = 0) load normally
- New snapshots use compression automatically when needed
- Migration adds column with DEFAULT 0 (uncompressed)
- No data migration or re-processing required

## Monitoring

Watch for these log messages:

- **Success**: `Compressed snapshot for X: AMB → BMB (C% reduction)`
- **Warning**: `Large snapshot for X: NMB (approaching D1 limit of 2MB) [compressed]`
- **Critical**: `CRITICAL: Document X (NMB) is too large to persist to D1`

## Future Enhancements

If sessions still exceed 2MB after compression:

1. **Session archival**: Archive old messages and start fresh session
2. **Message pruning**: Remove old messages from Y.Doc (app-level)
3. **Chunked storage**: Split large sessions across multiple D1 rows
4. **R2 archival**: Move old content to cheaper R2 storage

## Testing

To test the fix:

1. Create a large AI chat session (>1.5MB of messages)
2. Watch logs for compression messages
3. Verify session saves successfully
4. Reload session and verify content is intact
5. Check database to confirm `compressed = 1` for large snapshots

## References

- [Cloudflare D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)
- [CompressionStream API](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream)
- [Y.js Documentation](https://docs.yjs.dev/)
