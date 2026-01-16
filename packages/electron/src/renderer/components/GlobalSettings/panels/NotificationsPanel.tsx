import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { getSoundPlayer } from '../../../services/SoundPlayer';
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

  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">Notifications</h3>
        <p className="provider-panel-description">
          Configure audio and visual notifications for AI interactions.
        </p>
      </div>

      <div className="provider-panel-section">
        <h4 className="provider-panel-section-title">Completion Sounds</h4>
        <p className="provider-panel-hint">
          Play a sound when the AI or agent completes a turn and is ready for more input.
        </p>

        <div className="setting-item">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={completionSoundEnabled}
              onChange={(e) => updateSettings({ completionSoundEnabled: e.target.checked })}
              className="setting-checkbox"
            />
            <div className="setting-text">
              <span className="setting-name">Enable Completion Sounds</span>
              <span className="setting-description">
                Play an audio notification when AI chat or agentic panel completes a response.
              </span>
            </div>
          </label>
        </div>

        {completionSoundEnabled && (
          <div className="setting-item" style={{ marginTop: '16px' }}>
            <div className="setting-text">
              <span className="setting-name">Sound Type</span>
              <span className="setting-description">
                Choose the sound to play when a response completes.
              </span>
            </div>
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(['chime', 'bell', 'pop'] as CompletionSoundType[]).map((sound) => (
                <label key={sound} className="setting-radio-label">
                  <input
                    type="radio"
                    name="sound-type"
                    value={sound}
                    checked={completionSoundType === sound}
                    onChange={(e) => updateSettings({ completionSoundType: e.target.value as CompletionSoundType })}
                    className="setting-radio"
                  />
                  <span style={{ textTransform: 'capitalize' }}>{sound}</span>
                </label>
              ))}
            </div>
            <button
              onClick={handleTestSound}
              disabled={isTestPlaying}
              className="button-test-sound"
              style={{
                marginTop: '12px',
                padding: '8px 16px',
                borderRadius: '4px',
                border: '1px solid var(--border-primary)',
                background: 'var(--surface-secondary)',
                color: 'var(--text-primary)',
                cursor: isTestPlaying ? 'default' : 'pointer',
                opacity: isTestPlaying ? 0.6 : 1
              }}
            >
              {isTestPlaying ? 'Playing...' : 'Test Sound'}
            </button>
          </div>
        )}
      </div>

      <div className="provider-panel-section" style={{ marginTop: '24px' }}>
        <h4 className="provider-panel-section-title">OS Notifications</h4>
        <p className="provider-panel-hint">
          Show system notifications when AI responses complete while the app is in the background.
        </p>

        <div className="setting-item">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={osNotificationsEnabled}
              onChange={(e) => updateSettings({ osNotificationsEnabled: e.target.checked })}
              className="setting-checkbox"
            />
            <div className="setting-text">
              <span className="setting-name">Enable OS Notifications</span>
              <span className="setting-description">
                Display native system notifications when AI completes a response and the app window is not focused.
                Respects system Do Not Disturb settings.
              </span>
            </div>
          </label>
        </div>

        {osNotificationsEnabled && (
          <div className="setting-item" style={{ marginTop: '12px' }}>
            <label className="setting-label">
              <input
                type="checkbox"
                checked={notifyWhenFocused}
                onChange={(e) => updateSettings({ notifyWhenFocused: e.target.checked })}
                className="setting-checkbox"
              />
              <div className="setting-text">
                <span className="setting-name">Notify Even When Focused</span>
                <span className="setting-description">
                  Show notifications even when the app is focused, unless you are already viewing that session.
                  Useful when working in one session and waiting for another to complete.
                </span>
              </div>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
