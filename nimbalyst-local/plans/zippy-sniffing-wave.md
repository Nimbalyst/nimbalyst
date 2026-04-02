---
status: draft
---

# Remove CodexOutputRenderer: Unify Codex Rendering Through Normal Path

## Context

The canonical transcript refactor replaced the legacy `Message` type with `TranscriptViewMessage`. The canonical pipeline (TranscriptTransformer -> TranscriptProjector -> UI) already decomposes Codex raw events into structured canonical events (assistant_message, tool_call, system_message). However, the UI still has a parallel rendering path (`CodexOutputRenderer`) that depends on `message.metadata.codexProvider` -- a field the canonical pipeline never populates.

This causes blank rendering for Codex/OpenAI sessions: after a DB reload, metadata is lost, the CodexOutputRenderer path is skipped, and the decomposed events render through the normal path -- which works for tool calls and text, but the CodexOutputRenderer also handled reasoning blocks and todo lists that the transformer currently skips.

The fix: remove the CodexOutputRenderer rendering path, ensure the transformer produces canonical events for all Codex content types, and let everything render through the unified normal path.

## What Codex sessions lose (acceptable)

- **Single-bubble grouping**: Codex turns currently render as one message bubble. With the normal path, each event (text, tool call) gets its own message -- same as Claude sessions. This is the intended unification.
- **Inline temporal interleaving**: Reasoning + tools + output interleaved in one bubble. Now they're separate messages in chronological order -- which is what the normal path already does.

## What needs to change to avoid data loss

The transformer currently skips two Codex-specific content types. These need canonical event types so they render:

1. **Reasoning blocks** (`ce.reasoning` from `parseCodexEvent`): Currently `// reasoning is internal thinking -- skip`. Should be written as `assistant_message` events with a payload flag (e.g. `isReasoning: true`) so the UI can style them as collapsible thinking blocks if desired. For now, rendering as normal assistant text is acceptable.

2. **Todo lists** (`ce.todoItems` from `parseCodexEvent`): Currently not handled by the transformer (the CodexOutputRenderer's `parseCodexRawEvents` handles them). Should be written as `assistant_message` events with formatted text (checkbox markdown). This is acceptable since todo lists are just progress indicators.

## Teammate metadata (separate concern)

The UI also reads `message.metadata.isTeammateMessage` and `message.metadata.teammateName` to render teammate notifications. The transformer does NOT handle this metadata at all -- teammate input messages are stored as plain `user_message` events without any teammate flag.

This is a pre-existing gap but is NOT blocking the blank rendering fix. Teammate metadata is only used for Claude Code sessions (not Codex), and the teammate rendering path is a nice-to-have notification style. Fixing it would require:
- Adding `isTeammateMessage` and `teammateName` to `UserMessagePayload`
- Having the transformer detect `teammate_message_injected` in raw message metadata
- Setting these fields when writing user_message events

This can be done in a follow-up. For now, teammate messages render as normal user messages (which is functional, just less polished).

## Implementation steps

### 1. TranscriptTransformer: Write reasoning events (~5 lines)

**File**: `packages/runtime/src/ai/server/transcript/TranscriptTransformer.ts` (line ~552)

Currently:
```
// reasoning is internal thinking -- skip
```

Change to: write reasoning text as an assistant_message. No payload changes needed -- reasoning text is just text.

```typescript
if (ce.reasoning) {
  const event = await writer.appendAssistantMessage(sessionId, ce.reasoning, {
    createdAt: msg.createdAt,
  });
  if (event) eventsWritten++;
}
```

### 2. TranscriptTransformer: Write todo_list events (~15 lines)

**File**: `packages/runtime/src/ai/server/transcript/TranscriptTransformer.ts` (inside `transformCodexOutputMessage`, after the reasoning block)

`parseCodexEvent` returns `ce.todoItems` as `Array<{text: string, completed: boolean}>`. Convert to markdown checkbox text and write as an assistant_message:

```typescript
if (ce.todoItems && ce.todoItems.length > 0) {
  const todoText = ce.todoItems
    .map(t => `- [${t.completed ? 'x' : ' '}] ${t.text}`)
    .join('\n');
  const event = await writer.appendAssistantMessage(sessionId, todoText, {
    createdAt: msg.createdAt,
  });
  if (event) eventsWritten++;
}
```

### 3. RichTranscriptView: Remove CodexOutputRenderer path (~90 lines removed)

**File**: `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`

Remove the entire `isCodexRawEvent` block (lines ~1559-1649):
- The `isCodexRawEvent` check and all its branches
- The `CodexOutputRenderer` import
- The Codex elapsed time calculation block

After removal, Codex messages flow through the normal rendering path (MessageSegment, tool cards, etc.) -- same as Claude Code sessions.

### 4. Verify parseCodexEvent return type has reasoning/todoItems

**File**: `packages/runtime/src/ai/server/providers/codex/codexEventParser.ts`

Verify the `ParsedCodexEvent` interface includes `reasoning?: string` and `todoItems?: Array<{text: string, completed: boolean}>`. These fields should already exist since `CodexOutputRenderer.parseCodexRawEvents` handles them. If the transformer's `parseCodexEvent` doesn't return them, add support.

### 5. Update tests

**File**: `packages/runtime/src/ui/AgentTranscript/components/__tests__/CodexOutputRenderer.test.ts`

The `parseCodexRawEvents` function is only used by `CodexOutputRenderer`. Once the renderer is removed, this test file tests dead code. Options:
- Delete the test file (the function is no longer called)
- Or keep it if `parseCodexRawEvents` is still exported for other use

**File**: `packages/runtime/src/ai/server/transcript/__tests__/TranscriptTransformer.test.ts` (if it exists)

Add test cases for reasoning and todo_list events being written as assistant_messages.

## Critical files

- `packages/runtime/src/ai/server/transcript/TranscriptTransformer.ts` -- write reasoning + todos
- `packages/runtime/src/ai/server/providers/codex/codexEventParser.ts` -- verify ParsedCodexEvent type
- `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx` -- remove Codex path
- `packages/runtime/src/ui/AgentTranscript/components/CodexOutputRenderer.tsx` -- may become dead code
- `packages/runtime/src/ui/AgentTranscript/components/__tests__/CodexOutputRenderer.test.ts` -- update/remove

## Verification

1. `npx tsc --noEmit -p packages/runtime/tsconfig.json 2>&1 | grep "error TS" | grep -v "extension-sdk" | wc -l` -- 0
2. `npx tsc --noEmit -p packages/electron/tsconfig.json 2>&1 | grep "error TS" | grep -Ev "extension-sdk|ThemesPanel|PanelContainer|ExtensionConfigPanel|InstalledExtensionsPanel|ThemeHandlers" | wc -l` -- 0
3. `npx vitest run packages/runtime/src/ai/server/transcript/__tests__/` -- all pass
4. `npx vitest run packages/runtime/src/ui/AgentTranscript/` -- all pass
5. Manual: Open an existing OpenAI Codex session -- should render tool calls, text output, and reasoning as normal messages (not blank)
6. Manual: Open a Claude Code session -- should render identically to before (no regression)
