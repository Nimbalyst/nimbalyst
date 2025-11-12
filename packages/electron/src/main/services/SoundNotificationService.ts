import { BrowserWindow } from 'electron';
import { isCompletionSoundEnabled, getCompletionSoundType, CompletionSoundType } from '../utils/store';
import { findWindowByWorkspace } from '../window/WindowManager';

export class SoundNotificationService {
  private static instance: SoundNotificationService;

  private constructor() {}

  public static getInstance(): SoundNotificationService {
    if (!SoundNotificationService.instance) {
      SoundNotificationService.instance = new SoundNotificationService();
    }
    return SoundNotificationService.instance;
  }

  public playCompletionSound(workspacePath: string): void {
    if (!isCompletionSoundEnabled()) {
      // console.log('[SoundNotification] Completion sound disabled, skipping playback');
      return;
    }

    const soundType = getCompletionSoundType();
    if (soundType === 'none') {
      // console.log('[SoundNotification] Sound type is "none", skipping playback');
      return;
    }

    // console.log(`[SoundNotification] Playing completion sound: ${soundType} for workspace:`, workspacePath);

    // REQUIRED: workspacePath must be provided - sessions are tied to workspaces
    if (!workspacePath) {
      throw new Error('workspacePath is required for sound notification routing');
    }

    // Find window by workspace path (the only stable identifier)
    const targetWindow = findWindowByWorkspace(workspacePath);

    if (!targetWindow || targetWindow.isDestroyed()) {
      console.warn('[SoundNotification] No window found for workspace:', workspacePath);
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
