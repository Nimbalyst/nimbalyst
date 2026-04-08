/**
 * Contract tests for ClaudeCodeRawParser.
 *
 * Verifies that representative raw messages produce the expected
 * canonical event descriptors. These tests ensure that the parser
 * correctly extracts canonical events from the Claude Code SDK
 * raw message format stored in ai_agent_messages.
 */

import { describe, it, expect } from 'vitest';
import { ClaudeCodeRawParser } from '../parsers/ClaudeCodeRawParser';
import type { ParseContext, CanonicalEventDescriptor } from '../parsers/IRawMessageParser';
import type { RawMessage } from '../TranscriptTransformer';

const SESSION_ID = 'test-session';

function makeRawMessage(overrides: Partial<RawMessage>): RawMessage {
  return {
    id: 1,
    sessionId: SESSION_ID,
    source: 'claude-code',
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

describe('ClaudeCodeRawParser', () => {
  describe('input messages', () => {
    it('parses user prompt from { prompt: "..." } format', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        direction: 'input',
        content: JSON.stringify({ prompt: 'Hello world', options: {} }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'user_message',
        text: 'Hello world',
      });
    });

    it('parses system reminder as system_message', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        direction: 'input',
        content: JSON.stringify({ prompt: '[System: continuation]' }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'system_message',
        systemType: 'status',
      });
    });

    it('parses SDK format user message { type: "user", message: { content: "..." } }', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        direction: 'input',
        content: JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Hello SDK format' },
        }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'user_message',
        text: 'Hello SDK format',
      });
    });

    it('parses tool_result blocks in input messages', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        direction: 'input',
        content: JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool-1', content: 'result text' },
            ],
          },
        }),
      });

      const context = makeContext({
        hasToolCall: (id) => id === 'tool-1',
      });
      const descriptors = await parser.parseMessage(msg, context);

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'tool_call_completed',
        providerToolCallId: 'tool-1',
        result: 'result text',
        status: 'completed',
      });
    });

    it('treats plain text as user_message', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        direction: 'input',
        content: 'Just plain text',
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'user_message',
        text: 'Just plain text',
      });
    });

    it('skips hidden messages', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        direction: 'input',
        content: 'Hidden content',
        hidden: true,
      });

      const descriptors = await parser.parseMessage(msg, makeContext());
      expect(descriptors).toHaveLength(0);
    });
  });

  describe('output messages', () => {
    it('parses text chunk { type: "text", content: "..." }', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({ type: 'text', content: 'Hello assistant' }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'assistant_message',
        text: 'Hello assistant',
      });
    });

    it('parses assistant chunk with text blocks', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({
          type: 'assistant',
          message: {
            id: 'msg-1',
            content: [{ type: 'text', text: 'Response text' }],
          },
        }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'assistant_message',
        text: 'Response text',
      });
    });

    it('deduplicates text by message ID', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg1 = makeRawMessage({
        id: 1,
        content: JSON.stringify({
          type: 'assistant',
          message: { id: 'msg-1', content: [{ type: 'text', text: 'First' }] },
        }),
      });
      const msg2 = makeRawMessage({
        id: 2,
        content: JSON.stringify({
          type: 'assistant',
          message: { id: 'msg-1', content: [{ type: 'text', text: 'Duplicate' }] },
        }),
      });

      const ctx = makeContext();
      const d1 = await parser.parseMessage(msg1, ctx);
      const d2 = await parser.parseMessage(msg2, ctx);

      expect(d1).toHaveLength(1);
      expect(d2).toHaveLength(0); // Deduped
    });

    it('parses tool_use blocks', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'tool-1',
              name: 'Read',
              input: { file_path: '/test.ts' },
            }],
          },
        }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'tool_call_started',
        toolName: 'Read',
        providerToolCallId: 'tool-1',
        arguments: { file_path: '/test.ts' },
      });
    });

    it('parses MCP tool calls with server/tool extraction', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'mcp-1',
              name: 'mcp__nimbalyst-mcp__excalidraw_add_rectangle',
              input: { label: 'Box' },
            }],
          },
        }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'tool_call_started',
        toolName: 'mcp__nimbalyst-mcp__excalidraw_add_rectangle',
        mcpServer: 'nimbalyst-mcp',
        mcpTool: 'excalidraw_add_rectangle',
      });
    });

    it('parses subagent spawns (Agent/Task tools)', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'agent-1',
              name: 'Agent',
              input: { prompt: 'Do something', name: 'helper' },
            }],
          },
        }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'subagent_started',
        subagentId: 'agent-1',
        agentType: 'Agent',
        teammateName: 'helper',
        prompt: 'Do something',
      });
    });

    it('deduplicates tool_use blocks by ID', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg1 = makeRawMessage({
        id: 1,
        content: JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }],
          },
        }),
      });
      const msg2 = makeRawMessage({
        id: 2,
        content: JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }],
          },
        }),
      });

      const ctx = makeContext();
      // First message creates the tool call
      const d1 = await parser.parseMessage(msg1, ctx);
      expect(d1).toHaveLength(1);

      // Second message with same tool ID -- now hasToolCall returns true
      const ctx2 = makeContext({ hasToolCall: (id) => id === 'tool-1' });
      const d2 = await parser.parseMessage(msg2, ctx2);
      expect(d2).toHaveLength(0); // Deduped
    });

    it('parses error chunks', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({
          type: 'error',
          error: 'Something went wrong',
        }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'system_message',
        text: 'Something went wrong',
        systemType: 'error',
      });
    });

    it('parses nimbalyst_tool_use', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({
          type: 'nimbalyst_tool_use',
          id: 'ask-1',
          name: 'AskUserQuestion',
          input: { questions: [{ question: 'What?' }] },
        }),
      });

      const descriptors = await parser.parseMessage(msg, makeContext());

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'tool_call_started',
        toolName: 'AskUserQuestion',
        providerToolCallId: 'ask-1',
      });
    });

    it('deduplicates nimbalyst_tool_use via DB fallback when in-memory map misses', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({
          type: 'nimbalyst_tool_use',
          id: 'ask-1',
          name: 'AskUserQuestion',
          input: { questions: [{ question: 'What?' }] },
        }),
      });

      // In-memory map returns false (cross-batch scenario), but DB finds the existing event
      const ctx = makeContext({
        hasToolCall: () => false,
        findByProviderToolCallId: async (id) =>
          id === 'ask-1' ? { id: 999 } as any : null,
      });
      const descriptors = await parser.parseMessage(msg, ctx);

      expect(descriptors).toHaveLength(0); // Deduped via DB lookup
    });

    it('parses nimbalyst_tool_result', async () => {
      const parser = new ClaudeCodeRawParser();
      const msg = makeRawMessage({
        content: JSON.stringify({
          type: 'nimbalyst_tool_result',
          tool_use_id: 'ask-1',
          result: '{"answers": {"q1": "yes"}}',
        }),
      });

      const ctx = makeContext({ hasToolCall: (id) => id === 'ask-1' });
      const descriptors = await parser.parseMessage(msg, ctx);

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toMatchObject({
        type: 'tool_call_completed',
        providerToolCallId: 'ask-1',
        status: 'completed',
      });
    });

    it('treats plain text output as assistant_message', async () => {
      const parser = new ClaudeCodeRawParser();
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
  });
});
