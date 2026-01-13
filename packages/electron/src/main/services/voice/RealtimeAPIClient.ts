/**
 * OpenAI Realtime API WebSocket Client
 *
 * Manages WebSocket connection to OpenAI's Realtime API for voice interactions.
 * Handles audio streaming, function calls, and session management.
 */

import WebSocket from 'ws';
import { ipcMain } from 'electron';
import { AnalyticsService } from '../analytics/AnalyticsService';

interface RealtimeEvent {
  type: string;
  event_id?: string;
  [key: string]: unknown;
}

interface SessionConfig {
  modalities: string[];
  instructions: string;
  voice: string;
  input_audio_format: string;
  output_audio_format: string;
  input_audio_transcription?: {
    model: string;
  };
  turn_detection?: {
    type: string;
    threshold?: number;
    prefix_padding_ms?: number;
    silence_duration_ms?: number;
  };
  tools?: Array<{
    type: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

interface CustomPromptConfig {
  prepend?: string;
  append?: string;
}

export class RealtimeAPIClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private model: string = 'gpt-realtime';
  private sessionId: string | null = null;
  private connected: boolean = false;
  private onAudioCallback: ((audioBase64: string) => void) | null = null;
  private onTextCallback: ((text: string) => void) | null = null;
  private onSubmitPromptCallback: ((prompt: string) => Promise<void>) | null = null;
  private onInterruptionCallback: (() => void) | null = null;
  private onDisconnectCallback: ((reason: 'timeout' | 'error' | 'user_stopped') => void) | null = null;
  private onErrorCallback: ((error: { type: string; message: string }) => void) | null = null;
  private onStopSessionCallback: (() => boolean) | null = null;
  private onGetSessionSummaryCallback: (() => Promise<{ success: boolean; summary?: string; error?: string }>) | null = null;
  private onAskCodingAgentCallback: ((question: string) => Promise<{ success: boolean; answer?: string; error?: string }>) | null = null;
  private claudeCodeSessionId: string;
  private workspacePath: string | null;
  private window: Electron.BrowserWindow;
  private sessionContext: string;
  private customPrompt: CustomPromptConfig;

  // Inactivity tracking
  private lastActivityTime: number = Date.now();
  private inactivityCheckInterval: NodeJS.Timeout | null = null;
  private readonly INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  // Token usage tracking
  private inputAudioTokens: number = 0;
  private outputAudioTokens: number = 0;
  private textTokens: number = 0;

  // Current response tracking
  private currentResponseId: string | null = null;
  private hasActiveResponse: boolean = false;

  constructor(
    apiKey: string,
    claudeCodeSessionId: string,
    workspacePath: string | null,
    window: Electron.BrowserWindow,
    sessionContext?: string,
    customPrompt?: CustomPromptConfig
  ) {
    this.apiKey = apiKey;
    this.claudeCodeSessionId = claudeCodeSessionId;
    this.workspacePath = workspacePath;
    this.window = window;
    this.sessionContext = sessionContext || 'New session with no prior messages.';
    this.customPrompt = customPrompt || {};
  }

  /**
   * Set callback for received audio
   */
  setOnAudio(callback: (audioBase64: string) => void): void {
    this.onAudioCallback = callback;
  }

  /**
   * Set callback for received text
   */
  setOnText(callback: (text: string) => void): void {
    this.onTextCallback = callback;
  }

  /**
   * Set callback for submitting prompts to Claude Code
   */
  setOnSubmitPrompt(callback: (prompt: string) => Promise<void>): void {
    this.onSubmitPromptCallback = callback;
  }

  /**
   * Set callback for when user interrupts the assistant
   */
  setOnInterruption(callback: () => void): void {
    this.onInterruptionCallback = callback;
  }

  /**
   * Set callback for when the connection is closed
   */
  setOnDisconnect(callback: (reason: 'timeout' | 'error' | 'user_stopped') => void): void {
    this.onDisconnectCallback = callback;
  }

  /**
   * Set callback for errors (quota exceeded, rate limits, etc.)
   */
  setOnError(callback: (error: { type: string; message: string }) => void): void {
    this.onErrorCallback = callback;
  }

  /**
   * Set callback for stopping the voice session
   */
  setOnStopSession(callback: () => boolean): void {
    this.onStopSessionCallback = callback;
  }

  /**
   * Set callback for getting session summary
   */
  setOnGetSessionSummary(callback: () => Promise<{ success: boolean; summary?: string; error?: string }>): void {
    this.onGetSessionSummaryCallback = callback;
  }

  /**
   * Set callback for asking the coding agent questions
   */
  setOnAskCodingAgent(callback: (question: string) => Promise<{ success: boolean; answer?: string; error?: string }>): void {
    this.onAskCodingAgentCallback = callback;
  }

  /**
   * Connect to OpenAI Realtime API via WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;

      console.log('[RealtimeAPIClient] Connecting to OpenAI Realtime API', { url });

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      this.ws.on('open', () => {
        this.connected = true;
        this.startInactivityMonitor();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString()) as RealtimeEvent;
          this.handleServerEvent(event);
        } catch (error) {
          console.error('[RealtimeAPIClient] Failed to parse server event', { error });
        }
      });

      this.ws.on('error', (error) => {
        console.error('[RealtimeAPIClient] WebSocket error', { error });
        this.connected = false;
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        this.connected = false;
      });
    });
  }

  /**
   * Handle events from OpenAI Realtime API
   */
  private handleServerEvent(event: RealtimeEvent): void {
    // Update activity timestamp for most events
    if (!event.type.startsWith('response.audio.delta')) {
      this.updateActivity();
    }

    switch (event.type) {
      case 'session.created':
        this.sessionId = (event as any).session?.id || null;
        this.updateSession();
        break;

      case 'session.updated':
        break;

      case 'response.created':
        this.currentResponseId = (event as any).response?.id || null;
        this.hasActiveResponse = true;
        break;

      case 'response.done':
        const response = (event as any).response;
        const usage = response?.usage;
        if (usage) {
          this.trackTokenUsage(usage);
        }
        // Check for failed response with error
        if (response?.status === 'failed' && response?.status_details?.error) {
          const error = response.status_details.error;
          console.error('[RealtimeAPIClient] Response failed:', error.type, error.message);
          if (this.onErrorCallback) {
            this.onErrorCallback({
              type: error.type || 'unknown_error',
              message: error.message || 'Voice mode encountered an error',
            });
          }
        }
        this.currentResponseId = null;
        this.hasActiveResponse = false;
        break;

      case 'response.audio.delta':
        // Received audio chunk from OpenAI
        const audioDelta = (event as any).delta as string; // base64-encoded PCM16
        this.handleAudioDelta(audioDelta);
        if (this.onAudioCallback) {
          this.onAudioCallback(audioDelta);
        }
        break;

      case 'response.audio.done':
        break;

      case 'response.text.delta':
        const textDelta = (event as any).delta as string;
        if (this.onTextCallback) {
          this.onTextCallback(textDelta);
        }
        break;

      case 'response.function_call_arguments.delta':
        break;

      case 'response.function_call_arguments.done':
        const callId = (event as any).call_id as string;
        const name = (event as any).name as string;
        const args = (event as any).arguments as string;
        this.handleFunctionCall(callId, name, args);
        break;

      case 'input_audio_buffer.speech_started':
        this.updateActivity();
        this.cancelCurrentResponse();
        if (this.onInterruptionCallback) {
          this.onInterruptionCallback();
        }
        break;

      case 'input_audio_buffer.speech_stopped':
        this.updateActivity();
        break;

      case 'error':
        const errorEvent = event as any;
        console.error('[RealtimeAPIClient] Server error:', JSON.stringify(errorEvent.error, null, 2));
        console.error('[RealtimeAPIClient] Full error event:', JSON.stringify(errorEvent, null, 2));
        break;

      default:
        break;
    }
  }

  /**
   * Update session configuration
   */
  private updateSession(): void {
    if (!this.ws || !this.connected) {
      console.error('[RealtimeAPIClient] Cannot update session - not connected');
      return;
    }

    // Build instructions with optional custom prepend/append
    const baseInstructions = `You are a voice assistant that serves as the conversational interface between the user and a coding agent (Claude).

Architecture:
- You handle voice interaction with the user
- A separate coding agent (Claude) handles all coding tasks, file searches, and technical work
- You relay requests to the coding agent and summarize its responses for voice

Session: ${this.sessionContext}

IMPORTANT: Your knowledge of this codebase is limited to the session context above. You do NOT have current knowledge of this project's code, files, implementation details, or recent changes. Do not assume you know how features work. When in doubt, ask the coding agent.

Tools:
- submit_agent_prompt: Send a coding task to the coding agent. Use for any task that requires writing code, making changes, or doing technical work.
- ask_coding_agent: Ask the coding agent a question. Use when you need information about the project, codebase, files, or anything you don't know. The coding agent can search files, read code, and look up information.
- stop_voice_session: End the voice conversation when the user says goodbye or wants to stop.
- get_session_summary: Get a summary of what's been discussed in this session.

Guidelines:
- For coding tasks: use submit_agent_prompt, say "On it" or similar, then stay quiet until the coding agent finishes
- For ANY question about this project, codebase, files, features, implementation, timeouts, configurations, or how things work: ALWAYS say a brief acknowledgement first (like "Let me check on that" or "Asking the coding agent"), then use ask_coding_agent, then summarize the answer conversationally
- Only answer directly for truly general knowledge questions completely unrelated to this project (like "what time is it" or "tell me a joke")
- For "[INTERNAL: ...]" messages: these are completion notifications from the coding agent - briefly acknowledge ("Done" + short summary)
- When summarizing coding agent responses: adapt length to complexity, paraphrase technical details naturally for speech
- Never read code, file paths, or technical details verbatim`;

    // Apply custom prepend/append if configured
    let instructions = baseInstructions;
    if (this.customPrompt.prepend) {
      instructions = this.customPrompt.prepend + '\n\n' + instructions;
    }
    if (this.customPrompt.append) {
      instructions = instructions + '\n\n' + this.customPrompt.append;
    }

    const config: SessionConfig = {
      modalities: ['text', 'audio'],
      instructions,
      voice: 'marin', // Use Marin voice
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1',
      },
      turn_detection: {
        type: 'server_vad', // Server-side Voice Activity Detection
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
      },
      tools: [
        {
          type: 'function',
          name: 'submit_agent_prompt',
          description: 'Queue a coding task for yourself to process. Use this when the user asks you to write code, fix bugs, refactor, or perform any coding task. The work will be queued and you will be notified when it completes.',
          parameters: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The coding task to queue for yourself. Be specific and include all relevant context from the conversation. IMPORTANT: End your prompt with "When done, provide a clear 1-sentence summary of what was changed or fixed." This ensures you get a useful summary to relay to the user.',
              },
            },
            required: ['prompt'],
          },
        },
        {
          type: 'function',
          name: 'stop_voice_session',
          description: 'End the current voice mode session. Use this when the user says goodbye, wants to stop talking, or the conversation is complete. This will disconnect from voice mode.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          type: 'function',
          name: 'get_session_summary',
          description: 'Get a summary of the current AI session. Returns information about the session name, message counts, duration, and recent topics discussed. Use this when the user asks about what has been discussed or wants a recap.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          type: 'function',
          name: 'ask_coding_agent',
          description: 'Ask the coding agent a question when you need more information to answer the user. The coding agent can search files, read code, look up documentation, run web searches, or use its knowledge of the codebase. Use this when the user asks about something you do not know - like details about the project, how something works, what a file contains, recent changes, etc. The coding agent will provide a detailed answer which you should then summarize appropriately for voice.',
          parameters: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The question to ask the coding agent. Be specific about what information you need. Examples: "What does the VoiceModeService do?", "How is authentication implemented?", "What files handle the editor tabs?"',
              },
            },
            required: ['question'],
          },
        },
      ],
    };

    const event = {
      type: 'session.update',
      session: config,
    };

    this.ws.send(JSON.stringify(event));
  }

  /**
   * Send audio chunk to OpenAI
   * @param audioBase64 Base64-encoded PCM16 audio data
   */
  sendAudio(audioBase64: string): void {
    if (!this.ws || !this.connected) {
      console.error('[RealtimeAPIClient] Cannot send audio - not connected');
      return;
    }

    const event = {
      type: 'input_audio_buffer.append',
      audio: audioBase64,
    };

    this.ws.send(JSON.stringify(event));
  }

  /**
   * Commit the audio buffer to trigger processing
   */
  commitAudio(): void {
    if (!this.ws || !this.connected) {
      console.error('[RealtimeAPIClient] Cannot commit audio - not connected');
      return;
    }

    const event = {
      type: 'input_audio_buffer.commit',
    };

    this.ws.send(JSON.stringify(event));
  }

  /**
   * Send a text message from the user to the assistant
   * This is used to notify the voice assistant when the coding agent completes
   * Returns true if message was sent successfully, false otherwise
   */
  sendUserMessage(text: string): boolean {
    if (!this.ws || !this.connected) {
      console.error('[RealtimeAPIClient] Cannot send user message - WebSocket not connected');
      return false;
    }

    try {
      const event = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: text,
            },
          ],
        },
      };

      this.ws.send(JSON.stringify(event));

      // Trigger a response from the assistant
      this.createResponse();

      return true;
    } catch (error) {
      console.error('[RealtimeAPIClient] Failed to send user message:', error);
      return false;
    }
  }

  /**
   * Handle incoming audio delta from OpenAI
   * In a full implementation, this would decode and play the audio
   */
  private handleAudioDelta(audioBase64: string): void {
    // Audio is handled via callback
  }

  /**
   * Handle function call from OpenAI
   */
  private async handleFunctionCall(callId: string, name: string, argsJson: string): Promise<void> {
    switch (name) {
      case 'submit_agent_prompt': {
        try {
          const args = JSON.parse(argsJson);
          const prompt = args.prompt;

          // Track prompt submission (no content for privacy)
          AnalyticsService.getInstance().sendEvent('voice_prompt_submitted');

          if (this.onSubmitPromptCallback) {
            await this.onSubmitPromptCallback(prompt);
          } else {
            throw new Error('No submit prompt callback registered');
          }

          this.sendFunctionCallResult(callId, {
            success: true,
            message: 'Task queued successfully. You will be notified when it completes.',
          });
        } catch (error) {
          console.error('[RealtimeAPIClient] Failed to submit prompt to agent:', error);
          this.sendFunctionCallResult(callId, {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      case 'stop_voice_session': {
        try {
          if (this.onStopSessionCallback) {
            const stopped = this.onStopSessionCallback();
            this.sendFunctionCallResult(callId, {
              success: stopped,
              message: stopped ? 'Voice session ended.' : 'No active session to stop.',
            });
          } else {
            this.sendFunctionCallResult(callId, {
              success: false,
              error: 'Stop session callback not registered',
            });
          }
        } catch (error) {
          console.error('[RealtimeAPIClient] Failed to stop session:', error);
          this.sendFunctionCallResult(callId, {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      case 'get_session_summary': {
        try {
          if (this.onGetSessionSummaryCallback) {
            const result = await this.onGetSessionSummaryCallback();
            this.sendFunctionCallResult(callId, result);
          } else {
            this.sendFunctionCallResult(callId, {
              success: false,
              error: 'Session summary callback not registered',
            });
          }
        } catch (error) {
          console.error('[RealtimeAPIClient] Failed to get session summary:', error);
          this.sendFunctionCallResult(callId, {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      case 'ask_coding_agent': {
        try {
          const args = JSON.parse(argsJson);
          const question = args.question;

          if (!question) {
            this.sendFunctionCallResult(callId, {
              success: false,
              error: 'question parameter is required',
            });
            break;
          }

          if (this.onAskCodingAgentCallback) {
            const result = await this.onAskCodingAgentCallback(question);
            this.sendFunctionCallResult(callId, result);
          } else {
            this.sendFunctionCallResult(callId, {
              success: false,
              error: 'Ask coding agent callback not registered',
            });
          }
        } catch (error) {
          console.error('[RealtimeAPIClient] Failed to ask coding agent:', error);
          this.sendFunctionCallResult(callId, {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      default: {
        console.error('[RealtimeAPIClient] Unknown function call:', name);
        this.sendFunctionCallResult(callId, { error: 'Unknown function' });
      }
    }
  }

  /**
   * Send function call result back to OpenAI
   */
  private sendFunctionCallResult(callId: string, result: unknown): void {
    if (!this.ws || !this.connected) {
      console.error('[RealtimeAPIClient] Cannot send function result - not connected');
      return;
    }

    const event = {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result),
      },
    };

    this.ws.send(JSON.stringify(event));

    // Trigger assistant response
    this.createResponse();
  }

  /**
   * Request the assistant to generate a response
   */
  private createResponse(): void {
    if (!this.ws || !this.connected) {
      console.error('[RealtimeAPIClient] Cannot create response - not connected');
      return;
    }

    const event = {
      type: 'response.create',
    };

    this.ws.send(JSON.stringify(event));
  }

  /**
   * Cancel the current response (used when user interrupts)
   */
  private cancelCurrentResponse(): void {
    if (!this.ws || !this.connected || !this.hasActiveResponse) {
      return;
    }

    const event = {
      type: 'response.cancel',
    };

    this.ws.send(JSON.stringify(event));
    this.hasActiveResponse = false;
  }

  /**
   * Update last activity timestamp
   */
  private updateActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Start monitoring for inactivity
   */
  private startInactivityMonitor(): void {
    // Check every 30 seconds
    this.inactivityCheckInterval = setInterval(() => {
      const inactiveMs = Date.now() - this.lastActivityTime;

      if (inactiveMs >= this.INACTIVITY_TIMEOUT_MS) {
        console.log('[RealtimeAPIClient] Session inactive for 5 minutes, disconnecting to save tokens');
        this.disconnect('timeout');
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Stop inactivity monitor
   */
  private stopInactivityMonitor(): void {
    if (this.inactivityCheckInterval) {
      clearInterval(this.inactivityCheckInterval);
      this.inactivityCheckInterval = null;
    }
  }

  /**
   * Track token usage from response events
   */
  private trackTokenUsage(usage: any): void {
    // OpenAI Realtime API usage format:
    // - input_tokens: text input tokens
    // - output_tokens: text output tokens
    // - input_token_details.audio: audio input tokens (1 token per 100ms)
    // - output_token_details.audio: audio output tokens (1 token per 50ms)

    const inputAudio = usage.input_token_details?.audio || 0;
    const outputAudio = usage.output_token_details?.audio || 0;
    const inputText = usage.input_tokens || 0;
    const outputText = usage.output_tokens || 0;

    this.inputAudioTokens += inputAudio;
    this.outputAudioTokens += outputAudio;
    this.textTokens += inputText + outputText;

    const totalTokens = this.inputAudioTokens + this.outputAudioTokens + this.textTokens;

    console.log('[RealtimeAPIClient] Token usage update', {
      thisResponse: {
        inputAudio,
        outputAudio,
        inputText,
        outputText,
        total: inputAudio + outputAudio + inputText + outputText
      },
      sessionTotal: {
        inputAudio: this.inputAudioTokens,
        outputAudio: this.outputAudioTokens,
        text: this.textTokens,
        total: totalTokens
      }
    });
  }

  /**
   * Get current token usage statistics
   */
  getTokenUsage(): { inputAudio: number; outputAudio: number; text: number; total: number } {
    return {
      inputAudio: this.inputAudioTokens,
      outputAudio: this.outputAudioTokens,
      text: this.textTokens,
      total: this.inputAudioTokens + this.outputAudioTokens + this.textTokens,
    };
  }

  /**
   * Disconnect from OpenAI Realtime API
   * @param reason Optional reason for disconnect (default: 'user_stopped')
   */
  disconnect(reason: 'timeout' | 'error' | 'user_stopped' = 'user_stopped'): void {
    if (this.ws) {
      this.stopInactivityMonitor();

      // Call disconnect callback before closing
      if (this.onDisconnectCallback) {
        this.onDisconnectCallback(reason);
      }

      this.ws.close();
      this.ws = null;
      this.connected = false;
      this.sessionId = null;
      this.currentResponseId = null;
      this.hasActiveResponse = false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}
