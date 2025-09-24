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

      // Ask a question that requires actual AI processing, not just echoing
      const messages: AIMessage[] = [
        { role: 'user', content: 'What is 2 + 2? Reply with just the number.' }
      ];

      // Try to execute a simple command
      const responseStream = provider.streamChat(messages, {
        workingDirectory: '/tmp'
      });

      let response = '';
      let hasError = false;
      let errorMessage = '';
      let chunkCount = 0;
      let gotValidResponse = false;

      try {
        for await (const chunk of responseStream) {
          chunkCount++;
          if (chunk.type === 'text') {
            response += chunk.text || '';
            console.log('[TEST] Got text chunk:', chunk.text);
            // Check if we're getting actual codex responses
            if (chunk.text && chunk.text.length > 0) {
              gotValidResponse = true;
            }
          } else if (chunk.type === 'error') {
            hasError = true;
            errorMessage = chunk.error || '';
            console.log('[TEST] Got error:', errorMessage);
          } else if (chunk.type === 'finish') {
            console.log('[TEST] Got finish chunk with text:', chunk.text);
            if (chunk.text) {
              response += chunk.text;
            }
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
      console.log('[TEST] Has error:', hasError);
      console.log('[TEST] Got valid response:', gotValidResponse);

      // This test should FAIL if codex is not properly connected
      // We should NOT accept just any response - we need to verify actual communication

      if (hasError) {
        // If we have an error, it should be a specific codex-related error
        console.error('[TEST] Codex connection failed with error:', errorMessage);
        expect(errorMessage).toMatch(/Codex CLI not found|codex: command not found|spawn codex ENOENT|Cannot find module.*codex/);

        // IMPORTANT: If we get here, the test should FAIL because Codex is not working
        throw new Error(`Codex is not properly connected: ${errorMessage}`);
      } else {
        // We should have gotten a real response from codex
        expect(gotValidResponse).toBe(true);
        expect(chunkCount).toBeGreaterThan(0);
        expect(response).toBeTruthy();
        expect(response.length).toBeGreaterThan(0);

        // The response should actually contain what we asked for
        // But more importantly, we should verify that codex actually processed our request
        console.log('[TEST] Verifying codex actually responded with:', response);

        // Check that we got a proper AI response
        // For "What is 2 + 2?" we should get "4" or something containing "4"
        if (!response.includes('4')) {
          throw new Error(`Codex did not provide correct answer. Expected '4', got: ${response}`);
        }
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