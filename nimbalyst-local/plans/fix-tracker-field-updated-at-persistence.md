---
planStatus:
  planId: plan-fix-tracker-field-updated-at-persistence
  title: "Fix tracker field-level LWW by persisting fieldUpdatedAt"
  status: in-review
  planType: bug-fix
  priority: high
  owner: ghinkle
  stakeholders: []
  tags: [tracker, collabv3, sync]
  created: "2026-04-14"
  updated: "2026-04-15T00:00:00.000Z"
  startDate: "2026-04-15"
  progress: 100
---

# Fix Tracker Field-Level LWW by Persisting fieldUpdatedAt

## Implementation Progress

- [x] Step 5: Add `_fieldUpdatedAt` to `NON_FIELD_KEYS` filter
- [x] Step 4a: Add `fieldUpdatedAt` property to `TrackerItem` interface
- [x] Step 1a: Persist `fieldUpdatedAt` in `recordToDbParams()`
- [x] Step 1b: Read persisted timestamps in `dbRowToRecord()`
- [x] Step 4b: Fix `trackerItemToRecord()` to use persisted timestamps
- [x] Step 4c: Map `fieldUpdatedAt` in `trackerRecordToItem()`
- [x] Step 2a: Stamp `fieldUpdatedAt` in `updateTrackerItem()`
- [x] Step 2b: Stamp `fieldUpdatedAt` in `createTrackerItem()`
- [x] Step 3: Preserve incoming `fieldUpdatedAt` in `hydrateTrackerItem()`
- [x] Typecheck passes

## Problem

Tracker item content (description and all other fields) does not sync correctly between users. The field-level Last-Write-Wins (LWW) conflict resolution is broken because `fieldUpdatedAt` timestamps are never persisted -- they are reconstructed as `Date.now()` every time an item is read from PGLite.

**Impact:** When User A edits a description and User B edits the title, the merge produces unpredictable results because both users' local items report all fields as "just updated now" regardless of when the actual edit happened.

## Root Cause Analysis

There are 4 compounding issues:

### 1. `fieldUpdatedAt` is never persisted to PGLite

The `data` JSONB column stores field values and system metadata, but `fieldUpdatedAt` is never included when writing to the database. There is no dedicated column for it either.

**Location:** `recordToDbParams()` in `packages/runtime/src/core/TrackerRecord.ts:285-327`
- Builds the JSONB `data` object from `record.fields` + system metadata
- Does NOT include `record.fieldUpdatedAt` in the output

### 2. `dbRowToRecord()` reconstructs all timestamps as "now"

Every time an item is read from PGLite, all `fieldUpdatedAt` timestamps are set to `Date.now()`, destroying real edit history.

**Location:** `dbRowToRecord()` in `packages/runtime/src/core/TrackerRecord.ts:228-277`
```typescript
const now = Date.now();
for (const [key, value] of Object.entries(data)) {
  if (value !== undefined) {
    fields[key] = value;
    fieldUpdatedAt[key] = now;  // ALWAYS "now" -- never the real edit time
  }
}
```

### 3. `updateTrackerItem()` never stamps field-level timestamps

When a user edits a field (title, description, status, etc.), the update handler writes the new value but never records WHICH fields changed or WHEN.

**Location:** `updateTrackerItem()` in `packages/electron/src/main/services/ElectronDocumentService.ts`
```typescript
for (const [key, value] of Object.entries(updates)) {
  data[key] = value;  // sets value, but no fieldUpdatedAt tracking
}
```

### 4. `hydrateTrackerItem()` drops incoming `fieldUpdatedAt` from sync

When a remote item arrives via sync, `hydrateTrackerItem()` in `TrackerSyncManager.ts:489` converts the payload to a flat `data` object and writes it to PGLite. The incoming `fieldUpdatedAt` from the sync payload is discarded.

### 5. `trackerItemToRecord()` also reconstructs timestamps as "now"

The legacy `TrackerItem -> TrackerRecord` converter (used in the upload path) sets all `fieldUpdatedAt` to `Date.now()`, so uploaded items always claim all fields were "just edited."

**Location:** `trackerItemToRecord()` in `packages/runtime/src/core/TrackerRecord.ts:94-152`

## Fix Plan

The fix persists `fieldUpdatedAt` inside the existing `data` JSONB column under a reserved key `_fieldUpdatedAt`. No schema migration needed.

### Step 1: Persist `fieldUpdatedAt` in JSONB data

**File:** `packages/runtime/src/core/TrackerRecord.ts`

**`recordToDbParams()`** -- Include `fieldUpdatedAt` in the JSONB data:
```typescript
// After building the data object from fields + system metadata:
data._fieldUpdatedAt = record.fieldUpdatedAt;
```

**`dbRowToRecord()`** -- Read persisted timestamps instead of generating "now":
```typescript
// Read persisted timestamps if available
const persistedTimestamps: Record<string, number> = data._fieldUpdatedAt || {};

for (const [key, value] of Object.entries(data)) {
  if (key === '_fieldUpdatedAt') continue;  // skip the meta key
  if (NON_FIELD_KEYS.has(key) || SYSTEM_KEYS.has(key)) continue;
  if (value !== undefined) {
    fields[key] = value;
    fieldUpdatedAt[key] = persistedTimestamps[key] ?? now;  // use persisted, fallback to now
  }
}
```

This is backward-compatible: old rows without `_fieldUpdatedAt` fall back to the current "now" behavior.

### Step 2: Stamp `fieldUpdatedAt` on local edits

**File:** `packages/electron/src/main/services/ElectronDocumentService.ts`

In `updateTrackerItem()`, when merging updates into the data object, also stamp the changed fields:

```typescript
const fieldTimestamps = data._fieldUpdatedAt || {};
const now = Date.now();

for (const [key, value] of Object.entries(updates)) {
  if (key === 'typeTags') continue;
  data[key] = value;
  fieldTimestamps[key] = now;  // stamp the changed field
}

data._fieldUpdatedAt = fieldTimestamps;
```

### Step 3: Preserve incoming `fieldUpdatedAt` during hydration

**File:** `packages/electron/src/main/services/TrackerSyncManager.ts`

In `hydrateTrackerItem()`, include the payload's `fieldUpdatedAt` in the JSONB data written to PGLite:

```typescript
const data: Record<string, any> = {
  // ... existing fields ...
  _fieldUpdatedAt: payload.fieldUpdatedAt,  // preserve sync timestamps
};
```

### Step 4: Fix `trackerItemToRecord()` to use persisted timestamps

**File:** `packages/runtime/src/core/TrackerRecord.ts`

The `trackerItemToRecord()` function currently sets all `fieldUpdatedAt[key] = now`. This is used in the upload path (`trackerItemToPayload -> trackerItemToRecord -> recordToPayload`).

**Fix:** Add `fieldUpdatedAt?: Record<string, number>` as a first-class optional property on the `TrackerItem` interface (in `DocumentService.ts`). Then `trackerItemToRecord` uses it:

```typescript
// In trackerItemToRecord():
const persistedTimestamps: Record<string, number> = item.fieldUpdatedAt || {};
const now = Date.now();

for (const key of Object.keys(fields)) {
  fieldUpdatedAt[key] = persistedTimestamps[key] ?? now;
}
```

And `trackerRecordToItem()` maps it back:
```typescript
return {
  ...item,
  fieldUpdatedAt: record.fieldUpdatedAt,
};
```

### Step 5: Exclude `_fieldUpdatedAt` from the fields bag

Make sure the `_fieldUpdatedAt` key is filtered out of user-visible fields everywhere:

- Add `'_fieldUpdatedAt'` to `NON_FIELD_KEYS` set in `TrackerRecord.ts`
- This ensures it doesn't appear in the tracker UI or get treated as a user field

## Files Changed

| File | Change |
|------|--------|
| `packages/runtime/src/core/TrackerRecord.ts` | Persist/read `_fieldUpdatedAt` in JSONB; add to `NON_FIELD_KEYS`; fix `trackerItemToRecord` |
| `packages/electron/src/main/services/ElectronDocumentService.ts` | Stamp `fieldUpdatedAt` on local edits in `updateTrackerItem()` |
| `packages/electron/src/main/services/TrackerSyncManager.ts` | Preserve incoming `fieldUpdatedAt` in `hydrateTrackerItem()` |

## Testing Strategy

1. **Unit test for `mergeTrackerItems`**: Two items with known `fieldUpdatedAt` -- verify the correct field wins
2. **Round-trip test**: Write a TrackerRecord to PGLite via `recordToDbParams`, read it back via `dbRowToRecord`, verify `fieldUpdatedAt` is preserved (not reset to "now")
3. **Integration test**: Two users edit different fields on the same item, sync, verify both edits are preserved
4. **Backward compat test**: Read an old row without `_fieldUpdatedAt` in data -- verify graceful fallback to "now"

## Design Decisions

1. **`_fieldUpdatedAt` includes system keys too.** The sync payload's `fieldUpdatedAt` covers both `fields` keys and `system` keys (like `linkedSessions`, `authorIdentity`). We persist the entire map as-is.

2. **Stamp `fieldUpdatedAt` in both `createTrackerItem()` and `updateTrackerItem()`.** On create, all fields get `now` timestamps persisted in `_fieldUpdatedAt` so the first sync upload has accurate per-field data from the start.

3. **First-class `fieldUpdatedAt` property on `TrackerItem` interface.** Rather than threading through `customFields`, add `fieldUpdatedAt?: Record<string, number>` directly to the `TrackerItem` interface. This is cleaner and more explicit. The `trackerRecordToItem()` and `trackerItemToRecord()` converters map it directly.
