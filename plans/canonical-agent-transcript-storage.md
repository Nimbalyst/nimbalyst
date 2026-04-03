---
planStatus:
  planId: plan-canonical-agent-transcript-storage
  title: Canonical agent transcript storage
  status: in-progress
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - ai
    - runtime
    - transcripts
    - database
    - search
    - sync
  created: "2026-03-17"
  updated: "2026-04-03T14:56:00.000Z"
  progress: 95
---
# Canonical agent transcript storage

## Goal

A two-tier transcript architecture where:

- `ai_agent_messages` is the **sole source of truth** -- the append-only raw log, synced between devices
- `ai_transcript_events` is a **local materialized view** -- derived deterministically from raw messages, never synced

Canonical events provide a unified data model across all providers (Claude Code, Codex, OpenCode, future providers) so the UI and rendering layer never deals with provider-specific message formats.

## Architecture

```
ai_agent_messages  <-->  synced between devices (desktop, mobile)
        |
        v  (local, per-device, derived)
ai_transcript_events  <--  TranscriptTransformer + per-provider parsers
```

### Core principles

1. **Raw log is the only source of truth.** All writes -- provider streaming, user answers, permission grants -- go to `ai_agent_messages` first.
2. **Canonical events are always derived, never written directly.** The `TranscriptTransformer` is the single code path from raw -> canonical. There is no second "live" write path.
3. **Provider-specific parsing is isolated.** Each provider gets its own raw parser class. No giant conditional file. Adding a new provider means adding a new parser, not touching shared code.
4. **Idempotency by watermark.** The transformer tracks `lastRawMessageId` per session. Each raw message is processed exactly once. No in-memory dedup state needed.
5. **Mobile syncs raw messages only.** Mobile reads/writes `ai_agent_messages`. Each device derives canonical events locally.

### Data flow

#### During streaming (desktop)

```
Provider SDK emits chunk
    |
    v
Provider writes raw message to ai_agent_messages
    |
    v
Calls transformer.processNewMessage(sessionId, rawMsgId)
    |
    v
Transformer reads that one raw message
    |
    +--> dispatches to provider-specific parser
    |    (ClaudeCodeRawParser, CodexRawParser, etc.)
    |
    v
Parser returns canonical event descriptor(s)
    |
    v
TranscriptWriter inserts into ai_transcript_events
    |
    v
Watermark (lastRawMessageId) updated atomically
    |
    v
UI notified of new canonical event
```

#### On session load / refresh / restart

```
TranscriptTransformer.ensureUpToDate(sessionId)
    |
    v
Read raw messages WHERE id > lastRawMessageId
    |
    v
If none: no-op (one DB query, zero writes)
If some: process each through provider parser, write canonical events
    |
    v
Update watermark
```

#### Mobile sync

```
Mobile writes answer/message to ai_agent_messages via sync
    |
    v
Desktop receives synced raw message
    |
    v
Next ensureUpToDate() picks it up via watermark gap
    |
    v
Transformer processes it, updates canonical events
```

#### Interactive state (user answers a question)

```
User clicks "Allow" / types answer
    |
    v
Response written to ai_agent_messages as raw message
    (e.g., type: interactive_prompt_response)
    |
    v
transformer.processNewMessage() called immediately
    |
    v
Parser produces update to canonical interactive_prompt event
    |
    v
UI re-renders with answer inline
```

## Per-provider raw parsers

Each parser takes a `RawMessage` and returns canonical event descriptors. Parsers are stateless across calls -- any state needed for tool matching (e.g., mapping tool_use IDs to canonical event IDs) is resolved via DB lookups.

| Parser | Extracted from | Handles |
| --- | --- | --- |
| `ClaudeCodeRawParser` | `TranscriptTransformer.transformOutputMessage()` + `transformInputMessage()` | Claude Code SDK messages (text, assistant, tool_use, tool_result, subagent, nimbalyst_tool_use/result) |
| `CodexRawParser` | `TranscriptTransformer.transformCodexOutputMessage()` | Codex SDK raw events (response items, tool calls, todo lists) |
| `OpenCodeRawParser` | Shares `CodexRawParser` or minor subclass | OpenCode protocol events (same AgentProtocol interface) |

### Parser interface

```typescript
interface IRawMessageParser {
  parseMessage(
    msg: RawMessage,
    context: ParseContext,
  ): Promise<CanonicalEventDescriptor[]>;
}

interface ParseContext {
  sessionId: string;
  /** Look up existing canonical events for tool matching on resume */
  findByProviderToolCallId(id: string): Promise<TranscriptEvent | null>;
}
```

Parsers return descriptors (plain data), not DB rows. The transformer handles writing and sequence assignment.

## What gets deleted

| File/Concept | Why |
| --- | --- |
| `TranscriptEventBus` | No live event emission path -- transformer is the single writer |
| `TranscriptEventHandler` | Same -- handler was the bus consumer that wrote canonical events |
| `AgentProtocolTranscriptAdapter` | Replaced by `CodexRawParser` (parsing raw messages, not live SDK events) |
| `ClaudeCodeTranscriptAdapter` | Replaced by `ClaudeCodeRawParser` |
| `LIVE_WRITE_VERSION` | No live vs legacy distinction -- all sessions use the same transformer path |
| `markSessionAsLive()` | Gone with LIVE_WRITE_VERSION |
| All in-memory dedup Sets/Maps | Watermark makes them unnecessary |

## What stays (refactored)

| Component | Changes |
| --- | --- |
| `TranscriptTransformer` | Becomes the single entry point. Dispatches to per-provider parsers. Existing `transformMessages()` logic extracted into parsers. |
| `TranscriptWriter` | Unchanged -- writes canonical events, assigns sequences. Only called by the transformer. |
| `TranscriptProjector` | Unchanged -- projects canonical events into UI view models. |
| `TranscriptMigrationService` | Simplified -- just calls `transformer.ensureUpToDate()`. No live/legacy branching. |
| Provider implementations | Simplified -- write raw messages only, then call `transformer.processNewMessage()`. No bus emission. |

## Why duplicates become impossible

1. Each raw message has a unique auto-increment `id`
2. The transformer tracks `lastRawMessageId` per session
3. It processes raw messages with `id > lastRawMessageId`
4. After processing, it atomically updates the watermark
5. If it runs twice with the same watermark, it finds zero new messages
6. There is no second write path -- no adapter, no bus, no handler writing canonical events independently
7. No in-memory state to lose on refresh/restart/crash

## Implementation phases

### Phase 1: Extract per-provider parsers

Extract the existing transformer methods into isolated parser classes:
- [x] Define `IRawMessageParser` interface and `CanonicalEventDescriptor` type
- [x] Extract `ClaudeCodeRawParser` from `transformOutputMessage()` + `transformInputMessage()`
- [x] Extract `CodexRawParser` from `transformCodexOutputMessage()`
- [x] Refactor `TranscriptTransformer.transformMessages()` to dispatch to parsers
- [x] Tests: existing transformer tests should pass with no behavior change

### Phase 2: Unify the write path

Make the transformer the single writer, remove the live path:
- [x] Add `transformer.processNewMessages(sessionId, provider)` for incremental processing with onEventWritten callback
- [x] Update providers -- removed bus/markSessionAsLive, adapters now pure parsers (bus=null)
- [x] Remove `TranscriptEventBus` from RepositoryManager (file kept but deprecated, no consumers)
- [x] Remove `TranscriptEventHandler` from RepositoryManager (file kept but deprecated, no consumers)
- [x] Delete `TranscriptEventBus.ts` and `TranscriptEventHandler.ts` files
- [x] Remove bus imports from adapters (inlined minimal interface)
- [x] Update ClaudeCodeTranscriptAdapter.test.ts to work without bus/handler
- [x] Remove `LIVE_WRITE_VERSION` skip -- all sessions now processed by transformer
- [x] Simplify `TranscriptMigrationService` -- `markSessionAsLive()` is now a no-op, onEventWritten delegated to transformer
- [x] Simplify `ensureTransformed()` to `ensureUpToDate()` (check watermark, process new messages)

### Phase 3: Interactive state through raw log

Make interactive responses (user answers, permission grants) flow through raw messages:
- [x] Verified: interactive responses already flow as `nimbalyst_tool_result` raw messages
- [x] Parser handles `nimbalyst_tool_use` and `nimbalyst_tool_result` as tool_call descriptors
- [ ] (Future) Upgrade to `interactive_prompt_created/updated` descriptors for richer canonical representation
- [ ] (Future) Verify mobile can write these raw messages via sync

### Phase 4: Clean up and harden

- [x] Delete `TranscriptEventBus.ts` and `TranscriptEventHandler.ts` files
- [x] Verify session search still works (canonical searchable_text) -- 19 tests pass
- [x] Verify ToolCallMatcher reads from canonical events -- 42 tests pass
- [x] Verify transcript export/display for all providers -- projector tests pass
- [x] Add contract tests per parser: ClaudeCodeRawParser (17 tests), CodexRawParser (7 tests)

## Risks and mitigations

### Latency during streaming

**Risk:** Extra hop (write raw -> transform -> write canonical) adds latency.
**Mitigation:** Processing one raw message is just parse JSON + one INSERT + watermark update. Should be <10ms. If it's noticeable, we can batch the watermark update.

### Interrupted streaming (crash mid-turn)

**Risk:** Some raw messages written, app crashes before they're transformed.
**Mitigation:** Next `ensureUpToDate()` picks them up via watermark gap. Tool results find their started events via `findByProviderToolCallId()` DB lookup.

### Parser drift between providers

**Risk:** Parsers diverge in how they produce canonical events.
**Mitigation:** Contract tests per parser asserting expected canonical output for representative raw input. Shared `CanonicalEventDescriptor` type enforces structural consistency.

## Success criteria

- [ ] All providers write to `ai_agent_messages` only -- no direct canonical writes
- [ ] `TranscriptTransformer` is the single path from raw -> canonical
- [ ] No `TranscriptEventBus`, `TranscriptEventHandler`, or live adapters
- [ ] No `LIVE_WRITE_VERSION` or live/legacy distinction
- [ ] No in-memory dedup state (Sets, Maps) for preventing duplicate canonical events
- [ ] Duplicate canonical events are structurally impossible (watermark guarantees)
- [ ] Mobile syncs raw messages only; each device derives canonical locally
- [ ] Interactive responses flow through raw log -> transformer -> canonical
- [ ] Per-provider parsers are isolated classes, not conditionals in shared code
- [ ] Adding a new provider means adding a parser class, not touching the transformer
