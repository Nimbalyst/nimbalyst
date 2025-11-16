---
planStatus:
  planId: plan-ai-prompt-queueing
  title: AI Prompt Queueing System
  status: blocked
  planType: feature
  priority: medium
  owner: developer
  stakeholders:
    - developer
    - users
  tags:
    - ai
    - ux
    - performance
    - claude-code
  created: "2025-11-08"
  updated: "2025-11-09T07:10:00.000Z"
  progress: 90
  startDate: "2025-11-09"
---
## Implementation Progress

- [x] Add `queuedPrompts` array to SessionData type
- [x] Add queue processing logic to AIService.sendMessage()
- [x] Create PromptQueueList component
- [x] Add Queue button to AIInput component
- [x] Wire up queue to AISessionView
- [x] Add IPC handler for updating session metadata
- [x] Users can queue prompts while AI is processing (UI works)
- [ ] Queued prompts execute in FIFO order (BLOCKED - code not executing)
- [x] Queue state persists across restarts (storage works)
- [x] Users can view and cancel queued prompts (UI works)
- [x] Clear visual feedback for queue count (badge shows correctly)
- [x] E2E test created for queue feature
- [ ] E2E test passing

## Current Blocker

**Queue processing code does not execute after message completion.**

Test evidence:
- Queue creation works (badge shows "1", queue list displays prompt)
- First prompt completes successfully
- Second prompt does NOT auto-execute
- Queue remains at count "1" indefinitely

Investigation done:
- Moved queue processing from 'complete' case to after for-await loop (line 1187+)
- Added debug file logging - file never created, proving code not reached
- Confirmed ClaudeCodeProvider doesn't yield 'complete' chunk (generator just ends)

Possible causes:
1. Exception/error thrown before reaching line 1187
2. Early return statement preventing code execution
3. Execution flow issue not yet identified

Next steps: Need to identify why code after for-await loop completion isn't executing.

# AI Prompt Queueing System

## Goals

Enable users to queue multiple prompts to the AI agent without waiting for the current prompt to complete. This improves workflow efficiency by allowing users to:

1. Submit multiple related tasks in succession without context switching
2. Continue working while the AI processes queued prompts in order
3. Review and cancel queued prompts before they execute
4. See clear visual feedback about queue status and progress

## Problem Statement

Currently, when a user sends a prompt to the AI agent (particularly Claude Code), they must wait for the entire response to complete before sending another prompt. This creates friction in the workflow:

- Users cannot prepare the next task while waiting for results
- Multi-step workflows require manual monitoring and intervention
- No way to batch related operations efficiently
- Context switching reduces productivity

The Claude Agent SDK processes prompts synchronously through the `query()` function, which returns an async iterator. While this supports streaming responses, it blocks concurrent prompt submission within the same session.

## System Architecture Overview

### Current Flow

1. User submits prompt via AI input field
2. `AIService.sendMessage()` is called via IPC
3. Provider's `sendMessage()` method is invoked (e.g., ClaudeCodeProvider)
4. Claude Agent SDK's `query()` function processes the request
5. Response streams back through async iterator
6. UI updates in real-time with streamed content
7. Session is ready for next prompt only after completion

### Proposed Queuing Flow

1. User submits prompt while another is in progress
2. Prompt is added to session's queue array in metadata
3. Session metadata update persists queue via existing `ai:updateSession` IPC
4. Queue UI shows pending prompts with status indicators
5. When current prompt completes, next prompt auto-starts from queue
6. Queue state persists automatically with session

## Key Components

### 1. Session Queue Array

**Location**: Add `queuedPrompts` array to session metadata

Queue stored as simple array in `SessionData.metadata.queuedPrompts`:
```typescript
{
  id: string;           // Unique ID for this queued item
  prompt: string;       // The user's message
  timestamp: number;    // When queued
}[]
```

No separate database table needed - queue is just part of session metadata.

### 2. Queue Processing Logic

**Location**: Modify `AIService.sendMessage()` handler

Changes:
- After message completes, check if session has queued prompts
- If queue exists and has items, automatically call `sendMessage` with first item
- Remove processed item from queue
- Update session metadata to persist queue state

### 3. UI Components

**Location**: `packages/electron/src/renderer/components/`

New Components:
- `PromptQueueList` - Simple list above input showing queued prompts

Modified Components:
- `AIInput` - Add "Queue" button when busy, show queue count
- `AgenticInput` - Same queue UI for coding sessions

Use existing session update mechanisms - no new IPC channels needed.

## User Experience

### Queue Interaction

1. **Submitting to Queue**
  - While AI is processing, input shows "Queue" button instead of/alongside "Send"
  - Click "Queue" or use keyboard shortcut (Cmd+Shift+Enter) to queue prompt
  - Prompt appears in queue panel with "pending" status
  - Input clears, ready for next prompt

2. **Queue Panel**
  - panel showing all queued prompts just above the input area (show all queued messages)
  - Each item shows: prompt preview, timestamp, status
  - Actions per item: Edit, Cancel, Move Up/Down
  - Global actions: Pause Queue, Clear All, Resume
  - Shows current processing item at top

3. **Status Indicators**
  - Badge on AI input showing queue count (e.g., "3 queued")
  - Progress indicator for current item
  - Toast notifications when queue completes
  - Visual feedback for queue state changes

4. **Queue Management**
  - Drag-and-drop to reorder queue items
  - Click to edit or cancel queued prompt before execution
  - Pause queue to prevent auto-processing
  - Clear queue to cancel all pending items

### Error Handling

- If queued prompt fails, mark as failed and pause queue
- Show error message in queue item
- User can retry, edit, or skip failed item
- Option to continue queue on error (skip failed items)

## Implementation Phases

### Phase 1: Data Structure (15 min)
- Add `queuedPrompts` array to SessionData type
- No database migration needed - just metadata

### Phase 2: Queue Processing Logic (30 min)
- Modify `AIService.sendMessage()` to check queue after completion
- Auto-process next queued prompt if present
- Update session metadata to remove processed items

### Phase 3: Basic UI (1 hour)
- Create simple `PromptQueueList` component
- Add "Queue" button to AIInput when busy
- Show queue count badge
- Click to remove queued items

### Phase 4: Polish (30 min)
- Error handling for failed queue items
- Clear visual feedback
- Basic E2E test

## Technical Considerations

### Claude Agent SDK Constraints

The Claude Agent SDK's `query()` function is designed for single-request processing:
- Returns async iterator for streaming
- Does not natively support concurrent requests in same session
- Session state is maintained across sequential calls

Our queue system works with these constraints by:
- Processing queue items sequentially, not concurrently
- Waiting for current `query()` to complete before starting next
- Maintaining session continuity across queued prompts

### Session Continuity

Queued prompts maintain conversation context naturally:
- Each prompt in queue processes after previous completes
- Session messages array includes all prior responses
- Document context uses current state at execution time

### Simplicity

- No separate queue manager class needed
- No new IPC channels
- No new database tables
- Just an array in session metadata + auto-process logic

## Acceptance Criteria

1. Users can queue multiple prompts while AI is processing
2. Queued prompts execute sequentially in FIFO order
3. Queue state persists across app restarts (via session metadata)
4. Users can view and cancel queued prompts
5. Clear visual feedback for queue count
6. Simple error handling for failed queue items
7. Works with all AI providers

## Related Files

This feature will affect:
- `packages/runtime/src/ai/server/types.ts` - Add `queuedPrompts` to SessionData type
- `packages/electron/src/main/services/ai/AIService.ts` - Add auto-process logic after sendMessage
- `packages/electron/src/renderer/components/PromptQueueList.tsx` (new) - Simple queue display
- `packages/electron/src/renderer/components/UnifiedAI/AIInput.tsx` - Add Queue button
- `packages/electron/src/renderer/components/AgenticCoding/AgenticInput.tsx` - Add Queue button

Total: ~2-3 hours of work, minimal complexity.
