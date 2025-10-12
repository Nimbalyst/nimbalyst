# Agentic Coding Streaming Transcript Tests

This directory contains E2E tests for the real-time streaming transcript feature in the Agentic Coding Window.

## Overview

The streaming transcript feature allows users to see AI responses in real-time as they're generated, rather than waiting for the entire response to complete. These tests validate that:

1. Streaming content appears immediately as chunks arrive
2. Thinking indicators are removed when streaming starts
3. Streaming content is replaced by persisted messages on completion
4. Per-tab input state is maintained correctly
5. Cleanup happens properly on cancel or error
6. Performance is maintained with debouncing

## Running the Tests

### Run all streaming tests:
```bash
cd packages/electron
npx playwright test e2e/ai/agentic-coding-streaming.spec.ts
```

### Run a specific test:
```bash
npx playwright test e2e/ai/agentic-coding-streaming.spec.ts -g "should display streaming content in real-time"
```

### Run tests with UI (headed mode):
```bash
npx playwright test e2e/ai/agentic-coding-streaming.spec.ts --headed
```

### Run tests with debug mode:
```bash
npx playwright test e2e/ai/agentic-coding-streaming.spec.ts --debug
```

## Test Structure

### Main Test File
- `agentic-coding-streaming.spec.ts` - Complete test suite for streaming feature

### Helper Utilities
- `../utils/agenticStreamingSimulator.ts` - Reusable utilities for simulating AI streaming

## Key Test Scenarios

### 1. Real-time Streaming Display
Tests that content appears immediately as chunks arrive from the AI, with the "streaming..." indicator visible.

### 2. Thinking Indicator Removal
Validates that the "Thinking..." placeholder is removed when the first streaming chunk arrives.

### 3. Completion Handling
Verifies that streaming content is replaced by the persisted database message when the stream completes.

### 4. Pulsing Cursor
Checks that a visual pulsing cursor indicator appears during streaming.

### 5. Per-Tab Input State
Ensures each session tab maintains its own independent draft input that persists when switching tabs.

### 6. Cancel Functionality
Tests that canceling a request properly clears streaming content and state.

### 7. Tool Call Integration
Validates that streaming works correctly when tool calls occur during the response.

### 8. Debouncing Performance
Verifies that rapid streaming updates are properly debounced (50ms) to avoid excessive re-renders.

### 9. Auto-scroll Behavior
Checks that the transcript auto-scrolls to show new streaming content.

## Using the Simulator Utilities

The `agenticStreamingSimulator.ts` utilities make it easy to mock AI streaming:

### Basic Streaming:
```typescript
import {
  simulateAgenticStreaming,
  setupStreamHandlerCapture
} from '../utils/agenticStreamingSimulator';

// In beforeEach:
await setupStreamHandlerCapture(page);

// In test:
await simulateAgenticStreaming(page, [
  'First chunk ',
  'second chunk ',
  'final chunk'
], {
  delayBetweenChunks: 100,
  includeCompletion: true
});
```

### With Tool Calls:
```typescript
await simulateAgenticStreaming(page, ['Analyzing...'], {
  includeToolCalls: true,
  toolCalls: [{
    id: 'tool-1',
    name: 'Read',
    arguments: { file_path: '/test.ts' },
    result: 'File content'
  }]
});
```

### Complete Message Exchange:
```typescript
import { simulateMessageExchange } from '../utils/agenticStreamingSimulator';

await simulateMessageExchange(
  page,
  'User message here',
  ['AI response ', 'in chunks'],
  { delayBetweenChunks: 100 }
);
```

### Check Streaming State:
```typescript
import {
  hasStreamingIndicator,
  transcriptContains,
  waitForStreamingComplete
} from '../utils/agenticStreamingSimulator';

// Check if currently streaming
const isStreaming = await hasStreamingIndicator(page);

// Check transcript content
const hasText = await transcriptContains(page, 'some text');

// Wait for streaming to complete
await waitForStreamingComplete(page, 5000);
```

### Input Management:
```typescript
import {
  getAgenticInput,
  setAgenticInput
} from '../utils/agenticStreamingSimulator';

// Set input value
await setAgenticInput(page, 'My message');

// Get current input value
const value = await getAgenticInput(page);
```

## Implementation Details

### How Streaming Simulation Works

1. **Handler Capture**: `setupStreamHandlerCapture()` intercepts the `onAIStreamResponse` handler registration
2. **Event Emission**: `simulateAgenticStreaming()` emits mock streaming events directly to captured handlers
3. **Realistic Timing**: Uses configurable delays to simulate real AI response timing
4. **Complete Lifecycle**: Supports partial chunks, tool calls, and completion events

### Mock Stream Event Structure

```typescript
// Streaming chunk event
{
  partial: 'accumulated content so far',
  isComplete: false
}

// Tool call event
{
  partial: 'accumulated content',
  isComplete: false,
  toolCalls: [{ id, name, arguments, result }]
}

// Completion event
{
  partial: 'final accumulated content',
  isComplete: true
}
```

## Debugging Tests

### View Test Execution
```bash
npx playwright test --ui
```

### Generate Trace
```bash
npx playwright test --trace on
```

### Check Failed Test Screenshots
Failed tests automatically capture screenshots in `test-results/`

## Performance Considerations

- Tests use realistic delays (50-100ms between chunks) to simulate actual AI streaming
- Debouncing is validated to ensure no more than ~20 FPS updates
- Auto-scroll performance is checked with long transcript scenarios
- Per-tab state isolation prevents unnecessary re-renders

## Troubleshooting

### Tests Timing Out
- Increase timeout: `test.setTimeout(TEST_TIMEOUTS.VERY_LONG)`
- Check that `setupStreamHandlerCapture()` is called in beforeEach
- Verify the agentic coding window opens successfully

### Streaming Not Appearing
- Ensure handlers are captured before streaming starts
- Check that the window has loaded completely
- Verify the correct selectors for transcript elements

### Flaky Tests
- Add appropriate `waitForTimeout()` after state changes
- Use `waitForStreamingComplete()` instead of fixed timeouts
- Ensure cleanup happens between tests

## Related Files

- Implementation: `packages/electron/src/renderer/components/AgenticCodingWindow.tsx`
- Transcript Panel: `packages/runtime/src/ui/AgentTranscript/components/AgentTranscriptPanel.tsx`
- Rich View: `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`
- Plan: `plans/agentic-coding-streaming-transcript.md`
