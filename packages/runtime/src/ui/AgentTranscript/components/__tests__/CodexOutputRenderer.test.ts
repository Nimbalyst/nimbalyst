import { describe, expect, it } from 'vitest';
import type { Message } from '../../../../ai/server/types';
import { parseCodexRawEvents } from '../CodexOutputRenderer';

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

    expect(parsed.reasoning).toEqual(['**Reading instructions**']);
    expect(parsed.output).toBe('Done.');
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].name).toBe('mcp__nimbalyst-extension-dev__get_environment_info');
    expect(parsed.toolCalls[0].result).toEqual({
      success: true,
      result: { ok: true },
      status: 'completed',
    });
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

    expect(parsed.toolCalls).toHaveLength(2);

    expect(parsed.toolCalls[0].name).toBe('command_execution');
    expect(parsed.toolCalls[0].arguments).toEqual({
      command: '/bin/zsh -lc ls',
    });
    expect(parsed.toolCalls[0].result).toEqual({
      success: true,
      command: '/bin/zsh -lc ls',
      output: 'README.md\npackage.json\n',
      exit_code: 0,
      status: 'completed',
    });

    expect(parsed.toolCalls[1].name).toBe('file_change');
    expect(parsed.toolCalls[1].arguments).toEqual({
      changes: [{ path: '/tmp/file.ts', kind: 'update' }],
    });
    expect(parsed.toolCalls[1].result).toEqual({
      success: true,
      status: 'completed',
      changes: [{ path: '/tmp/file.ts', kind: 'update' }],
    });
  });
});
