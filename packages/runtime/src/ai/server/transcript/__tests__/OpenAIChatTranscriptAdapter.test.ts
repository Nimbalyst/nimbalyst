import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAIChatTranscriptAdapter } from '../adapters/OpenAIChatTranscriptAdapter';
import { TranscriptWriter } from '../TranscriptWriter';
import type { ITranscriptEventStore } from '../types';
import { createMockStore } from './helpers/createMockStore';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAIChatTranscriptAdapter', () => {
  let store: ITranscriptEventStore;
  let writer: TranscriptWriter;
  let adapter: OpenAIChatTranscriptAdapter;
  const sessionId = 'openai-chat-session-1';

  beforeEach(() => {
    store = createMockStore();
    writer = new TranscriptWriter(store, 'openai');
    adapter = new OpenAIChatTranscriptAdapter(writer, sessionId);
  });

  // -----------------------------------------------------------------------
  // User input
  // -----------------------------------------------------------------------

  it('should record user input', async () => {
    await adapter.handleUserInput('Write a function');

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('user_message');
    expect(events[0].searchableText).toBe('Write a function');
  });

  // -----------------------------------------------------------------------
  // Text accumulation from chat.completion.chunk deltas
  // -----------------------------------------------------------------------

  it('should accumulate text from delta.content chunks', async () => {
    await adapter.handleChunk({
      choices: [{ delta: { content: 'Hello ' }, finish_reason: null }],
    });
    await adapter.handleChunk({
      choices: [{ delta: { content: 'world' }, finish_reason: null }],
    });
    await adapter.handleChunk({
      choices: [{ delta: {}, finish_reason: 'stop' }],
    });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('assistant_message');
    expect(events[0].searchableText).toBe('Hello world');
  });

  it('should record turn_ended on finish_reason stop with usage', async () => {
    await adapter.handleChunk({
      choices: [{ delta: { content: 'Done' }, finish_reason: null }],
    });
    await adapter.handleChunk({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 200, completion_tokens: 50, total_tokens: 250 },
    });

    const events = await store.getSessionEvents(sessionId);
    const turnEvent = events.find((e) => e.eventType === 'turn_ended');
    expect(turnEvent).toBeDefined();
    const payload = turnEvent!.payload as any;
    expect(payload.contextFill.inputTokens).toBe(200);
    expect(payload.contextFill.outputTokens).toBe(50);
  });

  it('should skip turn_ended when no usage data', async () => {
    await adapter.handleChunk({
      choices: [{ delta: { content: 'Hi' }, finish_reason: null }],
    });
    await adapter.handleChunk({
      choices: [{ delta: {}, finish_reason: 'stop' }],
    });

    const events = await store.getSessionEvents(sessionId);
    expect(events.filter((e) => e.eventType === 'turn_ended')).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Tool call accumulation from tool_calls deltas
  // -----------------------------------------------------------------------

  it('should accumulate tool calls from delta.tool_calls and finalize', async () => {
    // First chunk: tool call ID and name
    await adapter.handleChunk({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_abc',
            function: { name: 'applyDiff', arguments: '' },
          }],
        },
        finish_reason: null,
      }],
    });

    // Second chunk: partial arguments
    await adapter.handleChunk({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: '{"file_path":' },
          }],
        },
        finish_reason: null,
      }],
    });

    // Third chunk: rest of arguments
    await adapter.handleChunk({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: ' "/src/app.ts"}' },
          }],
        },
        finish_reason: null,
      }],
    });

    // Finish with tool_calls reason
    await adapter.handleChunk({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call');
    expect(toolEvent).toBeDefined();
    const payload = toolEvent!.payload as any;
    expect(payload.toolName).toBe('applyDiff');
    expect(payload.status).toBe('running');
    expect(payload.arguments.file_path).toBe('/src/app.ts');
    expect(toolEvent!.providerToolCallId).toBe('call_abc');
  });

  it('should handle multiple parallel tool calls', async () => {
    // Two tool calls in parallel
    await adapter.handleChunk({
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, id: 'call_1', function: { name: 'tool_a', arguments: '{}' } },
            { index: 1, id: 'call_2', function: { name: 'tool_b', arguments: '{}' } },
          ],
        },
        finish_reason: null,
      }],
    });

    await adapter.handleChunk({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvents = events.filter((e) => e.eventType === 'tool_call');
    expect(toolEvents).toHaveLength(2);
    expect((toolEvents[0].payload as any).toolName).toBe('tool_a');
    expect((toolEvents[1].payload as any).toolName).toBe('tool_b');
  });

  it('should flush pending text before finalizing tool calls', async () => {
    // Text first
    await adapter.handleChunk({
      choices: [{ delta: { content: 'Let me check' }, finish_reason: null }],
    });

    // Then tool calls
    await adapter.handleChunk({
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'call_t', function: { name: 'myTool', arguments: '{}' } }],
        },
        finish_reason: null,
      }],
    });

    await adapter.handleChunk({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    });

    const events = await store.getSessionEvents(sessionId);
    expect(events[0].eventType).toBe('assistant_message');
    expect(events[0].searchableText).toBe('Let me check');
    expect(events[1].eventType).toBe('tool_call');
  });

  // -----------------------------------------------------------------------
  // Tool result updates
  // -----------------------------------------------------------------------

  it('should update tool call with result', async () => {
    // Create tool call
    await adapter.handleChunk({
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'call_r1', function: { name: 'applyDiff', arguments: '{}' } }],
        },
        finish_reason: null,
      }],
    });
    await adapter.handleChunk({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    });

    // Update with result
    await adapter.handleToolResult('call_r1', 'Success!');

    const events = await store.getSessionEvents(sessionId);
    const payload = events.find((e) => e.eventType === 'tool_call')!.payload as any;
    expect(payload.status).toBe('completed');
    expect(payload.result).toBe('Success!');
  });

  it('should update tool call with error result', async () => {
    await adapter.handleChunk({
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'call_e1', function: { name: 'applyDiff', arguments: '{}' } }],
        },
        finish_reason: null,
      }],
    });
    await adapter.handleChunk({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    });

    await adapter.handleToolResult('call_e1', 'File not found', true);

    const events = await store.getSessionEvents(sessionId);
    const payload = events.find((e) => e.eventType === 'tool_call')!.payload as any;
    expect(payload.status).toBe('error');
    expect(payload.isError).toBe(true);
  });

  it('should ignore tool result for unknown tool call ID', async () => {
    await adapter.handleToolResult('unknown-id', 'some result');

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Flush behavior
  // -----------------------------------------------------------------------

  it('should flush pending text when user input arrives', async () => {
    await adapter.handleChunk({
      choices: [{ delta: { content: 'Pending text' }, finish_reason: null }],
    });
    await adapter.handleUserInput('New question');

    const events = await store.getSessionEvents(sessionId);
    expect(events[0].eventType).toBe('assistant_message');
    expect(events[0].searchableText).toBe('Pending text');
    expect(events[1].eventType).toBe('user_message');
  });

  it('should not create event on flush when no pending text', async () => {
    await adapter.flush();

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Usage data with OpenAI field names
  // -----------------------------------------------------------------------

  it('should handle usage with input_tokens/output_tokens field names', async () => {
    await adapter.handleChunk({
      choices: [{ delta: { content: 'Hi' }, finish_reason: null }],
    });
    await adapter.handleChunk({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { input_tokens: 100, output_tokens: 25 },
    });

    const events = await store.getSessionEvents(sessionId);
    const turnEvent = events.find((e) => e.eventType === 'turn_ended');
    const payload = turnEvent!.payload as any;
    expect(payload.contextFill.inputTokens).toBe(100);
    expect(payload.contextFill.outputTokens).toBe(25);
  });

  // -----------------------------------------------------------------------
  // LM Studio compatibility
  // -----------------------------------------------------------------------

  it('should work with lmstudio provider string', async () => {
    const lmStore = createMockStore();
    const lmWriter = new TranscriptWriter(lmStore, 'lmstudio');
    const lmAdapter = new OpenAIChatTranscriptAdapter(lmWriter, 'lm-session-1');

    await lmAdapter.handleUserInput('Hello from LM Studio');
    await lmAdapter.handleChunk({
      choices: [{ delta: { content: 'Hi there!' }, finish_reason: null }],
    });
    await lmAdapter.handleChunk({
      choices: [{ delta: {}, finish_reason: 'stop' }],
    });

    const events = await lmStore.getSessionEvents('lm-session-1');
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe('user_message');
    expect(events[0].provider).toBe('lmstudio');
    expect(events[1].eventType).toBe('assistant_message');
    expect(events[1].searchableText).toBe('Hi there!');
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('should handle null/undefined chunks gracefully', async () => {
    await adapter.handleChunk(null);
    await adapter.handleChunk(undefined);
    await adapter.handleChunk('string');

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(0);
  });

  it('should handle chunks with no choices', async () => {
    await adapter.handleChunk({ id: 'chatcmpl-1' });
    await adapter.handleChunk({ choices: [] });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(0);
  });

  it('should handle malformed tool call arguments', async () => {
    await adapter.handleChunk({
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'call_bad', function: { name: 'badTool', arguments: '{broken json' } }],
        },
        finish_reason: null,
      }],
    });
    await adapter.handleChunk({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call');
    expect(toolEvent).toBeDefined();
    const payload = toolEvent!.payload as any;
    expect(payload.arguments._rawInput).toBe('{broken json');
  });
});
