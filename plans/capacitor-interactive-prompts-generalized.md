---
planStatus:
  planId: plan-capacitor-interactive-prompts-generalized
  title: Generalized Interactive Prompts for Capacitor
  status: ready-for-development
  planType: system-design
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - capacitor
    - mobile
    - interactive-prompts
    - architecture
    - cross-platform
  created: "2026-02-05"
  updated: "2026-02-05T12:00:00.000Z"
  progress: 0
  startDate: "2026-02-05"
---

# Generalized Interactive Prompts for Capacitor

## Problem Statement

We have refactored all interactive prompt widgets (AskUserQuestion, ExitPlanMode, GitCommitProposal, ToolPermission) according to the durable prompts architecture documented in `plans/durable-interactive-prompts.md`. However, the Capacitor (mobile) app currently only supports AskUserQuestion and ToolPermission through a legacy `InteractivePromptWidget` pattern that:

1. **Detects prompts by scanning messages** - Using `pendingPrompt` useMemo that parses message content
2. **Renders a special widget at the bottom** - Separate from the transcript
3. **Uses a special `question_response` broadcast** - Only works for AskUserQuestion
4. **Has no support** for ExitPlanMode or GitCommitProposal responses

When we add new interactive prompt types in the future, the current approach requires:
- Adding new detection logic to `SessionDetailScreen.tsx`
- Adding new broadcast message types
- Adding new handler code in `MobileSessionControlHandler.ts`
- Updating mobile widget UI

This doesn't scale.

## Current Architecture

### Desktop (Electron)

Widgets live in `packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/`:
- `AskUserQuestionWidget.tsx` - Interactive questions from Claude
- `ExitPlanModeWidget.tsx` - Plan approval confirmation
- `GitCommitConfirmationWidget.tsx` - Git commit approval
- `ToolPermissionWidget.tsx` - Tool permission approval

All widgets use `InteractiveWidgetHost` pattern:
```typescript
const host = useAtomValue(interactiveWidgetHostAtom(sessionId));
await host.askUserQuestionSubmit(questionId, answers);
await host.exitPlanModeApprove(requestId);
await host.gitCommit(proposalId, files, message);
await host.toolPermissionSubmit(requestId, response);
```

### Mobile (Capacitor)

Current implementation in `packages/capacitor/src/screens/SessionDetailScreen.tsx`:

1. **Detection** (lines 524-615): Scans messages for `nimbalyst_tool_use` without matching `nimbalyst_tool_result`
2. **Rendering** (line 1149): Uses `InteractivePromptWidget` from runtime (legacy widget, not CustomToolWidgets)
3. **Response** (lines 618-694): `handlePromptResponse` sends:
   - Message to SessionRoom (for persistence)
   - Control message via IndexRoom (for immediate desktop notification)
4. **Desktop Handler** (`MobileSessionControlHandler.ts`): Only handles `question_response` type

### Communication Flow

```
Mobile                    CollabV3 Server                Desktop
  │                            │                            │
  │  (1) User responds         │                            │
  │  ─────────────────────────>│                            │
  │  append_message (persist)  │                            │
  │  ─────────────────────────>│                            │
  │  session_control           │                            │
  │  (type: question_response) │                            │
  │                            │  (2) Broadcast to desktop  │
  │                            │  ─────────────────────────>│
  │                            │                            │
  │                            │                            │ (3) Resolve provider
  │                            │                            │     promise
```

## Proposed Solution: Generalized Prompt Response Protocol

### Key Insight

The current system already has a generic `session_control_broadcast` mechanism. We need to:

1. **Generalize the control message type** - Single `prompt_response` type instead of `question_response`
2. **Use same widgets on mobile** - Render `CustomToolWidgets` in transcript, not separate legacy widget
3. **Provide mobile InteractiveWidgetHost** - Implementation that broadcasts via sync layer

### 1. Unified Control Message Protocol

Replace type-specific messages with a single generic `prompt_response`:

```typescript
// Current: Type-specific messages
type ControlMessageType = 'cancel' | 'question_response' | 'prompt';

// Proposed: Generic prompt response
interface PromptResponsePayload {
  promptType: 'ask_user_question' | 'exit_plan_mode' | 'tool_permission' | 'git_commit';
  promptId: string;  // toolCall.id
  response: AskUserQuestionResponse | ExitPlanModeResponse | ToolPermissionResponse | GitCommitResponse;
}

type ControlMessageType = 'cancel' | 'prompt_response' | 'prompt';
```

### 2. Mobile InteractiveWidgetHost Implementation

Create a Capacitor-specific host that broadcasts responses:

```typescript
// packages/capacitor/src/services/MobileInteractiveWidgetHost.ts

export function createMobileInteractiveWidgetHost(
  sessionId: string,
  sendSessionControlMessage: (sessionId: string, type: string, payload?: unknown) => void,
  appendMessage: (response: unknown) => void,
): InteractiveWidgetHost {
  return {
    sessionId,
    workspacePath: '',  // Not available on mobile
    worktreeId: null,

    // AskUserQuestion
    async askUserQuestionSubmit(questionId: string, answers: Record<string, string>) {
      // Persist response to transcript
      appendMessage({
        type: 'nimbalyst_tool_result',
        tool_use_id: questionId,
        result: JSON.stringify({ answers }),
      });

      // Broadcast to desktop for immediate resolution
      sendSessionControlMessage(sessionId, 'prompt_response', {
        promptType: 'ask_user_question',
        promptId: questionId,
        response: { answers },
      });
    },

    async askUserQuestionCancel(questionId: string) {
      appendMessage({
        type: 'nimbalyst_tool_result',
        tool_use_id: questionId,
        result: JSON.stringify({ cancelled: true }),
      });

      sendSessionControlMessage(sessionId, 'cancel');
    },

    // ExitPlanMode
    async exitPlanModeApprove(requestId: string) {
      sendSessionControlMessage(sessionId, 'prompt_response', {
        promptType: 'exit_plan_mode',
        promptId: requestId,
        response: { approved: true },
      });
    },

    async exitPlanModeStartNewSession(requestId: string, planFilePath: string) {
      // Mobile cannot start new sessions - just approve
      sendSessionControlMessage(sessionId, 'prompt_response', {
        promptType: 'exit_plan_mode',
        promptId: requestId,
        response: { approved: true, startNewSession: true },
      });
    },

    async exitPlanModeDeny(requestId: string, feedback?: string) {
      sendSessionControlMessage(sessionId, 'prompt_response', {
        promptType: 'exit_plan_mode',
        promptId: requestId,
        response: { approved: false, feedback },
      });
    },

    async exitPlanModeCancel(requestId: string) {
      sendSessionControlMessage(sessionId, 'cancel');
    },

    // ToolPermission
    async toolPermissionSubmit(requestId: string, response: ToolPermissionResponse) {
      appendMessage({
        type: 'nimbalyst_tool_result',
        tool_use_id: requestId,
        result: JSON.stringify(response),
      });

      sendSessionControlMessage(sessionId, 'prompt_response', {
        promptType: 'tool_permission',
        promptId: requestId,
        response,
      });
    },

    async toolPermissionCancel(requestId: string) {
      sendSessionControlMessage(sessionId, 'cancel');
    },

    // GitCommit - Limited on mobile
    async gitCommit(proposalId: string, files: string[], message: string) {
      // Mobile cannot execute git commands - send approval to desktop
      sendSessionControlMessage(sessionId, 'prompt_response', {
        promptType: 'git_commit',
        promptId: proposalId,
        response: { action: 'committed', files, message },
      });
      return { success: false, error: 'Git operations must be executed on desktop' };
    },

    async gitCommitCancel(proposalId: string) {
      sendSessionControlMessage(sessionId, 'prompt_response', {
        promptType: 'git_commit',
        promptId: proposalId,
        response: { action: 'cancelled' },
      });
    },

    // Common
    async openFile() {
      // Not available on mobile
    },

    trackEvent(eventName: string, properties?: Record<string, unknown>) {
      analyticsService.capture(eventName, properties);
    },
  };
}
```

### 3. Desktop Handler Updates

Update `MobileSessionControlHandler.ts` to handle generic `prompt_response`:

```typescript
case 'prompt_response': {
  const payload = message.payload as PromptResponsePayload;
  handlePromptResponse(
    message.sessionId,
    payload.promptType,
    payload.promptId,
    payload.response,
    findWindowByWorkspace
  );
  break;
}

function handlePromptResponse(
  sessionId: string,
  promptType: string,
  promptId: string,
  response: unknown,
  findWindowByWorkspace: (workspacePath: string) => BrowserWindow | null | undefined
): void {
  const provider = ProviderFactory.getProvider('claude-code', sessionId);
  if (!provider) {
    log.warn('No provider found for session:', sessionId);
    return;
  }

  switch (promptType) {
    case 'ask_user_question':
      handleAskUserQuestionResponse(provider, sessionId, promptId, response as AskUserQuestionResponse);
      break;

    case 'exit_plan_mode':
      handleExitPlanModeResponse(provider, sessionId, promptId, response as ExitPlanModeResponse);
      break;

    case 'tool_permission':
      handleToolPermissionResponse(provider, sessionId, promptId, response as ToolPermissionResponse);
      break;

    case 'git_commit':
      handleGitCommitResponse(provider, sessionId, promptId, response as GitCommitResponse, findWindowByWorkspace);
      break;
  }
}
```

### 4. Render CustomToolWidgets in Mobile Transcript

Currently, mobile uses `AgentTranscriptPanel` from runtime which should already support custom widgets. The issue is that:

1. The `interactiveWidgetHostAtom` is not being set for mobile sessions
2. The widgets fall back to "no host available" state

**Solution**: Set the mobile host in SessionDetailScreen when the component mounts:

```typescript
// In SessionDetailScreen.tsx
import { setInteractiveWidgetHost } from '@nimbalyst/runtime/store/atoms/interactiveWidgetHost';
import { createMobileInteractiveWidgetHost } from '../services/MobileInteractiveWidgetHost';

useEffect(() => {
  if (sessionId) {
    const host = createMobileInteractiveWidgetHost(
      sessionId,
      sendSessionControlMessage,
      appendMessage,
    );
    setInteractiveWidgetHost(sessionId, host);

    return () => {
      setInteractiveWidgetHost(sessionId, null);
    };
  }
}, [sessionId, sendSessionControlMessage]);
```

### 5. Mobile Limitations

Some operations cannot be fully executed on mobile:

| Prompt Type | Mobile Capability |
| --- | --- |
| AskUserQuestion | Full support - can answer questions |
| ToolPermission | Full support - can approve/deny |
| ExitPlanMode | Partial - can approve, cannot start new session |
| GitCommit | Partial - can approve, desktop executes git |

For GitCommit specifically, mobile can:
- Review the proposed changes (files and message)
- Edit commit message before approving
- Approve or cancel

But desktop must execute the actual `git commit` command.

**Note on GitCommit limitations**: The widget shows file paths from the tool call arguments, but cannot show actual file diffs or verify git status since mobile has no filesystem access. The widget relies on the proposal data being accurate.

## Implementation Verification

Before implementation, verify the following assumptions:

1. **CustomToolWidgets already render in AgentTranscriptPanel on Capacitor**
   - The `RichTranscriptView` component uses `getCustomToolWidget()` to render widgets
   - Widgets fall back to "no host available" state if `interactiveWidgetHostAtom(sessionId)` is null

2. **Runtime package exports are accessible from Capacitor**
   - `setInteractiveWidgetHost` is exported from `@nimbalyst/runtime/store`
   - `InteractiveWidgetHost` type is exported from CustomToolWidgets

3. **AgentTranscriptPanel passes sessionId to widgets**
   - Widgets need sessionId to look up their host from the atom

## Implementation Plan

### Phase 1: Protocol Update

1. [ ] Add `prompt_response` to `ControlMessageType` in collabv3/types.ts
2. [ ] Add `PromptResponsePayload` interface
3. [ ] Update `MobileSessionControlHandler.ts` to dispatch generic responses
4. [ ] Keep `question_response` for backwards compatibility during transition

### Phase 2: Mobile Host Implementation

1. [ ] Create `MobileInteractiveWidgetHost.ts` in capacitor package
2. [ ] Export from runtime package for capacitor to import
3. [ ] Add `appendMessage` helper to SessionDetailScreen for persisting tool results
4. [ ] Wire up host initialization in SessionDetailScreen useEffect

### Phase 3: Remove Legacy Code

1. [ ] Remove `pendingPrompt` detection logic from SessionDetailScreen
2. [ ] Remove separate `InteractivePromptWidget` rendering at bottom
3. [ ] Remove legacy `handlePromptResponse` callback
4. [ ] Remove `question_response` case from MobileSessionControlHandler (once all clients updated)

### Phase 4: Testing

1. [ ] Test AskUserQuestion flow on mobile
2. [ ] Test ToolPermission flow on mobile
3. [ ] Test ExitPlanMode approval on mobile
4. [ ] Test GitCommit approval on mobile
5. [ ] Test cancellation flows
6. [ ] Test response when desktop provider is not running
7. [ ] Test response after app restart (provider resumed)

## Benefits

1. **Single source of truth**: Widgets render from tool call data in transcript
2. **Consistent UX**: Same widgets on desktop and mobile
3. **Future-proof**: New prompt types just need host method + handler case
4. **No message scanning**: Widgets know their state from `toolCall.result`
5. **Simpler mobile code**: SessionDetailScreen doesn't need prompt detection logic

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Widget styles may not work well on mobile | Use responsive CSS, test on devices |
| Git operations can't be done on mobile | Show clear messaging, let desktop execute |
| Network latency for broadcasts | Optimistic UI updates, show submitting state |
| Provider not running when response arrives | Message persisted, provider picks up on resume |

## Design Decisions

### 1. Widget Styling: Responsive CSS

Widgets will use CSS container queries to adapt to mobile layouts. This keeps a single codebase with automatic adjustment based on container width. No `isMobile` prop needed.

### 2. GitCommit: Auto-Execute on Desktop

The `GitCommitConfirmationWidget` currently executes commits directly via `window.electronAPI.invoke('git:commit', ...)`. This doesn't exist on mobile. The flow needs to be:

When mobile user approves a commit:
1. Mobile broadcasts `prompt_response` with `promptType: 'git_commit'` containing files and message
2. Desktop `MobileSessionControlHandler` receives broadcast
3. Handler executes `git:commit` IPC call
4. Handler calls `messages:respond-to-prompt` to notify the provider
5. Result syncs back to mobile via message broadcast

**Implementation detail for handler**:
```typescript
async function handleGitCommitResponse(
  sessionId: string,
  promptId: string,
  response: { files: string[]; message: string },
  findWindowByWorkspace: (workspacePath: string) => BrowserWindow | null | undefined
): Promise<void> {
  // Need to find workspace path from session
  const session = await getSessionFromDB(sessionId);
  if (!session?.workspacePath) {
    log.error('Cannot execute git commit: no workspace path for session', sessionId);
    return;
  }

  const window = findWindowByWorkspace(session.workspacePath);
  if (!window) {
    log.error('Cannot execute git commit: no window for workspace', session.workspacePath);
    return;
  }

  // Execute git commit
  const result = await executeGitCommit(session.workspacePath, response.message, response.files);

  // Notify provider that commit is complete
  await window.webContents.invoke('messages:respond-to-prompt', {
    sessionId,
    promptId,
    promptType: 'git_commit_proposal_request',
    response: {
      action: result.success ? 'committed' : 'cancelled',
      commitHash: result.commitHash,
      error: result.error,
    },
  });
}
```

**Important**: Desktop must be running with provider active for auto-execute. If desktop is offline, the approval is persisted and the user will need to trigger execution when desktop reconnects.

### 3. ExitPlanMode "Start New Session"

Hide the "Start New Session" button on mobile since mobile cannot create worktrees. The user can still approve the plan on mobile, and start a new implementation session on desktop if needed.

## File Changes Summary

### New Files
- `packages/capacitor/src/services/MobileInteractiveWidgetHost.ts`

### Modified Files
- `packages/collabv3/src/types.ts` - Add `prompt_response` type
- `packages/electron/src/main/services/ai/MobileSessionControlHandler.ts` - Generic handler
- `packages/capacitor/src/screens/SessionDetailScreen.tsx` - Remove legacy code, add host init
- `packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/index.ts` - Export host types

### Files to Delete
- None (keep `InteractivePromptWidget.tsx` for backwards compatibility or other uses)
