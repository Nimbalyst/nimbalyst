import { describe, expect, it } from 'vitest';
import type { Message } from '../../../../ai/server/types';
import { parseCodexRawEvents, type CodexSection } from '../CodexOutputRenderer';

function buildRawMessage(rawEvent: Record<string, unknown>, timestamp: number): Message {
  return {
    role: 'assistant',
    content: JSON.stringify(rawEvent),
    timestamp,
    metadata: {
      codexProvider: true,
      eventType: typeof rawEvent.type === 'string' ? rawEvent.type : 'unknown',
    },
  };
}

describe('parseCodexRawEvents', () => {
  it('renders reasoning, final output, and mcp tool call pairs from raw item events', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'item.completed',
          item: {
            id: 'reasoning-1',
            type: 'reasoning',
            text: '**Reading instructions**',
          },
        },
        1
      ),
      buildRawMessage(
        {
          type: 'item.started',
          item: {
            id: 'tool-1',
            type: 'mcp_tool_call',
            server: 'nimbalyst-extension-dev',
            tool: 'get_environment_info',
            arguments: {},
            status: 'in_progress',
          },
        },
        2
      ),
      buildRawMessage(
        {
          type: 'item.completed',
          item: {
            id: 'tool-1',
            type: 'mcp_tool_call',
            server: 'nimbalyst-extension-dev',
            tool: 'get_environment_info',
            arguments: {},
            result: {
              ok: true,
            },
            error: null,
            status: 'completed',
          },
        },
        3
      ),
      buildRawMessage(
        {
          type: 'item.completed',
          item: {
            id: 'msg-1',
            type: 'agent_message',
            text: 'Done.',
          },
        },
        4
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(3);

    // Section 0: reasoning
    expect(parsed.sections[0].type).toBe('reasoning');
    expect((parsed.sections[0] as Extract<CodexSection, { type: 'reasoning' }>).blocks).toEqual([
      '**Reading instructions**',
    ]);

    // Section 1: tool call (started + completed merged)
    expect(parsed.sections[1].type).toBe('tool_call');
    const toolSection = parsed.sections[1] as Extract<CodexSection, { type: 'tool_call' }>;
    expect(toolSection.toolCall.name).toBe('mcp__nimbalyst-extension-dev__get_environment_info');
    expect(toolSection.toolCall.result).toEqual({
      success: true,
      result: { ok: true },
      status: 'completed',
    });

    // Section 2: output
    expect(parsed.sections[2].type).toBe('output');
    expect((parsed.sections[2] as Extract<CodexSection, { type: 'output' }>).content).toBe('Done.');
  });

  it('renders command_execution and file_change events as tool calls', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'item.started',
          item: {
            id: 'cmd-1',
            type: 'command_execution',
            command: '/bin/zsh -lc ls',
            status: 'in_progress',
          },
        },
        1
      ),
      buildRawMessage(
        {
          type: 'item.completed',
          item: {
            id: 'cmd-1',
            type: 'command_execution',
            command: '/bin/zsh -lc ls',
            aggregated_output: 'README.md\npackage.json\n',
            exit_code: 0,
            status: 'completed',
          },
        },
        2
      ),
      buildRawMessage(
        {
          type: 'item.completed',
          item: {
            id: 'change-1',
            type: 'file_change',
            changes: [{ path: '/tmp/file.ts', kind: 'update' }],
            status: 'completed',
          },
        },
        3
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(2);

    // Section 0: command_execution (started + completed merged)
    expect(parsed.sections[0].type).toBe('tool_call');
    const cmdSection = parsed.sections[0] as Extract<CodexSection, { type: 'tool_call' }>;
    expect(cmdSection.toolCall.name).toBe('command_execution');
    expect(cmdSection.toolCall.arguments).toEqual({
      command: '/bin/zsh -lc ls',
    });
    expect(cmdSection.toolCall.result).toEqual({
      success: true,
      command: '/bin/zsh -lc ls',
      output: 'README.md\npackage.json\n',
      exit_code: 0,
      status: 'completed',
    });

    // Section 1: file_change
    expect(parsed.sections[1].type).toBe('tool_call');
    const fileSection = parsed.sections[1] as Extract<CodexSection, { type: 'tool_call' }>;
    expect(fileSection.toolCall.name).toBe('file_change');
    expect(fileSection.toolCall.arguments).toEqual({
      changes: [{ path: '/tmp/file.ts', kind: 'update' }],
    });
    expect(fileSection.toolCall.result).toEqual({
      success: true,
      status: 'completed',
      changes: [{ path: '/tmp/file.ts', kind: 'update' }],
    });
  });

  it('preserves interleaved order of reasoning, tools, and output', () => {
    const events: Message[] = [
      // Reasoning block 1
      buildRawMessage(
        { type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'Thinking about step 1' } },
        1
      ),
      // Tool call
      buildRawMessage(
        {
          type: 'item.completed',
          item: { id: 'tool-1', type: 'mcp_tool_call', server: 's', tool: 'read', arguments: {}, result: 'ok', error: null, status: 'completed' },
        },
        2
      ),
      // Reasoning block 2
      buildRawMessage(
        { type: 'item.completed', item: { id: 'r2', type: 'reasoning', text: 'Thinking about step 2' } },
        3
      ),
      // Output
      buildRawMessage(
        { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'Final answer.' } },
        4
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(4);
    expect(parsed.sections[0].type).toBe('reasoning');
    expect(parsed.sections[1].type).toBe('tool_call');
    expect(parsed.sections[2].type).toBe('reasoning');
    expect(parsed.sections[3].type).toBe('output');

    // Verify each section has the right content
    expect((parsed.sections[0] as Extract<CodexSection, { type: 'reasoning' }>).blocks).toEqual([
      'Thinking about step 1',
    ]);
    expect((parsed.sections[2] as Extract<CodexSection, { type: 'reasoning' }>).blocks).toEqual([
      'Thinking about step 2',
    ]);
    expect((parsed.sections[3] as Extract<CodexSection, { type: 'output' }>).content).toBe('Final answer.');
  });

  it('merges consecutive reasoning events into one section', () => {
    const events: Message[] = [
      buildRawMessage(
        { type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'First thought' } },
        1
      ),
      buildRawMessage(
        { type: 'item.completed', item: { id: 'r2', type: 'reasoning', text: 'Second thought' } },
        2
      ),
      buildRawMessage(
        { type: 'item.completed', item: { id: 'r3', type: 'reasoning', text: 'Third thought' } },
        3
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].type).toBe('reasoning');
    expect((parsed.sections[0] as Extract<CodexSection, { type: 'reasoning' }>).blocks).toEqual([
      'First thought',
      'Second thought',
      'Third thought',
    ]);
  });

  it('merges tool call started/completed pair into one section', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'item.started',
          item: { id: 'tool-1', type: 'mcp_tool_call', server: 's', tool: 'read', arguments: {}, status: 'in_progress' },
        },
        1
      ),
      buildRawMessage(
        {
          type: 'item.completed',
          item: { id: 'tool-1', type: 'mcp_tool_call', server: 's', tool: 'read', arguments: {}, result: { data: 1 }, error: null, status: 'completed' },
        },
        2
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].type).toBe('tool_call');
    const toolSection = parsed.sections[0] as Extract<CodexSection, { type: 'tool_call' }>;
    expect(toolSection.toolCall.id).toBe('tool-1');
    expect(toolSection.toolCall.result).toEqual({
      success: true,
      result: { data: 1 },
      status: 'completed',
    });
  });

  it('renders OpenAI 401 error as openai_auth_error section', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'error',
          message: 'Reconnecting... 5/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses, cf-ray: abc123)',
        },
        1
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].type).toBe('openai_auth_error');
  });

  it('deduplicates consecutive OpenAI 401 errors into one section', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'error',
          message: 'Reconnecting... 1/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses)',
        },
        1
      ),
      buildRawMessage(
        {
          type: 'error',
          message: 'Reconnecting... 2/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses)',
        },
        2
      ),
      buildRawMessage(
        {
          type: 'error',
          message: 'Reconnecting... 5/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses)',
        },
        3
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].type).toBe('openai_auth_error');
  });

  it('renders non-OpenAI errors as regular output', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'error',
          message: 'Connection timeout',
        },
        1
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].type).toBe('output');
    expect((parsed.sections[0] as Extract<CodexSection, { type: 'output' }>).content).toBe('Connection timeout');
  });

  it('returns empty sections for empty input', () => {
    const parsed = parseCodexRawEvents([]);
    expect(parsed.sections).toEqual([]);
  });

  it('renders output-only events as a single output section', () => {
    const events: Message[] = [
      buildRawMessage(
        { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'Hello world.' } },
        1
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].type).toBe('output');
    expect((parsed.sections[0] as Extract<CodexSection, { type: 'output' }>).content).toBe('Hello world.');
  });
});
