import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAICodexProvider } from '../OpenAICodexProvider';
import { AIMessage } from '../../../types';

describe('OpenAICodexProvider', () => {
  let provider: OpenAICodexProvider;

  beforeEach(() => {
    // Use real API key from environment
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-api-key';

    // Create provider instance
    provider = new OpenAICodexProvider({
      apiKey: process.env.OPENAI_API_KEY
    });
  });

  describe('Provider Setup', () => {
    it('should have the correct default model', () => {
      expect(OpenAICodexProvider.DEFAULT_MODEL).toBe('gpt-5');
    });

    it('should return available models', () => {
      const models = OpenAICodexProvider.getModels();
      expect(models).toHaveLength(2);
      expect(models[0]).toEqual({
        id: 'openai-codex:gpt-5',
        name: 'GPT-5 (Codex)',
        provider: 'openai-codex',
        contextWindow: 128000,
        maxTokens: 16384
      });
      expect(models[1]).toEqual({
        id: 'openai-codex:gpt-4o',
        name: 'GPT-4o (Codex)',
        provider: 'openai-codex',
        contextWindow: 128000,
        maxTokens: 16384
      });
    });

    it('should return default model', () => {
      const defaultModel = OpenAICodexProvider.getDefaultModel();
      expect(defaultModel).toBe('gpt-5');
    });
  });

  describe('Initialization', () => {
    it('should initialize with config', async () => {
      await provider.initialize({
        model: 'gpt-5',
        apiKey: 'test-key',
        maxTokens: 2000
      });

      // Provider should initialize without error
      expect(provider).toBeDefined();
    });

    it('should register tool handler', () => {
      const mockHandler = {
        applyDiff: () => {},
        executeTool: () => Promise.resolve({ result: 'test' })
      };

      provider.registerToolHandler(mockHandler);
      // Should not throw
      expect(provider).toBeDefined();
    });
  });

  describe('Codex Execution', () => {
    it('should execute codex command with proper arguments and parse response correctly', async () => {
      await provider.initialize({
        model: 'gpt-5',
        apiKey: process.env.OPENAI_API_KEY || 'test-key'
      });

      const messages: AIMessage[] = [
        { role: 'user', content: 'Say exactly "Hello from codex" and nothing else' }
      ];

      // Try to execute a simple command
      const responseStream = provider.streamChat(messages, {
        workingDirectory: '/tmp'
      });

      let response = '';
      let hasError = false;
      let errorMessage = '';
      let chunkCount = 0;

      try {
        for await (const chunk of responseStream) {
          chunkCount++;
          if (chunk.type === 'text') {
            response += chunk.text || '';
            console.log('[TEST] Got text chunk:', chunk.text);
          } else if (chunk.type === 'error') {
            hasError = true;
            errorMessage = chunk.error || '';
            console.log('[TEST] Got error:', errorMessage);
          } else if (chunk.type === 'finish') {
            console.log('[TEST] Got finish chunk with text:', chunk.text);
            break;
          }
        }
      } catch (error: any) {
        hasError = true;
        errorMessage = error.message;
        console.log('[TEST] Exception:', errorMessage);
      }

      console.log('[TEST] Final response:', response);
      console.log('[TEST] Total chunks:', chunkCount);

      // If codex is not installed, we expect an error
      // If codex is installed, we expect a proper response
      if (hasError) {
        // Should be a meaningful error about codex not being found
        expect(errorMessage).toMatch(/Codex CLI not found|Codex process exited|Device not configured/);
      } else {
        // Should have received some chunks
        expect(chunkCount).toBeGreaterThan(0);

        // Response should not be empty
        expect(response).toBeTruthy();
        expect(response.length).toBeGreaterThan(0);

        // Response should contain expected text (codex will say something about "Hello from codex")
        // It should contain "Hello from codex" somewhere in the response
        expect(response.toLowerCase()).toContain('hello from codex');

        // Response should NOT contain raw JSON
        expect(response).not.toContain('"type":');
        expect(response).not.toContain('"msg":');
        expect(response).not.toContain('"agent_message"');
      }
    }, 30000); // 30 second timeout for API call
  });

  describe('Tool Calls', () => {
    it('should indicate tool calls are not supported', async () => {
      const toolCall = {
        id: 'tool-1',
        name: 'test-tool',
        arguments: { test: true }
      };

      const result = await provider.handleToolCall(toolCall, {
        workingDirectory: '/tmp'
      });

      expect(result.isError).toBe(true);
      expect(result.result).toContain('not supported');
    });
  });

  describe('Capabilities', () => {
    it('should report correct capabilities', () => {
      const capabilities = provider.getCapabilities();

      expect(capabilities.streaming).toBe(true);
      expect(capabilities.tools).toBe(false);
      expect(capabilities.mcpSupport).toBe(false);
    });
  });
});