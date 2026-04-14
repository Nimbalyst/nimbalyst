---
planStatus:
  planId: plan-e2ee-key-rotation-hardening
  title: E2EE Key Rotation Hardening
  status: in-development
  planType: bug-fix
  priority: critical
  owner: ghinkle
  stakeholders: []
  tags:
    - collabv3
    - security
    - e2ee
  created: "2026-04-14"
  updated: "2026-04-14T18:00:00.000Z"
  progress: 85
---
# E2EE Key Rotation Hardening

## Implementation Progress

- [x] Key rotation orchestrator (6-phase: archive, download, backup, re-encrypt, upload, distribute)
- [x] Key history archive in OrgKeyService (old keys never discarded)
- [x] TeamService removeMember rewritten (rotation before removal, fail closed)
- [x] DocumentRoom asset enumeration endpoint
- [x] Client-side onOrgKeyRotated handler (provider teardown/recreation)
- [x] TrackerSyncManager restart-for-workspace handler
- [x] P0: Key epoch enforcement on TrackerRoom writes
- [x] P0: Key epoch enforcement on DocumentRoom writes
- [x] P0: Write barrier / freeze during rotation
- [x] P0: Close connections on member removal (TeamRoom -> DocumentRoom/TrackerRoom)
- [x] P0: Stale key verification on document-sync:open
- [x] P0: Stale key verification on tracker sync init
- [x] P1: Open collab document tab re-keying via keyRotated event
- [ ] P1: Ongoing local plaintext mirror service
- [x] P1: Encrypt plaintext backups at rest
- [ ] P2: AAD / domain separation with HKDF-derived keys
- [ ] P2: Trust model hardening (signed identity keys)
- [ ] P2: Metadata exposure audit document
- [x] P3: Tracker changelog cleanup during rotation
- [x] Orphaned documents cleanup IPC handler
- [x] P3: Tracker changelog cleanup during rotation
- [ ] Automated tests for rotation path

## Incident

On Apr 13, removing a team member triggered key rotation. The rotation generated a new AES-256-GCM org key and distributed it to remaining members, but **never re-encrypted existing server-side data**. The old key was overwritten with no history. 14 shared documents and all tracker items became permanently unreadable. Data is unrecoverable -- the old key no longer exists anywhere.

## Root Cause

`TeamService.removeMember()` generated a new key and wrapped it for remaining members, but:
- Never re-encrypted document titles (TeamRoom `document_index`)
- Never re-encrypted document content (DocumentRoom `encrypted_updates` + `snapshots`)
- Never re-encrypted document assets (DocumentRoom `document_assets` + R2 binaries)
- Never re-encrypted tracker items (TrackerRoom `tracker_items`)
- Overwrote the old key with no archive/history

## What Was Done in This Session

### New Files Created

- **`packages/electron/src/main/services/KeyRotationService.ts`** -- Full 6-phase rotation orchestrator:
  1. Archive old key (never discard)
  2. Download and decrypt all data with old key (doc titles, doc content, tracker items)
  3. Write plaintext backup to `{userData}/key-rotation-backups/{orgId}/{timestamp}/`
  4. Generate new key, re-encrypt everything
  5. Upload re-encrypted data (doc titles via `docIndexUpdate`, doc content via `docCompact`, assets via HTTP re-upload, tracker items via `trackerBatchUpsert`)
  6. Distribute new key (upload envelopes THEN post fingerprint)
  - Includes `cleanupOrphanedDocuments()` for removing entries encrypted with lost keys

### Modified Files

- **`packages/electron/src/main/services/OrgKeyService.ts`** -- Added key history archive (`org-key-history.enc`). Old keys are never discarded. Functions: `archiveCurrentOrgKey()`, `getLatestArchivedOrgKey()`, `getArchivedOrgKeyByFingerprint()`, `getArchivedOrgKeys()`

- **`packages/electron/src/main/services/TeamService.ts`** -- `removeMember()` rewritten: rotation runs BEFORE member removal (fail closed). Delegates to `performKeyRotation()`.

- **`packages/collabv3/src/DocumentRoom.ts`** -- Added `handleInternalListAssets()` endpoint to enumerate all assets for a document during rotation.

- **`packages/collabv3/src/index.ts`** -- Added `GET /api/collab/docs/{documentId}/assets` HTTP route for asset enumeration.

- **`packages/electron/src/renderer/store/atoms/collabDocuments.ts`** -- `onOrgKeyRotated` handler now tears down TeamSyncProvider and reinitializes with new key, plus triggers tracker sync restart.

- **`packages/electron/src/main/services/TrackerSyncManager.ts`** -- Added `tracker-sync:restart-for-workspace` IPC handler for key rotation recovery.

### Security Review Findings Addressed

| Finding | Fix Applied |
| --- | --- |
| Member removal succeeds when rotation fails | Rotation runs BEFORE removal; failure blocks removal |
| Rotation deletes concurrent edits | Uses exact download sequence for `replacesUpTo`, no re-read |
| Fingerprint broadcast before envelopes | Reordered: envelopes uploaded THEN fingerprint posted |
| Partial failure still distributes new key | Fail closed: throws if any doc/asset/tracker fails |
| Clients don't re-key after rotation | `onOrgKeyRotated` destroys and recreates providers |

## What Was Done in Session 2 (P0 Server-Side Enforcement)

### TrackerRoom.ts -- Key Epoch Enforcement + Write Barrier + Connection Closure

- Added internal POST endpoints: `/internal/set-org-key-fingerprint`, `/internal/set-rotation-lock`, `/internal/close-user-connections`
- `validateWriteAllowed()` checks rotation lock and key epoch on every `trackerUpsert`, `trackerDelete`, and `trackerBatchUpsert`
- Stale-key writes rejected with `write_rejected` error code
- Rotation lock blocks ALL writes while key rotation is in progress

### DocumentRoom.ts -- Write Barrier + Connection Closure

- Added `getMetadataValue()` method
- Added internal POST endpoints: `/internal/set-org-key-fingerprint`, `/internal/set-rotation-lock`, `/internal/close-user-connections`
- `validateWriteAllowed()` checks rotation lock on `docUpdate` and `docCompact`
- Internal mutation handler with error responses

### TeamRoom.ts -- Cross-DO Connection Propagation

- `/internal/remove-member` now calls `closeUserConnectionsOnRooms()` after removing member data
- `closeUserConnectionsOnRooms()` iterates all DocumentRoom DOs (from `document_index`) and the TrackerRoom DO (from `git_remote_hash`) to close the removed user's WebSocket connections
- Added `/internal/list-document-ids` GET endpoint for rotation API

### teamKeyEnvelopes.ts -- Rotation API Routes

- `handleRotationLock()` -- POST `/api/teams/{orgId}/rotation-lock`: sets/clears write barrier on all document and tracker rooms
- `handlePropagateFingerprint()` -- POST `/api/teams/{orgId}/propagate-fingerprint`: sets the new fingerprint on all document and tracker rooms after re-encryption

### index.ts -- New API Routes

- Added routes for `/api/teams/{orgId}/rotation-lock` and `/api/teams/{orgId}/propagate-fingerprint`

### KeyRotationService.ts -- Freeze/Unfreeze Integration

- Phase 1b: Sets write barrier (`rotation-lock: true`) before downloading data
- Phase 5b: Propagates new fingerprint to all rooms after re-encrypted data is uploaded
- Phase 5c: Clears write barrier after propagation
- Error recovery: best-effort write barrier clearance in catch block

### DocumentSyncHandlers.ts -- Stale Key Verification

- Before constructing DocumentSyncProvider, verifies local key fingerprint against server
- If stale, clears local key and re-fetches from envelope
- Added `getSyncHttpUrl()` helper

### TrackerSyncManager.ts -- Stale Key Verification

- Before connecting TrackerSyncProvider, verifies local key fingerprint against server
- If stale, clears local key and re-fetches from envelope

## Remaining Work (for future sessions)

### P0: Server-Coordinated Rotation Protocol

The current rotation is client-driven. A server-coordinated protocol would be safer:

1. **Write barrier / freeze during rotation** -- The admin downloads state at sequence S, then compacts at S. Any writes between download and compact that have sequence > S survive as old-key incremental updates after the new-key snapshot. The server should reject old-key writes after the new fingerprint is set, OR freeze writes on rooms during rotation.

2. **Key epoch enforcement on writes** -- TrackerRoom stores whatever `orgKeyFingerprint` the client sends without checking against the current org fingerprint. DocumentRoom writes have no fingerprint at all. The server should reject writes encrypted with a stale key.

   Files: `packages/collabv3/src/TrackerRoom.ts` (line ~483), `packages/collabv3/src/DocumentRoom.ts` (line ~572)

3. **Stale key verification on open paths** -- `document-sync:open` (DocumentSyncHandlers.ts:77) and `initializeTrackerSync` (TrackerSyncManager.ts:280) call `getOrgKey()` without verifying the fingerprint against the server. Should check before constructing providers.

### P0: Membership Enforcement on Rooms

Removed members can keep using existing org-scoped JWTs (valid up to 1 week) and existing WebSocket connections.

1. **Close existing connections on member removal** -- When a member is removed from TeamRoom, broadcast to DocumentRoom and TrackerRoom DOs to close that user's connections.

2. **Live membership validation** -- Every room should check membership on each write, not just on initial connection. Or use short-lived room-scoped tokens instead of long-lived org JWTs.

   Files: `packages/collabv3/src/DocumentRoom.ts`, `packages/collabv3/src/TrackerRoom.ts`, `packages/collabv3/src/index.ts` (line ~304)

### P1: Open Collab Document Tab Re-keying

Currently, open CollaborativeTabEditor tabs hold a `DocumentSyncProvider` with the old key. After rotation, existing tabs need close/reopen. A better fix: emit a `keyRotated` event that collab tabs listen to, triggering them to destroy their provider and recreate with the new key.

Files: `packages/electron/src/renderer/components/TabEditor/CollaborativeTabEditor.tsx`

### P1: Ongoing Local Plaintext Mirror

Store decrypted content of shared documents in `{userData}/shared-doc-mirrors/{orgId}/` as an always-on safety net. Write on every content change (sync response, remote update, local edit). Feed into existing `document_history` snapshot system for versioned history.

Files needed:
- `packages/electron/src/main/services/SharedDocMirrorService.ts` (new)
- `packages/runtime/src/sync/DocumentSync.ts` (add `onContentChanged` callback)
- `packages/electron/src/renderer/components/TabEditor/CollaborativeTabEditor.tsx` (wire callback)

### P1: Encrypt Plaintext Backups at Rest

Current rotation backups are plaintext JSON/binary in `{userData}/key-rotation-backups/`. Should be encrypted with a local-only key (e.g., derived from safeStorage) and have configurable retention. Also need to include asset binaries in the backup.

### P2: AAD / Domain Separation

All encrypted data (titles, Yjs updates, tracker payloads, asset bytes, asset metadata) uses the same AES-GCM key without Associated Authenticated Data binding ciphertext to context. A compromised server could replay/swap ciphertext across documents. Fix: use HKDF-derived per-purpose keys or AES-GCM AAD with `{orgId, documentId, purpose, keyVersion}`.

Files: `packages/runtime/src/sync/DocumentSync.ts`, `packages/runtime/src/sync/TrackerSync.ts`, `packages/runtime/src/sync/TeamSync.ts`

### P2: Trust Model Hardening

Identity keys are mutable server records. Auto-wrap blindly trusts server-provided public keys. A compromised server could swap keys to intercept wrapped org keys. Fix: mandatory client-side identity key verification before wrapping, signed identity keys.

### P2: Metadata Exposure Audit

Team names, member emails/roles, git remote hashes, document IDs/types, tracker issue numbers/keys, asset MIME types and sizes are visible to the server as plaintext. Need a threat model document that explicitly defines what metadata the server sees and why.

### P3: Tracker Changelog Cleanup

Old changelog entries in TrackerRoom remain encrypted with the old key after rotation. They're only used for delta sync and don't affect current state. Options: truncate changelog during rotation (forces full resync for all clients), or accept as historical artifact.

## Cleanup Needed Now

Run `cleanupOrphanedDocuments()` against the current org to remove the 14 document index entries encrypted with the lost key. This function is in `KeyRotationService.ts` but has no IPC handler yet -- needs one, or can be called directly from a debug session.

## Testing

No automated tests exist for the rotation path. Need:
- Unit tests mocking WebSocket round-trips for the rotation orchestrator
- Integration test with collab server: create team, share doc, edit, remove member, verify re-encryption
- Concurrent edit test: edit during rotation, verify edits after snapshot sequence survive
- Asset re-encryption test
- Stale client test: verify old-key writes are rejected after rotation
- Active removed-member test: verify connections are closed
