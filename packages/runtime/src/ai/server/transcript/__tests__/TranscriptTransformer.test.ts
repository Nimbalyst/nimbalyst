import { describe, it, expect, beforeEach } from 'vitest';
import { TranscriptTransformer } from '../TranscriptTransformer';
import type { IRawMessageStore, RawMessage, ISessionMetadataStore } from '../TranscriptTransformer';
import type { ITranscriptEventStore, TranscriptEvent } from '../types';

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------

function createMockTranscriptStore(): ITranscriptEventStore & { getAll(): TranscriptEvent[] } {
  const events: TranscriptEvent[] = [];
  let nextId = 1;
  const sequenceCounters = new Map<string, number>();

  return {
    getAll: () => [...events],

    async insertEvent(event) {
      const id = nextId++;
      const full: TranscriptEvent = { ...event, id };
      events.push(full);
      const seq = sequenceCounters.get(event.sessionId) ?? 0;
      sequenceCounters.set(event.sessionId, Math.max(seq, event.sequence + 1));
      return full;
    },

    async updateEventPayload(id, payload) {
      const event = events.find((e) => e.id === id);
      if (event) {
        event.payload = payload;
      }
    },

    async mergeEventPayload(id, partialPayload) {
      const event = events.find((e) => e.id === id);
      if (event) {
        event.payload = { ...event.payload, ...partialPayload };
      }
    },

    async getSessionEvents(sessionId, options) {
      let result = events
        .filter((e) => e.sessionId === sessionId)
        .sort((a, b) => a.sequence - b.sequence);
      if (options?.eventTypes) {
        result = result.filter((e) => options.eventTypes!.includes(e.eventType));
      }
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? result.length;
      return result.slice(offset, offset + limit);
    },

    async getNextSequence(sessionId) {
      return sequenceCounters.get(sessionId) ?? 0;
    },

    async findByProviderToolCallId(providerToolCallId) {
      return events.find((e) => e.providerToolCallId === providerToolCallId) ?? null;
    },

    async getEventById(id) {
      return events.find((e) => e.id === id) ?? null;
    },

    async getChildEvents(parentEventId) {
      return events
        .filter((e) => e.parentEventId === parentEventId)
        .sort((a, b) => a.sequence - b.sequence);
    },

    async getSubagentEvents(subagentId, sessionId) {
      return events
        .filter((e) => e.subagentId === subagentId && e.sessionId === sessionId)
        .sort((a, b) => a.sequence - b.sequence);
    },

    async getMultiSessionEvents(sessionIds, options) {
      let result = events
        .filter((e) => sessionIds.includes(e.sessionId))
        .sort((a, b) => a.sequence - b.sequence);
      if (options?.eventTypes) {
        result = result.filter((e) => options.eventTypes!.includes(e.eventType));
      }
      return result;
    },

    async searchSessions(query, options) {
      let result = events.filter(
        (e) => e.searchable && e.searchableText?.toLowerCase().includes(query.toLowerCase()),
      );
      if (options?.sessionIds) {
        result = result.filter((e) => options.sessionIds!.includes(e.sessionId));
      }
      const limit = options?.limit ?? 100;
      return result.slice(0, limit).map((e) => ({ event: e, sessionId: e.sessionId }));
    },

    async getTailEvents(sessionId, count, options) {
      let result = events
        .filter((e) => e.sessionId === sessionId)
        .sort((a, b) => a.sequence - b.sequence);
      if (options?.excludeEventTypes) {
        result = result.filter((e) => !options.excludeEventTypes!.includes(e.eventType));
      }
      return result.slice(-count);
    },

    async deleteSessionEvents(sessionId) {
      const toRemove = events.filter((e) => e.sessionId === sessionId);
      for (const e of toRemove) {
        events.splice(events.indexOf(e), 1);
      }
      sequenceCounters.delete(sessionId);
    },
  };
}

function createMockRawStore(messages: RawMessage[] = []): IRawMessageStore {
  return {
    async getMessages(sessionId, afterId) {
      return messages
        .filter((m) => m.sessionId === sessionId && (afterId == null || m.id > afterId))
        .sort((a, b) => a.id - b.id);
    },
  };
}

type TransformStatusEntry = {
  transformVersion: number | null;
  lastRawMessageId: number | null;
  lastTransformedAt: Date | null;
  transformStatus: 'pending' | 'complete' | 'error' | null;
};

function createMockMetadataStore(): ISessionMetadataStore & {
  getStatus(sessionId: string): TransformStatusEntry;
} {
  const statuses = new Map<string, TransformStatusEntry>();

  return {
    getStatus(sessionId) {
      return (
        statuses.get(sessionId) ?? {
          transformVersion: null,
          lastRawMessageId: null,
          lastTransformedAt: null,
          transformStatus: null,
        }
      );
    },

    async getTransformStatus(sessionId) {
      return (
        statuses.get(sessionId) ?? {
          transformVersion: null,
          lastRawMessageId: null,
          lastTransformedAt: null,
          transformStatus: null,
        }
      );
    },

    async updateTransformStatus(sessionId, update) {
      statuses.set(sessionId, update);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRawMessage(overrides: Partial<RawMessage> & { id: number; sessionId: string }): RawMessage {
  return {
    source: 'claude-code',
    direction: 'input',
    content: '',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TranscriptTransformer', () => {
  const SESSION_ID = 'test-session-1';
  const PROVIDER = 'claude-code';

  let transcriptStore: ReturnType<typeof createMockTranscriptStore>;
  let metadataStore: ReturnType<typeof createMockMetadataStore>;

  beforeEach(() => {
    transcriptStore = createMockTranscriptStore();
    metadataStore = createMockMetadataStore();
  });

  describe('ensureTransformed', () => {
    it('skips when already complete at current version', async () => {
      const rawStore = createMockRawStore([]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      // Pre-set status as complete
      await metadataStore.updateTransformStatus(SESSION_ID, {
        transformVersion: TranscriptTransformer.CURRENT_VERSION,
        lastRawMessageId: 10,
        lastTransformedAt: new Date(),
        transformStatus: 'complete',
      });

      const result = await transformer.ensureTransformed(SESSION_ID, PROVIDER);
      expect(result).toBe(false);
      expect(transcriptStore.getAll()).toHaveLength(0);
    });

    it('transforms from beginning when status is null', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'input',
          content: 'Hello world',
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      const result = await transformer.ensureTransformed(SESSION_ID, PROVIDER);
      expect(result).toBe(true);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].eventType).toBe('user_message');
      expect(events[0].searchableText).toBe('Hello world');

      const status = metadataStore.getStatus(SESSION_ID);
      expect(status.transformStatus).toBe('complete');
      expect(status.transformVersion).toBe(TranscriptTransformer.CURRENT_VERSION);
    });

    it('resumes from lastRawMessageId when pending', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'input',
          content: 'First message',
        }),
        makeRawMessage({
          id: 2,
          sessionId: SESSION_ID,
          direction: 'input',
          content: 'Second message',
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      // Pre-set as pending with message 1 already processed
      await metadataStore.updateTransformStatus(SESSION_ID, {
        transformVersion: TranscriptTransformer.CURRENT_VERSION,
        lastRawMessageId: 1,
        lastTransformedAt: new Date(),
        transformStatus: 'pending',
      });

      const result = await transformer.ensureTransformed(SESSION_ID, PROVIDER);
      expect(result).toBe(true);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      // Should only have message 2 (resumed after id 1)
      expect(events).toHaveLength(1);
      expect(events[0].searchableText).toBe('Second message');

      const status = metadataStore.getStatus(SESSION_ID);
      expect(status.transformStatus).toBe('complete');
      expect(status.lastRawMessageId).toBe(2);
    });

    it('re-transforms when version is outdated', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'input',
          content: 'Hello',
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      // Pre-set as complete but at an older version
      await metadataStore.updateTransformStatus(SESSION_ID, {
        transformVersion: 0, // older than CURRENT_VERSION
        lastRawMessageId: 1,
        lastTransformedAt: new Date(),
        transformStatus: 'complete',
      });

      // Pre-insert a stale canonical event (should be deleted on re-transform)
      await transcriptStore.insertEvent({
        sessionId: SESSION_ID,
        sequence: 0,
        createdAt: new Date(),
        eventType: 'user_message',
        searchableText: 'stale',
        payload: { mode: 'agent', inputType: 'user' },
        parentEventId: null,
        searchable: true,
        subagentId: null,
        provider: PROVIDER,
        providerToolCallId: null,
      });

      const result = await transformer.ensureTransformed(SESSION_ID, PROVIDER);
      expect(result).toBe(true);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      // Stale event should have been deleted and replaced with fresh transform
      expect(events).toHaveLength(1);
      expect(events[0].searchableText).toBe('Hello');
    });

    it('handles empty sessions gracefully', async () => {
      const rawStore = createMockRawStore([]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      const result = await transformer.ensureTransformed(SESSION_ID, PROVIDER);
      expect(result).toBe(true);

      const status = metadataStore.getStatus(SESSION_ID);
      expect(status.transformStatus).toBe('complete');
    });

    it('retries after error status', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'input',
          content: 'Retry me',
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      // Pre-set as error
      await metadataStore.updateTransformStatus(SESSION_ID, {
        transformVersion: TranscriptTransformer.CURRENT_VERSION,
        lastRawMessageId: 0,
        lastTransformedAt: new Date(),
        transformStatus: 'error',
      });

      const result = await transformer.ensureTransformed(SESSION_ID, PROVIDER);
      expect(result).toBe(true);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(1);
      expect(events[0].searchableText).toBe('Retry me');
    });
  });

  describe('message transformation', () => {
    it('transforms plain text user messages', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'input',
          content: 'What is TypeScript?',
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('user_message');
      expect(events[0].searchableText).toBe('What is TypeScript?');
      expect(events[0].searchable).toBe(true);
    });

    it('transforms Claude Code format user messages', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'input',
          content: JSON.stringify({ prompt: 'Fix the bug' }),
          metadata: { mode: 'agent' },
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('user_message');
      expect(events[0].searchableText).toBe('Fix the bug');
    });

    it('transforms assistant text messages', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({ type: 'text', content: 'Here is my answer.' }),
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('assistant_message');
      expect(events[0].searchableText).toBe('Here is my answer.');
    });

    it('transforms structured assistant messages with tool_use content', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Let me read that file.' },
                {
                  type: 'tool_use',
                  id: 'tool-1',
                  name: 'Read',
                  input: { file_path: '/src/index.ts' },
                },
              ],
            },
          }),
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(2);
      expect(events[0].eventType).toBe('assistant_message');
      expect(events[0].searchableText).toBe('Let me read that file.');
      expect(events[1].eventType).toBe('tool_call');
      expect(events[1].providerToolCallId).toBe('tool-1');
      const payload = events[1].payload as any;
      expect(payload.toolName).toBe('Read');
      expect(payload.status).toBe('running');
    });

    it('transforms tool result messages and updates tool_call', async () => {
      const rawStore = createMockRawStore([
        // Tool use
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'tool-1',
                  name: 'Read',
                  input: { file_path: '/src/index.ts' },
                },
              ],
            },
          }),
        }),
        // Tool result
        makeRawMessage({
          id: 2,
          sessionId: SESSION_ID,
          direction: 'input',
          content: JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'tool-1',
                  content: [{ type: 'text', text: 'File contents here' }],
                },
              ],
            },
          }),
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(1); // tool_call only (result is an update)

      const payload = events[0].payload as any;
      expect(payload.status).toBe('completed');
      expect(payload.result).toBe('File contents here');
    });

    it('transforms system messages', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'input',
          content: JSON.stringify({ prompt: '[System: Your previous turn ended]' }),
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('system_message');
    });

    it('transforms error messages', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'error',
            error: 'Rate limit exceeded',
          }),
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('system_message');
      expect(events[0].searchableText).toBe('Rate limit exceeded');
      const payload = events[0].payload as any;
      expect(payload.systemType).toBe('error');
    });

    it('transforms MCP tool calls with server/tool parsing', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'mcp-tool-1',
                  name: 'mcp__posthog__query-trends',
                  input: { query: 'test' },
                },
              ],
            },
          }),
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(1);
      const payload = events[0].payload as any;
      expect(payload.mcpServer).toBe('posthog');
      expect(payload.mcpTool).toBe('query-trends');
    });

    it('skips hidden messages', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'input',
          content: 'Visible message',
        }),
        makeRawMessage({
          id: 2,
          sessionId: SESSION_ID,
          direction: 'input',
          content: 'Hidden message',
          hidden: true,
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(1);
      expect(events[0].searchableText).toBe('Visible message');
    });

    it('transforms nimbalyst_tool_use and nimbalyst_tool_result', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'nimbalyst_tool_use',
            id: 'nim-tool-1',
            name: 'AskUserQuestion',
            input: { question: 'Do you approve?' },
          }),
        }),
        makeRawMessage({
          id: 2,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'nimbalyst_tool_result',
            tool_use_id: 'nim-tool-1',
            result: 'Yes',
          }),
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(1); // tool_use + result update
      expect(events[0].eventType).toBe('tool_call');
      const payload = events[0].payload as any;
      expect(payload.toolName).toBe('AskUserQuestion');
      expect(payload.status).toBe('completed');
      expect(payload.result).toBe('Yes');
    });

    it('handles non-JSON output as plain assistant text', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: 'Just a plain text response',
        }),
      ]);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('assistant_message');
      expect(events[0].searchableText).toBe('Just a plain text response');
    });
  });

  describe('incremental transformation', () => {
    it('advances high-water mark correctly', async () => {
      const rawMessages = [
        makeRawMessage({ id: 1, sessionId: SESSION_ID, direction: 'input', content: 'First' }),
        makeRawMessage({ id: 2, sessionId: SESSION_ID, direction: 'input', content: 'Second' }),
        makeRawMessage({ id: 3, sessionId: SESSION_ID, direction: 'input', content: 'Third' }),
      ];
      const rawStore = createMockRawStore(rawMessages);
      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);

      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const status = metadataStore.getStatus(SESSION_ID);
      expect(status.lastRawMessageId).toBe(3);
      expect(status.transformStatus).toBe('complete');

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      expect(events).toHaveLength(3);
    });
  });

  describe('subagent transformation', () => {
    it('creates subagent event for Agent tool_use and groups child tools', async () => {
      const rawStore = createMockRawStore([
        // Agent spawn
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'agent-1',
                  name: 'Agent',
                  input: { prompt: 'Search for files', subagent_type: 'Explore' },
                },
              ],
            },
          }),
        }),
        // Child tool call with parent_tool_use_id on the outer wrapper
        makeRawMessage({
          id: 2,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            parent_tool_use_id: 'agent-1',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'child-1',
                  name: 'Glob',
                  input: { pattern: '*.ts' },
                },
              ],
            },
          }),
        }),
        // Agent result
        makeRawMessage({
          id: 3,
          sessionId: SESSION_ID,
          direction: 'input',
          content: JSON.stringify({
            type: 'user',
            message: {
              content: [
                { type: 'tool_result', tool_use_id: 'agent-1', content: 'Found 10 files' },
              ],
            },
          }),
        }),
      ]);

      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);
      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);

      // Should have: subagent event + child tool_call event
      const subagentEvent = events.find((e) => e.eventType === 'subagent');
      expect(subagentEvent).toBeDefined();
      expect(subagentEvent!.subagentId).toBe('agent-1');
      expect((subagentEvent!.payload as any).agentType).toBe('Agent');
      expect((subagentEvent!.payload as any).status).toBe('completed');
      expect((subagentEvent!.payload as any).resultSummary).toBe('Found 10 files');

      const childTool = events.find(
        (e) => e.eventType === 'tool_call' && (e.payload as any).toolName === 'Glob',
      );
      expect(childTool).toBeDefined();
      expect(childTool!.subagentId).toBe('agent-1');
    });

    it('does not set subagentId for tools without parent_tool_use_id', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: 'agent-1', name: 'Agent', input: { prompt: 'do stuff' } },
              ],
            },
          }),
        }),
        // Regular tool call (no parent_tool_use_id on wrapper)
        makeRawMessage({
          id: 2,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: 'top-level', name: 'Read', input: { file_path: '/foo.ts' } },
              ],
            },
          }),
        }),
      ]);

      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);
      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      const readEvent = events.find(
        (e) => e.eventType === 'tool_call' && (e.payload as any).toolName === 'Read',
      );
      expect(readEvent).toBeDefined();
      expect(readEvent!.subagentId).toBeNull();
    });
  });

  describe('deduplication of accumulated chunks', () => {
    it('deduplicates tool_use blocks with the same tool ID', async () => {
      const rawStore = createMockRawStore([
        // Streaming chunk (has message.id)
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              model: 'claude-opus-4-6',
              id: 'msg_123',
              content: [
                { type: 'tool_use', id: 'tool-dup', name: 'Read', input: { file_path: '/foo.ts' } },
              ],
            },
          }),
        }),
        // Accumulated echo (no message.id)
        makeRawMessage({
          id: 2,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: 'tool-dup', name: 'Read', input: { file_path: '/foo.ts' } },
              ],
            },
          }),
        }),
      ]);

      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);
      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      const toolEvents = events.filter((e) => e.eventType === 'tool_call');
      expect(toolEvents).toHaveLength(1);
    });

    it('deduplicates subagent tool_use blocks', async () => {
      const rawStore = createMockRawStore([
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              model: 'claude-opus-4-6',
              id: 'msg_456',
              content: [
                { type: 'tool_use', id: 'agent-dup', name: 'Agent', input: { prompt: 'search' } },
              ],
            },
          }),
        }),
        makeRawMessage({
          id: 2,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: 'agent-dup', name: 'Agent', input: { prompt: 'search' } },
              ],
            },
          }),
        }),
      ]);

      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);
      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      const subagentEvents = events.filter((e) => e.eventType === 'subagent');
      expect(subagentEvents).toHaveLength(1);
    });

    it('deduplicates assistant text from accumulated chunks', async () => {
      const rawStore = createMockRawStore([
        // Streaming chunk with text (has message.id)
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              model: 'claude-opus-4-6',
              id: 'msg_789',
              content: [
                { type: 'text', text: 'Let me help you.' },
              ],
            },
          }),
        }),
        // Accumulated chunk repeats the text (no message.id)
        makeRawMessage({
          id: 2,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Let me help you.' },
              ],
            },
          }),
        }),
      ]);

      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);
      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      const textEvents = events.filter((e) => e.eventType === 'assistant_message');
      expect(textEvents).toHaveLength(1);
    });

    it('deduplicates text when same message ID appears in multiple streaming chunks', async () => {
      const rawStore = createMockRawStore([
        // First streaming chunk: text
        makeRawMessage({
          id: 1,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              model: 'claude-opus-4-6',
              id: 'msg_same',
              content: [{ type: 'text', text: 'First part.' }],
            },
          }),
        }),
        // Second streaming chunk with same message ID: tool_use
        makeRawMessage({
          id: 2,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              model: 'claude-opus-4-6',
              id: 'msg_same',
              content: [
                { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/bar.ts' } },
              ],
            },
          }),
        }),
        // Accumulated chunk repeats both (no message.id)
        makeRawMessage({
          id: 3,
          sessionId: SESSION_ID,
          direction: 'output',
          content: JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'First part.' },
                { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/bar.ts' } },
              ],
            },
          }),
        }),
      ]);

      const transformer = new TranscriptTransformer(rawStore, transcriptStore, metadataStore);
      await transformer.ensureTransformed(SESSION_ID, PROVIDER);

      const events = await transcriptStore.getSessionEvents(SESSION_ID);
      const textEvents = events.filter((e) => e.eventType === 'assistant_message');
      const toolEvents = events.filter((e) => e.eventType === 'tool_call');
      expect(textEvents).toHaveLength(1);
      expect(toolEvents).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('marks session as error when transformation fails', async () => {
      // Create a raw store that throws on getMessages (called before per-message loop)
      const failingRawStore: IRawMessageStore = {
        async getMessages() {
          throw new Error('DB read failed');
        },
      };

      const transformer = new TranscriptTransformer(failingRawStore, transcriptStore, metadataStore);

      await expect(transformer.ensureTransformed(SESSION_ID, PROVIDER)).rejects.toThrow(
        'DB read failed',
      );

      const status = metadataStore.getStatus(SESSION_ID);
      expect(status.transformStatus).toBe('error');
    });
  });
});
