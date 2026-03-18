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

  it('renders web_search started and completed events as a tool call', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'item.started',
          item: {
            id: 'ws-1',
            type: 'web_search',
            query: '',
            action: { type: 'other' },
          },
        },
        1
      ),
      buildRawMessage(
        {
          type: 'item.completed',
          item: {
            id: 'ws-1',
            type: 'web_search',
            query: 'site:github.com/openai/codex web_search',
            action: {
              type: 'search',
              query: 'site:github.com/openai/codex web_search',
              queries: ['site:github.com/openai/codex web_search'],
            },
          },
        },
        2
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].type).toBe('tool_call');

    const webSearchSection = parsed.sections[0] as Extract<CodexSection, { type: 'tool_call' }>;
    expect(webSearchSection.toolCall.name).toBe('web_search');
    expect(webSearchSection.toolCall.arguments).toEqual({
      query: '',
      action: { type: 'other' },
    });
    expect(webSearchSection.toolCall.result).toEqual({
      success: true,
      query: 'site:github.com/openai/codex web_search',
      action: {
        type: 'search',
        query: 'site:github.com/openai/codex web_search',
        queries: ['site:github.com/openai/codex web_search'],
      },
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
    expect(toolSection.toolCall.id).toBe('nimtc|tool-1|1|0');
    expect(toolSection.toolCall.result).toEqual({
      success: true,
      result: { data: 1 },
      status: 'completed',
    });
  });

  it('does not merge separate completed tool calls when Codex reuses item IDs', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'item.completed',
          item: {
            id: 'item_4',
            type: 'command_execution',
            command: 'echo first',
            aggregated_output: 'first',
            exit_code: 0,
            status: 'completed',
          },
        },
        1
      ),
      buildRawMessage(
        {
          type: 'item.completed',
          item: {
            id: 'item_4',
            type: 'command_execution',
            command: 'echo second',
            aggregated_output: 'second',
            exit_code: 0,
            status: 'completed',
          },
        },
        2
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0].type).toBe('tool_call');
    expect(parsed.sections[1].type).toBe('tool_call');

    const first = parsed.sections[0] as Extract<CodexSection, { type: 'tool_call' }>;
    const second = parsed.sections[1] as Extract<CodexSection, { type: 'tool_call' }>;
    expect(first.toolCall.result).toMatchObject({ output: 'first' });
    expect(second.toolCall.result).toMatchObject({ output: 'second' });
    expect(first.toolCall.id).not.toBe(second.toolCall.id);
  });

  it('scopes item.updated + item.completed to the active tool call instance', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'item.started',
          item: {
            id: 'item_9',
            type: 'mcp_tool_call',
            server: 's',
            tool: 'read',
            arguments: { path: '/tmp/a' },
            status: 'in_progress',
          },
        },
        1
      ),
      buildRawMessage(
        {
          type: 'item.updated',
          item: {
            id: 'item_9',
            type: 'mcp_tool_call',
            server: 's',
            tool: 'read',
            arguments: { path: '/tmp/a' },
            status: 'in_progress',
          },
        },
        2
      ),
      buildRawMessage(
        {
          type: 'item.completed',
          item: {
            id: 'item_9',
            type: 'mcp_tool_call',
            server: 's',
            tool: 'read',
            arguments: { path: '/tmp/a' },
            result: { turn: 1 },
            error: null,
            status: 'completed',
          },
        },
        3
      ),
      buildRawMessage(
        {
          type: 'item.started',
          item: {
            id: 'item_9',
            type: 'mcp_tool_call',
            server: 's',
            tool: 'read',
            arguments: { path: '/tmp/b' },
            status: 'in_progress',
          },
        },
        4
      ),
      buildRawMessage(
        {
          type: 'item.completed',
          item: {
            id: 'item_9',
            type: 'mcp_tool_call',
            server: 's',
            tool: 'read',
            arguments: { path: '/tmp/b' },
            result: { turn: 2 },
            error: null,
            status: 'completed',
          },
        },
        5
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(2);
    const first = parsed.sections[0] as Extract<CodexSection, { type: 'tool_call' }>;
    const second = parsed.sections[1] as Extract<CodexSection, { type: 'tool_call' }>;
    expect(first.toolCall.result).toMatchObject({ result: { turn: 1 } });
    expect(second.toolCall.result).toMatchObject({ result: { turn: 2 } });
    expect(first.toolCall.id).not.toBe(second.toolCall.id);
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

  it('renders todo_list items as a todo_list section', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'item.started',
          item: {
            id: 'item_11',
            type: 'todo_list',
            items: [
              { text: 'Step one', completed: true },
              { text: 'Step two', completed: false },
              { text: 'Step three', completed: false },
            ],
          },
        },
        1
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].type).toBe('todo_list');
    const todoSection = parsed.sections[0] as Extract<CodexSection, { type: 'todo_list' }>;
    expect(todoSection.items).toEqual([
      { text: 'Step one', completed: true },
      { text: 'Step two', completed: false },
      { text: 'Step three', completed: false },
    ]);
  });

  it('merges consecutive todo_list events (updated replaces started)', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'item.started',
          item: {
            id: 'item_11',
            type: 'todo_list',
            items: [
              { text: 'Step one', completed: true },
              { text: 'Step two', completed: false },
            ],
          },
        },
        1
      ),
      buildRawMessage(
        {
          type: 'item.completed',
          item: {
            id: 'item_11',
            type: 'todo_list',
            items: [
              { text: 'Step one', completed: true },
              { text: 'Step two', completed: true },
            ],
          },
        },
        2
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].type).toBe('todo_list');
    const todoSection = parsed.sections[0] as Extract<CodexSection, { type: 'todo_list' }>;
    expect(todoSection.items).toEqual([
      { text: 'Step one', completed: true },
      { text: 'Step two', completed: true },
    ]);
  });

  it('does not merge todo_list with non-adjacent todo_list', () => {
    const events: Message[] = [
      buildRawMessage(
        {
          type: 'item.started',
          item: {
            id: 'item_11',
            type: 'todo_list',
            items: [{ text: 'First batch', completed: false }],
          },
        },
        1
      ),
      buildRawMessage(
        { type: 'item.completed', item: { id: 'msg-1', type: 'agent_message', text: 'Working on it...' } },
        2
      ),
      buildRawMessage(
        {
          type: 'item.started',
          item: {
            id: 'item_12',
            type: 'todo_list',
            items: [{ text: 'Second batch', completed: false }],
          },
        },
        3
      ),
    ];

    const parsed = parseCodexRawEvents(events);

    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[0].type).toBe('todo_list');
    expect(parsed.sections[1].type).toBe('output');
    expect(parsed.sections[2].type).toBe('todo_list');
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
