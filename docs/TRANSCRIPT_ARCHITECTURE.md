# Transcript Architecture

How AI session transcripts are stored, transformed, and rendered.

## Two-tier storage

| Table | Purpose | Written by |
|-------|---------|------------|
| `ai_agent_messages` | Append-only raw source log. Preserves provider-native payloads exactly as received from each SDK. | Providers via `logAgentMessage()` |
| `ai_transcript_events` | Canonical, provider-agnostic events optimized for rendering, search, and sync. | `TranscriptTransformer` (the single writer) |

The raw log is the sole source of truth. Canonical events are derived from it and can be regenerated at any time.

## Data flow

```
Provider SDK (Claude Code, Codex, OpenCode)
    |
    v
Provider writes raw chunk to ai_agent_messages
    |
    v
TranscriptTransformer reads new raw messages (watermark-based)
    |
    v
Per-provider parser (ClaudeCodeRawParser / CodexRawParser)
produces CanonicalEventDescriptors
    |
    v
Transformer processes descriptors via TranscriptWriter
    |
    v
Canonical events written to ai_transcript_events
    |
    v
onEventWritten callback fires (IPC to renderer)
    |
    v
TranscriptProjector projects events into TranscriptViewMessages
    |
    v
RichTranscriptView renders the UI
```

## Key components

All located in `packages/runtime/src/ai/server/transcript/`.

### TranscriptTransformer

The central component. Owns the single path from raw messages to canonical events.

**Two modes of operation:**

1. **Batch** (`ensureUpToDate(sessionId, provider)`) -- Lazy migration on session load. Reads all unprocessed raw messages since the last watermark and transforms them. Called by `TranscriptMigrationService.getCanonicalEvents()` before returning events.

2. **Incremental** (`processNewMessages(sessionId, provider)`) -- Real-time processing during streaming. Called after new raw messages are written. Returns the canonical events that were written and fires `onEventWritten` for each so the renderer can update live.

**Watermark tracking:** The `ai_sessions` table stores per-session transform state:
- `canonical_transform_version` -- Parser version. Bumped to force re-transformation.
- `canonical_last_raw_message_id` -- Watermark. Only messages with `id > watermark` are processed.
- `canonical_transform_status` -- `pending | complete | error`

### Per-provider parsers

Located in `packages/runtime/src/ai/server/transcript/parsers/`.

| Parser | Provider(s) | Handles |
|--------|-------------|---------|
| `ClaudeCodeRawParser` | `claude-code` (default) | SDK chunks: `assistant`, `text`, `tool_use`, `tool_result`, `error`, `nimbalyst_tool_use/result`, subagent spawns |
| `CodexRawParser` | `openai-codex`, `open-code` | Codex SDK events via `parseCodexEvent()`, `todo_list`, MCP tool unwrapping |

Parsers implement `IRawMessageParser`:
```typescript
interface IRawMessageParser {
  parseMessage(msg: RawMessage, context: ParseContext): Promise<CanonicalEventDescriptor[]>;
}
```

Parsers are **pure functions** over a single message -- they return data descriptors, never write to the DB. The transformer handles writing and tool ID tracking.

**ParseContext** provides dedup state to parsers:
- `hasToolCall(id)` / `hasSubagent(id)` -- in-memory maps managed by the transformer
- `findByProviderToolCallId(id)` -- DB fallback for cross-batch tool matching on resume

### CanonicalEventDescriptor

Discriminated union of 12 types that map 1:1 to `TranscriptWriter` methods:

| Descriptor | Writer method | Notes |
|------------|---------------|-------|
| `user_message` | `appendUserMessage` | |
| `assistant_message` | `appendAssistantMessage` | |
| `system_message` | `appendSystemMessage` | System reminders, errors |
| `tool_call_started` | `createToolCall` | Registers in toolEventIds map |
| `tool_call_completed` | `updateToolCall` | Resolves via toolEventIds or DB lookup |
| `tool_progress` | `appendToolProgress` | |
| `subagent_started` | `createSubagent` | Agent/Task spawns |
| `subagent_completed` | `updateSubagent` | |
| `interactive_prompt_created` | `createInteractivePrompt` | Permission requests, questions |
| `interactive_prompt_updated` | `updateInteractivePrompt` | User responses |
| `turn_ended` | `recordTurnEnded` | Token usage, context fill |

### TranscriptWriter

Shared service for writing canonical events. Owns sequence assignment and searchable flag decisions. Used by the transformer only (not by providers directly).

### TranscriptProjector

Pure function that projects `TranscriptEvent[]` into `TranscriptViewModel` for UI rendering. Groups tool progress under parent tool calls, nests subagent child events, and attaches turn-ended metadata.

### TranscriptMigrationService

Higher-level service wrapping the transformer. Primary API for consumers:
- `getCanonicalEvents(sessionId, provider)` -- Ensures transformed, returns events
- `getViewMessages(sessionId, provider)` -- Chains events through projector
- `processNewMessages(sessionId, provider)` -- Incremental processing
- `getTailEvents(sessionId, provider, count)` -- Efficient tail query for previews
- `setOnEventWritten(cb)` -- Wires real-time notification callback

## Provider integration

Providers write raw messages via `logAgentMessage()` / `logAgentMessageNonBlocking()` (defined in `AIProvider.ts`). They do **not** write canonical events directly.

Each provider also uses a **chunk parser adapter** that converts SDK-specific streaming chunks into typed `ParsedItem[]` for the provider's streaming yield loop (UI rendering). These adapters are separate from the raw message parsers:

| Adapter | Used by | Returns |
|---------|---------|---------|
| `ClaudeCodeTranscriptAdapter` | `ClaudeCodeProvider` | `ParsedItem[]` per SDK chunk |
| `AgentProtocolTranscriptAdapter` | `OpenAICodexProvider`, `OpenCodeProvider` | `ParsedItem[]` per protocol event |

These adapters parse chunks for the provider's `yield` loop only. They do not write to the DB or emit canonical events.

## Canonical event types

Stored in `ai_transcript_events.event_type`:

| Type | Searchable | Description |
|------|-----------|-------------|
| `user_message` | yes | User prompts |
| `assistant_message` | yes | AI responses |
| `system_message` | yes | System reminders, errors, status |
| `tool_call` | no | Tool invocations with arguments and results |
| `tool_progress` | no | Long-running tool progress updates |
| `interactive_prompt` | no | Permission requests, user questions, commit proposals |
| `subagent` | no | Agent/Task teammate spawns |
| `turn_ended` | no | Token usage and context fill metadata |

## Mobile sync

Mobile sync works naturally through the watermark mechanism:

1. Mobile writes a raw message (e.g., permission response) to the sync server
2. Desktop receives it via `messageBroadcast` and writes to local `ai_agent_messages`
3. The message gets a local `id` higher than the watermark
4. Next `ensureUpToDate()` picks it up and transforms it

No special handling is needed. The transformer processes all raw messages uniformly regardless of origin (local provider, synced from mobile, or recovered from backup).

## Session lifecycle

```
Session created (no canonical state)
    |
    v
First message logged to ai_agent_messages
    |
    v
UI loads session -> getCanonicalEvents()
    |
    v
ensureUpToDate() sees null status -> transformFromBeginning()
    |
    v
All raw messages parsed and written as canonical events
Status set to (version=4, watermark=lastMsgId, status=complete)
    |
    v
New messages during streaming -> logged to ai_agent_messages
    |
    v
Next ensureUpToDate() -> resumeTransformation(afterId=watermark)
Only new messages processed, watermark advanced
```

## System reminder handling

System reminders (`<SYSTEM_REMINDER>` tags or `metadata.promptType === 'system_reminder'`) are classified as `system_message` events by both parsers. The `RichTranscriptView` renders these with the `SystemReminderCard` widget instead of displaying them as user messages.

## Version management

`TranscriptTransformer.CURRENT_VERSION` (currently 4) tracks the parser version. When bumped:
- Sessions at the old version are re-transformed from scratch on next load
- Sessions at `LIVE_WRITE_VERSION` (1000, legacy) are also re-processed
- The watermark and all canonical events are rebuilt

This ensures parser improvements (like better system reminder detection) apply retroactively to existing sessions.

## File locations

```
packages/runtime/src/ai/server/transcript/
  TranscriptTransformer.ts      -- Core transformer (batch + incremental)
  TranscriptWriter.ts           -- Canonical event writer
  TranscriptProjector.ts        -- Event -> view model projection
  TranscriptMigrationService.ts -- High-level API for consumers
  types.ts                      -- Canonical event type definitions
  parsers/
    IRawMessageParser.ts        -- Parser interface + descriptor types
    ClaudeCodeRawParser.ts      -- Claude Code raw message parser
    CodexRawParser.ts           -- Codex/OpenCode raw message parser
  __tests__/
    TranscriptTransformer.test.ts
    ClaudeCodeRawParser.test.ts -- Parser contract tests
    CodexRawParser.test.ts      -- Parser contract tests
    ...

packages/runtime/src/ai/server/providers/
  claudeCode/
    ClaudeCodeTranscriptAdapter.ts  -- Chunk parser for streaming UI
  agentProtocol/
    AgentProtocolTranscriptAdapter.ts -- Event parser for streaming UI

packages/electron/src/main/services/
  RepositoryManager.ts              -- Wires transformer + onEventWritten
  TranscriptMigrationAdapters.ts    -- DB adapters for IRawMessageStore, ISessionMetadataStore
```
