---
planStatus:
  planId: plan-durable-interactive-prompts
  title: Durable Interactive Prompts Architecture
  status: in-development
  planType: system-design
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - architecture
    - ai-ux
    - persistence
    - interactive
  created: "2025-02-01"
  updated: "2026-02-04T22:00:00.000Z"
  progress: 85
  startDate: "2026-02-02"
---
# Durable Interactive Prompts Architecture

## Problem Statement

When Claude Code needs user input (AskUserQuestion, ExitPlanMode, ToolPermission, GitCommitProposal), the current system:

1. **Sends an IPC event** from main process to renderer
2. **Renderer stores in local React state** (or Jotai atom)
3. **User might switch sessions, close window, or restart app**
4. **State is lost**, AI is stuck waiting forever

Current mitigations (storing in session metadata, polling for response messages) are scattered, inconsistent, and fragile.

### Symptoms
- User switches to different session while question is pending
- Goes back to original session - question UI is gone
- AI is stuck in "waiting" state forever
- User has to cancel and re-run the prompt

### Scale of Problem
Every new AI-to-user interaction we add (GitCommitProposal, future tools) requires:
- New IPC channels
- New renderer state management
- New persistence hacks
- New recovery logic

This doesn't scale.

## Current Architecture (Problematic)

```
┌─────────────────┐     IPC Event      ┌─────────────────┐
│  ClaudeCode     │ ──────────────────► │  SessionTranscript│
│  Provider       │                     │  (React State)   │
│                 │ ◄────────────────── │                  │
│  (blocks on     │   IPC Response      │  (local state    │
│   Promise)      │                     │   lost on unmount)│
└─────────────────┘                     └─────────────────┘
        │                                       │
        │                                       │
        ▼                                       ▼
┌─────────────────┐                     ┌─────────────────┐
│  Database       │                     │  Session Metadata│
│  (messages)     │                     │  (hack for       │
│                 │                     │   persistence)   │
└─────────────────┘                     └─────────────────┘
```

**Problems:**
- Renderer state is ephemeral
- Metadata persistence is a hack added after the fact
- Multiple sources of truth (IPC, state, metadata, messages)
- Each interaction type implements this differently

## Proposed Architecture

**Core Insight:** The request message in the database IS the source of truth. The UI should derive from it.

```
┌─────────────────┐
│  ClaudeCode     │
│  Provider       │
│                 │──┐
│  (blocks on     │  │  1. Create request message
│   Promise)      │  │     (type: 'ask_user_question_request', status: 'pending')
└─────────────────┘  │
                     ▼
              ┌─────────────────┐
              │    Database     │
              │  (messages)     │◄───────────────────────┐
              │                 │                        │
              │  Request msg    │  3. Poll or subscribe  │
              │  with status    │     for response msg   │
              └─────────────────┘                        │
                     │                                   │
                     │ 2. UI queries for                 │
                     │    pending prompts                │
                     ▼                                   │
              ┌─────────────────┐                        │
              │  React/Jotai    │                        │
              │  (derived from  │  4. User responds,     │
              │   DB query)     │     creates response   │
              │                 │─────message────────────┘
              └─────────────────┘
```

**Key Changes:**
1. **No IPC events for prompt state** - UI queries database
2. **Single source of truth** - The message in the database
3. **Generic prompt type** - All interactive prompts share common schema
4. **Polling/subscription** - Provider polls DB for response (already implemented!)

## Generic Interactive Prompt Schema

Instead of separate types for each interaction, use a generic schema:

```typescript
interface InteractivePromptMessage {
  // Existing message fields
  sessionId: string;
  role: 'assistant';  // AI is asking
  timestamp: number;

  // Interactive prompt specific
  content: {
    type: 'interactive_prompt';
    promptType: 'ask_user_question' | 'exit_plan_mode' | 'tool_permission' | 'git_commit_proposal';
    promptId: string;  // Unique ID for matching response
    status: 'pending' | 'resolved' | 'cancelled' | 'expired';

    // Prompt-specific data (varies by promptType)
    data: AskUserQuestionData | ExitPlanModeData | ToolPermissionData | GitCommitProposalData;

    // Response (filled when resolved)
    response?: {
      answeredAt: number;
      answeredBy: 'desktop' | 'mobile';
      result: any;  // Type depends on promptType
    };
  };
}
```

### Prompt Type Data Schemas

```typescript
// AskUserQuestion
interface AskUserQuestionData {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
}

// ExitPlanMode
interface ExitPlanModeData {
  planFilePath: string;
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
}

// ToolPermission
interface ToolPermissionData {
  toolName: string;
  toolInput: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
  pattern?: string;  // For "allow always" scope
}

// GitCommitProposal (new!)
interface GitCommitProposalData {
  filesToStage: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>;
  commitMessage: string;
  reasoning: string;
}
```

## UI Implementation

### 1. Query for Pending Prompts

Instead of listening to IPC, components query for pending prompts:

```typescript
// Atom that queries database for pending prompts
export const sessionPendingPromptsAtom = atomFamily((sessionId: string) =>
  atom(async (get) => {
    // Query messages for this session with status: 'pending'
    const messages = await window.electronAPI.invoke('messages:get-pending-prompts', sessionId);
    return messages as InteractivePromptMessage[];
  })
);

// Usage in component
const pendingPrompts = useAtomValue(sessionPendingPromptsAtom(sessionId));
const pendingQuestion = pendingPrompts.find(p => p.content.promptType === 'ask_user_question');
const pendingPermissions = pendingPrompts.filter(p => p.content.promptType === 'tool_permission');
```

### 2. Refresh on Session Load

When a session is selected, refresh the pending prompts query:

```typescript
// In session selection logic
const refreshPendingPrompts = useSetAtom(refreshSessionPendingPromptsAtom);

useEffect(() => {
  if (sessionId) {
    refreshPendingPrompts(sessionId);
  }
}, [sessionId]);
```

### 3. Respond to Prompt

When user responds, create a response message (not update the request):

```typescript
async function respondToPrompt(promptId: string, response: any) {
  // Create response message in database
  await window.electronAPI.invoke('messages:respond-to-prompt', {
    sessionId,
    promptId,
    response,
    respondedBy: 'desktop'
  });

  // The provider is polling and will pick up the response
  // The UI will refresh via subscription or manual refresh
}
```

### 4. IPC for Notifications (Not State)

IPC is used for **lightweight notifications** only - the actual state lives in the database:

```typescript
// === Prompt Created (Provider → UI) ===
// Main process emits notification when prompt is persisted
webContents.send('ai:prompt-created', { sessionId, promptId, promptType });

// Renderer refreshes atoms from DB (in central listener, not component!)
// store/listeners/sessionDialogListeners.ts
window.electronAPI.on('ai:prompt-created', ({ sessionId }) => {
  store.set(refreshSessionPendingPromptsAtom(sessionId));
});

// === Prompt Responded (UI → Provider) ===
// When user responds, create response message AND notify provider
async function respondToPrompt(promptId: string, response: any) {
  // 1. Persist response to database
  await window.electronAPI.invoke('messages:respond-to-prompt', {
    sessionId,
    promptId,
    response,
    respondedBy: 'desktop'
  });

  // 2. Notify provider directly (faster than polling)
  await window.electronAPI.invoke('ai:prompt-responded', {
    sessionId,
    promptId
  });
}

// Provider receives notification and resolves promise immediately
// No more polling needed for desktop responses
```

**Key point:** IPC carries notifications, not state. The database is always the source of truth.

## Benefits

1. **Survives restart** - Prompts are in database
2. **Works across sessions** - Query by sessionId, not by component mount
3. **Works cross-device** - Mobile can poll same DB (already synced)
4. **Generic** - Adding new prompt types doesn't require new IPC
5. **Debuggable** - Can see prompts in database
6. **Testable** - Just test database state

## Migration Path

### Phase 1: Add Generic Prompt Infrastructure [DONE]
- [x] Add `messages:get-pending-prompts` IPC handler
- [x] Add `messages:respond-to-prompt` IPC handler
- [x] Add `sessionPendingPromptsAtom` atom
- [x] Add `refreshPendingPromptsAtom` action atom
- [x] Add `respondToPromptAtom` action atom

### Phase 2: Centralize IPC Listeners [DONE]
- [x] Create `sessionTranscriptListeners.ts` with centralized handlers
- [x] Move `ai:error` to centralized listener with `sessionErrorAtom`
- [x] Move `ai:exitPlanModeConfirm` to centralized listener with `sessionExitPlanModeConfirmAtom`
- [x] Move `ai:promptAdditions` to centralized listener
- [x] Move `ai:queuedPromptsReceived` to centralized listener with `sessionQueuedPromptsAtom`
- [x] Move `ai:tokenUsageUpdated` to centralized listener
- [x] Remove direct IPC subscriptions from SessionTranscript.tsx
- [x] Initialize centralized listeners in AgentMode.tsx

### Phase 3: Migrate AskUserQuestion [DONE]
- [x] `sessionPendingQuestionAtom` derives from `sessionPendingPromptsAtom`
- [x] Central listener (`sessionStateListeners.ts`) handles IPC and refreshes atoms
- [x] `refreshPendingPromptsAtom` updates legacy atoms for backward compatibility
- [x] SessionTranscript uses atoms, no direct IPC subscriptions

### Phase 4: Migrate ExitPlanMode [DONE]
- [x] `sessionExitPlanModeConfirmAtom` marked deprecated in `sessionTranscript.ts`
- [x] `sessionPendingExitPlanModeAtom` derives from `sessionPendingPromptsAtom` (DB-backed)
- [x] `respondToPromptAtom` handles `exit_plan_mode_request` responses
- [x] IPC handler in `sessionStateListeners.ts` for legacy support

### Phase 5: Migrate ToolPermission [DONE]
- [x] `sessionPendingPermissionsAtom` derives from `sessionPendingPromptsAtom`
- [x] Transforms flat DB format to nested `ToolPermissionData` for UI compatibility
- [x] `respondToPromptAtom` handles `permission_request` responses

### Phase 6: Add GitCommitProposal [DONE]
- [x] `sessionPendingGitCommitProposalAtom` derives from `sessionPendingPromptsAtom`
- [x] Main process IPC handler supports `git_commit_proposal_request` responses
- [x] Runtime `GitCommitConfirmationWidget` calls `messages:respond-to-prompt` IPC directly
- [x] Widget uses `sessionPendingGitCommitProposalAtom` to match proposals to tool calls
- [x] Widget clears pending proposal via `clearPendingGitCommitProposal()` after response
- Note: `respondToPromptAtom` type union doesn't include `git_commit_proposal_request` but widget calls IPC directly

### Phase 7: Clean Up
- [x] SessionTranscript.tsx has no direct IPC subscriptions
- [x] All prompt types derive from DB-backed `sessionPendingPromptsAtom`
- [ ] Remove unused `sessionExitPlanModeConfirmAtom` (marked deprecated)
- [ ] Remove any remaining metadata persistence hacks
- [ ] Update CLAUDE.md with durable prompts architecture

## Relationship to IPC Listener Plan

This plan is **complementary** to the centralized IPC listener plan:

| IPC Listener Plan | This Plan |
| --- | --- |
| Addresses listener churn | Addresses durable state |
| Moves subscriptions to store | Moves source of truth to DB |
| Components read atoms | Atoms derived from DB query |
| Session state (processing, etc.) | Interactive prompt state |

Both plans together mean:
- **No IPC subscriptions in components** (IPC plan)
- **No ephemeral state for AI interactions** (this plan)
- **Database is source of truth** (this plan)
- **Lightweight notifications refresh atoms** (both plans)

## Implementation Status

### Completed (2026-02-03)

**Centralized IPC Listeners:**
- `store/listeners/sessionTranscriptListeners.ts` - Handles `ai:tokenUsageUpdated`, `ai:error`, `ai:promptAdditions`, `ai:queuedPromptsReceived`
- `store/sessionStateListeners.ts` - Handles `ai:exitPlanModeConfirm` and session lifecycle events
- `AgentMode.tsx` - Initializes all three listener systems on mount

**DB-Derived Atoms (all in `store/atoms/sessions.ts`):**
- `sessionPendingPromptsAtom` - Base atom populated from DB via `refreshPendingPromptsAtom`
- `sessionPendingQuestionAtom` - Backward-compatible atom, updated by `refreshPendingPromptsAtom`
- `sessionPendingPermissionsAtom` - Derived atom that transforms DB format to UI format
- `sessionPendingExitPlanModeAtom` - Derived atom for exit plan mode confirmations
- `sessionPendingGitCommitProposalAtom` - Derived atom for git commit proposals
- `refreshPendingPromptsAtom` - Action atom that fetches from DB and updates all legacy atoms
- `respondToPromptAtom` - Action atom that persists response to DB and notifies provider

**Deprecated Atoms:**
- `sessionExitPlanModeConfirmAtom` (in `sessionTranscript.ts`) - Marked deprecated, replaced by DB-backed atom

**UI Components:**
- `SessionTranscript.tsx` - Uses atoms exclusively, no direct IPC subscriptions
- All pending prompts fetched on session load via `refreshPendingPrompts(sessionId)`

### Remaining Work
1. Remove deprecated `sessionExitPlanModeConfirmAtom`
2. E2E testing for prompt durability across session switches
3. Update CLAUDE.md with durable prompts architecture

### Related Files
- `plans/session-transcript-centralized-ipc.md` - Detailed implementation plan for Phase 2
- `store/listeners/fileStateListeners.ts` - Reference implementation pattern
- `store/listeners/sessionListListeners.ts` - Reference implementation pattern
- `main/ipc/SessionHandlers.ts` - IPC handlers including `messages:get-pending-prompts` and `messages:respond-to-prompt`

## Decisions

1. **Refresh strategy** - IPC notifications trigger atom refresh (no polling)
   - Lightweight notification: `ai:prompt-created` with just `{ sessionId, promptId }`
   - Renderer refreshes pending prompts atom from DB on notification
   - No periodic polling needed

2. **Message schema migration** - New schema going forward, existing messages continue rendering
   - Old `ask_user_question_request` messages still render in transcript
   - New prompts use unified `interactive_prompt` schema
   - No migration of existing data

3. **Provider response detection** - Switch from polling to IPC
   - Currently: Provider polls DB every 500ms for response message
   - New: Renderer sends IPC when user responds, provider resolves immediately
   - Fallback: Provider can still poll DB (for mobile responses)

4. **Restart handling - Sessions ARE resumable**

   **Key insight from claude-agent-sdk:**
   - The SDK supports session resumption via `session_id`
   - We already persist `claudeSessionId` in provider session data
   - The SDK's polling mechanism (10 min timeout) was designed for async responses
   - **Users CAN answer questions after restart and resume the session**

   **On app restart:**
   - Query DB for pending prompts with `status: 'pending'`
   - Show prompt UI - user CAN still answer even though provider isn't running yet
   - When user answers: persist response message to DB
   - When user sends any message to resume: SDK resumes with stored `session_id`
   - Claude sees the response in conversation history and continues

   **No expiration needed for restart:**
   - Pending prompts stay pending until answered
   - The response message in DB is what matters, not in-memory state
   - SDK polling will find the response when session resumes

   **Optional `expiresAt` for explicit timeouts only:**
   - Only if Claude sets a deadline (rare)
   - Not for app restart scenarios

## Restart Recovery Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     App Restart                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  1. Query: SELECT * FROM messages                           │
│     WHERE content->>'type' = 'interactive_prompt'           │
│     AND content->>'status' = 'pending'                      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Show pending prompts in UI                              │
│     - User can answer even before resuming session          │
│     - Response persisted to DB                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  3. User sends message to resume session                    │
│     - SDK resumes with stored claudeSessionId               │
│     - Provider's polling finds response in DB               │
│     - OR Claude sees response in conversation history       │
│     - Session continues normally                            │
└─────────────────────────────────────────────────────────────┘
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| User answers after restart, before resuming | Response in DB, SDK finds it on resume |
| User answers after restart, then resumes | Works - polling finds response |
| User restarts multiple times | Pending prompt persists, response persists, all works |
| Multiple pending prompts | All restored, shown in order, all answerable |
| Mobile responds while desktop offline | Response in DB via sync, works on resume |
| User never answers and session expires | Claude session expires (SDK-level), user must start new session |

## Session Expiration (SDK-level)

The claude-agent-sdk has its own session expiration (separate from our prompts):
- SDK sessions expire after some period of inactivity
- When expired: `checkSessionExists()` returns false
- Our handling: Show "session expired" message, offer to start fresh
- **This is NOT about prompt expiration** - it's about the underlying Claude conversation

**We don't need prompt expiration** because:
- If user answers and resumes: works
- If user never answers and session expires: they have to start fresh anyway
- If user answers but session expired: they start fresh, but might not need to re-answer (Claude sees history)

## Tool Use ID Discovery (2026-02-04)

### The Matching Problem

When Claude calls an MCP tool (like `developer_git_commit_proposal`), we need to:
1. Store the prompt in the database
2. Show interactive UI in the widget
3. Match the widget to the correct stored prompt

Previously, we matched by **content** (files + commit message) which is fundamentally broken:
- User cancels a proposal
- Claude calls the tool again with same arguments
- Two tool calls, same content - which prompt belongs to which?

### The Solution: `claudecode/toolUseId`

**Discovery:** The Claude Code SDK passes Claude's `tool_use` ID via the MCP `_meta` field:

```typescript
// In MCP server tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Claude's tool_use ID is available via _meta!
  const toolUseId = (request.params._meta as any)?.['claudecode/toolUseId'];
  // Example: "toolu_01Chk7kbfsj74N9YSZx1AaNu"
});
```

This ID is:
- **Globally unique** per tool call
- **Same ID** that appears in the UI's `message.toolCall.id`
- **Perfect for matching** prompts to widgets

### Architecture with toolUseId

```
┌─────────────────────────────────────────────────────────────────────┐
│  Claude calls MCP tool                                               │
│  tool_use block: { id: "toolu_01ABC...", name: "git_commit_proposal" }│
└─────────────────────────────────────────────────────────────────────┘
                           │
                           │ MCP request with _meta
                           │ _meta: { "claudecode/toolUseId": "toolu_01ABC..." }
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MCP Server (httpServer.ts)                                          │
│  1. Extract toolUseId from request.params._meta                      │
│  2. Store prompt in DB with toolUseId                                │
│  3. Wait for user response (Promise)                                 │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           │ DB message with toolUseId
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Database (ai_agent_messages)                                        │
│  content: {                                                          │
│    type: "git_commit_proposal",                                      │
│    toolUseId: "toolu_01ABC...",  // <-- Key for matching            │
│    proposalId: "toolu_01ABC...", // Use toolUseId as proposalId     │
│    filesToStage: [...],                                              │
│    commitMessage: "...",                                             │
│    status: "pending"                                                 │
│  }                                                                   │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           │ Query pending prompts
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Widget (GitCommitConfirmationWidget)                                │
│  1. Get toolCall.id from message props ("toolu_01ABC...")           │
│  2. Get pendingProposal from atom                                    │
│  3. Match: pendingProposal.toolUseId === toolCall.id                │
│  4. If match, show interactive UI                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Implementation Status

**Completed (2026-02-04):**
- [x] MCP server extracts `claudecode/toolUseId` from `request.params._meta`
- [x] GitCommitProposal stores `toolUseId` in DB message
- [x] `GitCommitProposalData` type includes `toolUseId?: string`
- [x] Widget matches by `toolUseId` ONLY - no fallback (fallback matching is dangerous)

**Files changed:**
- `packages/electron/src/main/mcp/httpServer.ts` - Extract and store toolUseId
- `packages/electron/src/renderer/store/atoms/sessions.ts` - Pass toolUseId through
- `packages/runtime/src/store/atoms/gitCommitProposals.ts` - Add to interface
- `packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/GitCommitConfirmationWidget.tsx` - Match by ID

## Phase 8: Unified Interactive Prompt System

### Goal

Create a unified system where ALL interactive prompts (current and future):
1. Use `toolUseId` for matching (when available)
2. Work on both Electron and Capacitor
3. Survive app restarts
4. Are testable without real Claude sessions

### Current Interactive Prompt Types

| Type | Has toolUseId | Widget Location | Matching Strategy |
|------|---------------|-----------------|-------------------|
| AskUserQuestion | Yes (MCP tool) | runtime | Needs migration to toolUseId |
| ExitPlanMode | Yes (MCP tool) | electron | Needs migration to toolUseId |
| ToolPermission | Yes (MCP tool) | electron | Needs migration to toolUseId |
| GitCommitProposal | Yes (MCP tool) | runtime | Done - uses toolUseId |

### Unified Architecture

```typescript
// Unified prompt data stored in database
interface InteractivePromptContent {
  type: 'interactive_prompt';
  promptType: 'ask_user_question' | 'exit_plan_mode' | 'tool_permission' | 'git_commit_proposal';

  // PRIMARY KEY for matching - Claude's tool_use ID
  toolUseId: string;  // "toolu_01ABC..." - REQUIRED for new prompts

  // Legacy ID for backward compatibility
  promptId: string;   // Can be same as toolUseId or legacy format

  status: 'pending' | 'resolved' | 'cancelled';

  // Prompt-specific data
  data: AskUserQuestionData | ExitPlanModeData | ToolPermissionData | GitCommitProposalData;

  // Response (filled when resolved)
  response?: InteractivePromptResponse;
}

// Widget matching logic (same for all prompt types)
// NO FALLBACK - toolUseId matching only. Content-based matching is dangerous.
function matchPromptToToolCall(
  pendingPrompt: InteractivePromptContent | null,
  toolCall: { id?: string }
): boolean {
  if (!pendingPrompt || !toolCall.id || !pendingPrompt.toolUseId) {
    return false;
  }
  return pendingPrompt.toolUseId === toolCall.id;
}
```

### Capacitor Support

The same architecture works for Capacitor because:
1. **Database is synced** - Pending prompts replicate via existing sync
2. **toolUseId is stable** - Same ID on desktop and mobile
3. **Response persists to DB** - Mobile can respond, desktop sees it

```
┌──────────────────┐     Sync      ┌──────────────────┐
│  Desktop         │ ◄──────────► │  Mobile          │
│  (Electron)      │              │  (Capacitor)     │
└──────────────────┘              └──────────────────┘
         │                                 │
         │ Query/Write                     │ Query/Write
         ▼                                 ▼
┌─────────────────────────────────────────────────────┐
│              Database (PGLite / Synced)             │
│  ai_agent_messages with toolUseId                   │
└─────────────────────────────────────────────────────┘
```

### Testing Without Real Claude Sessions

**Problem:** We can't invoke real Claude sessions in tests, but we need to test:
1. Prompt persistence
2. Widget matching
3. Response handling
4. Cross-device sync

**Solution:** Mock the MCP layer and inject prompts directly into the database.

```typescript
// Test helper: Create a pending prompt as if Claude called the tool
async function createMockPendingPrompt(
  sessionId: string,
  promptType: 'ask_user_question' | 'git_commit_proposal' | ...,
  toolUseId: string,
  data: any
): Promise<void> {
  await AgentMessagesRepository.create({
    sessionId,
    source: 'mcp',
    direction: 'output',
    content: JSON.stringify({
      type: promptType,
      toolUseId,
      proposalId: toolUseId,
      ...data,
      status: 'pending',
      timestamp: Date.now(),
    }),
    hidden: false,
    createdAt: new Date(),
  });
}

// Test helper: Create a tool call message as if Claude sent it
async function createMockToolCallMessage(
  sessionId: string,
  toolName: string,
  toolUseId: string,
  args: any
): Promise<void> {
  await AgentMessagesRepository.create({
    sessionId,
    source: 'claude',
    direction: 'output',
    content: JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: toolUseId,
          name: toolName,
          input: args,
        }]
      }
    }),
    hidden: false,
    createdAt: new Date(),
  });
}

// Example test
describe('GitCommitProposal durability', () => {
  it('survives app restart', async () => {
    const sessionId = 'test-session';
    const toolUseId = 'toolu_test123';

    // 1. Create pending prompt (simulates MCP server)
    await createMockPendingPrompt(sessionId, 'git_commit_proposal', toolUseId, {
      filesToStage: ['file.ts'],
      commitMessage: 'test commit',
    });

    // 2. Create tool call message (simulates Claude's response)
    await createMockToolCallMessage(sessionId, 'developer_git_commit_proposal', toolUseId, {
      filesToStage: ['file.ts'],
      commitMessage: 'test commit',
    });

    // 3. Simulate "restart" by clearing in-memory state
    clearAllAtoms();

    // 4. Reload session - pending prompt should be restored
    await store.set(refreshPendingPromptsAtom, sessionId);
    const pendingPrompt = store.get(sessionPendingGitCommitProposalAtom(sessionId));

    expect(pendingPrompt).not.toBeNull();
    expect(pendingPrompt?.toolUseId).toBe(toolUseId);
  });

  it('matches widget to correct tool call by toolUseId', async () => {
    const sessionId = 'test-session';
    const toolUseId1 = 'toolu_first';
    const toolUseId2 = 'toolu_second';

    // Create two tool calls with same content but different IDs
    await createMockPendingPrompt(sessionId, 'git_commit_proposal', toolUseId2, {
      filesToStage: ['same-file.ts'],
      commitMessage: 'same message',
    });

    // Widget for first tool call should NOT match
    const match1 = matchPromptToToolCall(
      store.get(sessionPendingGitCommitProposalAtom(sessionId)),
      { id: toolUseId1 }
    );
    expect(match1).toBe(false);

    // Widget for second tool call SHOULD match
    const match2 = matchPromptToToolCall(
      store.get(sessionPendingGitCommitProposalAtom(sessionId)),
      { id: toolUseId2 }
    );
    expect(match2).toBe(true);
  });
});
```

### Migration Tasks

#### Phase 8a: Standardize toolUseId Extraction
- [ ] Create helper function `extractToolUseId(request)` in MCP server
- [ ] Update ALL MCP tool handlers to extract and store toolUseId
- [ ] Add toolUseId to all prompt type interfaces

#### Phase 8b: Migrate Existing Prompts to toolUseId Matching
- [ ] AskUserQuestion - update widget to match by toolUseId
- [ ] ExitPlanMode - update confirmation dialog to match by toolUseId
- [ ] ToolPermission - update permission dialog to match by toolUseId

#### Phase 8c: Create Test Infrastructure
- [ ] Add `createMockPendingPrompt` test helper
- [ ] Add `createMockToolCallMessage` test helper
- [ ] Add `matchPromptToToolCall` utility function
- [ ] Write unit tests for each prompt type

#### Phase 8d: E2E Tests for Durability
- [ ] Test: Pending prompt survives session switch
- [ ] Test: Pending prompt survives app restart
- [ ] Test: Response persists and is found on resume
- [ ] Test: Multiple pending prompts handled correctly
- [ ] Test: Cancel and re-call same tool works correctly

#### Phase 8e: Capacitor Integration
- [ ] Verify sync includes toolUseId field
- [ ] Test mobile can respond to desktop-created prompts
- [ ] Test desktop sees mobile responses after sync
