/**
 * Audio playback utility for Voice Mode
 *
 * Plays back PCM16 audio received from OpenAI Realtime API
 */

let instanceCounter = 0;

export class AudioPlayback {
  private audioContext: AudioContext | null = null;
  private audioQueue: AudioBuffer[] = [];
  private isPlaying: boolean = false;
  private scheduledSources: AudioBufferSourceNode[] = [];
  private nextStartTime: number = 0;
  private instanceId: number;

  constructor() {
    this.instanceId = ++instanceCounter;
    // Create audio context with 24kHz sample rate to match input
    this.audioContext = new AudioContext({ sampleRate: 24000 });
  }

  /**
   * Play PCM16 audio chunk
   * @param pcm16Base64 Base64-encoded PCM16 audio data
   */
  async play(pcm16Base64: string): Promise<void> {
    if (!this.audioContext) {
      throw new Error('Audio context not initialized');
    }

    try {
      // Decode base64 to ArrayBuffer
      const pcm16Buffer = this.base64ToArrayBuffer(pcm16Base64);

      // Convert PCM16 (Int16) to Float32
      const int16Array = new Int16Array(pcm16Buffer);
      const float32Array = this.pcm16ToFloat32(int16Array);

      // Create audio buffer
      const audioBuffer = this.audioContext.createBuffer(
        1, // mono
        float32Array.length,
        24000 // 24kHz sample rate
      );

      // Copy data to audio buffer
      audioBuffer.copyToChannel(new Float32Array(float32Array), 0);

      // Add to queue and play
      this.audioQueue.push(audioBuffer);
      this.playQueue();
    } catch (error) {
      console.error('[AudioPlayback] Failed to play audio:', error);
    }
  }

  /**
   * Play queued audio buffers
   */
  private playQueue(): void {
    if (this.audioQueue.length === 0 || !this.audioContext) {
      return;
    }

    if (!this.isPlaying) {
      this.isPlaying = true;
      // Only reset nextStartTime if it's in the past (or hasn't been set)
      if (this.nextStartTime < this.audioContext.currentTime) {
        this.nextStartTime = this.audioContext.currentTime;
      }
    }

    while (this.audioQueue.length > 0) {
      const audioBuffer = this.audioQueue.shift()!;

      // Create source node
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      // Schedule playback
      source.start(this.nextStartTime);

      // Track this scheduled source
      this.scheduledSources.push(source);

      // Update next start time
      this.nextStartTime += audioBuffer.duration;

      // Handle completion
      source.onended = () => {
        // Remove from scheduled sources
        const index = this.scheduledSources.indexOf(source);
        if (index > -1) {
          this.scheduledSources.splice(index, 1);
        }

        if (this.audioQueue.length === 0 && this.scheduledSources.length === 0) {
          this.isPlaying = false;
        }
      };
    }
  }

  /**
   * Stop all audio playback
   */
  stop(): void {
    // Stop ALL scheduled sources, not just the current one
    for (const source of this.scheduledSources) {
      try {
        source.stop();
      } catch (e) {
        // Ignore - may already be stopped
      }
    }

    this.scheduledSources = [];
    this.audioQueue = [];
    this.isPlaying = false;
    this.nextStartTime = 0;
  }

  /**
   * Convert base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes.buffer;
  }

  /**
   * Convert PCM16 (Int16Array) to Float32Array
   */
  private pcm16ToFloat32(int16Array: Int16Array): Float32Array {
    const float32Array = new Float32Array(int16Array.length);

    for (let i = 0; i < int16Array.length; i++) {
      // Convert from 16-bit integer to float (-1 to 1)
      const sample = int16Array[i];
      float32Array[i] = sample < 0 ? sample / 0x8000 : sample / 0x7FFF;
    }

    return float32Array;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Check if currently playing
   */
  isPlaybackActive(): boolean {
    return this.isPlaying;
  }
}
