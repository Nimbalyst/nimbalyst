---
planStatus:
  planId: plan-codex-acp-provider
  title: Optional ACP provider for Codex file edit hooks
  status: draft
  planType: design
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - ai
    - codex
    - acp
    - file-history
    - transcripts
  created: "2026-04-15"
  updated: "2026-04-27T00:00:00.000Z"
  progress: 0
---
# Optional ACP Provider For Codex File Edit Hooks

## Goal

Add an optional ACP-backed Codex provider so Nimbalyst can consume native file
edit hooks instead of trying to coerce Codex into routing edits through a
custom patch tool.

When enabled, the ACP path should let Nimbalyst:

- receive structured file edit events before and after writes
- create pre-edit local-history baselines from real edit hooks instead of
  reactive watcher recovery
- create post-edit local-history snapshots tied to the correct session
- render exact edit diffs in the live transcript and after reload
- link all edits back to the producing Nimbalyst session

The feature is opt-in. Existing Codex SDK behavior remains the default.

## Non-Goals

- Do not merge the full historical ACP branch back to `main`.
- Do not make ACP the default path until transcript persistence and packaging
  are correct.
- Do not rely on prompt-level tool enforcement for file edit attribution.
- Do not attempt to parse ACP and Codex SDK raw events with a shared raw
  transformer.
- Do not fork the downstream transcript, local-history, or file-tracking
  systems if a shared canonical model can represent both providers.

## Decision

The previous "Nimbalyst apply patch tool" direction is no longer the primary
path for Codex edit tracking.

Reasoning:

- it depends on Codex honoring tool usage instructions and tool restrictions
- it does not give a hard guarantee against native edits or shell writes
- it shifts edit correctness onto prompt compliance rather than transport-level
  hooks
- ACP already provides a path to real edit callbacks, which is what Nimbalyst
  actually needs for local-history accuracy and transcript fidelity

The patch-tool approach can remain a separate fallback idea, but this design
assumes ACP is the preferred experimental provider.

## Background

The current `openai-codex` integration runs through the Codex SDK provider.
That path can surface `file_change` events after edits land, and Nimbalyst
already has watcher-based recovery logic to reconstruct pre-edit baselines as
best it can.

That is useful but not sufficient:

- pre-edit tagging is reactive rather than hook-driven
- ignored and newly created files can miss an exact before-state
- transcript diffs depend on post-hoc provider event parsing
- the raw provider events are not rich enough to reliably support exact
  per-edit replay through canonical transcript storage

There is already ACP integration work in the repo history:

- branch: `codex-acp-integration`
- usable commit: `d38c58c72`
- summary: `feat: integrate Codex ACP sessions with Nimbalyst transcript UI and MCP tools`

That work should be treated as a source of implementation pieces, not as a
branch to merge wholesale.

## Branch Recovery Assessment

The ACP direction should be revived by selectively porting the ACP commit onto
current `main`.

Current assessment:

- the useful ACP implementation is effectively one commit: `d38c58c72`
- most of that commit is still structurally relevant
- it does not fully solve the current transcript architecture because it
  predates the newer raw-versus-canonical transcript split
- it contains at least one unsafe session-mapping fallback that should not be
  carried forward

Do not merge `codex-acp-integration` as a branch.

Do:

- port the ACP provider pieces from `d38c58c72`
- rework them into the current transcript model
- gate the ACP path behind an explicit experimental provider setting

## Proposal

Add a second provider for ACP rather than hiding ACP behind a transport toggle
inside `openai-codex`.

```ts
interface OpenAICodexProviderSettings {
  enabled: boolean;
}

interface OpenAICodexACPProviderSettings {
  enabled: boolean;
}
```

Providers:

```ts
'openai-codex'
'openai-codex-acp'
```

Expected behavior:

- `openai-codex` continues to use the current Codex SDK implementation
- `openai-codex-acp` uses the ACP-backed implementation
- only one Codex provider is active for a given session
- ACP remains opt-in and experimental

When the ACP provider is selected, Nimbalyst should consume ACP session/update
events for:

- assistant text
- reasoning/thinking chunks
- tool calls and tool results
- file edit lifecycle events
- approvals and permission requests
- session completion and errors

## UI Configuration

The OpenAI Codex settings UI should expose ACP as a separate experimental
provider option rather than as a transport sub-toggle.

Example labels:

- `OpenAI Codex`
- `OpenAI Codex ACP (experimental)`

Copy should be explicit:

- enabled: "Uses the ACP-based Codex provider so Nimbalyst can receive native
  file edit hooks and richer transcript events."
- warning: "Experimental. ACP transcript persistence and packaged-build support
  are still being validated."

This should be global-only in the first version.

## Provider Architecture

### Provider Shape

There should be two separate providers at the integration boundary:

- `openai-codex`
- `openai-codex-acp`

This is preferable here because the providers differ in:

- runtime dependencies
- raw event formats
- file edit hook behavior
- approval behavior
- packaging requirements
- expected lifespan in the codebase

This does add provider-level fan-out through:

- provider selection state
- provider factory wiring
- settings state
- settings UI
- provider/session metadata

That tradeoff is acceptable because ACP is expected to be temporary and easier
to delete cleanly if it is isolated as a provider.

### Shared Downstream Model

Separate providers should not imply separate downstream transcript systems.

Both providers should still target a shared canonical model for:

- assistant text
- reasoning
- tool use and results
- approvals
- file edits
- completion and errors

That means the integration boundary is provider-specific, but transcript replay,
local history, and session-file attribution remain shared.

### Protocol Split

The clean design is:

- keep the current provider and protocol for `openai-codex`
- add `OpenAICodexACPProvider`
- add `CodexACPProtocol` for the ACP path

`OpenAICodexACPProvider` should own ACP-specific runtime wiring. It should not
be folded into `OpenAICodexProvider` through transport conditionals unless that
materially reduces complexity.

## Raw Event Transformation

ACP and Codex SDK should have separate raw transformers or adapters.

Expected shape:

- `CodexSDKRawTransformer`
- `CodexACPRawTransformer`

Those raw transformers should normalize into a shared canonical transcript
schema. Raw parsing is provider-specific. Canonical replay is shared.

## ACP Event Requirements

The ACP provider path must expose structured events that Nimbalyst can
normalize into a stable internal model.

At minimum, Nimbalyst needs normalized events for:

- `assistant_message_chunk`
- `assistant_reasoning_chunk`
- `tool_use`
- `tool_result`
- `permission_request`
- `file_edit_started`
- `file_edit_applied`
- `file_edit_failed`
- `session_completed`
- `session_error`

ACP raw event names do not need to match these names exactly, but the
normalization layer must emit an equivalent internal shape.

## File Edit Hook Behavior

For ACP-backed file edit events:

1. Resolve the Nimbalyst session deterministically.
2. Resolve the file path relative to the workspace or worktree.
3. Capture the true before-state before the write is committed.
4. Create the local-history pending tag with:
   - `sessionId`
   - `toolUseId` or equivalent ACP edit identifier
   - before-content baseline
5. Apply or observe the ACP write completion.
6. Capture the after-state.
7. Create the post-edit local-history snapshot.
8. Track the change through `SessionFileTracker`.
9. Emit normalized transcript data containing the exact diff payload.

This should replace the current Codex watcher-recovery path when ACP is active.

Watcher-based recovery remains a fallback only for provider-path failures or
unexpected ACP gaps.

## Local History Contract

For each ACP edit:

- pre-edit tags must be created before the write lands
- tags must be tied to the correct Nimbalyst session, not the "latest active
  session"
- the edit identifier used for local history and transcript correlation must be
  stable across live rendering and reload
- repeated edits in the same session should preserve the original pending
  baseline unless the user reviews the file between edits
- cross-session conflicts should not silently overwrite ownership of pending
  tags

The previous ACP branch had an unsafe fallback that mapped events to the most
recent active session. That fallback should be removed. ACP provider session
mapping must be explicit and deterministic.

## Transcript Architecture

The ACP work must support both transcript layers:

1. raw provider events in `ai_agent_messages`
2. canonical replay events in `ai_transcript_events`

This is the main design gap in the old ACP branch.

### Raw Transcript Storage

Store ACP source events in `ai_agent_messages` with enough information to debug
provider-path behavior and to support future parser improvements.

Raw storage should preserve:

- original ACP event kind
- session identifier
- tool identifiers
- file edit metadata
- text and reasoning chunks
- timestamps and ordering information

### Canonical Transcript Storage

Canonical replay must not depend on ACP raw event names at render time.

Instead, `TranscriptTransformer` should normalize ACP raw events into the same
canonical event families the UI already expects, plus a new structured edit
event where needed.

At minimum, the canonical layer must support:

- assistant output text
- assistant reasoning text
- tool calls
- tool results
- file edit diffs with per-file metadata

The canonical event for ACP-backed file edits should include:

```ts
{
  type: 'tool_call',
  toolName: 'codex_file_edit',
  toolDisplayName: 'Codex File Edit',
  status: 'completed' | 'error',
  providerToolCallId: string,
  changes: Array<{
    path: string;
    patch: string;
    linesAdded: number;
    linesRemoved: number;
    beforeContentHash: string | null;
    afterContentHash: string | null;
  }>;
}
```

The important point is not the exact event name. The important point is that
canonical replay owns the stable schema, not ACP raw storage.

## Transcript UI Behavior

The live transcript and reloaded transcript should render the same result for
ACP edit events.

The widget should show:

- edit summary
- changed file list
- additions and removals
- expandable unified diff per file
- local-history review state if available
- links to affected files

There should not be one rendering path for live ACP sessions and another for
reloaded sessions with materially different data quality.

## Packaging Requirements

ACP is not only a runtime code change. Packaged builds need the native ACP
dependencies included explicitly.

The implementation should add packaged-build support for:

- ACP runtime dependencies
- any native binaries required by the ACP provider path
- correct unpack/include rules in Electron packaging

This needs to be treated as part of the first usable ACP rollout, not as a
follow-up.

## Implementation Plan

### Phase 1: Recover ACP Provider

1. Port the ACP implementation pieces from `d38c58c72`.
2. Add `OpenAICodexACPProvider`.
3. Isolate ACP runtime logic into `CodexACPProtocol` and its raw transformer.
4. Remove any env-var defaulting that makes ACP implicit.

### Phase 2: Deterministic Session Mapping

1. Replace any "latest active session" fallback with explicit session binding.
2. Ensure ACP callbacks always resolve to the correct Nimbalyst session.
3. Add tests covering concurrent Codex sessions.

### Phase 3: File Edit Hook Integration

1. Normalize ACP file edit events into a stable internal shape.
2. Create pre-edit local-history tags before writes land.
3. Create post-edit snapshots after successful writes.
4. Track edited files through `SessionFileTracker`.
5. Keep watcher recovery as fallback only.

### Phase 4: Transcript Persistence

1. Store ACP raw events in `ai_agent_messages`.
2. Extend `TranscriptTransformer` to parse ACP raw events.
3. Emit stable canonical replay events in `ai_transcript_events`.
4. Ensure assistant text, reasoning, tools, and file edits all survive reload.

### Phase 5: Transcript UI

1. Reuse existing transcript widgets where canonical event shapes already match.
2. Add or extend a diff widget for ACP-backed file edit events.
3. Ensure live and reloaded sessions render the same diff content.

### Phase 6: Settings And Rollout

1. Add `openai-codex-acp` as an experimental provider option in settings.
2. Keep `openai-codex` as the default for existing users.
3. Add debug logging and internal diagnostics for provider selection and ACP
   event normalization.
4. Roll out ACP only as an opt-in testing path.

### Phase 7: Packaging

1. Add Electron packaging rules for ACP dependencies and binaries.
2. Validate ACP in development and packaged app builds.

## Files Likely Touched

- `packages/runtime/src/ai/server/providers/OpenAICodexProvider.ts`
- `packages/runtime/src/ai/server/providers/OpenAICodexACPProvider.ts`
- `packages/runtime/src/ai/server/ProviderFactory.ts`
- `packages/runtime/src/ai/server/protocols/CodexSDKProtocol.ts`
- `packages/runtime/src/ai/server/transcript/CodexSDKRawTransformer.ts`
- `packages/runtime/src/ai/server/protocols/CodexACPProtocol.ts`
- `packages/runtime/src/ai/server/transcript/CodexACPRawTransformer.ts`
- `packages/runtime/src/ai/server/transcript/TranscriptTransformer.ts`
- `packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/*`
- `packages/electron/src/main/services/ai/AIService.ts`
- `packages/electron/src/main/services/SessionFileTracker.ts`
- `packages/electron/src/main/services/ToolCallMatcher.ts`
- `packages/electron/package.json`
- `packages/electron/src/renderer/components/GlobalSettings/panels/OpenAICodexPanel.tsx`
- `packages/electron/src/renderer/store/atoms/appSettings.ts`

## Risks

- ACP raw event formats may differ enough from current transcript assumptions
  that normalization work is larger than the old branch suggested.
- Concurrent-session mapping bugs could attach edits or approvals to the wrong
  session if provider binding is sloppy.
- Packaged builds may fail if ACP native assets are not explicitly included.
- The old ACP branch may contain UI assumptions that no longer match the newer
  transcript storage model.
- ACP may still need targeted adaptation for ask/approval flows that differ from
  the Codex SDK path.

## Success Criteria

- Existing Codex sessions behave unchanged when using `openai-codex`.
- When using `openai-codex-acp`, Nimbalyst receives native file edit hooks for
  common Codex edits.
- Pre-edit local-history tags are created before ACP-backed writes land.
- Post-edit snapshots are created after ACP-backed writes complete.
- Transcript diffs render live during ACP sessions.
- Reloaded sessions show the same assistant output, reasoning, tool activity,
  and file diffs via canonical transcript replay.
- Concurrent ACP Codex sessions keep edits, permissions, and transcript events
  attached to the correct session.
- ACP works in both development and packaged builds.

## Open Questions

- What exact ACP raw events should be treated as the source of truth for edit
  start versus edit applied?
- Should ACP-backed file edits be modeled canonically as `tool_call` events or
  as a dedicated `file_edit` canonical event family?
- Does ACP support the equivalent of the current Codex SDK "ask" flow well
  enough to enable it under ACP, or does that remain a provider-specific
  limitation?
