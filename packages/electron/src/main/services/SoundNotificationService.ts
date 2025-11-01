import { BrowserWindow } from 'electron';
import { isCompletionSoundEnabled, getCompletionSoundType, CompletionSoundType } from '../utils/store';

export class SoundNotificationService {
  private static instance: SoundNotificationService;

  private constructor() {}

  public static getInstance(): SoundNotificationService {
    if (!SoundNotificationService.instance) {
      SoundNotificationService.instance = new SoundNotificationService();
    }
    return SoundNotificationService.instance;
  }

  public playCompletionSound(windowId?: number): void {
    if (!isCompletionSoundEnabled()) {
      console.log('[SoundNotification] Completion sound disabled, skipping playback');
      return;
    }

    const soundType = getCompletionSoundType();
    if (soundType === 'none') {
      console.log('[SoundNotification] Sound type is "none", skipping playback');
      return;
    }

    console.log(`[SoundNotification] Playing completion sound: ${soundType}`);

    // Get the target window or use focused window
    let targetWindow: BrowserWindow | null = null;
    if (windowId) {
      targetWindow = BrowserWindow.fromId(windowId);
    } else {
      targetWindow = BrowserWindow.getFocusedWindow();
    }

    // If no specific window, play on all windows
    if (!targetWindow) {
      const allWindows = BrowserWindow.getAllWindows();
      if (allWindows.length > 0) {
        targetWindow = allWindows[0];
      }
    }

    if (!targetWindow || targetWindow.isDestroyed()) {
      console.warn('[SoundNotification] No valid window found for sound playback');
      return;
    }

    // Send sound playback request to renderer
    targetWindow.webContents.send('play-completion-sound', soundType);
  }

  public testSound(soundType: CompletionSoundType, windowId?: number): void {
    console.log(`[SoundNotification] Testing sound: ${soundType}`);

    let targetWindow: BrowserWindow | null = null;
    if (windowId) {
      targetWindow = BrowserWindow.fromId(windowId);
    } else {
      targetWindow = BrowserWindow.getFocusedWindow();
    }

    if (!targetWindow) {
      const allWindows = BrowserWindow.getAllWindows();
      if (allWindows.length > 0) {
        targetWindow = allWindows[0];
      }
    }

    if (!targetWindow || targetWindow.isDestroyed()) {
      console.warn('[SoundNotification] No valid window found for sound test');
      return;
    }

    targetWindow.webContents.send('play-completion-sound', soundType);
  }
}
