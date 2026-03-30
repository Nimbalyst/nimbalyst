import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeChatTranscriptAdapter } from '../adapters/ClaudeChatTranscriptAdapter';
import { TranscriptWriter } from '../TranscriptWriter';
import type { ITranscriptEventStore } from '../types';
import { createMockStore } from './helpers/createMockStore';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaudeChatTranscriptAdapter', () => {
  let store: ITranscriptEventStore;
  let writer: TranscriptWriter;
  let adapter: ClaudeChatTranscriptAdapter;
  const sessionId = 'claude-chat-session-1';

  beforeEach(() => {
    store = createMockStore();
    writer = new TranscriptWriter(store, 'claude');
    adapter = new ClaudeChatTranscriptAdapter(writer, sessionId);
  });

  // -----------------------------------------------------------------------
  // User input
  // -----------------------------------------------------------------------

  it('should record user input', async () => {
    await adapter.handleUserInput('Explain this code');

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('user_message');
    expect(events[0].searchableText).toBe('Explain this code');
  });

  it('should record user input with attachments', async () => {
    await adapter.handleUserInput('What is this?', {
      attachments: [{ id: 'a1', filename: 'test.png', filepath: '/tmp/test.png', mimeType: 'image/png', size: 1024, type: 'image' }],
    });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    const payload = events[0].payload as any;
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].filename).toBe('test.png');
  });

  // -----------------------------------------------------------------------
  // Text accumulation from content_block_start/delta/stop
  // -----------------------------------------------------------------------

  it('should accumulate text from content_block_delta events', async () => {
    await adapter.handleEvent({ type: 'content_block_start', content_block: { type: 'text' } });
    await adapter.handleEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } });
    await adapter.handleEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } });
    await adapter.handleEvent({ type: 'content_block_stop' });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('assistant_message');
    expect(events[0].searchableText).toBe('Hello world');
  });

  it('should flush accumulated text on content_block_stop', async () => {
    await adapter.handleEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Some text' } });
    await adapter.handleEvent({ type: 'content_block_stop' });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].searchableText).toBe('Some text');
  });

  // -----------------------------------------------------------------------
  // Tool use accumulation and creation
  // -----------------------------------------------------------------------

  it('should accumulate tool_use from content blocks and create tool call', async () => {
    // Start tool use block
    await adapter.handleEvent({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'applyDiff' },
    });

    // Accumulate JSON input
    await adapter.handleEvent({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"file_path":' },
    });
    await adapter.handleEvent({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: ' "/src/app.ts"}' },
    });

    // Stop block -> finalize tool call
    await adapter.handleEvent({ type: 'content_block_stop' });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call');
    expect(toolEvent).toBeDefined();
    const payload = toolEvent!.payload as any;
    expect(payload.toolName).toBe('applyDiff');
    expect(payload.status).toBe('running');
    expect(payload.arguments.file_path).toBe('/src/app.ts');
    expect(toolEvent!.providerToolCallId).toBe('toolu_1');
  });

  it('should flush pending text before creating tool call', async () => {
    // Some text first
    await adapter.handleEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'I will edit the file' } });
    await adapter.handleEvent({ type: 'content_block_stop' });

    // Then a tool use
    await adapter.handleEvent({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'toolu_2', name: 'getDocumentContent' },
    });
    await adapter.handleEvent({ type: 'content_block_stop' });

    const events = await store.getSessionEvents(sessionId);
    expect(events[0].eventType).toBe('assistant_message');
    expect(events[0].searchableText).toBe('I will edit the file');
    expect(events[1].eventType).toBe('tool_call');
  });

  it('should handle tool_use with empty arguments', async () => {
    await adapter.handleEvent({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'toolu_3', name: 'getDocumentContent' },
    });
    await adapter.handleEvent({ type: 'content_block_stop' });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call');
    const payload = toolEvent!.payload as any;
    expect(payload.arguments).toEqual({});
  });

  it('should handle malformed JSON in tool arguments gracefully', async () => {
    await adapter.handleEvent({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'toolu_bad', name: 'badTool' },
    });
    await adapter.handleEvent({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{not valid json' },
    });
    await adapter.handleEvent({ type: 'content_block_stop' });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call');
    expect(toolEvent).toBeDefined();
    const payload = toolEvent!.payload as any;
    expect(payload.arguments._rawInput).toBe('{not valid json');
  });

  // -----------------------------------------------------------------------
  // Tool result updates
  // -----------------------------------------------------------------------

  it('should update tool call with result', async () => {
    // Create tool call
    await adapter.handleEvent({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'toolu_r1', name: 'applyDiff' },
    });
    await adapter.handleEvent({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{}' },
    });
    await adapter.handleEvent({ type: 'content_block_stop' });

    // Update with result
    await adapter.handleToolResult('toolu_r1', 'Diff applied successfully');

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call');
    const payload = toolEvent!.payload as any;
    expect(payload.status).toBe('completed');
    expect(payload.result).toBe('Diff applied successfully');
  });

  it('should update tool call with error result', async () => {
    await adapter.handleEvent({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'toolu_e1', name: 'applyDiff' },
    });
    await adapter.handleEvent({ type: 'content_block_stop' });

    await adapter.handleToolResult('toolu_e1', 'File not found', true);

    const events = await store.getSessionEvents(sessionId);
    const payload = events.find((e) => e.eventType === 'tool_call')!.payload as any;
    expect(payload.status).toBe('error');
    expect(payload.isError).toBe(true);
  });

  it('should ignore tool result for unknown tool call ID', async () => {
    // Should not throw
    await adapter.handleToolResult('unknown-id', 'some result');

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Turn ended on message_stop
  // -----------------------------------------------------------------------

  it('should record turn_ended on message_stop with usage data', async () => {
    // Provide usage via message_start
    await adapter.handleEvent({
      type: 'message_start',
      message: { usage: { input_tokens: 500, output_tokens: 100 } },
    });

    // Some content
    await adapter.handleEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Response' } });

    // Message stop
    await adapter.handleEvent({ type: 'message_stop' });

    const events = await store.getSessionEvents(sessionId);
    const turnEvent = events.find((e) => e.eventType === 'turn_ended');
    expect(turnEvent).toBeDefined();
    const payload = turnEvent!.payload as any;
    expect(payload.contextFill.inputTokens).toBe(500);
    expect(payload.contextFill.outputTokens).toBe(100);
  });

  it('should accumulate usage from message_delta', async () => {
    await adapter.handleEvent({
      type: 'message_start',
      message: { usage: { input_tokens: 300, output_tokens: 0 } },
    });
    await adapter.handleEvent({
      type: 'message_delta',
      usage: { output_tokens: 150 },
    });
    await adapter.handleEvent({ type: 'message_stop' });

    const events = await store.getSessionEvents(sessionId);
    const turnEvent = events.find((e) => e.eventType === 'turn_ended');
    const payload = turnEvent!.payload as any;
    expect(payload.contextFill.inputTokens).toBe(300);
    expect(payload.contextFill.outputTokens).toBe(150);
  });

  it('should skip turn_ended when no usage data', async () => {
    await adapter.handleEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } });
    await adapter.handleEvent({ type: 'message_stop' });

    const events = await store.getSessionEvents(sessionId);
    expect(events.filter((e) => e.eventType === 'turn_ended')).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Flush behavior
  // -----------------------------------------------------------------------

  it('should flush pending text when user input arrives', async () => {
    await adapter.handleEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Pending' } });
    await adapter.handleUserInput('Follow up');

    const events = await store.getSessionEvents(sessionId);
    expect(events[0].eventType).toBe('assistant_message');
    expect(events[0].searchableText).toBe('Pending');
    expect(events[1].eventType).toBe('user_message');
  });

  it('should not create event on flush when no pending text', async () => {
    await adapter.flush();

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Unknown events
  // -----------------------------------------------------------------------

  it('should silently ignore unknown event types', async () => {
    await adapter.handleEvent({ type: 'ping' });
    await adapter.handleEvent({ type: 'unknown_type', data: 'foo' });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(0);
  });

  it('should handle null/undefined events gracefully', async () => {
    await adapter.handleEvent(null);
    await adapter.handleEvent(undefined);
    await adapter.handleEvent('string');

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(0);
  });
});
