---
status: done
---

# Post-Refactor Cleanup: TranscriptViewMessage Migration

## Context

The transcript refactor (commits `06c0b66e` and `5b37b30c`) changed `SessionData.messages` from `Message[]` to `TranscriptViewMessage[]` and deleted the `CanonicalTranscriptConverter`. The review identified 10 action items: 1 logic regression, 2 data integrity bugs, and 7 code quality improvements. This plan addresses all 10.

## 1. Fix dead-code condition (logic regression)

**File:** `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx:1638`

**Problem:** `isUser && message.type !== 'user_message'` is always false because `isUser` is defined as `message.type === 'user_message'`. Previously this hid system-generated user-role messages with `isUserInput === false`. Now those empty bubbles render.

**Fix:** The canonical pipeline no longer produces "system-generated user-role messages" — those were a legacy artifact of the old `Message` shape where system injections had `role: 'user'` but `isUserInput: false`. In the canonical model, system injections are `system_message` type. The entire `if` block is dead code and should be **removed** along with its stale comment.

Verify: Search `isUserInput` in runtime — it's only set in `SessionManager.ts` on legacy Message objects that go through `viewMessageFromServerMessage`, which maps `role: 'user'` to `type: 'user_message'` regardless of `isUserInput`. The canonical pipeline (TranscriptTransformer) never produces user_message events for system injections.

## 2. Fix optimistic message dedup

**File:** `packages/electron/src/renderer/store/atoms/sessions.ts` (reloadSessionDataAtom, ~line 1588)

**Problem:** Matching by `type + text` causes premature eviction when a user sends two identical messages (e.g., "yes" twice).

**Fix:** Use a monotonically decreasing counter for optimistic IDs instead of `-Date.now()`. Match optimistic messages against DB messages by checking if a DB message exists with matching `type + text + createdAt` (within 5s tolerance). This is more robust than text-only matching.

```ts
// At module scope in sessions.ts
let optimisticIdCounter = -1;
export function nextOptimisticId(): number {
  return optimisticIdCounter--;
}
```

Update the merge filter:
```ts
const optimisticMessages = localMessages.filter(
  (m: TranscriptViewMessage) =>
    m.id < 0 &&
    !dbMessages.some(
      (db: TranscriptViewMessage) =>
        db.type === m.type &&
        db.text === m.text &&
        Math.abs(db.createdAt.getTime() - m.createdAt.getTime()) < 5000
    )
);
```

## 3. Fix viewMessageFromServerMessage IDs

**File:** `packages/runtime/src/ai/server/SessionManager.ts:84`

**Problem:** `id: -(msg.timestamp || Date.now())` produces colliding and nondeterministic IDs. Messages loaded through the legacy path get negative IDs, confusing the optimistic filter.

**Fix:** Use a separate counter for server-message IDs. These are only used for in-memory session state (not persisted), so a module-scoped counter is fine.

```ts
let serverMsgIdCounter = -1_000_000; // Start far from optimistic counter range
function nextServerMsgId(): number {
  return serverMsgIdCounter--;
}
```

Then in `viewMessageFromServerMessage`: `id: nextServerMsgId()`.

This separates the ID space from optimistic messages (which use `-1, -2, -3...`).

## 4. Extract `isToolLikeMessage()` helper

**Files:**
- Create: `packages/runtime/src/ui/AgentTranscript/utils/messageTypeHelpers.ts`
- Update: `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx` (14+ sites)
- Update: `packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx` (2 sites)

**Fix:**
```ts
// messageTypeHelpers.ts
import type { TranscriptViewMessage } from '../../../ai/server/transcript/TranscriptProjector';

export function isToolLikeMessage(msg: TranscriptViewMessage): boolean {
  return msg.type === 'tool_call' || msg.type === 'interactive_prompt' || msg.type === 'subagent';
}
```

Replace all 16+ occurrences of the three-way check with `isToolLikeMessage(msg)`.

## 5. Extract message factory functions

**File:** `packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx`

**Fix:** Extract two factory functions at the top of the file (or in a local utils):

```ts
function makeOptimisticError(text: string, extra?: Partial<TranscriptViewMessage>): TranscriptViewMessage {
  return {
    id: nextOptimisticId(),
    sequence: -1,
    createdAt: new Date(),
    type: 'system_message',
    text,
    subagentId: null,
    isError: true,
    systemMessage: { systemType: 'error' },
    ...extra,
  };
}

function makeOptimisticUserMessage(
  text: string,
  mode?: 'agent' | 'planning',
  attachments?: ChatAttachment[],
): TranscriptViewMessage {
  return {
    id: nextOptimisticId(),
    sequence: -1,
    createdAt: new Date(),
    type: 'user_message',
    text,
    subagentId: null,
    mode,
    attachments,
  };
}
```

Replace the 3 error message constructions (~lines 488, 667, 777) and 2 user message constructions (~lines 738, 833) with these factories. Import `nextOptimisticId` from sessions.ts.

## 6. Delete CodexOutputRenderer

**Files to delete:**
- `packages/runtime/src/ui/AgentTranscript/components/CodexOutputRenderer.tsx`

**Verification:** `grep -r "CodexOutputRenderer" --include="*.ts" --include="*.tsx"` confirms **zero imports**. The component is dead code — the RichTranscriptView rendering path was already removed in this branch. The test file was already deleted.

Also remove the stale reference in `packages/runtime/src/ai/server/providers/codex/textExtraction.ts:6` (a comment mentioning CodexOutputRenderer).

## 7. Remove dead `Message` imports

**Files:**
- `packages/electron/src/renderer/store/atoms/sessions.ts:20` — remove `Message` from the import (keep `TranscriptViewMessage`)
- `packages/runtime/src/ai/server/__tests__/SessionManager.test.ts:9` — remove `Message` from the import (keep `TranscriptViewMessage`)

## 8. Remove stale `(toolMsg as any).isError` casts

**File:** `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`

`isError` is defined on `TranscriptViewMessage` (added in this branch). Replace all `(toolMsg as any).isError` with `toolMsg.isError`. Search for `as any).isError` in the file.

## 9. Update provider sendMessage signatures

**File:** `packages/runtime/src/ai/server/AIProvider.ts` (interface + abstract class)

**Problem:** `sendMessage` declares `messages?: Message[]` but callers now pass `TranscriptViewMessage[]` with `as any`.

**Fix:** Change the parameter type to `messages?: TranscriptViewMessage[]` in both the `AIProvider` interface (line 62) and abstract class (line 125). Update the import to include `TranscriptViewMessage`.

Then remove the `as any` casts in `packages/electron/src/main/services/ai/AIService.ts` (lines ~880, ~898).

**Impact check:** All 7 providers (`ClaudeProvider`, `ClaudeCodeProvider`, `OpenAIProvider`, `OpenAICodexProvider`, `LMStudioProvider`, `OpenCodeProvider`, `TeammateManager`) accept `messages` in their `sendMessage` signature. The chat providers (Claude, OpenAI, LMStudio) read `.role` and `.content` from messages to build conversation history — these fields don't exist on `TranscriptViewMessage`. However, these providers receive messages through the `ProtocolInterface.sendMessage` path (which takes `ProtocolMessage`, not raw session messages), NOT through the `AIProvider.sendMessage` that takes the full message array. The `messages` parameter on `AIProvider.sendMessage` is only used by Claude Code provider (which ignores it) and chat providers that only use it for context window management (reading `.content` length). We need to verify this doesn't break chat providers.

**Safer alternative if chat providers do read `.role`/`.content`:** Add a type alias `type ProviderMessage = Message | TranscriptViewMessage` and use that, or keep `Message[]` in the signature and do the conversion at the call site in AIService.ts. Given the scope risk, check each provider's `sendMessage` body before committing to the change.

## 10. Fix misleading comment in CodexOutputRenderer

This is moot — we're deleting the file in step 6.

## Critical files

- `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`
- `packages/electron/src/renderer/store/atoms/sessions.ts`
- `packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx`
- `packages/runtime/src/ai/server/SessionManager.ts`
- `packages/runtime/src/ai/server/AIProvider.ts`
- `packages/electron/src/main/services/ai/AIService.ts`
- `packages/runtime/src/ui/AgentTranscript/components/CodexOutputRenderer.tsx` (delete)

## Verification

1. `npx tsc --noEmit -p packages/runtime/tsconfig.json 2>&1 | grep "error TS" | grep -v "extension-sdk" | wc -l` — 0
2. `npx tsc --noEmit -p packages/electron/tsconfig.json 2>&1 | grep "error TS" | grep -Ev "extension-sdk|ThemesPanel|PanelContainer|ExtensionConfigPanel|InstalledExtensionsPanel|ThemeHandlers" | wc -l` — 0
3. `npx vitest run packages/runtime/src/ai/server/transcript/__tests__/` — all transcript tests pass
4. `npx vitest run packages/runtime/src/ui/AgentTranscript/` — all UI component tests pass
5. `npx vitest run packages/runtime/src/ai/server/__tests__/SessionManager.test.ts` — passes
6. Verify no import references to `CodexOutputRenderer` remain: `grep -r "CodexOutputRenderer" --include="*.ts" --include="*.tsx" packages/`
