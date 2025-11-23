---
planStatus:
  planId: plan-exit-plan-mode-confirmation
  title: ExitPlanMode Confirmation Hook
  status: in-review
  planType: feature
  priority: high
  owner: developer
  stakeholders:
    - developer
  tags:
    - claude-code
    - hooks
    - plan-mode
    - ux
  created: "2025-11-22"
  updated: "2025-11-23T06:50:00.000Z"
  startDate: "2025-11-23"
  progress: 100
---
## Implementation Progress

- [x] Add ExitPlanMode handling to PreToolUse hook in ClaudeCodeProvider
- [x] Implement callback mechanism for user confirmation from hook
- [x] Update currentMode to 'agent' when user approves
- [x] Create inline transcript confirmation component
- [x] Show plan summary in confirmation UI
- [x] Handle abort/cancel scenarios
- [x] Test multiple concurrent sessions show independent confirmations

# ExitPlanMode Confirmation Hook

## Problem

When the AI agent is in planning mode and wants to exit (to start implementing), it calls the `ExitPlanMode` tool. Currently, this happens without any user confirmation - the agent simply exits plan mode and can immediately start writing code files.

This is problematic because:
1. The user may not have finished reviewing the plan
2. The agent might exit prematurely before the plan is complete
3. Users lose the opportunity to request changes before implementation begins
4. There's no clear handoff point between planning and implementation phases

## Goals

1. Intercept the `ExitPlanMode` tool call before it executes
2. Present an inline confirmation UI in the transcript (not a dialog)
3. Allow the user to:
  - Approve: proceed with exiting plan mode
  - Deny: keep the agent in plan mode so they can continue refining the plan
4. Communicate the user's decision back to the agent appropriately
5. Sync our internal `currentMode` state when plan mode is exited

## Current Bug: Mode State Desync

There's an existing bug that must be fixed as part of this work:

1. `this.currentMode` in ClaudeCodeProvider is set once at the start of `sendMessage()`
2. When SDK executes `ExitPlanMode`, it internally switches modes
3. But our `currentMode` is never updated
4. Our PreToolUse hook still enforces planning restrictions (markdown-only files)
5. **Result**: Agent is stuck - SDK thinks it's in agent mode, but our hook blocks non-markdown writes

The fix: When user approves ExitPlanMode, update `this.currentMode = 'agent'` so subsequent file operations are allowed.

## Proposed Solution

Add a `PreToolUse` hook handler specifically for the `ExitPlanMode` tool in `ClaudeCodeProvider`. When this tool is called:

1. The hook intercepts the call before execution
2. Emit an event to the renderer to add an inline confirmation component to the transcript
3. Wait for user response (approve/deny)
4. If approved, update `this.currentMode = 'agent'`
5. Return appropriate `permissionDecision` to the SDK:
  - `'allow'` if user approves
  - `'deny'` with a message if user wants to continue planning

## Key Components

### 1. PreToolUse Hook Extension
Extend the existing `createPreToolUseHook()` method to handle `ExitPlanMode` before the early-return guard for file editing tools.

### 2. Inline Transcript UI
Add an inline confirmation component that appears at the bottom of the transcript when ExitPlanMode is intercepted:
- Shows the plan summary (from tool arguments)
- "Start Coding" button to approve exiting plan mode
- "Continue Planning" button to stay in plan mode
- Stays in the specific session's transcript (supports multiple concurrent sessions)

### 3. IPC/Callback Communication
Use the existing message callback pattern to:
- Request user confirmation from the renderer
- Await the response before returning permission decision
- Handle timeout/abort scenarios

### 4. Mode State Sync
When user approves, update `this.currentMode = 'agent'` before returning `permissionDecision: 'allow'`.

### 5. Agent Feedback
When denied, the `errorMessage` returned to the agent should clearly explain that the user wants to continue refining the plan before implementation.

## Files to Modify

- `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` - Add ExitPlanMode handling to PreToolUse hook, update currentMode on approval
- `packages/electron/src/renderer/components/AgenticCoding/` - Add inline confirmation component for transcript
- Message callback system may need extension for the confirmation flow

## Considerations

- The hook must be async-capable to wait for user input
- Need to handle timeout/abort scenarios gracefully
- Should work with the existing abort controller pattern
- Inline UI avoids confusion when multiple sessions are running simultaneously
- The confirmation appears in context within the specific session's transcript

## Acceptance Criteria

1. When agent calls ExitPlanMode, an inline confirmation appears at the bottom of that session's transcript
2. User can approve ("Start Coding") or deny ("Continue Planning")
3. If denied, agent receives clear feedback and stays in planning mode
4. If approved, `currentMode` is updated to 'agent' and plan mode exits normally
5. After approval, the agent can write non-markdown files without being blocked
6. Works correctly with abort/cancel scenarios
7. Multiple concurrent sessions each show their own confirmation independently
