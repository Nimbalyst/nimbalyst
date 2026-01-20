/**
 * OpenAI Realtime API Client for Mobile Voice Transcription
 *
 * A simplified version of the desktop RealtimeAPIClient that only handles
 * audio capture and transcription. No voice agent tools - just speech-to-text.
 *
 * The transcribed text is then sent to the desktop via the sync infrastructure
 * for execution by Claude Code.
 */

interface RealtimeEvent {
  type: string;
  event_id?: string;
  [key: string]: unknown;
}

interface TranscriptionCallbacks {
  onTranscriptComplete: (transcript: string) => void;
  onTranscriptDelta?: (delta: string, itemId: string) => void;
  onError: (error: { type: string; message: string }) => void;
  onDisconnect: (reason: 'timeout' | 'error' | 'user_stopped') => void;
}

export class RealtimeTranscriptionClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private model: string = 'gpt-realtime';
  private connected: boolean = false;
  private callbacks: TranscriptionCallbacks;

  // Inactivity tracking
  private lastActivityTime: number = Date.now();
  private inactivityCheckInterval: ReturnType<typeof setInterval> | null = null;
  private readonly INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes for mobile (battery conscious)

  // VAD settings
  private vadThreshold: number;
  private silenceDurationMs: number;

  constructor(
    apiKey: string,
    callbacks: TranscriptionCallbacks,
    options?: {
      vadThreshold?: number;
      silenceDurationMs?: number;
    }
  ) {
    this.apiKey = apiKey;
    this.callbacks = callbacks;
    this.vadThreshold = options?.vadThreshold ?? 0.5;
    this.silenceDurationMs = options?.silenceDurationMs ?? 800; // Slightly longer for mobile
  }

  /**
   * Connect to OpenAI Realtime API via WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${this.model}`;

      console.log('[RealtimeTranscriptionClient] Connecting to OpenAI Realtime API');

      this.ws = new WebSocket(url, ['realtime', `openai-insecure-api-key.${this.apiKey}`, 'openai-beta.realtime-v1']);

      this.ws.onopen = () => {
        console.log('[RealtimeTranscriptionClient] Connected');
        this.connected = true;
        this.startInactivityMonitor();
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as RealtimeEvent;
          this.handleServerEvent(data);
        } catch (error) {
          console.error('[RealtimeTranscriptionClient] Failed to parse server event', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[RealtimeTranscriptionClient] WebSocket error', error);
        this.connected = false;
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        console.log('[RealtimeTranscriptionClient] WebSocket closed');
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
        // Configure session for transcription-only mode
        this.updateSession();
        break;

      case 'session.updated':
        console.log('[RealtimeTranscriptionClient] Session configured for transcription');
        break;

      case 'input_audio_buffer.speech_started':
        this.updateActivity();
        break;

      case 'input_audio_buffer.speech_stopped':
        this.updateActivity();
        break;

      case 'conversation.item.input_audio_transcription.delta':
        // Streaming transcription delta
        const delta = (event as any).delta as string;
        const deltaItemId = (event as any).item_id as string;
        if (delta && this.callbacks.onTranscriptDelta) {
          this.callbacks.onTranscriptDelta(delta, deltaItemId);
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        // Final transcription result
        const transcript = (event as any).transcript as string;
        console.log('[RealtimeTranscriptionClient] Transcription complete:', transcript);
        if (transcript) {
          this.callbacks.onTranscriptComplete(transcript);
        }
        break;

      case 'error':
        const errorEvent = event as any;
        console.error('[RealtimeTranscriptionClient] Server error:', errorEvent.error);
        this.callbacks.onError({
          type: errorEvent.error?.type || 'unknown_error',
          message: errorEvent.error?.message || 'An error occurred',
        });
        break;

      case 'response.done':
        // Check for failed response
        const response = (event as any).response;
        if (response?.status === 'failed' && response?.status_details?.error) {
          const error = response.status_details.error;
          this.callbacks.onError({
            type: error.type || 'response_error',
            message: error.message || 'Response failed',
          });
        }
        break;

      default:
        // Ignore other events (audio output, etc.) - we only care about transcription
        break;
    }
  }

  /**
   * Configure session for transcription-only mode
   * No tools, no audio output - just speech-to-text
   */
  private updateSession(): void {
    if (!this.ws || !this.connected) {
      console.error('[RealtimeTranscriptionClient] Cannot update session - not connected');
      return;
    }

    const config = {
      modalities: ['text'], // Text only - no audio output
      instructions: 'You are a transcription assistant. Simply transcribe what the user says.',
      input_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1',
      },
      turn_detection: {
        type: 'server_vad',
        threshold: this.vadThreshold,
        prefix_padding_ms: 300,
        silence_duration_ms: this.silenceDurationMs,
      },
      // No tools - transcription only
      tools: [],
    };

    const event = {
      type: 'session.update',
      session: config,
    };

    this.ws.send(JSON.stringify(event));
  }

  /**
   * Send audio chunk to OpenAI
   * @param audioBase64 Base64-encoded PCM16 audio data (24kHz mono)
   */
  sendAudio(audioBase64: string): void {
    if (!this.ws || !this.connected) {
      console.error('[RealtimeTranscriptionClient] Cannot send audio - not connected');
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
   * Use this in push-to-talk mode or to force transcription
   */
  commitAudio(): void {
    if (!this.ws || !this.connected) {
      console.error('[RealtimeTranscriptionClient] Cannot commit audio - not connected');
      return;
    }

    const event = {
      type: 'input_audio_buffer.commit',
    };

    this.ws.send(JSON.stringify(event));
  }

  /**
   * Clear the audio buffer without processing
   */
  clearAudio(): void {
    if (!this.ws || !this.connected) {
      return;
    }

    const event = {
      type: 'input_audio_buffer.clear',
    };

    this.ws.send(JSON.stringify(event));
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
        console.log('[RealtimeTranscriptionClient] Inactive for 2 minutes, disconnecting');
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
   * Disconnect from OpenAI Realtime API
   */
  disconnect(reason: 'timeout' | 'error' | 'user_stopped' = 'user_stopped'): void {
    if (this.ws) {
      this.stopInactivityMonitor();
      this.callbacks.onDisconnect(reason);
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}
