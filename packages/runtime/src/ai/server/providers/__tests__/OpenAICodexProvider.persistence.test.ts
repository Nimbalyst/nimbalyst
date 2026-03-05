import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICodexProvider } from '../OpenAICodexProvider';
import { AgentMessagesRepository } from '../../../../storage/repositories/AgentMessagesRepository';
import type { CreateAgentMessageInput } from '../../types';

describe('OpenAICodexProvider persistence', () => {
  const createdMessages: CreateAgentMessageInput[] = [];

  beforeEach(() => {
    createdMessages.length = 0;

    OpenAICodexProvider.setTrustChecker(() => ({
      trusted: true,
      mode: 'allow-all',
    }));

    AgentMessagesRepository.setStore({
      async create(message: CreateAgentMessageInput) {
        createdMessages.push(message);
      },
      async list() {
        return [];
      },
      async getMessageCounts() {
        return new Map();
      },
    });
  });

  afterEach(() => {
    AgentMessagesRepository.clearStore();
  });

  it('persists each raw_event output as an agent message row', async () => {
    const rawEvents = [
      { type: 'unknown.output', payload: { step: 1 } },
      { type: 'item.completed', item: { type: 'command_execution', command: 'apply_patch' } },
    ];

    const protocol = {
      platform: 'codex-sdk',
      async createSession() {
        return {
          id: 'thread-1',
          platform: 'codex-sdk',
          raw: {},
        };
      },
      async resumeSession() {
        throw new Error('not used');
      },
      async forkSession() {
        throw new Error('not used');
      },
      async *sendMessage() {
        for (const rawEvent of rawEvents) {
          yield {
            type: 'raw_event',
            metadata: { rawEvent },
          };
        }

        yield {
          type: 'text',
          content: 'done',
        };

        yield {
          type: 'complete',
          content: 'done',
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
          },
        };
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    } as any;

    const permissionService = {
      resolvePermission: vi.fn(),
      rejectAllPending: vi.fn(),
      clearSessionCache: vi.fn(),
    } as any;

    const provider = new OpenAICodexProvider(
      { apiKey: 'test-key' },
      { protocol, permissionService }
    );

    await provider.initialize({
      apiKey: 'test-key',
      model: 'openai-codex:gpt-5',
    });

    const chunks: any[] = [];
    for await (const chunk of provider.sendMessage('test', undefined, 'session-1', [], process.cwd())) {
      chunks.push(chunk);
    }

    const outputRows = createdMessages.filter((message) => message.direction === 'output');
    expect(outputRows).toHaveLength(rawEvents.length);
    expect(outputRows.map((row) => (row.metadata as any)?.eventType)).toEqual([
      'unknown.output',
      'item.completed',
    ]);
    expect(chunks.some((chunk) => chunk.type === 'text' && chunk.content === 'done')).toBe(true);
  });
});
