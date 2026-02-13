import { describe, it, expect, vi } from 'vitest';
import { CodexSDKProtocol } from '../CodexSDKProtocol';

function createAsyncEventStream(events: any[]): AsyncIterable<any> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

describe('CodexSDKProtocol', () => {
  it('emits a raw_event for every SDK event, including unknown shapes', async () => {
    const sdkEvents = [
      { type: 'unknown.output', payload: { id: 1 } },
      {
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: 'hello from codex',
        },
      },
    ];

    const runStreamed = vi.fn(async () => ({
      events: createAsyncEventStream(sdkEvents),
    }));

    const startThread = vi.fn(() => ({
      id: 'thread-raw-events',
      runStreamed,
    }));

    const protocol = new CodexSDKProtocol(
      'test-key',
      async () =>
        ({
          Codex: class {
            startThread = startThread;
            resumeThread = vi.fn();
          },
        }) as any
    );

    const session = await protocol.createSession({ workspacePath: process.cwd() });
    const emitted: any[] = [];

    for await (const event of protocol.sendMessage(session, { content: 'test' })) {
      emitted.push(event);
    }

    const rawEvents = emitted.filter((event) => event.type === 'raw_event');
    expect(rawEvents).toHaveLength(sdkEvents.length);
    expect(rawEvents[0].metadata?.rawEvent).toEqual(sdkEvents[0]);
    expect(rawEvents[1].metadata?.rawEvent).toEqual(sdkEvents[1]);
    expect(emitted.some((event) => event.type === 'text' && event.content === 'hello from codex')).toBe(true);
  });

  it('captures thread.started IDs without emitting empty text chunks', async () => {
    const runStreamed = vi.fn(async () => ({
      events: createAsyncEventStream([
        { type: 'thread.started', thread_id: 'thread-from-stream' },
        {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: 'resumed content',
          },
        },
      ]),
    }));

    const startThread = vi.fn(() => ({
      id: '',
      runStreamed,
    }));

    const protocol = new CodexSDKProtocol(
      'test-key',
      async () =>
        ({
          Codex: class {
            startThread = startThread;
            resumeThread = vi.fn();
          },
        }) as any
    );

    const session = await protocol.createSession({ workspacePath: process.cwd() });
    const emitted: any[] = [];

    for await (const event of protocol.sendMessage(session, { content: 'test' })) {
      emitted.push(event);
    }

    expect(session.id).toBe('thread-from-stream');
    expect(emitted.some((event) => event.type === 'text' && event.content === '')).toBe(false);
  });
});

