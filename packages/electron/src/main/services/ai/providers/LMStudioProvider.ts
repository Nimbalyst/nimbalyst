/**
 * LMStudio provider for local models (OpenAI-compatible API)
 */

import { BaseAIProvider } from '../AIProvider';
import { 
  DocumentContext, 
  ProviderConfig, 
  ProviderCapabilities, 
  StreamChunk,
  Message
} from '../types';

interface LMStudioConfig extends ProviderConfig {
  baseUrl?: string;  // Default: http://127.0.0.1:1234
}

export class LMStudioProvider extends BaseAIProvider {
  private baseUrl: string = 'http://127.0.0.1:8234';
  private abortController: AbortController | null = null;

  async initialize(config: LMStudioConfig): Promise<void> {
    this.config = config;
    this.baseUrl = config.baseUrl || 'http://127.0.0.1:8234';
    
    // Test connection to LMStudio
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`);
      if (!response.ok) {
        throw new Error(`LMStudio server not responding at ${this.baseUrl}`);
      }
    } catch (error) {
      throw new Error(`Failed to connect to LMStudio at ${this.baseUrl}: ${error}`);
    }
  }

  async *sendMessage(
    message: string, 
    documentContext?: DocumentContext,
    sessionId?: string,
    messages?: Message[]
  ): AsyncIterableIterator<StreamChunk> {
    // Build system prompt with document context
    const systemPrompt = this.buildSystemPrompt(documentContext);

    // Create abort controller for this request
    this.abortController = new AbortController();

    // Build messages array for OpenAI-compatible API
    const apiMessages: any[] = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Add existing messages if provided
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        // Skip messages with empty content
        if (!msg.content || msg.content.trim() === '') {
          continue;
        }
        
        // Skip tool messages for now (LMStudio might not support function calling)
        if (msg.role === 'tool') {
          continue;
        }
        
        apiMessages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      }
    }
    
    // Add the new user message
    if (!message || message.trim() === '') {
      throw new Error('Cannot send empty message to LMStudio');
    }
    apiMessages.push({ role: 'user', content: message });

    try {
      // Make streaming request to LMStudio
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model || 'local-model',
          messages: apiMessages,
          max_tokens: this.config.maxTokens || 4096,
          temperature: this.config.temperature || 0.7,
          stream: true
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        throw new Error(`LMStudio returned ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body from LMStudio');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.trim() === 'data: [DONE]') {
            yield {
              type: 'complete',
              content: fullContent,
              isComplete: true
            };
            return;
          }

          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              const delta = json.choices?.[0]?.delta;
              
              if (delta?.content) {
                fullContent += delta.content;
                yield {
                  type: 'text',
                  content: delta.content
                };
              }
              
              if (json.choices?.[0]?.finish_reason === 'stop') {
                yield {
                  type: 'complete',
                  content: fullContent,
                  isComplete: true
                };
              }
            } catch (error) {
              console.error('Error parsing SSE data from LMStudio:', error, 'Line:', line);
            }
          }
        }
      }

      // Handle any remaining buffer
      if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
        if (buffer.startsWith('data: ')) {
          try {
            const json = JSON.parse(buffer.slice(6));
            const delta = json.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              yield {
                type: 'text',
                content: delta.content
              };
            }
          } catch (error) {
            console.error('Error parsing final SSE data:', error);
          }
        }
      }

      // Ensure we send a complete event
      yield {
        type: 'complete',
        content: fullContent,
        isComplete: true
      };

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Request was aborted');
        yield {
          type: 'complete',
          isComplete: true
        };
      } else {
        console.error('LMStudio error:', error);
        yield {
          type: 'error',
          error: error.message
        };
      }
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      tools: false,  // Most local models don't support function calling yet
      mcpSupport: false,
      edits: false,  // Simplified - no tool support
      resumeSession: false
    };
  }

  destroy(): void {
    this.abort();
  }

  private buildSystemPrompt(documentContext?: DocumentContext): string {
    return `You are an AI assistant helping with a document in Stravu Editor, a markdown-focused text editor.

Current document context:
- File: ${documentContext?.filePath || 'untitled'}
- Type: ${documentContext?.fileType || 'markdown'}
${documentContext?.content ? `- Full document content:\n${documentContext.content}` : ''}

Please provide helpful, concise responses to assist with document editing and questions.`;
  }
}