---
status: in-progress
---

# Finish: Remove CanonicalTranscriptConverter

## Context

The canonical transcript refactor replaced the legacy `Message` type with `TranscriptViewMessage` as the UI rendering type. The converter (`CanonicalTranscriptConverter.ts`) has been deleted, the pipeline now flows directly from the projector to the UI, and `SessionData.messages` is typed as `TranscriptViewMessage[]`. 102 transcript tests pass.

However, ~34 source errors and ~59 test errors remain from incomplete field-access migration in 3 UI rendering files.

## Source errors (34 across 3 files)

### 1. `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`

**Null safety on `message.text` (3 errors)**

| Line | Current | Fix |
|------|---------|-----|
| 354 | `const content = message.text` | `(message.text ?? '')` |
| 1034 | `copyToClipboard(message.text)` | `copyToClipboard(message.text ?? '')` |
| 1835 | `message.text.length > 200` | `(message.text ?? '').length > 200` |

**Subagent auto-expand uses toolCall instead of subagentId (2 errors)**

| Line | Current | Fix |
|------|---------|-----|
| 1046 | `msg.type === 'subagent' && msg.toolCall.providerToolCallId` | `msg.type === 'subagent' && msg.subagentId` |
| 1047 | `subAgentIds.add(msg.toolCall.providerToolCallId)` | `subAgentIds.add(msg.subagentId!)` |

**Legacy ToolCall fields that should come from subagent (10 errors)**

These fields don't exist on the canonical `toolCall` type. They live on `toolMsg.subagent` now:

| Line | Current | Fix |
|------|---------|-----|
| 1242 | `tool.teammateName` | `toolMsg.subagent?.teammateName` |
| 1246 | `tool.teammateMode` | `toolMsg.subagent?.teammateMode` |
| 1247 | `tool.teammateMode` (JSX) | `toolMsg.subagent?.teammateMode` |
| 1249 | `tool.subAgentType` | `toolMsg.subagent?.agentType` |
| 1250 | `tool.subAgentType` (JSX) | `toolMsg.subagent?.agentType` |
| 1290 | `tool.teammateAgentId` | `toolMsg.subagentId` |
| 1384 | `tool.childToolCalls!.length` | `(toolMsg.subagent?.childEvents ?? []).length` |
| 1387 | `tool.childToolCalls!.map((childMsg, childIdx) =>` | `(toolMsg.subagent?.childEvents ?? []).map((childMsg: TranscriptViewMessage, childIdx: number) =>` |

**`toolProgress` renamed to `progress` (4 errors)**

The canonical type uses `progress` (array) not `toolProgress` (object):

| Line | Current | Fix |
|------|---------|-----|
| 1331 | `tool.toolProgress` | `tool.progress.length > 0` (check if has entries) |
| 1395 | `tool.toolProgress` | `tool.progress.length > 0` |
| 1398 | `tool.toolProgress.toolName` | `tool.progress[tool.progress.length - 1]?.progressContent` (or use `tool.toolName`) |
| 1399 | `tool.toolProgress.elapsedSeconds` | `tool.progress[tool.progress.length - 1]?.elapsedSeconds` |

**`toolCall!.name` renamed (1 error)**

| Line | Current | Fix |
|------|---------|-----|
| 1665 | `messages[checkPrev].toolCall!.name` | `messages[checkPrev].toolCall!.toolName` |

**Variable name mangled by type rename script (4 errors)**

The automated rename changed `toolMessagesBefore` -> `toolTranscriptViewMessagesBefore` on line 1688, but references on lines 1692, 1852, 1854 still use `toolMessagesBefore`:

| Line | Current | Fix |
|------|---------|-----|
| 1688 | `const toolTranscriptViewMessagesBefore:` | `const toolMessagesBefore:` |

**`copyMessageContent` renamed by script (1 error)**

| Line | Current | Fix |
|------|---------|-----|
| 1864 | `copyMessageContent(message, index)` | `copyTranscriptViewMessageContent(message, index)` — OR rename the function back. Check line ~1032 for the current function name. |

**Duplicate `message.text` in isLoginRequiredError (1 error, not TS but a bug)**

| Line | Current | Fix |
|------|---------|-----|
| 1071 | `message.text \|\| message.text \|\| ''` | `message.text \|\| ''` |

**Type comparison error (1 error)**

| Line | Current | Fix |
|------|---------|-----|
| 1776 | `message.type === 'system_message' \|\| message.type === 'system_message' \|\| message.metadata?.promptType === 'system_reminder'` | `message.type === 'system_message' \|\| message.systemMessage?.systemType === 'system_reminder'` — The issue is the automated script created duplicate checks. The `system_message` type was duplicated AND the message was already filtered to non-system types at this point. Read lines 1730-1776 to understand the control flow and fix the condition. |

### 2. `packages/runtime/src/ui/AgentTranscript/components/MessageSegment.tsx`

**Attachment type narrowing (3 errors)**

`message.attachments` has type `UserMessagePayload['attachments']` which is `Array<{id, filename, filepath, mimeType, size, type: string}>` — but the UI expects `ChatAttachment` (where `type` is `'image' | 'pdf' | 'document'`):

| Line | Current | Fix |
|------|---------|-----|
| 372 | `handleAttachmentClick(attachment)` | `handleAttachmentClick(attachment as ChatAttachment)` |
| 377 | `attachment.thumbnail` | `(attachment as any).thumbnail` |
| 383 | `getFileIcon(attachment.type)` | `getFileIcon(attachment.type as ChatAttachment['type'])` |

**Optional chaining on `changes` (3 errors)**

| Line | Current | Fix |
|------|---------|-----|
| 514 | `message.toolCall?.changes.length` (x2) | `message.toolCall?.changes?.length ?? 0` |
| 520 | `message.toolCall?.changes.map` | `message.toolCall?.changes?.map` |

**`stripSystemMessage` called with possibly-undefined text (not in TS errors but fragile)**

| Line | Current | Fix |
|------|---------|-----|
| 182 | `stripSystemMessage(message.text)` | `stripSystemMessage(message.text ?? '')` — check if `stripSystemMessage` already handles undefined; if so, skip |

### 3. `packages/runtime/src/ui/AgentTranscript/components/TranscriptSearchBar.tsx`

| Line | Current | Fix |
|------|---------|-----|
| 164 | `message.type === 'tool'` | `message.type === 'tool_call' \|\| message.type === 'interactive_prompt' \|\| message.type === 'subagent'` |

## Test file errors (59 across 3 test files)

These need `Message` objects updated to `TranscriptViewMessage` shape. Each test constructs objects with `{ role, content, timestamp }` that need `{ id, sequence, createdAt, type, text, subagentId }`.

### `__tests__/CodexOutputRenderer.test.ts` (~15 errors)
- Update `Message` import to `TranscriptViewMessage`
- Create a `makeTestMessage()` helper that builds `TranscriptViewMessage` objects
- Replace all `{ role: 'tool', content: '', timestamp: 1, toolCall: { name: ..., ... } }` with canonical shape

### `__tests__/RichTranscriptView.test.ts` (~2 errors)
- Update import, update the 2 test messages from `Message` to `TranscriptViewMessage` shape

### `__tests__/TranscriptWidgets.test.tsx` (~42 errors)
- Update import
- Create a `makeTestMessage()` helper
- Update all ~14 message construction sites from `Message` shape to `TranscriptViewMessage` shape

## Verification

1. `npx tsc --noEmit -p packages/runtime/tsconfig.json 2>&1 | grep "error TS" | grep -v "extension-sdk" | wc -l` should be 0
2. `npx tsc --noEmit -p packages/electron/tsconfig.json 2>&1 | grep "error TS" | grep -v "extension-sdk|ThemesPanel|PanelContainer|ExtensionConfigPanel|InstalledExtensionsPanel|ThemeHandlers" | wc -l` should be 0
3. `npx vitest run packages/runtime/src/ai/server/transcript/__tests__/` — all 102 transcript tests pass
4. `npx vitest run packages/runtime/src/ui/AgentTranscript/` — all UI component tests pass

## Critical files

- `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx` (27 source errors)
- `packages/runtime/src/ui/AgentTranscript/components/MessageSegment.tsx` (6 source errors)
- `packages/runtime/src/ui/AgentTranscript/components/TranscriptSearchBar.tsx` (1 source error)
- `packages/runtime/src/ui/AgentTranscript/components/__tests__/CodexOutputRenderer.test.ts`
- `packages/runtime/src/ui/AgentTranscript/components/__tests__/RichTranscriptView.test.ts`
- `packages/runtime/src/ui/AgentTranscript/components/__tests__/TranscriptWidgets.test.tsx`

## Existing utilities to reuse

- `TranscriptViewMessage` type from `packages/runtime/src/ai/server/transcript/TranscriptProjector.ts`
- `parseToolResult()` from `packages/runtime/src/ai/server/transcript/toolResultParser.ts`
- `ChatAttachment` type from `packages/runtime/src/ai/server/types.ts`
