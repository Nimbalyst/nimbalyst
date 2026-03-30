import { describe, it, expect, beforeEach } from 'vitest';
import { CodexTranscriptAdapter } from '../adapters/CodexTranscriptAdapter';
import { TranscriptWriter } from '../TranscriptWriter';
import type { ITranscriptEventStore } from '../types';
import { createMockStore } from './helpers/createMockStore';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodexTranscriptAdapter', () => {
  let store: ITranscriptEventStore;
  let writer: TranscriptWriter;
  let adapter: CodexTranscriptAdapter;
  const sessionId = 'codex-session-1';

  beforeEach(() => {
    store = createMockStore();
    writer = new TranscriptWriter(store, 'openai-codex');
    adapter = new CodexTranscriptAdapter(writer, sessionId);
  });

  // -----------------------------------------------------------------------
  // User input
  // -----------------------------------------------------------------------

  it('should record user input', async () => {
    await adapter.handleUserInput('Fix the bug', { mode: 'agent' });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('user_message');
    expect(events[0].searchableText).toBe('Fix the bug');
  });

  // -----------------------------------------------------------------------
  // Text accumulation
  // -----------------------------------------------------------------------

  it('should accumulate text events and flush', async () => {
    await adapter.handleEvent({ type: 'text', content: 'Part 1 ' });
    await adapter.handleEvent({ type: 'text', content: 'Part 2' });
    await adapter.flush();

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('assistant_message');
    expect(events[0].searchableText).toBe('Part 1 Part 2');
  });

  it('should flush text before tool call event', async () => {
    await adapter.handleEvent({ type: 'text', content: 'Before tool' });
    await adapter.handleEvent({
      type: 'tool_call',
      toolCall: { id: 'tc-1', name: 'shell', arguments: { command: 'ls' } },
    });

    const events = await store.getSessionEvents(sessionId);
    expect(events[0].eventType).toBe('assistant_message');
    expect(events[0].searchableText).toBe('Before tool');
    expect(events[1].eventType).toBe('tool_call');
  });

  // -----------------------------------------------------------------------
  // Tool calls
  // -----------------------------------------------------------------------

  it('should create tool call from tool_call event without result', async () => {
    await adapter.handleEvent({
      type: 'tool_call',
      toolCall: { id: 'tc-1', name: 'shell', arguments: { command: 'npm test' } },
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call');
    expect(toolEvent).toBeDefined();
    const payload = toolEvent!.payload as any;
    expect(payload.toolName).toBe('shell');
    expect(payload.status).toBe('running');
    expect(toolEvent!.providerToolCallId).toBe('tc-1');
  });

  it('should create and immediately complete tool call with result', async () => {
    await adapter.handleEvent({
      type: 'tool_call',
      toolCall: { id: 'tc-2', name: 'shell', arguments: { command: 'echo hi' }, result: 'hi' },
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call');
    const payload = toolEvent!.payload as any;
    expect(payload.status).toBe('completed');
    expect(payload.result).toBe('hi');
  });

  it('should update existing tool call when result arrives', async () => {
    // First event: tool started (no result)
    await adapter.handleEvent({
      type: 'tool_call',
      toolCall: { id: 'tc-3', name: 'shell', arguments: { command: 'sleep 1' } },
    });

    // Second event: tool completed (with result)
    await adapter.handleEvent({
      type: 'tool_call',
      toolCall: { id: 'tc-3', name: 'shell', arguments: { command: 'sleep 1' }, result: 'done' },
    });

    const events = await store.getSessionEvents(sessionId);
    // Should only have one tool_call event (created once, then updated)
    const toolEvents = events.filter((e) => e.eventType === 'tool_call');
    expect(toolEvents).toHaveLength(1);
    expect((toolEvents[0].payload as any).status).toBe('completed');
    expect((toolEvents[0].payload as any).result).toBe('done');
  });

  it('should detect error results', async () => {
    await adapter.handleEvent({
      type: 'tool_call',
      toolCall: { id: 'tc-err', name: 'shell', arguments: { command: 'bad' }, result: { error: 'command not found' } },
    });

    const events = await store.getSessionEvents(sessionId);
    const payload = events.find((e) => e.eventType === 'tool_call')!.payload as any;
    expect(payload.status).toBe('error');
    expect(payload.isError).toBe(true);
  });

  // -----------------------------------------------------------------------
  // file_change tool
  // -----------------------------------------------------------------------

  it('should handle file_change tool with changes array', async () => {
    await adapter.handleEvent({
      type: 'tool_call',
      toolCall: {
        id: 'fc-1',
        name: 'file_change',
        arguments: { changes: [{ path: '/src/app.ts', patch: '+import foo' }] },
        result: { status: 'applied', changes: [{ path: '/src/app.ts', patch: '+import foo' }] },
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const payload = events.find((e) => e.eventType === 'tool_call')!.payload as any;
    expect(payload.toolDisplayName).toBe('File Change');
    expect(payload.changes).toEqual([{ path: '/src/app.ts', patch: '+import foo' }]);
  });

  // -----------------------------------------------------------------------
  // MCP tool
  // -----------------------------------------------------------------------

  it('should parse MCP tool names into mcpServer/mcpTool', async () => {
    await adapter.handleEvent({
      type: 'tool_call',
      toolCall: { id: 'mcp-1', name: 'mcp__posthog__query', arguments: { sql: 'SELECT 1' } },
    });

    const events = await store.getSessionEvents(sessionId);
    const payload = events.find((e) => e.eventType === 'tool_call')!.payload as any;
    expect(payload.mcpServer).toBe('posthog');
    expect(payload.mcpTool).toBe('query');
  });

  // -----------------------------------------------------------------------
  // Error events
  // -----------------------------------------------------------------------

  it('should record error events as system messages', async () => {
    await adapter.handleEvent({ type: 'error', error: 'API rate limit exceeded' });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('system_message');
    expect((events[0].payload as any).systemType).toBe('error');
    expect(events[0].searchableText).toBe('API rate limit exceeded');
  });

  it('should flush text before recording error', async () => {
    await adapter.handleEvent({ type: 'text', content: 'Partial response' });
    await adapter.handleEvent({ type: 'error', error: 'Connection lost' });

    const events = await store.getSessionEvents(sessionId);
    expect(events[0].eventType).toBe('assistant_message');
    expect(events[1].eventType).toBe('system_message');
  });

  // -----------------------------------------------------------------------
  // Complete event (turn ended)
  // -----------------------------------------------------------------------

  it('should record turn_ended from complete event with usage', async () => {
    await adapter.handleEvent({
      type: 'complete',
      content: 'Done',
      usage: { input_tokens: 800, output_tokens: 200, total_tokens: 1000 },
      contextWindow: 128000,
    });

    const events = await store.getSessionEvents(sessionId);
    const turnEvent = events.find((e) => e.eventType === 'turn_ended');
    expect(turnEvent).toBeDefined();
    const payload = turnEvent!.payload as any;
    expect(payload.contextFill.inputTokens).toBe(800);
    expect(payload.contextFill.outputTokens).toBe(200);
    expect(payload.contextWindow).toBe(128000);
  });

  it('should skip turn_ended when no usage data', async () => {
    await adapter.handleEvent({ type: 'complete', content: 'Done' });

    const events = await store.getSessionEvents(sessionId);
    expect(events.filter((e) => e.eventType === 'turn_ended')).toHaveLength(0);
  });

  it('should skip turn_ended when usage is all zeros', async () => {
    await adapter.handleEvent({
      type: 'complete',
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    });

    const events = await store.getSessionEvents(sessionId);
    expect(events.filter((e) => e.eventType === 'turn_ended')).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Reasoning and raw_event (skipped)
  // -----------------------------------------------------------------------

  it('should skip reasoning events', async () => {
    await adapter.handleEvent({ type: 'reasoning', content: 'Thinking...' });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(0);
  });

  it('should skip raw_event events', async () => {
    await adapter.handleEvent({ type: 'raw_event', metadata: { rawEvent: { type: 'item.completed' } } });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Mode tracking
  // -----------------------------------------------------------------------

  it('should track mode from user input to assistant messages', async () => {
    await adapter.handleUserInput('Plan first', { mode: 'planning' });
    await adapter.handleEvent({ type: 'text', content: 'Here is the plan' });
    await adapter.flush();

    const events = await store.getSessionEvents(sessionId);
    const assistantEvent = events.find((e) => e.eventType === 'assistant_message');
    expect((assistantEvent!.payload as any).mode).toBe('planning');
  });
});
