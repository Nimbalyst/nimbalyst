/**
 * OpenAI Realtime API Client for Mobile Interactive Voice Mode
 *
 * A full-featured voice client that supports:
 * - Two-way audio (user speaks, agent speaks back)
 * - Voice agent tools (submit_agent_prompt, ask_coding_agent, etc.)
 * - Streaming transcription display
 *
 * This mirrors the desktop RealtimeAPIClient but adapted for mobile.
 */

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

type VoiceId = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar';

export interface VoiceClientCallbacks {
  // Audio output from the voice agent
  onAudio: (audioBase64: string) => void;
  // Text response from the voice agent
  onText: (text: string) => void;
  // User's transcribed speech (final)
  onUserTranscript: (transcript: string) => void;
  // User's transcribed speech (streaming delta)
  onUserTranscriptDelta?: (delta: string, itemId: string) => void;
  // Voice agent wants to submit a prompt to the coding agent
  onSubmitPrompt: (prompt: string) => Promise<void>;
  // Voice agent wants to ask the coding agent a question
  onAskCodingAgent?: (question: string) => Promise<{ success: boolean; answer?: string; error?: string }>;
  // Voice agent wants to stop the session
  onStopSession?: () => void;
  // User interrupted the agent
  onInterruption?: () => void;
  // Error occurred
  onError: (error: { type: string; message: string }) => void;
  // Session disconnected
  onDisconnect: (reason: 'timeout' | 'error' | 'user_stopped') => void;
  // Token usage update
  onTokenUsage?: (usage: { inputAudio: number; outputAudio: number; text: number; total: number }) => void;
}

export interface VoiceClientOptions {
  sessionContext?: string;
  voice?: VoiceId;
  vadThreshold?: number;
  silenceDurationMs?: number;
}

export class RealtimeVoiceClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private model: string = 'gpt-realtime';
  private connected: boolean = false;
  private callbacks: VoiceClientCallbacks;
  private options: VoiceClientOptions;

  // Inactivity tracking
  private lastActivityTime: number = Date.now();
  private inactivityCheckInterval: ReturnType<typeof setInterval> | null = null;
  private readonly INACTIVITY_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for mobile (battery conscious)

  // Token usage tracking
  private inputAudioTokens: number = 0;
  private outputAudioTokens: number = 0;
  private textTokens: number = 0;

  // Response tracking
  private currentResponseId: string | null = null;
  private hasActiveResponse: boolean = false;

  constructor(apiKey: string, callbacks: VoiceClientCallbacks, options?: VoiceClientOptions) {
    this.apiKey = apiKey;
    this.callbacks = callbacks;
    this.options = options || {};
  }

  /**
   * Connect to OpenAI Realtime API via WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;

      console.log('[RealtimeVoiceClient] Connecting to OpenAI Realtime API');

      // Mobile WebSocket doesn't support headers, use subprotocol for auth
      this.ws = new WebSocket(url, [
        'realtime',
        `openai-insecure-api-key.${this.apiKey}`,
        'openai-beta.realtime-v1',
      ]);

      this.ws.onopen = () => {
        console.log('[RealtimeVoiceClient] Connected');
        this.connected = true;
        this.startInactivityMonitor();
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as RealtimeEvent;
          this.handleServerEvent(data);
        } catch (error) {
          console.error('[RealtimeVoiceClient] Failed to parse server event', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[RealtimeVoiceClient] WebSocket error', error);
        this.connected = false;
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        console.log('[RealtimeVoiceClient] WebSocket closed');
        this.connected = false;
      };
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
        this.updateSession();
        break;

      case 'session.updated':
        console.log('[RealtimeVoiceClient] Session configured');
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
          console.error('[RealtimeVoiceClient] Response failed:', error.type, error.message);
          this.callbacks.onError({
            type: error.type || 'unknown_error',
            message: error.message || 'Voice mode encountered an error',
          });
        }
        this.currentResponseId = null;
        this.hasActiveResponse = false;
        break;

      case 'response.audio.delta':
        // Received audio chunk from OpenAI - send to playback
        const audioDelta = (event as any).delta as string;
        this.callbacks.onAudio(audioDelta);
        break;

      case 'response.audio.done':
        break;

      case 'response.text.delta':
        const textDelta = (event as any).delta as string;
        this.callbacks.onText(textDelta);
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
        if (this.callbacks.onInterruption) {
          this.callbacks.onInterruption();
        }
        break;

      case 'input_audio_buffer.speech_stopped':
        this.updateActivity();
        break;

      case 'conversation.item.input_audio_transcription.delta':
        // Streaming transcription delta
        const delta = (event as any).delta as string;
        const deltaItemId = (event as any).item_id as string;
        if (delta && this.callbacks.onUserTranscriptDelta) {
          this.callbacks.onUserTranscriptDelta(delta, deltaItemId);
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        // Final transcription result
        const transcript = (event as any).transcript as string;
        console.log('[RealtimeVoiceClient] User transcript:', transcript);
        if (transcript) {
          this.callbacks.onUserTranscript(transcript);
        }
        break;

      case 'error':
        const errorEvent = event as any;
        console.error('[RealtimeVoiceClient] Server error:', errorEvent.error);
        this.callbacks.onError({
          type: errorEvent.error?.type || 'unknown_error',
          message: errorEvent.error?.message || 'An error occurred',
        });
        break;

      default:
        break;
    }
  }

  /**
   * Configure session for interactive voice mode with tools
   */
  private updateSession(): void {
    if (!this.ws || !this.connected) {
      console.error('[RealtimeVoiceClient] Cannot update session - not connected');
      return;
    }

    const sessionContext = this.options.sessionContext || 'Mobile voice session.';

    const instructions = `You are a voice assistant on a mobile device that serves as the conversational interface between the user and a coding agent (Claude) running on their desktop.

Architecture:
- You handle voice interaction with the user on their phone
- A separate coding agent (Claude) handles all coding tasks on the desktop
- You relay requests to the coding agent and summarize its responses for voice

Session: ${sessionContext}

IMPORTANT: Your knowledge of this codebase is limited. When in doubt about project details, ask the coding agent.

Tools:
- submit_agent_prompt: Send a coding task to the coding agent on desktop. The user can review and cancel before it's sent.
- ask_coding_agent: Ask the coding agent a question about the project or codebase.
- stop_voice_session: End the voice conversation when the user says goodbye.

Guidelines:
- For coding tasks: use submit_agent_prompt, say "Queueing that for you" or similar
- For questions about the project: use ask_coding_agent and summarize the answer conversationally
- Keep responses brief and conversational - this is mobile voice
- Never read code or technical details verbatim - summarize naturally`;

    const config: SessionConfig = {
      modalities: ['text', 'audio'],
      instructions,
      voice: this.options.voice || 'alloy',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1',
      },
      turn_detection: {
        type: 'server_vad',
        threshold: this.options.vadThreshold ?? 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: this.options.silenceDurationMs ?? 600, // Slightly longer for mobile
      },
      tools: [
        {
          type: 'function',
          name: 'submit_agent_prompt',
          description:
            'Queue a coding task for the desktop coding agent. The user will see the task and can review/cancel it before it runs.',
          parameters: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The coding task to send to the desktop agent.',
              },
            },
            required: ['prompt'],
          },
        },
        {
          type: 'function',
          name: 'ask_coding_agent',
          description:
            'Ask the coding agent a question. Use when you need information about the project, files, or implementation.',
          parameters: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The question to ask the coding agent.',
              },
            },
            required: ['question'],
          },
        },
        {
          type: 'function',
          name: 'stop_voice_session',
          description: 'End the voice conversation when the user says goodbye or wants to stop.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
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
   * Handle function call from OpenAI
   */
  private async handleFunctionCall(callId: string, name: string, argsJson: string): Promise<void> {
    console.log('[RealtimeVoiceClient] Function call:', name);

    switch (name) {
      case 'submit_agent_prompt': {
        try {
          const args = JSON.parse(argsJson);
          const prompt = args.prompt;

          await this.callbacks.onSubmitPrompt(prompt);

          this.sendFunctionCallResult(callId, {
            success: true,
            message: 'Task queued. The user can review it before sending to the desktop.',
          });
        } catch (error) {
          console.error('[RealtimeVoiceClient] Failed to submit prompt:', error);
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

          if (this.callbacks.onAskCodingAgent) {
            const result = await this.callbacks.onAskCodingAgent(question);
            this.sendFunctionCallResult(callId, result);
          } else {
            this.sendFunctionCallResult(callId, {
              success: false,
              error: 'Asking the coding agent is not available from mobile yet.',
            });
          }
        } catch (error) {
          console.error('[RealtimeVoiceClient] Failed to ask coding agent:', error);
          this.sendFunctionCallResult(callId, {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      case 'stop_voice_session': {
        if (this.callbacks.onStopSession) {
          this.callbacks.onStopSession();
        }
        this.sendFunctionCallResult(callId, {
          success: true,
          message: 'Voice session ended.',
        });
        // Disconnect after sending the result
        setTimeout(() => this.disconnect('user_stopped'), 500);
        break;
      }

      default: {
        console.error('[RealtimeVoiceClient] Unknown function call:', name);
        this.sendFunctionCallResult(callId, { error: 'Unknown function' });
      }
    }
  }

  /**
   * Send function call result back to OpenAI
   */
  private sendFunctionCallResult(callId: string, result: unknown): void {
    if (!this.ws || !this.connected) {
      console.error('[RealtimeVoiceClient] Cannot send function result - not connected');
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
   * Send audio chunk to OpenAI
   */
  sendAudio(audioBase64: string): void {
    if (!this.ws || !this.connected) {
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
      return;
    }

    const event = {
      type: 'input_audio_buffer.commit',
    };

    this.ws.send(JSON.stringify(event));
  }

  /**
   * Send a text message to the assistant (e.g., completion notification)
   */
  sendUserMessage(text: string): boolean {
    if (!this.ws || !this.connected) {
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
      this.createResponse();
      return true;
    } catch (error) {
      console.error('[RealtimeVoiceClient] Failed to send user message:', error);
      return false;
    }
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
    this.inactivityCheckInterval = setInterval(() => {
      const inactiveMs = Date.now() - this.lastActivityTime;

      if (inactiveMs >= this.INACTIVITY_TIMEOUT_MS) {
        console.log('[RealtimeVoiceClient] Inactive for 3 minutes, disconnecting');
        this.disconnect('timeout');
      }
    }, 30000);
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
    const inputAudio = usage.input_token_details?.audio || 0;
    const outputAudio = usage.output_token_details?.audio || 0;
    const inputText = usage.input_tokens || 0;
    const outputText = usage.output_tokens || 0;

    this.inputAudioTokens += inputAudio;
    this.outputAudioTokens += outputAudio;
    this.textTokens += inputText + outputText;

    const totalTokens = this.inputAudioTokens + this.outputAudioTokens + this.textTokens;

    if (this.callbacks.onTokenUsage) {
      this.callbacks.onTokenUsage({
        inputAudio: this.inputAudioTokens,
        outputAudio: this.outputAudioTokens,
        text: this.textTokens,
        total: totalTokens,
      });
    }
  }

  /**
   * Disconnect from OpenAI Realtime API
   */
  disconnect(reason: 'timeout' | 'error' | 'user_stopped' = 'user_stopped'): void {
    if (this.ws) {
      this.stopInactivityMonitor();
      this.callbacks.onDisconnect(reason);
      this.ws.close();
      this.ws = null;
      this.connected = false;
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

  /**
   * Get current token usage
   */
  getTokenUsage(): { inputAudio: number; outputAudio: number; text: number; total: number } {
    return {
      inputAudio: this.inputAudioTokens,
      outputAudio: this.outputAudioTokens,
      text: this.textTokens,
      total: this.inputAudioTokens + this.outputAudioTokens + this.textTokens,
    };
  }
}
