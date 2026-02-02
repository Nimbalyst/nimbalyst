---
planStatus:
  planId: plan-session-transcript-centralized-ipc
  title: Centralize SessionTranscript IPC Listeners
  status: draft
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - ipc
    - state-management
    - jotai
    - race-conditions
  created: "2026-02-02"
  updated: "2026-02-02T21:45:00.000Z"
  progress: 0
---

# Centralize SessionTranscript IPC Listeners

## Problem

`SessionTranscript.tsx` has 8 direct IPC subscriptions that suffer from the same race condition issues we fixed in `FilesEditedSidebar`:

1. **Race conditions when switching sessions** - Handlers capture stale session IDs in closures
2. **Stale closure bugs** - Component state captured at subscription time
3. **Memory/listener churn** - Effects re-subscribe on every dependency change
4. **Defensive `isCurrent` flags** - Workarounds that indicate architectural problems

## Current IPC Subscriptions in SessionTranscript

| Event | Purpose | Line |
|-------|---------|------|
| `ai:message-logged` | New message added to session | 415 |
| `session:title-updated` | Session title changed | 416 |
| `ai:tokenUsageUpdated` | Token usage stats updated | 417 |
| `ai:error` | AI error occurred | 475 |
| `ai:exitPlanModeConfirm` | Plan mode exit confirmation | 504 |
| `ai:askUserQuestionAnswered` | User answered a question prompt | 530 |
| `ai:promptAdditions` | Prompt additions received | 573 |
| `ai:queuedPromptsReceived` | Queued prompts loaded | 656 |

## Solution

Follow the centralized IPC listener architecture from `plans/centralized-ipc-listener-architecture.md`:

1. Create `store/listeners/sessionTranscriptListeners.ts`
2. Create atom families keyed by session ID for each piece of state
3. Central listener subscribes ONCE and updates atoms
4. SessionTranscript reads from atoms, never subscribes to IPC directly

## Implementation Plan

### Phase 1: Create Atom Families

Create `store/atoms/sessionTranscript.ts` with:

```typescript
// Messages for a session
export const sessionMessagesAtom = atomFamily((sessionId: string) =>
  atom<Message[]>([])
);

// Session title
export const sessionTitleAtom = atomFamily((sessionId: string) =>
  atom<string>('')
);

// Token usage for a session
export const sessionTokenUsageAtom = atomFamily((sessionId: string) =>
  atom<TokenUsage | null>(null)
);

// Error state for a session
export const sessionErrorAtom = atomFamily((sessionId: string) =>
  atom<Error | null>(null)
);

// Plan mode exit confirmation pending
export const sessionExitPlanModeConfirmAtom = atomFamily((sessionId: string) =>
  atom<ExitPlanModeConfirm | null>(null)
);

// Pending ask user question
export const sessionAskUserQuestionAtom = atomFamily((sessionId: string) =>
  atom<AskUserQuestion | null>(null)
);

// Prompt additions
export const sessionPromptAdditionsAtom = atomFamily((sessionId: string) =>
  atom<PromptAddition[]>([])
);

// Queued prompts
export const sessionQueuedPromptsAtom = atomFamily((sessionId: string) =>
  atom<QueuedPrompt[]>([])
);
```

### Phase 2: Create Central Listener

Create `store/listeners/sessionTranscriptListeners.ts`:

```typescript
export function initSessionTranscriptListeners(): () => void {
  const cleanups: Array<() => void> = [];

  // ai:message-logged
  cleanups.push(
    window.electronAPI.on('ai:message-logged', (data) => {
      const { sessionId, message } = data;
      store.set(sessionMessagesAtom(sessionId), (prev) => [...prev, message]);
    })
  );

  // session:title-updated
  cleanups.push(
    window.electronAPI.on('session:title-updated', (data) => {
      const { sessionId, title } = data;
      store.set(sessionTitleAtom(sessionId), title);
    })
  );

  // ... etc for all 8 events

  return () => cleanups.forEach(fn => fn?.());
}
```

### Phase 3: Refactor SessionTranscript

1. Remove all 8 `useEffect` hooks with IPC subscriptions
2. Replace with `useAtomValue` calls to read from atoms
3. Remove `isCurrent` flags and defensive programming
4. Add initialization call in `AgentMode.tsx`

### Phase 4: Testing

1. Test rapid session switching while AI is responding
2. Verify no race conditions or stale data
3. Test all 8 event types update correctly
4. Verify cleanup on unmount

## Files to Modify

| File | Changes |
|------|---------|
| `store/atoms/sessionTranscript.ts` | NEW - Atom families for session transcript state |
| `store/listeners/sessionTranscriptListeners.ts` | NEW - Central IPC listener |
| `components/AgentMode/AgentMode.tsx` | Add `initSessionTranscriptListeners()` call |
| `components/UnifiedAI/SessionTranscript.tsx` | Remove IPC subscriptions, read from atoms |

## Risks

1. **Message ordering** - Need to ensure messages are added in correct order
2. **Initial load** - Need to load existing messages when session is selected
3. **Large state** - Messages array could be large, need to consider memory

## Success Criteria

- [ ] No direct IPC subscriptions in SessionTranscript
- [ ] All 8 event types handled by central listener
- [ ] No race conditions when switching sessions rapidly
- [ ] No `isCurrent` flags or defensive programming needed
- [ ] State persists correctly across component unmounts

## Related

- `plans/centralized-ipc-listener-architecture.md` - Architecture pattern
- `store/listeners/fileStateListeners.ts` - Reference implementation
- `store/listeners/sessionListListeners.ts` - Reference implementation
