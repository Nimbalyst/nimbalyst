import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { getSoundPlayer } from '../../../services/SoundPlayer';
import { SettingsToggle } from '../SettingsToggle';
import {
  notificationSettingsAtom,
  setNotificationSettingsAtom,
  type CompletionSoundType,
} from '../../../store/atoms/appSettings';

/**
 * NotificationsPanel - Self-contained settings panel for notifications.
 *
 * This component subscribes directly to Jotai atoms instead of receiving props.
 * Changes are automatically persisted via the setter atom.
 */
export function NotificationsPanel() {
  const [settings] = useAtom(notificationSettingsAtom);
  const [, updateSettings] = useAtom(setNotificationSettingsAtom);
  const [isTestPlaying, setIsTestPlaying] = useState(false);
  const [notificationHelp, setNotificationHelp] = useState<string | null>(null);

  const { completionSoundEnabled, completionSoundType, osNotificationsEnabled, notifyWhenFocused } = settings;

  // Set up IPC listener for sound playback
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handlePlaySound = (soundType: string) => {
      console.log('[NotificationsPanel] Received play-completion-sound event:', soundType);
      const soundPlayer = getSoundPlayer();
      soundPlayer.playSound(soundType as CompletionSoundType).catch(err => {
        console.error('[NotificationsPanel] Failed to play sound:', err);
      });
    };

    const cleanup = window.electronAPI.on('play-completion-sound', handlePlaySound);

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  const handleTestSound = async () => {
    if (!window.electronAPI) return;

    setIsTestPlaying(true);
    try {
      await window.electronAPI.invoke('completion-sound:test', completionSoundType);
    } catch (error) {
      console.error('Failed to test sound:', error);
    } finally {
      setTimeout(() => setIsTestPlaying(false), 500);
    }
  };

  const handleTestNotification = async () => {
    if (!window.electronAPI) return;

    const result = await window.electronAPI.invoke('notifications:show-test');
    if (result?.success) {
      setNotificationHelp('A test notification was sent. If you do not see it, open your OS notification settings and allow Nimbalyst notifications.');
    } else {
      setNotificationHelp(result?.error || 'Failed to show a test notification.');
    }
  };

  const handleOpenNotificationSettings = async () => {
    if (!window.electronAPI) return;

    const result = await window.electronAPI.invoke('notifications:open-system-settings');
    if (!result?.success) {
      setNotificationHelp(result?.error || 'Failed to open system notification settings.');
    }
  };

  return (
    <div className="provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">Notifications</h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          Configure audio and visual notifications for AI interactions.
        </p>
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Completion Sounds</h4>
        <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
          Play a sound when the AI or agent completes a turn and is ready for more input.
        </p>

        <SettingsToggle
          checked={completionSoundEnabled}
          onChange={(checked) => updateSettings({ completionSoundEnabled: checked })}
          name="Enable Completion Sounds"
          description="Play an audio notification when AI chat or agent completes a response."
        />

        {completionSoundEnabled && (
          <div className="setting-item py-3 mt-4">
            <div className="setting-text flex flex-col gap-0.5">
              <span className="setting-name text-sm font-medium text-[var(--nim-text)]">Sound Type</span>
              <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                Choose the sound to play when a response completes.
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {(['chime', 'bell', 'pop'] as CompletionSoundType[]).map((sound) => (
                <label key={sound} className="setting-radio-label flex items-center gap-2 cursor-pointer text-sm text-[var(--nim-text)]">
                  <input
                    type="radio"
                    name="sound-type"
                    value={sound}
                    checked={completionSoundType === sound}
                    onChange={(e) => updateSettings({ completionSoundType: e.target.value as CompletionSoundType })}
                    className="setting-radio w-4 h-4 cursor-pointer shrink-0 accent-[var(--nim-primary)]"
                  />
                  <span className="capitalize">{sound}</span>
                </label>
              ))}
            </div>
            <button
              onClick={handleTestSound}
              disabled={isTestPlaying}
              className="nim-btn-secondary text-sm mt-3"
            >
              {isTestPlaying ? 'Playing...' : 'Test Sound'}
            </button>
          </div>
        )}
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">OS Notifications</h4>
        <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
          Show system notifications when AI responses complete while the app is in the background.
        </p>

        <SettingsToggle
          checked={osNotificationsEnabled}
          onChange={(checked) => {
            updateSettings({ osNotificationsEnabled: checked });
            if (checked) {
              void handleTestNotification();
            } else {
              setNotificationHelp(null);
            }
          }}
          name="Enable OS Notifications"
          description="Native system notifications when AI completes a response. Respects Do Not Disturb."
        />

        {osNotificationsEnabled && (
          <>
            <SettingsToggle
              checked={notifyWhenFocused}
              onChange={(checked) => updateSettings({ notifyWhenFocused: checked })}
              name="Notify Even When Focused"
              description="Show notifications even when the app is focused, unless viewing that session."
            />

            <div className="setting-item py-3">
              <div className="setting-text flex flex-col gap-2">
                <span className="setting-description text-xs leading-relaxed text-[var(--nim-text-muted)]">
                  Electron does not expose a reliable cross-platform notification permission state here.
                  Use a test notification to trigger the OS prompt or verify delivery.
                </span>
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleTestNotification} className="nim-btn-secondary text-sm">
                    Send Test Notification
                  </button>
                  <button onClick={handleOpenNotificationSettings} className="nim-btn-secondary text-sm">
                    Open System Notification Settings
                  </button>
                </div>
                {notificationHelp && (
                  <span className="text-xs leading-relaxed text-[var(--nim-text-muted)]">{notificationHelp}</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-base font-semibold mb-3 text-[var(--nim-text)]">Session Blocked Notifications</h4>
        <p className="text-sm leading-relaxed text-[var(--nim-text-muted)] mb-4">
          Show system notifications when an AI session needs your input.
        </p>

        <SettingsToggle
          checked={settings.sessionBlockedNotificationsEnabled}
          onChange={(checked) => updateSettings({ sessionBlockedNotificationsEnabled: checked })}
          name="Notify When Session Needs Attention"
          description="Notify when a session is waiting for input (permissions, questions, plan reviews, commits)."
        />
      </div>
    </div>
  );
}
