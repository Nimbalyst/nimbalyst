/**
 * App Settings Atoms
 *
 * Global application settings stored via Jotai atoms.
 * These settings are persisted via IPC to electron-store.
 *
 * Phase 1: Voice Mode Settings
 * - Fixes the bug where VoiceModeButton doesn't update when settings change
 * - Both SettingsView and VoiceModeButton subscribe to the same atom
 *
 * Key principles:
 * - Single source of truth for settings that affect multiple components
 * - Debounced writes to avoid excessive IPC traffic
 * - Derived atoms for easy consumption
 * - Setter atoms that update and trigger persist
 */

import { atom } from 'jotai';
import posthog from 'posthog-js';

// Voice type - all available OpenAI Realtime voices
export type VoiceId = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar';

export interface TurnDetectionConfig {
  mode: 'server_vad' | 'push_to_talk';
  vadThreshold?: number;
  silenceDuration?: number;
  interruptible?: boolean;
}

export interface SystemPromptConfig {
  prepend?: string;
  append?: string;
}

export interface VoiceModeSettings {
  enabled: boolean;
  voice: VoiceId;
  showTranscription: boolean;
  turnDetection: TurnDetectionConfig;
  voiceAgentPrompt: SystemPromptConfig;
  codingAgentPrompt: SystemPromptConfig;
  submitDelayMs: number;
}

/**
 * Default voice mode settings.
 */
const defaultVoiceModeSettings: VoiceModeSettings = {
  enabled: false,
  voice: 'alloy',
  showTranscription: true,
  turnDetection: {
    mode: 'server_vad',
    vadThreshold: 0.5,
    silenceDuration: 500,
    interruptible: true,
  },
  voiceAgentPrompt: {},
  codingAgentPrompt: {},
  submitDelayMs: 3000,
};

/**
 * The main voice mode settings atom.
 * Should be initialized from IPC on app load.
 */
export const voiceModeSettingsAtom = atom<VoiceModeSettings>(defaultVoiceModeSettings);

/**
 * Debounce timer for persistence.
 */
let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 1000;

/**
 * Persist voice mode settings to main process.
 * Debounced to avoid excessive IPC calls during rapid changes.
 */
function schedulePersist(settings: VoiceModeSettings): void {
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
  }
  persistDebounceTimer = setTimeout(() => {
    persistDebounceTimer = null;
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.invoke('voice-mode:set-settings', settings);
    }
  }, PERSIST_DEBOUNCE_MS);
}

// === Derived read-only atoms (slices) ===

/**
 * Voice mode enabled state.
 * Use this in components that only need to know if voice mode is enabled.
 */
export const voiceModeEnabledAtom = atom(
  (get) => get(voiceModeSettingsAtom).enabled
);

/**
 * Show transcription setting.
 */
export const showTranscriptionAtom = atom(
  (get) => get(voiceModeSettingsAtom).showTranscription
);

/**
 * Selected voice.
 */
export const selectedVoiceAtom = atom(
  (get) => get(voiceModeSettingsAtom).voice
);

/**
 * Turn detection config.
 */
export const turnDetectionAtom = atom(
  (get) => get(voiceModeSettingsAtom).turnDetection
);

// === Setter atoms ===

/**
 * Set voice mode settings (partial update).
 * Merges with existing settings and triggers persist.
 */
export const setVoiceModeSettingsAtom = atom(
  null,
  (get, set, updates: Partial<VoiceModeSettings>) => {
    const current = get(voiceModeSettingsAtom);
    const newSettings = { ...current, ...updates };

    // Track when voice mode is enabled/disabled
    if (updates.enabled !== undefined && updates.enabled !== current.enabled) {
      posthog.capture(updates.enabled ? 'voice_mode_enabled' : 'voice_mode_disabled');
    }

    set(voiceModeSettingsAtom, newSettings);
    schedulePersist(newSettings);
  }
);

/**
 * Toggle voice mode enabled.
 */
export const toggleVoiceModeEnabledAtom = atom(
  null,
  (get, set, enabled: boolean) => {
    const current = get(voiceModeSettingsAtom);
    const newSettings = { ...current, enabled };
    set(voiceModeSettingsAtom, newSettings);
    schedulePersist(newSettings);
  }
);

/**
 * Set turn detection config (partial update).
 */
export const setTurnDetectionAtom = atom(
  null,
  (get, set, updates: Partial<TurnDetectionConfig>) => {
    const current = get(voiceModeSettingsAtom);
    const newTurnDetection = { ...current.turnDetection, ...updates };
    const newSettings = { ...current, turnDetection: newTurnDetection };
    set(voiceModeSettingsAtom, newSettings);
    schedulePersist(newSettings);
  }
);

/**
 * Initialize voice mode settings from IPC.
 * Call this once at app startup.
 */
export async function initVoiceModeSettings(): Promise<VoiceModeSettings> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return defaultVoiceModeSettings;
  }

  try {
    await window.electronAPI.invoke('voice-mode:init');
    const settings = await window.electronAPI.invoke('voice-mode:get-settings');

    if (settings) {
      return {
        enabled: settings.enabled || false,
        voice: settings.voice || 'alloy',
        showTranscription: settings.showTranscription !== false,
        turnDetection: settings.turnDetection || defaultVoiceModeSettings.turnDetection,
        voiceAgentPrompt: settings.voiceAgentPrompt || {},
        codingAgentPrompt: settings.codingAgentPrompt || {},
        submitDelayMs: settings.submitDelayMs ?? 3000,
      };
    }
  } catch (error) {
    console.error('[appSettings] Failed to load voice mode settings:', error);
  }

  return defaultVoiceModeSettings;
}
