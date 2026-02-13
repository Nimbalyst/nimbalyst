import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICodexProvider } from '../OpenAICodexProvider';
import * as codexBinaryPath from '../codex/codexBinaryPath';
import * as codexSdkLoader from '../codex/codexSdkLoader';

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
    // Reset all static configuration to null for clean test isolation
    OpenAICodexProvider.setTrustChecker(null);
    OpenAICodexProvider.setPermissionPatternChecker(null);
    OpenAICodexProvider.setPermissionPatternSaver(null);
    OpenAICodexProvider.setSecurityLogger(null);
    OpenAICodexProvider.setMcpServerPort(null);
    OpenAICodexProvider.setSessionNamingServerPort(null);
    OpenAICodexProvider.setExtensionDevServerPort(null);
    OpenAICodexProvider.setMCPConfigLoader(null);
    OpenAICodexProvider.setClaudeSettingsEnvLoader(null);
    OpenAICodexProvider.setShellEnvironmentLoader(null);
  });

  it('returns fallback models when SDK model discovery is unavailable', async () => {
    expect(OpenAICodexProvider.DEFAULT_MODEL).toBe('openai-codex:gpt-5.3-codex');

    const models = await OpenAICodexProvider.getModels(undefined, {
      loadSdkModule: async () => {
        throw new Error('sdk unavailable');
      },
    });

    expect(models.length).toBeGreaterThan(1);
    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'openai-codex:gpt-5.3-codex',
        provider: 'openai-codex',
      }),
      expect.objectContaining({
        id: 'openai-codex:gpt-5.2-codex',
        provider: 'openai-codex',
      }),
    ]));
  });

  it('uses SDK-provided model discovery when available', async () => {
    let codexConstructorOptions: Record<string, unknown> | undefined;
    const listModels = vi.fn(async () => ({
      data: [
        {
          id: 'gpt-5.2-codex',
          name: 'GPT-5.2 Codex',
          contextWindow: 400000,
          maxTokens: 128000,
        },
      ],
    }));

    const models = await OpenAICodexProvider.getModels('test-key', {
      loadSdkModule: async () =>
        ({
          Codex: class {
            constructor(options?: Record<string, unknown>) {
              codexConstructorOptions = options;
            }

            listModels = listModels;

            startThread = vi.fn();

            resumeThread = vi.fn();
          },
        }) as any,
    });

    expect(codexConstructorOptions).toEqual({ apiKey: 'test-key' });
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'openai-codex:gpt-5.3-codex',
        provider: 'openai-codex',
      }),
      expect.objectContaining({
        id: 'openai-codex:gpt-5.2-codex',
        name: 'GPT-5.2 Codex',
        provider: 'openai-codex',
      }),
      expect.objectContaining({
        id: 'openai-codex:gpt-5.1-codex-max',
        provider: 'openai-codex',
      }),
      expect.objectContaining({
        id: 'openai-codex:gpt-5.2',
        provider: 'openai-codex',
      }),
      expect.objectContaining({
        id: 'openai-codex:gpt-5.1-codex-mini',
        provider: 'openai-codex',
      }),
    ]));
    expect(models).toHaveLength(5);
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

  it('passes packaged codexPathOverride into SDK construction when available', async () => {
    let codexConstructorOptions: Record<string, unknown> | undefined;

    const runStreamed = vi.fn(async () => ({
      threadId: 'thread-override',
      events: createAsyncEventStream([
        {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: 'override path works',
          },
        },
      ]),
    }));

    const provider = new OpenAICodexProvider(
      { apiKey: 'test-key' },
      {
        resolveCodexPathOverride: () => '/tmp/codex-unpacked-bin',
        loadSdkModule: async () =>
          ({
            Codex: class {
              constructor(options?: Record<string, unknown>) {
                codexConstructorOptions = options;
              }

              startThread() {
                return {
                  id: 'thread-override',
                  runStreamed,
                };
              }

              resumeThread() {
                return {
                  id: 'thread-override',
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

    for await (const _chunk of provider.sendMessage('test override', undefined, 'session-override', [], process.cwd())) {
      // drain
    }

    expect(codexConstructorOptions).toMatchObject({
      apiKey: 'test-key',
      codexPathOverride: '/tmp/codex-unpacked-bin',
    });
  });

  it('wires packaged codex resolver in default provider construction path', async () => {
    OpenAICodexProvider.setTrustChecker(() => ({ trusted: true, mode: 'allow-all' as any }));
    OpenAICodexProvider.setPermissionPatternChecker(async () => false);
    OpenAICodexProvider.setPermissionPatternSaver(async () => {});
    OpenAICodexProvider.setSecurityLogger(() => {});

    const resolvedBinaryPath = '/tmp/codex-resolved-by-default';
    const resolveSpy = vi
      .spyOn(codexBinaryPath, 'resolvePackagedCodexBinaryPath')
      .mockReturnValue(resolvedBinaryPath);

    let codexConstructorOptions: Record<string, unknown> | undefined;
    const runStreamed = vi.fn(async () => ({
      threadId: 'thread-default-resolver',
      events: createAsyncEventStream([
        {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: 'default resolver wired',
          },
        },
      ]),
    }));

    vi.spyOn(codexSdkLoader, 'loadCodexSdkModule').mockResolvedValue({
      Codex: class {
        constructor(options?: Record<string, unknown>) {
          codexConstructorOptions = options;
        }

        startThread() {
          return {
            id: 'thread-default-resolver',
            runStreamed,
          };
        }

        resumeThread() {
          return {
            id: 'thread-default-resolver',
            runStreamed,
          };
        }
      },
    } as any);

    const provider = new OpenAICodexProvider({ apiKey: 'test-key' });
    await provider.initialize({
      apiKey: 'test-key',
      model: 'openai-codex:gpt-5',
    });

    for await (const _chunk of provider.sendMessage('test default resolver', undefined, 'session-default-resolver', [], process.cwd())) {
      // drain
    }

    expect(resolveSpy).toHaveBeenCalled();
    expect(codexConstructorOptions).toMatchObject({
      apiKey: 'test-key',
      codexPathOverride: resolvedBinaryPath,
    });
  });

  it('omits codexPathOverride from SDK options when resolver returns undefined', async () => {
    let codexConstructorOptions: Record<string, unknown> | undefined;

    const runStreamed = vi.fn(async () => ({
      threadId: 'thread-no-override',
      events: createAsyncEventStream([
        {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: 'no override',
          },
        },
      ]),
    }));

    const provider = new OpenAICodexProvider(
      { apiKey: 'test-key' },
      {
        resolveCodexPathOverride: () => undefined,
        loadSdkModule: async () =>
          ({
            Codex: class {
              constructor(options?: Record<string, unknown>) {
                codexConstructorOptions = options;
              }

              startThread() {
                return {
                  id: 'thread-no-override',
                  runStreamed,
                };
              }

              resumeThread() {
                return {
                  id: 'thread-no-override',
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

    for await (const _chunk of provider.sendMessage('test no override', undefined, 'session-no-override', [], process.cwd())) {
      // drain
    }

    expect(codexConstructorOptions).toEqual({
      apiKey: 'test-key',
    });
    expect(codexConstructorOptions).not.toHaveProperty('codexPathOverride');
  });

  it('passes runtime MCP servers into Codex config overrides', async () => {
    let codexConstructorOptions: Record<string, any> | undefined;
    const workspacePath = process.cwd();

    OpenAICodexProvider.setTrustChecker(() => ({ trusted: true, mode: 'allow-all' as any }));
    OpenAICodexProvider.setPermissionPatternChecker(async () => false);
    OpenAICodexProvider.setPermissionPatternSaver(async () => {});
    OpenAICodexProvider.setSecurityLogger(() => {});
    OpenAICodexProvider.setMcpServerPort(41001);
    OpenAICodexProvider.setSessionNamingServerPort(41002);
    OpenAICodexProvider.setExtensionDevServerPort(41003);
    OpenAICodexProvider.setMCPConfigLoader(async () => ({
      custom_stdio: {
        command: 'npx',
        args: ['-y', '@acme/mcp'],
        env: { API_TOKEN: 'token-value' },
      },
      custom_http: {
        type: 'http',
        url: 'https://mcp.example.com',
        headers: {
          Authorization: 'Bearer abc123',
          'X-Tenant': 'nimbalyst',
        },
      },
    }));

    const runStreamed = vi.fn(async () => ({
      threadId: 'thread-mcp-config',
      events: createAsyncEventStream([
        {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: 'mcp configured',
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
              constructor(options?: Record<string, unknown>) {
                codexConstructorOptions = options as Record<string, any>;
              }
              startThread() {
                return {
                  id: 'thread-mcp-config',
                  runStreamed,
                };
              }
              resumeThread() {
                return {
                  id: 'thread-mcp-config',
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

    for await (const _chunk of provider.sendMessage('mcp setup', undefined, 'session-mcp', [], workspacePath)) {
      // drain
    }

    const mcpServers = codexConstructorOptions?.config?.mcp_servers as Record<string, any>;
    expect(mcpServers).toBeDefined();
    expect(Object.keys(mcpServers)).toEqual(
      expect.arrayContaining([
        'nimbalyst-mcp',
        'nimbalyst-session-naming',
        'nimbalyst-extension-dev',
        'custom_stdio',
        'custom_http',
      ])
    );

    expect(mcpServers['nimbalyst-mcp'].url).toContain('http://127.0.0.1:41001/mcp');
    expect(mcpServers['nimbalyst-mcp'].url).toContain(`workspacePath=${encodeURIComponent(workspacePath)}`);
    expect(mcpServers['nimbalyst-session-naming'].url).toContain('http://127.0.0.1:41002/mcp');
    expect(mcpServers['nimbalyst-session-naming'].url).toContain('sessionId=session-mcp');
    expect(mcpServers['nimbalyst-extension-dev'].url).toContain('http://127.0.0.1:41003/mcp');
    expect(mcpServers['nimbalyst-extension-dev'].url).toContain(`workspacePath=${encodeURIComponent(workspacePath)}`);

    expect(mcpServers.custom_stdio).toEqual({
      command: 'npx',
      args: ['-y', '@acme/mcp'],
      env: { API_TOKEN: 'token-value' },
    });
    expect(mcpServers.custom_http).toEqual({
      url: 'https://mcp.example.com',
      http_headers: {
        Authorization: 'Bearer abc123',
        'X-Tenant': 'nimbalyst',
      },
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
    expect(errorChunk?.error).toContain('denied');
  });

  it('denies Codex in ask mode (tool-level permissions not supported)', async () => {
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
      trusted: true,
      mode: 'ask',
    }));
    OpenAICodexProvider.setPermissionPatternChecker(async () => false);

    await provider.initialize({
      apiKey: 'test-key',
      model: 'openai-codex:gpt-5',
    });

    const chunks: any[] = [];
    for await (const chunk of provider.sendMessage('test message', undefined, 'session-ask', [], process.cwd())) {
      chunks.push(chunk);
    }

    // Should be denied because Codex doesn't support tool-level permissions
    expect(startThread).not.toHaveBeenCalled();
    const errorChunk = chunks.find((chunk) => chunk.type === 'error');
    expect(errorChunk?.error).toContain('Allow Edits');
    expect(errorChunk?.error).toContain('permission mode');
  });

  it('maps legacy codex model ids to gpt-5.3-codex when starting a thread', async () => {
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
    const startArgs = (startThread.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(startArgs.model).toBe('gpt-5.3-codex');
  });

  it('maps removed codex aliases to supported model ids', async () => {
    const startThread = vi.fn((config: { model: string }) => ({
      id: 'thread-alias',
      runStreamed: async () => ({
        events: createAsyncEventStream([
          {
            type: 'item.completed',
            item: {
              type: 'agent_message',
              text: 'alias model mapped',
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
      model: 'openai-codex:codex-mini-latest',
    });

    for await (const _chunk of provider.sendMessage('alias', undefined, 'session-alias', [], process.cwd())) {
      // drain
    }

    expect(startThread).toHaveBeenCalledTimes(1);
    const startArgs = (startThread.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(startArgs.model).toBe('gpt-5.1-codex-mini');
  });

  it('maps removed codex max aliases to supported model ids', async () => {
    const startThread = vi.fn((config: { model: string }) => ({
      id: 'thread-alias-max',
      runStreamed: async () => ({
        events: createAsyncEventStream([
          {
            type: 'item.completed',
            item: {
              type: 'agent_message',
              text: 'alias max model mapped',
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
      model: 'openai-codex:gpt-5.2-codex-max',
    });

    for await (const _chunk of provider.sendMessage('alias max', undefined, 'session-alias-max', [], process.cwd())) {
      // drain
    }

    expect(startThread).toHaveBeenCalledTimes(1);
    const startArgs = (startThread.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(startArgs.model).toBe('gpt-5.2-codex');
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
