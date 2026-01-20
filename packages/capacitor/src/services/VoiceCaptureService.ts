/**
 * Voice Capture Service for Mobile
 *
 * Handles microphone audio capture and transcription via OpenAI Realtime API.
 * Designed for mobile use with battery-conscious defaults.
 */

import { RealtimeTranscriptionClient } from './RealtimeTranscriptionClient';

// Audio capture constants (must match OpenAI Realtime API requirements)
const SAMPLE_RATE = 24000; // 24kHz required by OpenAI
const BUFFER_SIZE = 4096;

interface VoiceCaptureCallbacks {
  onTranscriptComplete: (transcript: string) => void;
  onError: (error: Error) => void;
  onRecordingStateChange?: (isRecording: boolean) => void;
}

interface CaptureOptions {
  vadThreshold?: number;
  silenceDurationMs?: number;
}

export class VoiceCaptureService {
  private apiKey: string;
  private realtimeClient: RealtimeTranscriptionClient | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private callbacks: VoiceCaptureCallbacks;
  private recording: boolean = false;

  constructor(apiKey: string, callbacks: VoiceCaptureCallbacks) {
    this.apiKey = apiKey;
    this.callbacks = callbacks;
  }

  /**
   * Check if microphone permission is granted
   */
  async checkPermission(): Promise<PermissionState> {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return result.state;
    } catch {
      // Fallback for browsers that don't support permission query
      return 'prompt';
    }
  }

  /**
   * Request microphone permission
   */
  async requestPermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the stream immediately - we just needed permission
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      console.error('[VoiceCaptureService] Permission denied:', error);
      return false;
    }
  }

  /**
   * Start capturing audio and transcribing
   */
  async startCapture(options?: CaptureOptions): Promise<void> {
    if (this.recording) {
      console.warn('[VoiceCaptureService] Already recording');
      return;
    }

    try {
      // Initialize Realtime API client
      this.realtimeClient = new RealtimeTranscriptionClient(
        this.apiKey,
        {
          onTranscriptComplete: (transcript) => {
            this.callbacks.onTranscriptComplete(transcript);
          },
          onError: (error) => {
            this.callbacks.onError(new Error(error.message));
          },
          onDisconnect: (reason) => {
            console.log('[VoiceCaptureService] Disconnected:', reason);
            this.stopCapture();
          },
        },
        {
          vadThreshold: options?.vadThreshold ?? 0.5,
          silenceDurationMs: options?.silenceDurationMs ?? 800,
        }
      );

      // Connect to OpenAI
      await this.realtimeClient.connect();

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
      // Note: ScriptProcessorNode is deprecated but AudioWorklet requires more setup
      this.scriptProcessor = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

      this.scriptProcessor.onaudioprocess = (event) => {
        if (!this.recording || !this.realtimeClient?.isConnected()) {
          return;
        }

        const inputData = event.inputBuffer.getChannelData(0);
        const pcm16 = this.floatToPCM16(inputData);
        const base64 = this.arrayBufferToBase64(pcm16.buffer as ArrayBuffer);
        this.realtimeClient.sendAudio(base64);
      };

      // Connect the audio graph
      this.sourceNode.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      this.recording = true;
      this.callbacks.onRecordingStateChange?.(true);

      console.log('[VoiceCaptureService] Recording started');
    } catch (error) {
      console.error('[VoiceCaptureService] Failed to start capture:', error);
      this.cleanup();
      throw error;
    }
  }

  /**
   * Stop capturing audio
   */
  stopCapture(): void {
    if (!this.recording) {
      return;
    }

    this.recording = false;
    this.callbacks.onRecordingStateChange?.(false);

    // Commit any remaining audio before disconnecting
    if (this.realtimeClient?.isConnected()) {
      this.realtimeClient.commitAudio();
    }

    this.cleanup();
    console.log('[VoiceCaptureService] Recording stopped');
  }

  /**
   * Clean up all resources
   */
  private cleanup(): void {
    // Disconnect from OpenAI
    if (this.realtimeClient) {
      this.realtimeClient.disconnect('user_stopped');
      this.realtimeClient = null;
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
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.recording;
  }

  /**
   * Convert Float32Array audio samples to PCM16
   * Float32 range: -1.0 to 1.0
   * PCM16 range: -32768 to 32767
   */
  private floatToPCM16(float32Array: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Clamp to [-1, 1] range
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      // Convert to 16-bit signed integer
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
