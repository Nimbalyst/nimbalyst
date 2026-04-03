/**
 * Contract tests for CodexRawParser.
 *
 * Verifies that representative raw messages produce the expected
 * canonical event descriptors for Codex SDK format messages.
 */

import { describe, it, expect } from 'vitest';
import { CodexRawParser } from '../parsers/CodexRawParser';
import type { ParseContext } from '../parsers/IRawMessageParser';
import type { RawMessage } from '../TranscriptTransformer';

const SESSION_ID = 'test-session';

function makeRawMessage(overrides: Partial<RawMessage>): RawMessage {
  return {
    id: 1,
    sessionId: SESSION_ID,
    source: 'openai-codex',
    direction: 'output',
    content: '',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ParseContext>): ParseContext {
  return {
    sessionId: SESSION_ID,
    hasToolCall: () => false,
    hasSubagent: () => false,
    findByProviderToolCallId: async () => null,
    ...overrides,
  };
}

describe('CodexRawParser', () => {
  describe('input messages', () => {
    it('parses user prompt from { prompt: "..." } format', async () => {
      const parser = new CodexRawParser();
      const msg = makeRawMessage({
        direction: 'input',
        content: JSON.stringify({ prompt: 'Hello codex' }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'user_message',
        text: 'Hello codex',
      });
    });

    it('treats plain text input as user_message', async () => {
      const parser = new CodexRawParser();
      const msg = makeRawMessage({
        direction: 'input',
        content: 'Plain prompt',
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'user_message',
        text: 'Plain prompt',
      });
    });
  });

  describe('output messages', () => {
    it('parses todo_list items as markdown checklist', async () => {
      const parser = new CodexRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({
          item: {
            type: 'todo_list',
            items: [
              { text: 'First task', completed: false },
              { text: 'Second task', completed: true },
            ],
          },
        }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'assistant_message',
        text: '- [ ] First task\n- [x] Second task',
      });
    });

    it('parses tool calls with results', async () => {
      const parser = new CodexRawParser();
      // Simulate a Codex event that parseCodexEvent would interpret as a tool call
      // The item.completed format with function_call
      const msg = makeRawMessage({
        content: JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'function_call',
            id: 'fc-1',
            name: 'Read',
            arguments: JSON.stringify({ file_path: '/test.ts' }),
            output: 'file contents here',
            status: 'completed',
          },
        }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      // Should produce tool_call_started + tool_call_completed (result is inline)
      const started = descriptors.find(d => d.type === 'tool_call_started');
      expect(started).toBeDefined();
      expect(started).toMatchObject({
        toolName: 'Read',
      });
    });

    it('parses error events', async () => {
      const parser = new CodexRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({
          type: 'error',
          error: { message: 'Rate limited' },
        }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      const errorDesc = descriptors.find(d => d.type === 'system_message');
      expect(errorDesc).toBeDefined();
      expect(errorDesc).toMatchObject({
        systemType: 'error',
      });
    });

    it('treats plain text output as assistant_message', async () => {
      const parser = new CodexRawParser();
      const msg = makeRawMessage({
        content: 'Plain text response',
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'assistant_message',
        text: 'Plain text response',
      });
    });

    it('skips hidden messages', async () => {
      const parser = new CodexRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({ type: 'text', text: 'Hidden' }),
        hidden: true,
      });

      const descriptors = await parser.parseMessage(msg, makeContext());
      expect(descriptors).toHaveLength(0);
    });
  });
});
