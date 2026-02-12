/**
 * OpenAI Codex SDK Protocol Adapter
 *
 * Wraps the @openai/codex-sdk to provide a normalized protocol interface
 * for the OpenAICodexProvider.
 *
 * This adapter isolates all SDK-specific details:
 * - Client initialization
 * - Thread creation/resumption
 * - Message sending via runStreamed
 * - Event parsing and conversion
 */

import {
  AgentProtocol,
  ProtocolSession,
  SessionOptions,
  ProtocolMessage,
  ProtocolEvent,
} from './ProtocolInterface';
import {
  CodexClientLike,
  CodexSdkModuleLike,
  CodexThreadLike,
  getEventsIterable,
  loadCodexSdkModule,
} from '../providers/codex/codexSdkLoader';
import { parseCodexEvent } from '../providers/codex/codexEventParser';

/**
 * OpenAI Codex SDK Protocol Adapter
 *
 * Provides a normalized interface to the OpenAI Codex SDK, handling:
 * - Client initialization and API key management
 * - Thread lifecycle (create, resume)
 * - Message sending and event streaming
 * - Event parsing from Codex format to protocol format
 *
 * Note: The Codex SDK does not support session forking. Calling forkSession
 * will create a new thread instead.
 */
export class CodexSDKProtocol implements AgentProtocol {
  readonly platform = 'codex-sdk';

  private apiKey: string;
  private codexClient: CodexClientLike | null = null;
  private readonly loadSdkModule: () => Promise<CodexSdkModuleLike>;
  private readonly resolveCodexPathOverride: () => string | undefined;

  /**
   * @param apiKey - OpenAI API key
   * @param loadSdkModule - Optional SDK loader for testing
   * @param resolveCodexPathOverride - Optional function to resolve packaged Codex binary path
   */
  constructor(
    apiKey: string,
    loadSdkModule?: () => Promise<CodexSdkModuleLike>,
    resolveCodexPathOverride?: () => string | undefined
  ) {
    this.apiKey = apiKey;
    this.loadSdkModule = loadSdkModule || loadCodexSdkModule;
    this.resolveCodexPathOverride = resolveCodexPathOverride || (() => undefined);
  }

  /**
   * Create a new session (thread)
   *
   * @param options - Session configuration
   * @returns Protocol session with thread ID
   */
  async createSession(options: SessionOptions): Promise<ProtocolSession> {
    const client = await this.getCodexClient();
    const threadOptions = this.buildThreadOptions(options);
    const thread = client.startThread(threadOptions);

    // Thread ID is typically empty initially and populated from thread.started event
    const threadId = thread.id || '';
    console.log('[CODEX-PROTOCOL] Thread created, initial ID:', threadId || '(empty - will be set from thread.started event)');

    return {
      id: threadId,
      platform: this.platform,
      raw: {
        thread,
        options: threadOptions,
      },
    };
  }

  /**
   * Resume an existing session (thread)
   *
   * @param sessionId - Codex thread ID to resume
   * @param options - Session configuration
   * @returns Protocol session
   */
  async resumeSession(sessionId: string, options: SessionOptions): Promise<ProtocolSession> {
    console.log('[CODEX-PROTOCOL] Resuming thread:', sessionId);
    const client = await this.getCodexClient();
    const threadOptions = this.buildThreadOptions(options);
    const thread = client.resumeThread(sessionId, threadOptions);

    console.log('[CODEX-PROTOCOL] Thread resumed:', {
      threadId: sessionId,
      threadObjectId: thread.id
    });

    return {
      id: sessionId,
      platform: this.platform,
      raw: {
        thread,
        options: threadOptions,
      },
    };
  }

  /**
   * Fork an existing session
   *
   * Note: The Codex SDK does not support session forking.
   * This method creates a new thread instead.
   *
   * @param sessionId - Source session ID (ignored)
   * @param options - Session configuration for the new thread
   * @returns New protocol session
   */
  async forkSession(sessionId: string, options: SessionOptions): Promise<ProtocolSession> {
    // Codex SDK doesn't support forking, create a new thread instead
    console.warn('[CODEX-PROTOCOL] Codex SDK does not support session forking. Creating new thread instead.');
    return this.createSession(options);
  }

  /**
   * Send a message and receive streaming events
   *
   * This method:
   * 1. Builds the prompt from message content
   * 2. Calls thread.runStreamed() with the prompt
   * 3. Captures and updates the thread ID
   * 4. Streams and parses events from the SDK
   * 5. Converts Codex events to protocol events
   */
  async *sendMessage(
    session: ProtocolSession,
    message: ProtocolMessage
  ): AsyncIterable<ProtocolEvent> {
    const thread: CodexThreadLike = session.raw?.thread;
    if (!thread) {
      throw new Error('Invalid session: missing thread');
    }

    // Build the prompt
    const prompt = this.buildPrompt(message, session.raw?.options);

    // Track cumulative text for delta extraction
    let lastCumulativeText = '';
    let fullText = '';
    let usage: { input_tokens: number; output_tokens: number; total_tokens: number } | undefined;

    try {
      // Run the thread with streaming
      const runResult = await thread.runStreamed(prompt, {
        signal: session.raw?.options?.abortSignal,
      });

      // Thread ID is captured from thread.started event during streaming (see event loop below)

      // Stream events
      const events = getEventsIterable(runResult);
      for await (const event of events) {
        // Check for abort
        if (session.raw?.options?.abortSignal?.aborted) {
          throw new Error('Operation cancelled');
        }

        // Parse Codex event into protocol events
        const parsedEvents = parseCodexEvent(event);
        for (const parsedEvent of parsedEvents) {
          // Capture thread ID from thread.started event
          if (parsedEvent.threadId && parsedEvent.threadId !== session.id) {
            session.id = parsedEvent.threadId;
            console.log('[CODEX-PROTOCOL] Thread ID captured from thread.started event:', session.id);

            // Yield the raw event for database storage
            // This ensures thread.started events are preserved in the codex_events table
            if (parsedEvent.rawEvent) {
              yield {
                type: 'text',
                content: '', // No visible content
                metadata: {
                  rawEvent: parsedEvent.rawEvent,
                  threadStarted: true,
                  threadId: parsedEvent.threadId
                },
              };
            }
          }

          // Error event
          if (parsedEvent.error) {
            yield {
              type: 'error',
              error: parsedEvent.error,
              metadata: { rawEvent: parsedEvent.rawEvent },
            };
            continue;
          }

          // Usage tracking
          if (parsedEvent.usage) {
            usage = parsedEvent.usage;
          }

          // Tool call event
          if (parsedEvent.toolCall) {
            yield {
              type: 'tool_call',
              toolCall: {
                name: parsedEvent.toolCall.name,
                arguments: parsedEvent.toolCall.arguments,
                ...(parsedEvent.toolCall.result !== undefined
                  ? { result: parsedEvent.toolCall.result }
                  : {}),
              },
              metadata: { rawEvent: parsedEvent.rawEvent },
            };
            continue;
          }

          // Reasoning event (thinking blocks - not part of final output)
          if (parsedEvent.reasoning) {
            yield {
              type: 'reasoning',
              content: parsedEvent.reasoning,
              metadata: { rawEvent: parsedEvent.rawEvent },
            };
            continue;
          }

          // Text event (handle cumulative vs incremental)
          if (parsedEvent.text) {
            let delta: string;
            if (parsedEvent.text.startsWith(lastCumulativeText) && lastCumulativeText.length > 0) {
              // Cumulative mode - extract only the new portion
              delta = parsedEvent.text.slice(lastCumulativeText.length);
              lastCumulativeText = parsedEvent.text;
            } else {
              // Incremental mode
              delta = parsedEvent.text;
              lastCumulativeText = parsedEvent.text;
            }

            if (delta) {
              fullText += delta;
              yield {
                type: 'text',
                content: delta,
                metadata: { rawEvent: parsedEvent.rawEvent },
              };
            }
          }
        }
      }

      // Emit completion event
      yield {
        type: 'complete',
        content: fullText,
        usage: usage ?? {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isAbort =
        session.raw?.options?.abortSignal?.aborted || /abort|cancel/i.test(errorMessage);

      if (!isAbort) {
        yield {
          type: 'error',
          error: errorMessage,
        };
      }
    }
  }

  /**
   * Abort an active session
   *
   * Note: Codex SDK abort is handled via AbortSignal passed in options.
   * This method is for cleanup purposes.
   */
  abortSession(session: ProtocolSession): void {
    // Codex SDK abort is handled via AbortSignal in options
    // No additional cleanup needed
  }

  /**
   * Clean up session resources
   */
  cleanupSession(session: ProtocolSession): void {
    // Clear thread reference
    if (session.raw) {
      session.raw.thread = null;
    }
  }

  /**
   * Get or initialize the Codex client
   */
  private async getCodexClient(): Promise<CodexClientLike> {
    if (this.codexClient) {
      return this.codexClient;
    }

    const sdkModule = await this.loadSdkModule();
    const codexPathOverride = this.resolveCodexPathOverride();

    this.codexClient = new sdkModule.Codex({
      apiKey: this.apiKey,
      ...(codexPathOverride ? { codexPathOverride } : {}),
    });
    return this.codexClient;
  }

  /**
   * Build thread options from session options
   */
  private buildThreadOptions(options: SessionOptions): Record<string, unknown> {
    return {
      model: options.model || 'gpt-5',
      workingDirectory: options.workspacePath,
      skipGitRepoCheck: true,
      approvalPolicy: 'never', // Nimbalyst handles approvals
      sandboxMode: 'workspace-write',
      modelReasoningEffort: 'high',
      ...options.raw,
    };
  }

  /**
   * Build prompt from message content
   *
   * For the initial implementation, we just use the message content.
   * In the future, this could be enhanced to include:
   * - System prompt
   * - Conversation history
   * - Document context
   */
  private buildPrompt(message: ProtocolMessage, threadOptions?: Record<string, unknown>): string {
    const parts: string[] = [];

    // Add system prompt if available
    if (threadOptions?.systemPrompt) {
      parts.push(`<SYSTEM>\n${threadOptions.systemPrompt}\n</SYSTEM>`);
    }

    // Add user message
    parts.push(`USER: ${message.content}`);

    return parts.join('\n\n');
  }
}
