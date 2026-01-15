/**
 * IPC handlers for Voice Mode settings
 */

import Store from 'electron-store';
import { safeHandle } from '../../utils/ipcRegistry';

interface SystemPromptConfig {
  prepend?: string;
  append?: string;
}

interface TurnDetectionConfig {
  // 'server_vad' for automatic voice activity detection, 'push_to_talk' for manual
  mode: 'server_vad' | 'push_to_talk';
  // VAD threshold (0.0 to 1.0) - higher = less sensitive, requires louder speech
  vadThreshold?: number;
  // How long to wait (ms) after speech stops before processing (100-2000ms)
  silenceDuration?: number;
  // Whether user can interrupt the assistant while it's speaking
  interruptible?: boolean;
}

// All available OpenAI Realtime API voices
type VoiceId = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar';

interface VoiceModeSettings {
  enabled: boolean;
  voice?: VoiceId;
  showTranscription?: boolean;
  // Turn detection / VAD settings
  turnDetection?: TurnDetectionConfig;
  // System prompt customization for voice agent (GPT-4 Realtime)
  voiceAgentPrompt?: SystemPromptConfig;
  // System prompt customization for coding agent (Claude) during voice mode
  codingAgentPrompt?: SystemPromptConfig;
  // Delay before auto-submitting voice commands (0-10000ms, default 3000)
  submitDelayMs?: number;
}

export function initVoiceModeSettingsHandler() {
  // Voice mode settings are stored in nimbalyst-settings (app settings)
  // NOT ai-settings (AI provider API keys)
  const settingsStore = new Store<Record<string, unknown>>({
    name: 'nimbalyst-settings',
    watch: true,
  });

  /**
   * Get voice mode settings
   */
  safeHandle('voice-mode:get-settings', async () => {
    try {
      const settings = settingsStore.get('voiceMode') as VoiceModeSettings | undefined;
      return settings || {
        enabled: false,
        voice: 'alloy',
        showTranscription: true,
        submitDelayMs: 3000,
      };
    } catch (error) {
      console.error('[VoiceModeSettings] Failed to get settings', { error });
      return {
        enabled: false,
        voice: 'alloy',
        showTranscription: true,
        submitDelayMs: 3000,
      };
    }
  });

  /**
   * Set voice mode settings
   */
  safeHandle('voice-mode:set-settings', async (_event, settings: VoiceModeSettings) => {
    try {
      settingsStore.set('voiceMode', settings);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
