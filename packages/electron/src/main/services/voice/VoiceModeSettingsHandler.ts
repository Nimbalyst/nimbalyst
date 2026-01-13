/**
 * IPC handlers for Voice Mode settings
 */

import Store from 'electron-store';
import { safeHandle } from '../../utils/ipcRegistry';

interface SystemPromptConfig {
  prepend?: string;
  append?: string;
}

interface VoiceModeSettings {
  enabled: boolean;
  voice?: 'marin' | 'cedar';
  showTranscription?: boolean;
  // System prompt customization for voice agent (GPT-4 Realtime)
  voiceAgentPrompt?: SystemPromptConfig;
  // System prompt customization for coding agent (Claude) during voice mode
  codingAgentPrompt?: SystemPromptConfig;
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
        voice: 'marin',
        showTranscription: true,
      };
    } catch (error) {
      console.error('[VoiceModeSettings] Failed to get settings', { error });
      return {
        enabled: false,
        voice: 'marin',
        showTranscription: true,
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
