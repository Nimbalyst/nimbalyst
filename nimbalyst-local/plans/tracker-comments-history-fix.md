---
planStatus:
  planId: plan-tracker-comments-sync-fix
  title: "Fix tracker comments and activity: local rendering, sync pipeline, and merge"
  status: in-review
  planType: bug-fix
  priority: high
  owner: ghinkle
  stakeholders: []
  tags: [tracker, collabv3, sync]
  created: "2026-04-15"
  updated: "2026-04-15T18:30:00.000Z"
  progress: 100
---

# Fix Tracker Comments and Activity: Local Rendering, Sync Pipeline, and Merge

## Problem

Comments are stored in the DB but broken at every stage of the pipeline. Activity is defined in the local data model but not in the sync payload -- it needs to be added so team members see a unified history.

## Acceptance Criteria

1. Local UI: adding a comment renders it immediately without navigation
2. Restart: comments and activity persist and render on reload
3. Sync: user2 receives comments and activity from user1
4. Bidirectional: user2 can add a comment and user1 sees it
5. Convergence: two users adding different comments concurrently both see both comments
6. MCP: comments added via `tracker_add_comment` MCP tool also sync
7. Activity convergence: activity entries from both users are merged (union by ID, bounded to 100)

## Pipeline Audit

| Stage | File | Status | Issue |
|-------|------|--------|-------|
| DB -> TrackerItem | `ElectronDocumentService.ts:967` (class `rowToTrackerItem`) | OK | `customFields` catch-all carries comments/activity |
| DB -> TrackerItem | `trackerToolHandlers.ts:121` (standalone `rowToTrackerItem`) | FIXED | Added generic `customFields` catch-all |
| TrackerItem -> TrackerRecord | `TrackerRecord.ts:96` (`trackerItemToRecord`) | FIXED | Added generic SYSTEM_KEYS pull from customFields |
| TrackerRecord -> DB | `TrackerRecord.ts:308` (`recordToDbParams`) | **BROKEN** | Preserves `activity` but not `comments` |
| TrackerRecord -> Payload | `trackerSyncTypes.ts:254` (`recordToPayload`) | **BROKEN** | Emits `comments` (line 295) but not `activity` |
| Payload -> TrackerRecord | `trackerSyncTypes.ts:305` (`payloadToRecord`) | **BROKEN** | Reads `comments` (line 341) but not `activity` |
| Payload interface | `trackerSyncTypes.ts:102` (`TrackerItemPayload`) | **BROKEN** | Has `comments` (line 131) but no `activity` field |
| Payload merge (LWW) | `TrackerSync.ts:100` (`mergeTrackerItems`) | **BROKEN** | Treats `comments` as whole-value LWW routing field; no activity merge |
| Upload (DB -> server) | `TrackerSyncManager.ts:55` (`uploadTrackerRows`) | **BROKEN** | Hardcoded `known` set; comments/activity go to customFields but get dropped by NON_FIELD_KEYS |
| Hydration (server -> DB) | `TrackerSyncManager.ts:489` (`hydrateTrackerItem`) | **BROKEN** | Builds data JSONB without comments/activity from payload |
| IPC add-comment | `ElectronDocumentService.ts:2539` | **BROKEN** | No sync trigger, no `_fieldUpdatedAt.comments` stamp |
| IPC update-comment | `ElectronDocumentService.ts:2588` | **BROKEN** | Same |
| MCP add-comment | `trackerToolHandlers.ts:1512` | **BROKEN** | `notifyTrackerItemUpdated` but no `syncTrackerItem` |

## Fixes

### Fix 1: Add `activity` to sync payload (trackerSyncTypes.ts)

**a) `TrackerItemPayload` interface (line 131)** -- add `activity` field:

```typescript
comments: TrackerComment[];
activity: TrackerActivity[];
```

Import `TrackerActivity` from `../core/DocumentService`.

**b) `recordToPayload` (line 295)** -- emit activity alongside comments:

```typescript
comments: record.system.comments ?? [],
activity: record.system.activity ?? [],
```

Also add `fieldUpdatedAt.activity` timestamp (after line 275):

```typescript
fieldUpdatedAt.activity = fieldUpdatedAt.activity ?? now;
```

**c) `payloadToRecord` (line 341)** -- read activity from payload:

```typescript
comments: payload.comments,
activity: payload.activity,
```

### Fix 2: `recordToDbParams` -- preserve comments (TrackerRecord.ts:332)

Add after the existing `activity` line:

```typescript
if (record.system.comments?.length) data.comments = record.system.comments;
```

### Fix 3: `mergeTrackerItems` -- union-by-ID for comments AND activity (TrackerSync.ts:137)

Remove `comments` from `routingKeys`. Add after the routing merge:

```typescript
// Comments: union by ID, keep newer version per comment
const commentMap = new Map<string, TrackerComment>();
for (const c of local.comments ?? []) commentMap.set(c.id, c);
for (const c of remote.comments ?? []) {
  const existing = commentMap.get(c.id);
  if (!existing || (c.updatedAt ?? c.createdAt) >= (existing.updatedAt ?? existing.createdAt)) {
    commentMap.set(c.id, c);
  }
}
merged.comments = Array.from(commentMap.values()).sort((a, b) => a.createdAt - b.createdAt);
mergedTimestamps.comments = Math.max(local.fieldUpdatedAt.comments ?? 0, remote.fieldUpdatedAt.comments ?? 0);

// Activity: union by ID, bounded to 100, sorted by timestamp
const activityMap = new Map<string, TrackerActivity>();
for (const a of local.activity ?? []) activityMap.set(a.id, a);
for (const a of remote.activity ?? []) activityMap.set(a.id, a);  // append-only, no conflict
merged.activity = Array.from(activityMap.values())
  .sort((a, b) => a.timestamp - b.timestamp)
  .slice(-100);
mergedTimestamps.activity = Math.max(local.fieldUpdatedAt.activity ?? 0, remote.fieldUpdatedAt.activity ?? 0);
```

### Fix 4: `uploadTrackerRows` -- generic customFields (TrackerSyncManager.ts:95)

Replace the hardcoded `known` set with the same generic pattern: use the `item` object's own keys as the exclusion set. Comments/activity flow through `customFields` -> `trackerItemToRecord` SYSTEM_KEYS pull -> `record.system` -> `recordToPayload`.

### Fix 5: `hydrateTrackerItem` -- include comments and activity with merge (TrackerSyncManager.ts:498)

After data object construction, merge comments and activity from the payload with any existing local data:

```typescript
// In the existing try block that reads the existing row, after kanbanSortOrder preservation:

// Merge comments (union by ID)
const incomingComments = payload.comments ?? [];
const localComments = existingData?.comments ?? [];
if (incomingComments.length || localComments.length) {
  const commentMap = new Map();
  for (const c of localComments) commentMap.set(c.id, c);
  for (const c of incomingComments) {
    const local = commentMap.get(c.id);
    if (!local || (c.updatedAt ?? c.createdAt) >= (local.updatedAt ?? local.createdAt)) {
      commentMap.set(c.id, c);
    }
  }
  data.comments = Array.from(commentMap.values()).sort((a, b) => a.createdAt - b.createdAt);
}

// Merge activity (union by ID, bounded to 100)
const incomingActivity = payload.activity ?? [];
const localActivity = existingData?.activity ?? [];
if (incomingActivity.length || localActivity.length) {
  const activityMap = new Map();
  for (const a of localActivity) activityMap.set(a.id, a);
  for (const a of incomingActivity) activityMap.set(a.id, a);
  data.activity = Array.from(activityMap.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-100);
}
```

### Fix 6: Sync trigger for all comment mutation paths

All three paths need sync triggers following the same pattern as `update-tracker-item` (ElectronDocumentService.ts:2376). Import `getEffectiveTrackerSyncPolicy`, `shouldSyncTrackerPolicy` from `TrackerPolicyService` and `syncTrackerItem`, `isTrackerSyncActive` from `TrackerSyncManager` (already imported in both files).

The pattern for each:

```typescript
try {
  const workspace = row.rows[0].workspace;
  const itemType = row.rows[0].type;
  const syncPolicy = getEffectiveTrackerSyncPolicy(workspace, itemType);
  if (shouldSyncTrackerPolicy(syncPolicy)) {
    if (isTrackerSyncActive(workspace)) {
      // Re-read and sync
      const fullRow = await database.query<any>(`SELECT * FROM tracker_items WHERE id = $1`, [payload.itemId]);
      if (fullRow.rows.length > 0) {
        await syncTrackerItem(/* converted TrackerItem */);
      }
    } else {
      // Mark pending for sync when connection resumes
      await database.query(`UPDATE tracker_items SET sync_status = 'pending' WHERE id = $1`, [payload.itemId]);
    }
  }
} catch (syncErr) {
  console.error('[comment sync failed]', syncErr);
}
```

Apply to:
- **a)** IPC `tracker-item-add-comment` (ElectronDocumentService.ts)
- **b)** IPC `tracker-item-update-comment` (ElectronDocumentService.ts)
- **c)** MCP `handleTrackerAddComment` (trackerToolHandlers.ts) -- already imports `syncTrackerItem` and `isTrackerSyncActive`

For (a) and (b), converting the DB row to a TrackerItem requires either:
- Making `rowToTrackerItem` public on the class, OR
- Adding a public `getTrackerItemById(id): TrackerItem` method to ElectronDocumentService

Adding `getTrackerItemById` is cleaner -- it's a single-item read that other callers can use too.

### Fix 7: Stamp `_fieldUpdatedAt.comments` at mutation time

In all three comment mutation paths, stamp the timestamp before the DB write:

```typescript
const fieldUpdatedAt = data._fieldUpdatedAt || {};
fieldUpdatedAt.comments = Date.now();
data._fieldUpdatedAt = fieldUpdatedAt;
```

This ensures `recordToPayload` uses the mutation-time timestamp instead of falling back to sync-time `Date.now()` (trackerSyncTypes.ts:275). Critical for offline/pending items.

## Files to Change

| File | Changes |
|------|---------|
| `packages/runtime/src/sync/trackerSyncTypes.ts` | Add `activity` to `TrackerItemPayload`; emit in `recordToPayload`; read in `payloadToRecord` |
| `packages/runtime/src/core/TrackerRecord.ts` | Add `comments` to `recordToDbParams` |
| `packages/runtime/src/sync/TrackerSync.ts` | Replace LWW with union-by-ID for comments; add union-by-ID for activity in `mergeTrackerItems` |
| `packages/electron/src/main/services/TrackerSyncManager.ts` | Generic customFields in `uploadTrackerRows`; comments + activity merge in `hydrateTrackerItem` |
| `packages/electron/src/main/services/ElectronDocumentService.ts` | Add sync trigger + `_fieldUpdatedAt` stamp to comment IPC handlers; add `getTrackerItemById` public method |
| `packages/electron/src/main/mcp/tools/trackerToolHandlers.ts` | Add sync trigger + `_fieldUpdatedAt` stamp to `handleTrackerAddComment` |

## Tests to Add

| Test | Location |
|------|----------|
| `mergeTrackerItems`: concurrent comments produce union | `packages/runtime/src/sync/__tests__/trackerSyncTypes.test.ts` |
| `mergeTrackerItems`: concurrent activity entries produce union, bounded to 100 | same |
| `recordToDbParams` preserves comments | `packages/runtime/src/core/__tests__/TrackerRecord.test.ts` |
| `trackerItemToRecord` round-trips comments/activity via customFields -> system | same |
| `recordToPayload` / `payloadToRecord` round-trips comments and activity | `packages/runtime/src/sync/__tests__/trackerSyncTypes.test.ts` |

## Already Done (this session)

| File | Change |
|------|--------|
| `packages/runtime/src/core/TrackerRecord.ts` | Generic SYSTEM_KEYS pull from customFields in `trackerItemToRecord` |
| `packages/electron/src/main/mcp/tools/trackerToolHandlers.ts` | Generic customFields in standalone `rowToTrackerItem` |
| `packages/electron/src/main/services/ElectronDocumentService.ts` | Activity recording + broadcast in comment IPC handlers; `broadcastTrackerItemUpdate` helper with generic customFields |
