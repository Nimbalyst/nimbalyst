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
    - interactive
    - cross-platform
  created: "2025-02-01"
  updated: "2026-02-05T03:30:00.000Z"
  progress: 40
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

## Key Insight: Widgets Render from Tool Call Data (2026-02-04)

The original plan was overly complex. We were trying to:
1. Persist prompts to DB on the MCP server side
2. Send IPC events to notify renderer
3. Have atoms sync from DB
4. Have widgets read from atoms and match by toolUseId

**The simpler solution:** Widgets render directly from `toolCall` data in the transcript.

### Why This Works

When Claude calls an MCP tool (like `developer_git_commit_proposal`), the tool call message contains:
- `toolCall.id` - Claude's unique tool_use ID (e.g., `toolu_01ABC...`)
- `toolCall.input` - All the prompt data (files, message, reasoning, etc.)
- `toolCall.result` - Undefined while pending, filled when resolved

The widget receives this via `CustomToolWidgetProps` and can:
1. Check if `toolCall.result` is empty → show interactive UI
2. Use `toolCall.input` for all display data
3. Use `toolCall.id` as the proposalId for responding

**No atoms, no IPC events, no DB sync needed!**

### GitCommitConfirmationWidget Implementation

```typescript
// Widget props from transcript
const { toolCall, sessionId, workspacePath } = props;

// All data comes from the tool call itself
const { filesToStage, commitMessage, reasoning } = toolCall.input;
const proposalId = toolCall.id;  // Claude's tool_use ID
const isPending = !toolCall.result;  // No result = pending

// Show interactive UI when pending
if (isPending) {
  return <InteractiveCommitUI
    files={filesToStage}
    message={commitMessage}
    onCommit={() => {
      // Execute git commit
      const result = await electronAPI.invoke('git:commit', ...);
      // Send response to MCP server using toolCall.id
      await electronAPI.invoke('messages:respond-to-prompt', {
        sessionId,
        promptId: proposalId,  // Same as toolCall.id
        promptType: 'git_commit_proposal_request',
        response: { action: 'committed', commitHash: result.commitHash },
      });
    }}
  />;
}

// Show result when completed
return <CompletedCommitUI result={toolCall.result} />;
```

### Completed (2026-02-04)

- [x] GitCommitConfirmationWidget renders from `toolCall.input` directly
- [x] Uses `toolCall.id` as proposalId (no atom matching needed)
- [x] Shows interactive UI when `!toolCall.result`
- [x] Removed all atom dependencies from widget
- [x] Removed electron `sessionPendingGitCommitProposalAtom`
- [x] Removed runtime git commit proposal atoms (kept type only)
- [x] Removed sync effect from SessionTranscript

**Files changed:**
- `packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/GitCommitConfirmationWidget.tsx` - Render from tool call
- `packages/electron/src/renderer/store/atoms/sessions.ts` - Removed atom
- `packages/runtime/src/store/atoms/gitCommitProposals.ts` - Removed atoms, kept type
- `packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx` - Removed sync effect

## Unified Model: Render from Tool Call Data

### Goal

ALL interactive prompts (current and future) should:
1. **Render from tool call data** - `toolCall.input` has everything
2. **Use `toolCall.id` as promptId** - Guaranteed unique per call
3. **Check `toolCall.result` for state** - Empty = pending, filled = completed
4. **Work on Electron and Capacitor** - No platform-specific atoms

### Current Interactive Prompt Types

| Type | Widget Location | Status |
|------|-----------------|--------|
| GitCommitProposal | runtime | **Done** - renders from tool call |
| AskUserQuestion | runtime | Needs migration |
| ExitPlanMode | electron | Needs migration |
| ToolPermission | electron | Needs migration |

### Migration Pattern

For each prompt type:

1. **Remove atom dependency** - Widget should not read from any atom
2. **Get data from `toolCall.input`** - All prompt data is there
3. **Use `toolCall.id` as promptId** - For sending response
4. **Check `!toolCall.result` for pending** - Not atom state

```typescript
// BEFORE (atom-based, broken)
const pendingQuestion = useAtomValue(sessionPendingQuestionAtom(sessionId));
const matchingQuestion = pendingQuestion?.toolUseId === toolCall.id ? pendingQuestion : null;
if (!matchingQuestion) return null;

// AFTER (tool call-based, works)
const { questions } = toolCall.input;
const isPending = !toolCall.result;
if (!isPending) return <CompletedUI />;
return <InteractiveUI questions={questions} />;
```

### Capacitor Support

This architecture naturally works on Capacitor because:
1. **Tool call data is in the transcript** - Already synced
2. **No platform-specific atoms** - Widget code is in runtime package
3. **Response via IPC** - Same `messages:respond-to-prompt` channel

```
┌──────────────────┐     Sync      ┌──────────────────┐
│  Desktop         │ ◄──────────► │  Mobile          │
│  (Electron)      │              │  (Capacitor)     │
└──────────────────┘              └──────────────────┘
         │                                 │
         │  Tool call in                   │  Tool call in
         │  transcript (synced)            │  transcript (synced)
         ▼                                 ▼
┌──────────────────┐              ┌──────────────────┐
│  Widget renders  │              │  Widget renders  │
│  from toolCall   │              │  from toolCall   │
│  data directly   │              │  data directly   │
└──────────────────┘              └──────────────────┘
```

### Testing

Since widgets render from tool call data, testing is simple:
1. Create mock tool call message with test data
2. Render widget with that tool call
3. Verify UI shows correctly
4. Simulate user interaction
5. Verify response IPC is called with correct data

No need to mock atoms, IPC listeners, or DB queries.

```typescript
// Test helper: Create a mock tool call for widget testing
function createMockToolCall(toolUseId: string, input: any, result?: string) {
  return {
    id: toolUseId,
    name: 'developer_git_commit_proposal',
    input,
    result,  // undefined for pending, string for completed
  };
}

// Example test - widget renders from tool call data
describe('GitCommitConfirmationWidget', () => {
  it('shows interactive UI when tool is pending', () => {
    const toolCall = createMockToolCall('toolu_test123', {
      filesToStage: ['file.ts'],
      commitMessage: 'test commit',
      reasoning: 'test reasoning',
    });  // No result = pending

    const { getByText } = render(
      <GitCommitConfirmationWidget
        toolCall={toolCall}
        sessionId="test-session"
        workspacePath="/test/path"
      />
    );

    // Should show interactive UI
    expect(getByText('Commit Proposal')).toBeInTheDocument();
    expect(getByText('test commit')).toBeInTheDocument();
  });

  it('shows completed state when tool has result', () => {
    const toolCall = createMockToolCall('toolu_test123', {
      filesToStage: ['file.ts'],
      commitMessage: 'test commit',
    }, 'User confirmed and committed 1 file(s). Commit hash: abc123');

    const { getByText } = render(
      <GitCommitConfirmationWidget toolCall={toolCall} sessionId="test" workspacePath="/test" />
    );

    // Should show completed state
    expect(getByText('Changes Committed')).toBeInTheDocument();
  });

  it('handles multiple tool calls with same content correctly', () => {
    // Each tool call has unique ID, so no confusion
    const toolCall1 = createMockToolCall('toolu_first', { commitMessage: 'same' });
    const toolCall2 = createMockToolCall('toolu_second', { commitMessage: 'same' });

    // Widget 1 uses toolu_first as proposalId
    // Widget 2 uses toolu_second as proposalId
    // No conflict - they're different widgets with different IDs
  });
});
```

## Remaining Migration Tasks

### Migrate Other Prompt Types to Tool Call Rendering

Each prompt type widget should be updated to render from `toolCall` data:

#### AskUserQuestion Widget
- [ ] Remove atom dependency (`sessionPendingQuestionAtom`)
- [ ] Get questions from `toolCall.input.questions`
- [ ] Use `toolCall.id` as questionId for response
- [ ] Check `!toolCall.result` for pending state

#### ExitPlanMode Confirmation
- [ ] Remove atom dependency
- [ ] Get plan data from `toolCall.input`
- [ ] Use `toolCall.id` for response
- [ ] Render from tool call state

#### ToolPermission Dialog
- [ ] Remove atom dependency
- [ ] Get permission data from `toolCall.input`
- [ ] Use `toolCall.id` for response
- [ ] Render from tool call state

### Clean Up Legacy Code
- [ ] Remove `sessionPendingQuestionAtom` (once widget migrated)
- [ ] Remove `sessionPendingPermissionsAtom` (once widget migrated)
- [ ] Remove `sessionPendingExitPlanModeAtom` (once widget migrated)
- [ ] Remove IPC event handlers for prompt notifications
- [ ] Remove `refreshPendingPromptsAtom` (no longer needed)

### Testing
- [ ] Unit tests for each widget with mock tool calls
- [ ] E2E test: Pending prompt shows after page refresh
- [ ] E2E test: Cancel and re-call same tool works

### Capacitor Integration
- [ ] Verify transcript sync includes tool call messages
- [ ] Implement `messages:respond-to-prompt` IPC on Capacitor
- [ ] Test mobile can respond to pending prompts
- [ ] Test response syncs back to desktop
