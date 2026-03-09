---
planStatus:
  planId: plan-collab-document-attachments
  title: Collaborative Document Attachments
  status: draft
  planType: system-design
  priority: high
  owner: ghinkle
  stakeholders:
    - development-team
    - alpha-users
    - agents
  tags:
    - collaboration
    - collabv3
    - attachments
    - media
    - encryption
  created: "2026-03-08"
  updated: "2026-03-08T00:00:00.000Z"
  progress: 0
---
# Collaborative Document Attachments

This plan covers binary attachments and embedded assets for collaborative documents. It is intentionally separate from `plans/collab-document-mvp-completion.md`, which now treats attachments as out of scope for the MVP safety bar.

## Goals

1. Let users embed images and attach files in collaborative documents without relying on local filesystem paths.
2. Preserve attachment access across devices, reconnects, restart, version restore, and agent workflows.
3. Keep server-side storage end-to-end encrypted and aligned with the collabv3 isolation model.
4. Define attachment identity, retention, quota, and restore behavior before shipping.

## Non-Goals

- Replacing markdown as the collaborative document format.
- Building a public CDN or unauthenticated sharing flow for collaborative assets.
- Rich media editing beyond image embed and linked-file attachment MVP behavior.
- OCR, search indexing, or image understanding features.

## Current State

- Collaborative documents store encrypted Yjs state in `DocumentRoom`, but there is no binary asset channel or asset identity model.
- Shared document titles and document index metadata are handled by `TeamRoom`; attachment metadata is not represented there or in `DocumentRoom`.
- Local project markdown now has an asset strategy based on workspace `.preditor/assets/`, but that assumes a shared filesystem or git repo and does not apply to org-scoped collab docs.
- AI chat already has an attachment pipeline (`AttachmentService`, provider attachment handling, mobile queued prompt attachments), but it is session-scoped and file-path based, not document-scoped.
- Collaborative documents are currently markdown-only in practice, so embedded images and linked files have no stable shared backing store.

## Problem Summary

Without a dedicated attachment model, collaborative documents cannot safely support screenshots, PDFs, or linked artifacts:

- Local file paths are meaningless to other collaborators.
- Workspace-relative asset files are not available to users who only have the shared doc.
- Binary upload over the existing document WebSocket is a poor fit for large payloads and retry semantics.
- Restore/history would be incomplete if document snapshots could reference assets that no longer exist.
- Agent tools cannot operate safely on collab-doc attachments without stable asset identity.

## Proposed Architecture

### Storage Model

- Store document-scoped attachment metadata in the `DocumentRoom` Durable Object.
- Store encrypted binary blobs in R2, keyed by `(orgId, documentId, assetId, version)`.
- Keep D1 out of the design entirely. Customer data remains in Durable Objects and encrypted blob storage only.

### Asset Identity

- Every attachment gets a stable `assetId` UUID independent of filename and markdown label text.
- The markdown/Yjs content references the asset by a custom URI, for example:
  - image: `![Architecture](collab-asset://doc/{documentId}/asset/{assetId})`
  - linked file: `[spec.pdf](collab-asset://doc/{documentId}/asset/{assetId})`
- Human-readable labels remain in document content. Server-visible metadata should be minimal.

### Metadata Shape

Recommended `DocumentRoom` asset record:

```typescript
interface DocumentAssetRecord {
  assetId: string;
  documentId: string;
  status: 'pending' | 'ready' | 'deleted';
  ciphertextSize: number;
  plaintextSize?: number;
  mimeType?: string;
  encryptedMetadata?: string;
  metadataIv?: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  latestBlobVersion: number;
}
```

Notes:

- `encryptedMetadata` should hold filename, dimensions, alt defaults, and any other user-facing metadata.
- Server-visible fields should stay limited to what is needed for quota enforcement, lifecycle control, and debugging.

### Upload Flow

Use authenticated HTTP endpoints, not the document WebSocket, for binary transfer.

1. Renderer requests an upload session from `DocumentRoom`.
2. Client compresses/transcodes images locally when appropriate.
3. Client encrypts the blob with the document key or a per-asset key wrapped by the document key.
4. Client uploads chunks or a streaming body to a Worker endpoint.
5. Worker writes ciphertext to R2 and asks `DocumentRoom` to mark the asset `ready`.
6. Only after upload completion does the editor commit the final asset reference into shared Yjs state.

Rationale:

- avoids WebSocket size limits and replay complexity for large payloads
- gives us resumable upload semantics later
- keeps binary transport separate from CRDT text synchronization

### Download Flow

1. Editor encounters a `collab-asset://` URI.
2. Renderer requests a read token or streamed fetch via authenticated Worker endpoint.
3. Worker verifies org membership and document access via `DocumentRoom`.
4. Ciphertext is streamed from R2 to client.
5. Client decrypts locally and renders from a temp cache.

### Encryption Model

Preferred MVP:

- Use the existing document symmetric key to encrypt asset bytes and metadata.
- Optional follow-up: derive per-asset subkeys from the document key for easier rotation and scoped compromise analysis.

This keeps asset access aligned with existing document key distribution and avoids inventing a second permissions system.

## Editor UX

### Initial Scope

- Paste image into collaborative markdown editor
- Drag/drop image into collaborative markdown editor
- Insert file link attachment from picker for a bounded set of file types
- Render inline images and linked-file chips/previews

### Deferred Scope

- Arbitrary inline binary embeds inside rich custom block types
- Cross-document asset browser
- Reusable shared asset library

### Pending / Offline UX

Recommended behavior for the first implementation:

- Require `DocumentSync` to be connected and initially synced before uploading a new asset.
- Show a local placeholder while upload is in progress.
- If upload fails, keep a recoverable local placeholder state but do not publish the final asset reference into shared content.
- Do not attempt full offline asset upload in the first cut unless the collab edit outbox/recovery work is already complete.

This keeps attachment semantics consistent with the current safety-first direction of collaborative docs.

## History, Restore, and Deletion

### Restore Semantics

- Restoring a document version should restore asset references by `assetId`; it should not duplicate blob bytes.
- A restore creates a new head revision that reuses existing assets where possible.

### Retention

- Removing an attachment from current document content should not immediately delete the blob.
- `DocumentRoom` should track soft-deleted or unreferenced assets long enough to support:
  - history restore
  - reconnect races
  - multi-user editing overlap

Recommended MVP policy:

- keep unreferenced assets for a bounded retention window
- add background garbage collection only after history support lands

### Document Delete

- When a collaborative document is deleted/unshared, delete its asset metadata and schedule R2 blob cleanup.
- Cleanup should be idempotent and safe against partial failure.

## Agent and MCP Considerations

Attachments need explicit identity in agent tooling.

Future MCP/API surface should likely include:

- `collab_list_assets`
- `collab_get_asset_metadata`
- `collab_download_asset`
- `collab_upload_asset`
- `collab_delete_asset`

Agent write flows should be blocked until:

- sync status is inspectable
- upload completion is explicit
- destructive operations have confirmation/permission handling

## Workstreams

## Workstream 1: Asset Identity and Storage

### Deliverables

- Define `DocumentRoom` asset tables and lifecycle states
- Add Worker HTTP endpoints for upload/download/finalize
- Add R2 storage integration for encrypted blobs
- Define asset URI scheme and renderer resolver

### Acceptance Criteria

- [ ] A collaborative document can reference a stable asset ID instead of a local file path.
- [ ] Asset blobs are not stored in D1.
- [ ] Upload and download auth is tied to document access.

## Workstream 2: Editor Insert and Render Flow

### Deliverables

- Paste and drag/drop image support in collaborative markdown mode
- File picker flow for bounded attachment types
- Inline image rendering for `collab-asset://` URIs
- Linked-file preview UI for non-image assets

### Acceptance Criteria

- [ ] A user can paste an image into a collaborative doc and another collaborator can see it.
- [ ] A user can attach a supported file and collaborators can open/download it.
- [ ] Failed uploads do not leave broken shared references in the document.

## Workstream 3: Recovery, History, and Cleanup

### Deliverables

- Asset-aware document restore behavior
- Bounded retention policy for unreferenced assets
- Cleanup flow on document delete/unshare
- Observability for failed upload/fetch/cleanup paths

### Acceptance Criteria

- [ ] Restoring a collaborative document version restores working asset references.
- [ ] Deleting a document eventually cleans up its asset blobs.
- [ ] Asset loss is visible and diagnosable in logs.

## Workstream 4: Agent and Tooling Exposure

### Deliverables

- MCP asset read/write operations
- Transcript-friendly tool outputs for asset actions
- Permission handling for destructive asset operations

### Acceptance Criteria

- [ ] Agents can inspect and upload collab-doc assets using document identity.
- [ ] Agents cannot silently delete or overwrite assets without explicit handling.

## Suggested Sequence

1. Finalize the storage and URI design.
2. Implement `DocumentRoom` asset metadata plus Worker upload/download endpoints.
3. Land image-first editor insert/render support.
4. Add restore-aware retention and cleanup behavior.
5. Expose assets to agent tooling after sync-state and destructive-action handling are in place.

## Open Product Decisions

1. Is the first shipped scope images only, or images plus PDFs/documents?
2. Should assets be reusable across multiple collaborative documents, or strictly document-scoped?
3. What quotas apply per asset, per document, and per org?
4. Do we need export/materialization of collab attachments into workspace files?
5. Should filenames be visible to the server for quota/debugging, or remain encrypted metadata only?

## Risks

- Large uploads will stress reconnect and retry behavior if we do not separate binary transport from CRDT sync.
- Aggressive cleanup could break history restore if asset retention is not tied to snapshot policy.
- Reusing chat attachment code directly would leak file-path assumptions into shared documents.
- Using workspace `.preditor/assets/` for collab docs would create a false portability model and break for non-repo collaborators.
- Asset uploads before document sync safety is complete could recreate the same silent-loss class of bugs the text outbox work is trying to fix.

## Definition of Done

- Users can insert and view supported attachments in collaborative documents across multiple devices.
- Asset references survive reconnect and version restore.
- Asset blobs are encrypted at rest and never stored in D1.
- Upload, fetch, and cleanup failures are visible in UI/logs.
- Agent tooling can safely inspect and operate on collab assets by identity.
