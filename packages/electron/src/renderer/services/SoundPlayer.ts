import type { CompletionSoundType } from '../../main/utils/store';

export class SoundPlayer {
  private audioContext: AudioContext | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  public async playSound(soundType: CompletionSoundType): Promise<void> {
    console.log('[SoundPlayer] playSound called with type:', soundType);

    if (!this.audioContext) {
      console.warn('[SoundPlayer] AudioContext not available');
      return;
    }

    console.log('[SoundPlayer] AudioContext state:', this.audioContext.state);

    // Resume AudioContext if it's suspended (required by browser autoplay policies)
    if (this.audioContext.state === 'suspended') {
      console.log('[SoundPlayer] Resuming suspended AudioContext');
      await this.audioContext.resume();
    }

    switch (soundType) {
      case 'chime':
        console.log('[SoundPlayer] Playing chime');
        await this.playChime();
        break;
      case 'bell':
        console.log('[SoundPlayer] Playing bell');
        await this.playBell();
        break;
      case 'pop':
        console.log('[SoundPlayer] Playing pop');
        await this.playPop();
        break;
      case 'none':
        // Do nothing
        break;
    }
  }

  private async playChime(): Promise<void> {
    if (!this.audioContext) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Create a gentle chime with two tones
    const frequencies = [800, 1200];
    const duration = 0.3;

    frequencies.forEach((freq, index) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, now);

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.15, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start(now + index * 0.1);
      oscillator.stop(now + duration + index * 0.1);
    });
  }

  private async playBell(): Promise<void> {
    if (!this.audioContext) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Create a bell-like sound with multiple harmonics
    const fundamental = 600;
    const harmonics = [1, 2.4, 3.8, 5.2];
    const duration = 0.5;

    harmonics.forEach((ratio, index) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(fundamental * ratio, now);

      const volume = 0.1 / (index + 1);
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start(now);
      oscillator.stop(now + duration);
    });
  }

  private async playPop(): Promise<void> {
    if (!this.audioContext) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Create a short pop sound
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(400, now);
    oscillator.frequency.exponentialRampToValueAtTime(100, now + 0.1);

    gainNode.gain.setValueAtTime(0.2, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.1);
  }

  public dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// Singleton instance
let soundPlayer: SoundPlayer | null = null;

export function getSoundPlayer(): SoundPlayer {
  if (!soundPlayer) {
    soundPlayer = new SoundPlayer();
  }
  return soundPlayer;
}
