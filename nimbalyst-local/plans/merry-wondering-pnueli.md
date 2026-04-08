# Fix Org Key Split-Brain Encryption

## Context

When an admin removes a team member, `removeMember()` rotates the org encryption key on that admin's machine. But every other client keeps using their stale cached key because `OrgKeyService` never checks if the key has been rotated. This causes:

1. Stale-key clients encrypt tracker items that new-key holders can't decrypt (`OperationError`)
2. `autoWrapForNewMembers` spreads the wrong key to newcomers
3. Self-envelope recovery re-uploads envelopes with the stale key

The root cause: org keys are cached locally with no version/fingerprint, and the cache is never invalidated.

## Approach: Server-Authoritative Org Key Fingerprint

Add a SHA-256 fingerprint of the raw org key bytes. The server stores the "current" fingerprint; clients compare before using their local key.

---

## Phase 1: Org Key Fingerprint Computation & Local Storage

**File: `packages/electron/src/main/services/OrgKeyService.ts`**

1. Add `computeOrgKeyFingerprint(rawKeyBase64: string): string` -- SHA-256 of raw key bytes, first 16 bytes as hex string. Uses `createHash` already imported.

2. Change cache shape from `Map<string, string>` to `Map<string, { rawKeyBase64: string; fingerprint: string }>`. Update:
   - `storeOrgKeyRaw()` -- compute fingerprint on store
   - `getOrgKey()` -- extract `rawKeyBase64` from new shape
   - `hasOrgKey()` -- same but read from new shape
   - `loadOrgKeysFromDisk()` -- auto-migrate old format (detect string vs object values)
   - `saveOrgKeysToDisk()` -- serialize new shape

3. Add new exports:
   - `getOrgKeyFingerprint(orgId: string): string | null`
   - `clearOrgKey(orgId: string): void` -- remove from cache and disk

## Phase 2: Server-Side Fingerprint Storage (TeamRoom)

**File: `packages/collabv3/src/TeamRoom.ts`**

1. Add `POST /internal/set-org-key-fingerprint` to `handleInternalMutation()`:
   - Stores fingerprint in existing `metadata` table via `setMetadataValue('current_org_key_fingerprint', fingerprint)`
   - Broadcasts `{ type: 'orgKeyRotated', fingerprint }` to all connected clients

2. Add `GET /internal/get-org-key-fingerprint` to `handleInternalQuery()`:
   - Returns `{ fingerprint }` from metadata (or `{ fingerprint: null }`)

**File: `packages/collabv3/src/types.ts`**

3. Add `TeamOrgKeyRotatedMessage` to `TeamServerMessage` union:
   ```typescript
   { type: 'orgKeyRotated'; fingerprint: string }
   ```

**File: `packages/collabv3/src/index.ts`**

4. Add REST routes (admin-only):
   - `PUT /api/teams/{orgId}/org-key-fingerprint` -- calls TeamRoom `set-org-key-fingerprint`
   - `GET /api/teams/{orgId}/org-key-fingerprint` -- calls TeamRoom `get-org-key-fingerprint`

**File: `packages/collabv3/src/teamKeyEnvelopes.ts`** (or new `teamOrgKeyFingerprint.ts`)

5. Handler functions for the two REST routes above.

## Phase 3: Client Posts Fingerprint on Key Rotation

**File: `packages/electron/src/main/services/TeamService.ts`**

1. In `removeMember()` (line ~606), after `generateAndStoreOrgKey(orgId)`:
   - Compute fingerprint via `getOrgKeyFingerprint(orgId)`
   - `PUT /api/teams/${orgId}/org-key-fingerprint` with `{ fingerprint }`
   - This triggers the `orgKeyRotated` broadcast to all connected clients

2. In team creation flow (wherever `generateAndStoreOrgKey` is first called for a new team):
   - Also POST the initial fingerprint

## Phase 4: Client Validates Key Before Use

**File: `packages/electron/src/main/services/TeamService.ts`**

1. In `ensureOrgKeyForWorkspace()` (line ~714), when `hasOrgKey()` is true:
   - Fetch server fingerprint via `GET /api/teams/${orgId}/org-key-fingerprint`
   - Compare with `getOrgKeyFingerprint(orgId)`
   - If mismatch: `clearOrgKey(orgId)`, log warning, fall through to re-fetch path
   - If server fingerprint is null (legacy/pre-migration): proceed as-is

2. In `autoWrapForNewMembers()` (line ~924):
   - Before wrapping, fetch server fingerprint and compare
   - If stale or network error: skip wrapping entirely, log warning

3. In self-envelope recovery (line ~725):
   - Before re-uploading envelope from local key, verify fingerprint matches server
   - If stale: clear local key, attempt to fetch new key from envelope

4. Handle `orgKeyRotated` WebSocket message:
   - Compare broadcast fingerprint with local
   - If stale: clear local key, attempt `fetchAndUnwrapOrgKey()`
   - Emit IPC `team:org-key-rotated` to renderer for a toast notification

## Phase 5: Fingerprint on Tracker Writes

**File: `packages/collabv3/src/types.ts`**

1. Add optional `orgKeyFingerprint?: string` to:
   - `TrackerUpsertMessage`
   - `EncryptedTrackerItem`

**File: `packages/collabv3/src/TrackerRoom.ts`**

2. Add `org_key_fingerprint TEXT` column to `tracker_items` and `changelog` tables (nullable for backwards compat)

3. In `handleTrackerUpsert()`:
   - Accept `orgKeyFingerprint` param
   - Store it in the row
   - Include it in broadcast `EncryptedTrackerItem`
   - (Phase 5b -- optional enforcement): Look up current fingerprint from metadata and reject mismatches with `{ type: 'error', code: 'stale_org_key' }`

4. Add `POST /internal/set-org-key-fingerprint` to TrackerRoom as well, so rotating admin can set it on both TeamRoom and TrackerRoom

**File: `packages/runtime/src/sync/TrackerSync.ts`**

5. Include `orgKeyFingerprint` in outgoing upsert messages

6. On incoming items, compare `item.orgKeyFingerprint` with local fingerprint before decrypt to distinguish "wrong key" from "corrupted data"

**File: `packages/electron/src/main/services/TrackerSyncManager.ts`**

7. Pass `orgKeyFingerprint` when constructing `TrackerSyncProvider`

## Phase 6: Backwards Compatibility & Migration

- All new fingerprint fields are optional/nullable
- Server accepts writes without fingerprint when no current fingerprint is stored
- First admin to connect after update with a valid local key seeds the server fingerprint (one-time migration in `ensureOrgKeyForWorkspace`)
- Old clients that don't send fingerprint: accepted during transition period (logged as warnings)

## Phase 7: Error UX

- IPC `team:org-key-rotated` triggers toast: "Team encryption key was updated. Reconnecting..."
- Per-item decrypt errors with `wrong_key_version` shown as badge in tracker UI instead of silent skip

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/electron/src/main/services/OrgKeyService.ts` | Fingerprint computation, cache shape, new exports |
| `packages/electron/src/main/services/TeamService.ts` | Post fingerprint on rotation, validate before use, handle broadcast |
| `packages/electron/src/main/services/TrackerSyncManager.ts` | Pass fingerprint to sync provider |
| `packages/collabv3/src/TeamRoom.ts` | Store/serve fingerprint, broadcast rotation |
| `packages/collabv3/src/TrackerRoom.ts` | Fingerprint column, optional write rejection |
| `packages/collabv3/src/types.ts` | New message types, fingerprint fields |
| `packages/collabv3/src/index.ts` | New REST routes |
| `packages/collabv3/src/teamKeyEnvelopes.ts` (or new file) | Route handlers |
| `packages/runtime/src/sync/TrackerSync.ts` | Send fingerprint, pre-decrypt check |
| `packages/runtime/src/sync/trackerSyncTypes.ts` | Mirror type changes |

## Verification

1. **Unit**: Test `computeOrgKeyFingerprint` is deterministic and produces 32-char hex
2. **Manual**: Two-admin scenario:
   - Admin A removes a member (rotates key)
   - Admin B reconnects -- verify key is invalidated and re-fetched
   - Admin B writes a tracker item -- verify it's encrypted with new key
   - New member joins -- verify they get the current key, not the old one
3. **Backwards compat**: Existing team with no server fingerprint -- verify first admin seeds it, old items still decrypt
