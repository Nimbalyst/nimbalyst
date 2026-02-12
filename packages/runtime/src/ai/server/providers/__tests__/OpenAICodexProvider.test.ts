import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICodexProvider } from '../OpenAICodexProvider';

function createAsyncEventStream(events: any[]): AsyncIterable<any> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

describe('OpenAICodexProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    OpenAICodexProvider.setTrustChecker(null);
    OpenAICodexProvider.setPermissionPatternChecker(null);
    OpenAICodexProvider.setPermissionPatternSaver(null);
    OpenAICodexProvider.setSecurityLogger(null);
  });

  it('exposes expected model metadata', () => {
    expect(OpenAICodexProvider.DEFAULT_MODEL).toBe('openai-codex:gpt-5');

    const models = OpenAICodexProvider.getModels();
    expect(models).toHaveLength(1);
    expect(models[0]).toEqual({
      id: 'openai-codex:gpt-5',
      name: 'GPT-5 (Codex SDK)',
      provider: 'openai-codex',
      contextWindow: 272000,
      maxTokens: 16384,
    });
  });

  it('streams text and completion usage from Codex SDK events', async () => {
    const runStreamed = vi.fn(async () => ({
      threadId: 'thread-123',
      events: createAsyncEventStream([
        {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: 'hello from codex',
          },
        },
        {
          type: 'token_count',
          info: {
            input_tokens: 3,
            output_tokens: 7,
            total_tokens: 10,
          },
        },
      ]),
    }));

    const startThread = vi.fn(() => ({
      id: 'thread-123',
      runStreamed,
    }));

    const provider = new OpenAICodexProvider(
      { apiKey: 'test-key' },
      {
        loadSdkModule: async () =>
          ({
            Codex: class {
              startThread = startThread;
              resumeThread = vi.fn();
            },
          }) as any,
      }
    );

    await provider.initialize({
      apiKey: 'test-key',
      model: 'openai-codex:gpt-5',
    });

    const chunks: any[] = [];
    for await (const chunk of provider.sendMessage('say hello', undefined, 'session-1', [], process.cwd())) {
      chunks.push(chunk);
    }

    expect(startThread).toHaveBeenCalledTimes(1);
    expect(runStreamed).toHaveBeenCalledTimes(1);
    expect(chunks.some((chunk) => chunk.type === 'text' && chunk.content.includes('hello from codex'))).toBe(true);

    const completeChunk = chunks.find((chunk) => chunk.type === 'complete');
    expect(completeChunk).toBeDefined();
    expect(completeChunk.usage).toEqual({
      input_tokens: 3,
      output_tokens: 7,
      total_tokens: 10,
    });

    expect(provider.getProviderSessionData('session-1')).toEqual({
      providerSessionId: 'thread-123',
      codexThreadId: 'thread-123',
    });
  });

  it('emits tool_call chunks from streamed MCP tool events', async () => {
    const runStreamed = vi.fn(async () => ({
      threadId: 'thread-tool',
      events: createAsyncEventStream([
        {
          type: 'item.completed',
          item: {
            id: 'tool-1',
            type: 'mcp_tool_call',
            server: 'nimbalyst',
            tool: 'readFile',
            arguments: { path: 'README.md' },
            status: 'completed',
            result: { content: [{ type: 'text', text: 'file contents' }] },
          },
        },
        {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: 'tool complete',
          },
        },
      ]),
    }));

    const provider = new OpenAICodexProvider(
      { apiKey: 'test-key' },
      {
        loadSdkModule: async () =>
          ({
            Codex: class {
              startThread() {
                return {
                  id: 'thread-tool',
                  runStreamed,
                };
              }
              resumeThread() {
                return {
                  id: 'thread-tool',
                  runStreamed,
                };
              }
            },
          }) as any,
      }
    );

    await provider.initialize({
      apiKey: 'test-key',
      model: 'openai-codex:gpt-5',
    });

    const chunks: any[] = [];
    for await (const chunk of provider.sendMessage('use tools', undefined, 'session-tool', [], process.cwd())) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk) => chunk.type === 'tool_call' && chunk.toolCall?.name === 'readFile')).toBe(true);
    expect(chunks.some((chunk) => chunk.type === 'complete')).toBe(true);
  });

  it('resumes an existing provider thread when provider session data is restored', async () => {
    const resumeThread = vi.fn(() => ({
      id: 'thread-resume',
      runStreamed: async () => ({
        events: createAsyncEventStream([
          {
            type: 'item.completed',
            item: {
              type: 'agent_message',
              text: 'resumed',
            },
          },
        ]),
      }),
    }));
    const startThread = vi.fn();

    const provider = new OpenAICodexProvider(
      { apiKey: 'test-key' },
      {
        loadSdkModule: async () =>
          ({
            Codex: class {
              startThread = startThread;
              resumeThread = resumeThread;
            },
          }) as any,
      }
    );

    await provider.initialize({
      apiKey: 'test-key',
      model: 'openai-codex:gpt-5',
    });

    provider.setProviderSessionData('session-resume', {
      providerSessionId: 'thread-resume',
    });

    const chunks: any[] = [];
    for await (const chunk of provider.sendMessage('continue', undefined, 'session-resume', [], process.cwd())) {
      chunks.push(chunk);
    }

    expect(resumeThread).toHaveBeenCalledWith('thread-resume', expect.objectContaining({
      approvalPolicy: 'never',
      sandboxMode: 'workspace-write',
    }));
    expect(startThread).not.toHaveBeenCalled();
    expect(chunks.some((chunk) => chunk.type === 'text' && chunk.content.includes('resumed'))).toBe(true);
  });

  it('denies Codex turns when workspace is not trusted', async () => {
    const startThread = vi.fn();
    const provider = new OpenAICodexProvider(
      { apiKey: 'test-key' },
      {
        loadSdkModule: async () =>
          ({
            Codex: class {
              startThread = startThread;
              resumeThread = vi.fn();
            },
          }) as any,
      }
    );

    OpenAICodexProvider.setTrustChecker(() => ({
      trusted: false,
      mode: null,
    }));

    await provider.initialize({
      apiKey: 'test-key',
      model: 'openai-codex:gpt-5',
    });

    const chunks: any[] = [];
    for await (const chunk of provider.sendMessage('should be blocked', undefined, 'session-trust', [], process.cwd())) {
      chunks.push(chunk);
    }

    expect(startThread).not.toHaveBeenCalled();
    const errorChunk = chunks.find((chunk) => chunk.type === 'error');
    expect(errorChunk?.error).toContain('Workspace is not trusted');
  });

  it('uses Nimbalyst ToolPermission flow in ask mode before running Codex', async () => {
    const runStreamed = vi.fn(async () => ({
      threadId: 'thread-ask',
      events: createAsyncEventStream([
        {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: 'approved and executed',
          },
        },
      ]),
    }));

    const startThread = vi.fn(() => ({
      id: 'thread-ask',
      runStreamed,
    }));

    const provider = new OpenAICodexProvider(
      { apiKey: 'test-key' },
      {
        loadSdkModule: async () =>
          ({
            Codex: class {
              startThread = startThread;
              resumeThread = vi.fn();
            },
          }) as any,
      }
    );

    OpenAICodexProvider.setTrustChecker(() => ({
      trusted: true,
      mode: 'ask',
    }));
    OpenAICodexProvider.setPermissionPatternChecker(async () => false);

    await provider.initialize({
      apiKey: 'test-key',
      model: 'openai-codex:gpt-5',
    });

    const pendingPromise = new Promise<any>((resolve) => {
      provider.once('toolPermission:pending', resolve);
    });

    const chunksPromise = (async () => {
      const chunks: any[] = [];
      for await (const chunk of provider.sendMessage('needs approval', undefined, 'session-ask', [], process.cwd())) {
        chunks.push(chunk);
      }
      return chunks;
    })();

    const pending = await pendingPromise;
    expect(pending.requestId).toBeDefined();
    provider.resolveToolPermission(
      pending.requestId,
      { decision: 'allow', scope: 'once' },
      'session-ask'
    );

    const chunks = await chunksPromise;
    expect(startThread).toHaveBeenCalledTimes(1);
    expect(chunks.some((chunk) => chunk.type === 'text' && chunk.content.includes('approved and executed'))).toBe(true);
    expect(chunks.some((chunk) => chunk.type === 'complete')).toBe(true);
  });

  it('maps legacy codex model ids to gpt-5 when starting a thread', async () => {
    const startThread = vi.fn((config: { model: string }) => ({
      id: 'thread-legacy',
      runStreamed: async () => ({
        events: createAsyncEventStream([
          {
            type: 'item.completed',
            item: {
              type: 'agent_message',
              text: 'legacy model mapped',
            },
          },
        ]),
      }),
    }));

    const provider = new OpenAICodexProvider(
      { apiKey: 'test-key' },
      {
        loadSdkModule: async () =>
          ({
            Codex: class {
              startThread = startThread;
              resumeThread = vi.fn();
            },
          }) as any,
      }
    );

    await provider.initialize({
      apiKey: 'test-key',
      model: 'openai-codex:openai-codex-cli',
    });

    for await (const _chunk of provider.sendMessage('legacy', undefined, 'session-legacy', [], process.cwd())) {
      // drain
    }

    expect(startThread).toHaveBeenCalledTimes(1);
    const startArgs = startThread.mock.calls[0]?.[0];
    expect(startArgs?.model).toBe('gpt-5');
  });

  it('supports direct handleToolCall execution through the shared tool handler', async () => {
    const provider = new OpenAICodexProvider({ apiKey: 'test-key' });
    provider.registerToolHandler({
      executeTool: async () => ({ ok: true }),
    });

    const result = await provider.handleToolCall({
      name: 'readFile',
      arguments: { path: 'README.md' },
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ ok: true });
  });

  describe('Live Codex SDK integration', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY;

    it.runIf(hasApiKey)(
      'makes a real Codex SDK call and returns a valid response',
      async () => {
        const provider = new OpenAICodexProvider({
          apiKey: process.env.OPENAI_API_KEY!,
        });

        await provider.initialize({
          apiKey: process.env.OPENAI_API_KEY!,
          model: OpenAICodexProvider.getDefaultModel(),
          maxTokens: 256,
        });

        const responseChunks: any[] = [];
        for await (const chunk of provider.sendMessage(
          'What is 2 + 2? Reply with just the number.',
          undefined,
          'codex-live-test',
          [],
          process.cwd()
        )) {
          responseChunks.push(chunk);
          if (chunk.type === 'complete') {
            break;
          }
          if (chunk.type === 'error') {
            throw new Error(chunk.error || 'Codex live test failed');
          }
        }

        const textResponse = responseChunks
          .filter((chunk) => chunk.type === 'text')
          .map((chunk) => chunk.content || '')
          .join(' ');

        expect(responseChunks.some((chunk) => chunk.type === 'complete')).toBe(true);
        expect(textResponse).toContain('4');
      },
      120000
    );
  });
});
