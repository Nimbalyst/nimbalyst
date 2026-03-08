---
planStatus:
  planId: plan-collab-document-mvp-completion
  title: Collaborative Document MVP Completion
  status: draft
  planType: system-design
  priority: critical
  owner: ghinkle
  stakeholders:
    - development-team
    - alpha-users
  tags:
    - collaboration
    - collabv3
    - safety
    - history
    - agent-tools
    - recovery
  created: "2026-03-07"
  updated: "2026-03-07T00:00:00.000Z"
  progress: 0
---
# Collaborative Document MVP Completion

## Implementation Progress

- [ ] Ship a persisted offline outbox for collaborative document edits
- [ ] Add explicit sync-state UX and block unsafe editing states
- [ ] Add local recovery for unsynced collaborative changes across app restart
- [ ] Add collaborative document history, version browsing, and restore
- [ ] Add rename and move UX for collaborative documents
- [ ] Add stable document identity rules and clean up share/create flows
- [ ] Expose collaborative documents to agents via MCP tools
- [ ] Add destructive-action safety, recovery, and audit metadata
- [ ] Add end-to-end tests for offline, reconnect, history, rename, and agent flows
- [ ] Add observability for queue depth, replay success, sync failures, and recovery events

## Goals

1. Make collaborative documents safe enough for ongoing alpha use by eliminating silent data loss.
2. Complete the minimum document lifecycle so collaborative docs behave like real documents, not transient sync sessions.
3. Give users recovery and restore tools before wider rollout.
4. Make collaborative documents first-class targets for agents and internal MCP tooling.
5. Define a clear release gate for when collaborative documents can be considered MVP-complete.

## Problem Summary

The current collaborative document path is functional for happy-path live editing, but it is not yet safe or complete:

- The collaborative editor intentionally skips autosave, history snapshots, and conflict UI.
- Local Yjs updates are only sent while the WebSocket is open.
- Reconnect only pushes local state automatically when the server has no prior state, which means edits made while disconnected to an existing document can be stranded.
- Collaborative document rename exists at the protocol/index layer but is not exposed as a direct user action in the sidebar.
- Existing document-history infrastructure is not wired to collaborative documents.
- Agent-facing document tools operate on filesystem paths, not collaborative document identities.

This is sufficient for a prototype, but not for an alpha feature where users expect shared documents to preserve work, support rename, and provide rollback.

## Current State

### Existing Strengths

- `DocumentRoom` already provides encrypted update storage, sync pagination, snapshots for compaction, and key-envelope exchange.
- `TeamRoom` already stores the collaborative document index and supports title updates and deletion.
- `DocumentSyncProvider` already owns the local Yjs document and handles reconnect attempts.
- `HistoryManager` already provides a local snapshot store, deduplication, and retention logic for normal documents.
- The MCP server already supports internal tool exposure and custom tool widgets.

### Current Gaps

- No durable local outbox for offline collaborative edits.
- No persisted recovery state for unsynced collaborative changes.
- No version history or restore flow for collaborative documents.
- No direct rename action in the collaborative document sidebar.
- No clear distinction between safe and unsafe editing states.
- No collaborative document MCP tools.
- No alpha ship bar or test matrix for failure scenarios.

## MVP Completion Definition

Collaborative documents are MVP-complete when all of the following are true:

1. A user can disconnect, continue editing, reconnect, and keep all changes.
2. A user can restart the app while a collaborative document has unsynced local changes and recover them.
3. A user can create, rename, move, delete, version, and restore collaborative documents.
4. An agent can read, write, rename, and restore collaborative documents through explicit tools.
5. Failure modes are visible in the UI, logged, and covered by end-to-end tests.

## Scope

### In Scope

- Safety and recovery for collaborative document content edits
- Collaborative document history and restore
- Collaborative document rename and move UX
- Stable document identity and document-index cleanup
- Collaborative document MCP tools
- Observability and end-to-end validation

### Out of Scope for This MVP

- Fine-grained role-based permissions beyond current team membership model
- Commenting, inline annotations, or suggestion mode
- Full collaborator review-gate UI parity with AI diff review
- Long-term archival and legal retention policy beyond MVP-safe defaults
- Rich non-markdown collaborative document types

## Workstream 1: Safety and Connection Truth

### Objective

Guarantee that collaborative edits are never silently discarded.

### Deliverables

- Add a persisted outbox for collaborative document mutations in local PGLite.
- Queue local Yjs updates whenever the socket is not open instead of dropping them.
- Replay queued mutations after successful sync on reconnect.
- Persist queue state across reload and app restart.
- Track per-document sync state:
  - `connecting`
  - `initial-sync-required`
  - `connected`
  - `offline-unsynced`
  - `replaying`
  - `sync-error`
- Block editing before first successful sync unless the document is being created locally for first bootstrap.
- Warn on tab close and app quit when a collaborative document has unsynced changes.

### Design Notes

- Use the `TrackerSyncProvider` offline queue as the behavioral model for replay semantics.
- Store queued Yjs updates and recovery metadata by `collab://` URI or `(orgId, documentId)` rather than file path.
- Reconnect logic must not depend on the server being empty.
- Queue replay should happen only after initial sync so merge state is current before local changes are reapplied.

### Acceptance Criteria

- [ ] Offline edits to an existing collaborative document survive reconnect.
- [ ] Offline edits survive app restart and are recoverable.
- [ ] Users see a visible unsynced state while disconnected.
- [ ] Users cannot type into a never-synced collaborative document without an explicit safe bootstrap path.
- [ ] Closing a tab with unsynced edits warns the user.

## Workstream 2: Collaborative History and Versioning

### Objective

Give collaborative documents bounded, user-visible history with restore.

### Deliverables

- Add collaborative snapshot creation using the existing `HistoryManager` pattern.
- Decide on snapshot storage key:
  - preferred: use `collab://org:{orgId}:doc:{documentId}` as the history identity
- Create snapshot triggers:
  - manual snapshot
  - periodic bounded autosnapshot
  - pre-restore checkpoint
  - optional share/bootstrap checkpoint
- Add collaborative history UI:
  - list versions
  - preview snapshot metadata
  - restore selected version
- Define restore semantics as "restore by creating a new head revision", not destructive rewind.
- Track restore metadata such as actor, timestamp, and source snapshot.

### Design Notes

- The `DocumentRoom` snapshot table is currently for sync compaction, not end-user history. Keep those concerns separate.
- History should be local-first for recovery speed, with the option to later sync metadata or versions if needed.
- The first MVP does not need branching or diff-heavy history UI if snapshot preview plus restore is sufficient.

### Acceptance Criteria

- [ ] A user can open history for a collaborative document.
- [ ] A user can restore a previous version without corrupting current sync state.
- [ ] Restore creates a new recoverable head state.
- [ ] History survives app restart.

## Workstream 3: Document Lifecycle Completeness

### Objective

Make collaborative documents behave like normal documents for basic operations.

### Deliverables

- Add rename action to the collaborative sidebar context menu.
- Add rename modal and keyboard-friendly rename flow.
- Keep drag-and-drop move behavior, but make it explicit and discoverable.
- Decide how create, rename, move, and delete behave while offline:
  - recommended MVP: block metadata/destructive operations while offline unless a metadata outbox is also implemented
- Replace any title-derived identity assumptions with stable UUID-based document IDs.
- Audit "share to team" flows so sharing two same-named files cannot collide on document identity.
- Add `lastEditedAt` and `lastEditedBy` surface metadata where useful.

### Design Notes

- Protocol support for title updates already exists; this work is primarily UX, lifecycle policy, and identity hardening.
- Current local optimistic updates for collaborative document index mutations should not imply server success when disconnected.

### Acceptance Criteria

- [ ] Users can rename a collaborative document from the sidebar.
- [ ] Users can move documents between folders without inconsistent local/server state.
- [ ] Collaborative documents have stable IDs independent of title/path.
- [ ] Same-named documents from different local origins do not collide.
- [ ] Offline metadata operations are either safely queued or explicitly blocked.

## Workstream 4: Agent Tool Exposure

### Objective

Expose collaborative documents as first-class agent resources.

### Deliverables

- Add MCP tools for:
  - `collab_list_documents`
  - `collab_open_document`
  - `collab_get_document_content`
  - `collab_create_document`
  - `collab_rename_document`
  - `collab_move_document`
  - `collab_replace_document_content`
  - `collab_append_document_content`
  - `collab_list_versions`
  - `collab_restore_version`
  - `collab_get_sync_status`
- Use collaborative identity, not filesystem path, as the primary target.
- Add permission handling for destructive agent operations.
- Add custom transcript widgets where restore/version operations benefit from explicit review.

### Design Notes

- Collaborative tools should integrate with the same MCP server infrastructure used by tracker and visual tools.
- Opening a collaborative document from a tool should route through the existing collab opener and tab system.
- The tools should be explicit enough that agents cannot accidentally target the wrong shared doc.

### Acceptance Criteria

- [ ] Agents can read and modify collaborative documents without relying on local file paths.
- [ ] Agents can inspect sync status before writing.
- [ ] Restore and delete actions require explicit confirmation or permission handling.
- [ ] Tool results are understandable in the transcript UI.

## Workstream 5: Observability and Validation

### Objective

Make failure modes measurable and prove the safety bar in tests.

### Deliverables

- Add structured logging for:
  - outbox enqueue
  - outbox replay start/end
  - replay failure
  - recovery restored
  - sync disconnect/reconnect duration
  - history restore events
- Add analytics for:
  - offline editing sessions
  - recovered unsynced changes
  - version restores
  - collaborative rename usage
  - agent collaborative tool usage
- Add E2E tests for:
  - offline edit then reconnect on existing doc
  - offline edit then app restart then reconnect
  - rename and move flows
  - history snapshot and restore
  - agent collaborative document tool flow
  - two-user concurrent edit around disconnect

### Acceptance Criteria

- [ ] There is an end-to-end test that reproduces the original alpha failure and now passes.
- [ ] Replay/recovery paths emit logs that are easy to debug.
- [ ] Product analytics capture the main safety and recovery actions.

## Suggested Sequence

### Phase 1: Alpha Safety Patch

- Implement persisted edit outbox
- Implement reconnect replay
- Add unsynced-state UI
- Add close-tab/app-close warnings
- Add regression tests for offline editing loss

### Phase 2: Recovery and Versioning

- Wire collaborative docs into local history storage
- Add history dialog support
- Add restore flow and restore checkpoints

### Phase 3: Lifecycle Completion

- Add rename UI
- Harden create/share identity rules
- Finalize offline policy for metadata operations

### Phase 4: Agent Exposure

- Add collaborative MCP tools
- Add destructive-action permission handling
- Add any needed transcript widgets

### Phase 5: Exit Criteria

- Run full multi-user validation
- Validate crash/restart recovery
- Review logs and analytics from alpha usage
- Remove any remaining "prototype only" warnings

## Open Product Decisions

1. Should collaborative metadata operations queue offline, or should MVP block them while disconnected?
2. Should collaborative history remain local-only for MVP, or should snapshot metadata also sync later?
3. Do we want remote collaborator edits to autosave immediately after reconnect, or should collaborative review-gate work remain a post-MVP enhancement?
4. What is the intended retention policy for inactive collaborative documents?

## Risks

- Replaying raw Yjs updates incorrectly could duplicate or reorder operations if replay boundaries are not clear.
- Mixing local recovery snapshots with collaborative sync state could create confusing restore semantics if restore is treated as a rewind instead of a new head revision.
- Continuing to use title-derived identity in any share flow will create collisions and hard-to-debug recovery failures.
- Shipping agent write tools before sync-state inspection and permissions are in place increases the blast radius of mistakes.

## Acceptance Criteria

- [ ] Collaborative document edits are never silently lost due to disconnect.
- [ ] Collaborative documents support history and restore.
- [ ] Collaborative documents support rename and move.
- [ ] Collaborative documents have stable identities independent of title.
- [ ] Agents can operate on collaborative documents through explicit MCP tools.
- [ ] Offline, reconnect, restart, and restore flows are covered by automated tests.
- [ ] Alpha users can recover from both accidental restore mistakes and transient network loss.
