/**
 * Interactive Voice Service for Mobile
 *
 * Combines audio capture, voice client, and audio playback into a single
 * service for interactive voice conversations with the OpenAI Realtime API.
 *
 * This provides a two-way voice conversation where:
 * - User speaks into the microphone
 * - Voice agent responds with audio
 * - Voice agent can call tools (submit prompts, ask questions)
 */

import { RealtimeVoiceClient, VoiceClientCallbacks, VoiceClientOptions } from './RealtimeVoiceClient';
import { AudioPlayback } from './AudioPlayback';

// Audio capture constants (must match OpenAI Realtime API requirements)
const SAMPLE_RATE = 24000; // 24kHz required by OpenAI
const BUFFER_SIZE = 4096;

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface PendingPrompt {
  id: string;
  prompt: string;
  timestamp: number;
}

export interface InteractiveVoiceCallbacks {
  // Called when a transcript entry is added or updated
  onTranscriptUpdate: (entries: TranscriptEntry[]) => void;
  // Called when the voice agent wants to submit a prompt to coding agent
  onPendingPrompt: (prompt: PendingPrompt) => void;
  // Called when voice state changes
  onStateChange: (state: VoiceServiceState) => void;
  // Called when an error occurs
  onError: (error: Error) => void;
  // Called when session ends
  onSessionEnd: (reason: 'timeout' | 'error' | 'user_stopped' | 'agent_stopped') => void;
}

export type VoiceServiceState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'agent_speaking'
  | 'processing'
  | 'error';

export class InteractiveVoiceService {
  private apiKey: string;
  private voiceClient: RealtimeVoiceClient | null = null;
  private audioPlayback: AudioPlayback | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private callbacks: InteractiveVoiceCallbacks;
  private options: VoiceClientOptions;

  private state: VoiceServiceState = 'idle';
  private transcriptEntries: TranscriptEntry[] = [];
  private currentAgentTextId: string | null = null;
  private currentUserTranscriptId: string | null = null;

  constructor(apiKey: string, callbacks: InteractiveVoiceCallbacks, options?: VoiceClientOptions) {
    this.apiKey = apiKey;
    this.callbacks = callbacks;
    this.options = options || {};
  }

  /**
   * Check microphone permission
   */
  async checkPermission(): Promise<PermissionState> {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return result.state;
    } catch {
      return 'prompt';
    }
  }

  /**
   * Request microphone permission
   */
  async requestPermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      console.error('[InteractiveVoiceService] Permission denied:', error);
      return false;
    }
  }

  /**
   * Start the interactive voice session
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') {
      console.warn('[InteractiveVoiceService] Already started');
      return;
    }

    this.setState('connecting');

    try {
      // Initialize audio playback
      this.audioPlayback = new AudioPlayback();

      // Create voice client callbacks
      const clientCallbacks: VoiceClientCallbacks = {
        onAudio: (audioBase64) => {
          // Play agent audio response
          this.audioPlayback?.play(audioBase64);
          if (this.state !== 'agent_speaking') {
            this.setState('agent_speaking');
          }
        },

        onText: (text) => {
          // Streaming text from agent
          this.appendAgentText(text);
        },

        onUserTranscript: (transcript) => {
          // Final user transcript
          this.finalizeUserTranscript(transcript);
        },

        onUserTranscriptDelta: (delta, itemId) => {
          // Streaming user transcript
          this.appendUserTranscriptDelta(delta, itemId);
        },

        onSubmitPrompt: async (prompt) => {
          // Voice agent wants to submit a coding task
          const pendingPrompt: PendingPrompt = {
            id: crypto.randomUUID(),
            prompt,
            timestamp: Date.now(),
          };
          this.callbacks.onPendingPrompt(pendingPrompt);
        },

        onAskCodingAgent: async (question) => {
          // For now, indicate this isn't available from mobile
          // In the future, this could sync to desktop and wait for response
          return {
            success: false,
            error: 'Asking the coding agent is not yet available from mobile. Please use submit_agent_prompt instead.',
          };
        },

        onStopSession: () => {
          // Agent decided to end the session
          this.stop('agent_stopped');
        },

        onInterruption: () => {
          // User interrupted the agent - stop playback
          this.audioPlayback?.stop();
          this.finalizeAgentText();
          this.setState('listening');
        },

        onError: (error) => {
          console.error('[InteractiveVoiceService] Voice client error:', error);
          this.callbacks.onError(new Error(error.message));
          if (error.type === 'rate_limit_exceeded' || error.type === 'quota_exceeded') {
            this.stop('error');
          }
        },

        onDisconnect: (reason) => {
          console.log('[InteractiveVoiceService] Disconnected:', reason);
          this.cleanup();
          this.callbacks.onSessionEnd(reason);
        },

        onTokenUsage: (usage) => {
          console.log('[InteractiveVoiceService] Token usage:', usage);
        },
      };

      // Initialize voice client
      this.voiceClient = new RealtimeVoiceClient(this.apiKey, clientCallbacks, this.options);

      // Connect to OpenAI
      await this.voiceClient.connect();

      // Set up audio capture
      await this.setupAudioCapture();

      this.setState('listening');
      console.log('[InteractiveVoiceService] Voice session started');
    } catch (error) {
      console.error('[InteractiveVoiceService] Failed to start:', error);
      this.cleanup();
      this.setState('error');
      throw error;
    }
  }

  /**
   * Set up audio capture from microphone
   */
  private async setupAudioCapture(): Promise<void> {
    // Get microphone stream
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Create audio context at correct sample rate
    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

    // Create source from microphone
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Create script processor for audio data access
    this.scriptProcessor = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    this.scriptProcessor.onaudioprocess = (event) => {
      if (!this.voiceClient?.isConnected()) {
        return;
      }

      const inputData = event.inputBuffer.getChannelData(0);
      const pcm16 = this.floatToPCM16(inputData);
      const base64 = this.arrayBufferToBase64(pcm16.buffer as ArrayBuffer);
      this.voiceClient.sendAudio(base64);
    };

    // Connect the audio graph
    this.sourceNode.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
  }

  /**
   * Stop the voice session
   */
  stop(reason: 'timeout' | 'error' | 'user_stopped' | 'agent_stopped' = 'user_stopped'): void {
    if (this.state === 'idle') {
      return;
    }

    console.log('[InteractiveVoiceService] Stopping:', reason);

    // Disconnect voice client
    if (this.voiceClient?.isConnected()) {
      this.voiceClient.disconnect(reason === 'agent_stopped' ? 'user_stopped' : reason);
    }

    this.cleanup();
    this.setState('idle');
    this.callbacks.onSessionEnd(reason);
  }

  /**
   * Clean up all resources
   */
  private cleanup(): void {
    // Stop audio playback
    if (this.audioPlayback) {
      this.audioPlayback.destroy();
      this.audioPlayback = null;
    }

    // Stop script processor
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    // Stop source node
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // Stop media stream tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    // Clear voice client reference
    this.voiceClient = null;
  }

  /**
   * Set state and notify
   */
  private setState(state: VoiceServiceState): void {
    if (this.state !== state) {
      this.state = state;
      this.callbacks.onStateChange(state);
    }
  }

  /**
   * Append streaming text from agent
   */
  private appendAgentText(text: string): void {
    if (!this.currentAgentTextId) {
      this.currentAgentTextId = crypto.randomUUID();
      this.transcriptEntries.push({
        id: this.currentAgentTextId,
        role: 'agent',
        text: '',
        timestamp: Date.now(),
        isStreaming: true,
      });
    }

    const entry = this.transcriptEntries.find((e) => e.id === this.currentAgentTextId);
    if (entry) {
      entry.text += text;
    }

    this.callbacks.onTranscriptUpdate([...this.transcriptEntries]);
  }

  /**
   * Finalize agent text (mark as not streaming)
   */
  private finalizeAgentText(): void {
    if (this.currentAgentTextId) {
      const entry = this.transcriptEntries.find((e) => e.id === this.currentAgentTextId);
      if (entry) {
        entry.isStreaming = false;
      }
      this.currentAgentTextId = null;
      this.callbacks.onTranscriptUpdate([...this.transcriptEntries]);
    }
  }

  /**
   * Append streaming user transcript delta
   */
  private appendUserTranscriptDelta(delta: string, itemId: string): void {
    if (this.currentUserTranscriptId !== itemId) {
      // New user utterance
      this.currentUserTranscriptId = itemId;
      this.transcriptEntries.push({
        id: itemId,
        role: 'user',
        text: '',
        timestamp: Date.now(),
        isStreaming: true,
      });
    }

    const entry = this.transcriptEntries.find((e) => e.id === itemId);
    if (entry) {
      entry.text += delta;
    }

    this.callbacks.onTranscriptUpdate([...this.transcriptEntries]);
  }

  /**
   * Finalize user transcript with complete text
   */
  private finalizeUserTranscript(transcript: string): void {
    if (this.currentUserTranscriptId) {
      const entry = this.transcriptEntries.find((e) => e.id === this.currentUserTranscriptId);
      if (entry) {
        entry.text = transcript;
        entry.isStreaming = false;
      }
      this.currentUserTranscriptId = null;
    } else {
      // No streaming entry, create a new one
      this.transcriptEntries.push({
        id: crypto.randomUUID(),
        role: 'user',
        text: transcript,
        timestamp: Date.now(),
        isStreaming: false,
      });
    }

    this.callbacks.onTranscriptUpdate([...this.transcriptEntries]);

    // Check if agent is done speaking and transition to listening
    if (this.state === 'agent_speaking' && !this.audioPlayback?.isPlaybackActive()) {
      this.setState('listening');
    }
  }

  /**
   * Get current state
   */
  getState(): VoiceServiceState {
    return this.state;
  }

  /**
   * Get transcript entries
   */
  getTranscript(): TranscriptEntry[] {
    return [...this.transcriptEntries];
  }

  /**
   * Clear transcript
   */
  clearTranscript(): void {
    this.transcriptEntries = [];
    this.callbacks.onTranscriptUpdate([]);
  }

  /**
   * Check if session is active
   */
  isActive(): boolean {
    return this.state !== 'idle' && this.state !== 'error';
  }

  /**
   * Convert Float32Array audio samples to PCM16
   */
  private floatToPCM16(float32Array: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }

  /**
   * Convert ArrayBuffer to Base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
