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

import { atom, type Atom } from 'jotai';
import posthog from 'posthog-js';
import { AlphaFeatureTag } from '../../../shared/alphaFeatures';
import { DeveloperFeatureTag, DEVELOPER_FEATURES, getDefaultDeveloperFeatures, enableAllDeveloperFeatures, disableAllDeveloperFeatures, areAllDeveloperFeaturesEnabled } from '../../../shared/developerFeatures';

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

// ============================================================================
// PHASE 2: Notification Settings
// ============================================================================

export type CompletionSoundType = 'chime' | 'bell' | 'pop' | 'none';

export interface NotificationSettings {
  completionSoundEnabled: boolean;
  completionSoundType: CompletionSoundType;
  osNotificationsEnabled: boolean;
  /** Show OS notifications even when app is focused, unless viewing that session */
  notifyWhenFocused: boolean;
  /** Show OS notifications when a session needs user input (permission, question, etc.) */
  sessionBlockedNotificationsEnabled: boolean;
}

/**
 * Default notification settings.
 */
const defaultNotificationSettings: NotificationSettings = {
  completionSoundEnabled: false,
  completionSoundType: 'chime',
  osNotificationsEnabled: false,
  notifyWhenFocused: false,
  sessionBlockedNotificationsEnabled: true,
};

/**
 * The main notification settings atom.
 * Should be initialized from IPC on app load.
 */
export const notificationSettingsAtom = atom<NotificationSettings>(defaultNotificationSettings);

/**
 * Debounce timer for notification settings persistence.
 */
let notificationPersistTimer: ReturnType<typeof setTimeout> | null = null;
const NOTIFICATION_PERSIST_DEBOUNCE_MS = 500;

/**
 * Persist notification settings to main process.
 * Debounced to avoid excessive IPC calls during rapid changes.
 */
function scheduleNotificationPersist(settings: NotificationSettings): void {
  if (notificationPersistTimer) {
    clearTimeout(notificationPersistTimer);
  }
  notificationPersistTimer = setTimeout(async () => {
    notificationPersistTimer = null;
    if (typeof window !== 'undefined' && window.electronAPI) {
      await window.electronAPI.invoke('completion-sound:set-enabled', settings.completionSoundEnabled);
      await window.electronAPI.invoke('completion-sound:set-type', settings.completionSoundType);
      await window.electronAPI.invoke('notifications:set-enabled', settings.osNotificationsEnabled);
      await window.electronAPI.invoke('notifications:set-notify-when-focused', settings.notifyWhenFocused);
      await window.electronAPI.invoke('notifications:set-blocked-enabled', settings.sessionBlockedNotificationsEnabled);
    }
  }, NOTIFICATION_PERSIST_DEBOUNCE_MS);
}

// === Derived read-only atoms (slices) ===

/**
 * Completion sound enabled state.
 */
export const completionSoundEnabledAtom = atom(
  (get) => get(notificationSettingsAtom).completionSoundEnabled
);

/**
 * Completion sound type.
 */
export const completionSoundTypeAtom = atom(
  (get) => get(notificationSettingsAtom).completionSoundType
);

/**
 * OS notifications enabled state.
 */
export const osNotificationsEnabledAtom = atom(
  (get) => get(notificationSettingsAtom).osNotificationsEnabled
);

/**
 * Notify when focused (unless viewing that session).
 */
export const notifyWhenFocusedAtom = atom(
  (get) => get(notificationSettingsAtom).notifyWhenFocused
);

/**
 * Session blocked notifications enabled state.
 */
export const sessionBlockedNotificationsEnabledAtom = atom(
  (get) => get(notificationSettingsAtom).sessionBlockedNotificationsEnabled
);

// === Setter atoms ===

/**
 * Set notification settings (partial update).
 * Merges with existing settings and triggers persist.
 */
export const setNotificationSettingsAtom = atom(
  null,
  (get, set, updates: Partial<NotificationSettings>) => {
    const current = get(notificationSettingsAtom);
    const newSettings = { ...current, ...updates };
    set(notificationSettingsAtom, newSettings);
    scheduleNotificationPersist(newSettings);
  }
);

/**
 * Initialize notification settings from IPC.
 * Call this once at app startup.
 */
export async function initNotificationSettings(): Promise<NotificationSettings> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return defaultNotificationSettings;
  }

  try {
    const [soundEnabled, soundType, osNotifEnabled, notifyFocused, blockedEnabled] = await Promise.all([
      window.electronAPI.invoke('completion-sound:is-enabled'),
      window.electronAPI.invoke('completion-sound:get-type'),
      window.electronAPI.invoke('notifications:get-enabled'),
      window.electronAPI.invoke('notifications:get-notify-when-focused'),
      window.electronAPI.invoke('notifications:get-blocked-enabled'),
    ]);

    return {
      completionSoundEnabled: soundEnabled ?? false,
      completionSoundType: soundType ?? 'chime',
      osNotificationsEnabled: osNotifEnabled ?? false,
      notifyWhenFocused: notifyFocused ?? false,
      sessionBlockedNotificationsEnabled: blockedEnabled ?? true,
    };
  } catch (error) {
    console.error('[appSettings] Failed to load notification settings:', error);
  }

  return defaultNotificationSettings;
}

// ============================================================================
// PHASE 3: Advanced Settings
// ============================================================================

export type ReleaseChannel = 'stable' | 'alpha';

export interface AdvancedSettings {
  releaseChannel: ReleaseChannel;
  analyticsEnabled: boolean;
  extensionDevToolsEnabled: boolean;
  walkthroughsEnabled: boolean;
  walkthroughsViewedCount: number;
  walkthroughsTotalCount: number;
  // V8 heap memory limit in MB (default: 4096). Requires restart to take effect.
  maxHeapSizeMB: number;
  // Alpha feature flags - individual control over alpha features
  // Uses Record<AlphaFeatureTag, boolean> for dynamic feature registration
  alphaFeatures: Record<AlphaFeatureTag, boolean>;
  // Whether to automatically enable all new alpha features
  enableAllAlphaFeatures: boolean;
  // Custom directories to add to PATH (colon-separated on Unix, semicolon-separated on Windows)
  customPathDirs: string;
}

/**
 * Default advanced settings.
 */
const defaultAdvancedSettings: AdvancedSettings = {
  releaseChannel: 'stable',
  analyticsEnabled: true,
  extensionDevToolsEnabled: false,
  walkthroughsEnabled: true,
  walkthroughsViewedCount: 0,
  walkthroughsTotalCount: 0,
  maxHeapSizeMB: 4096,
  alphaFeatures: {
    sync: false,
    'voice-mode': false,
    'claude-plugins': false,
    'card-mode': false,
  } as Record<AlphaFeatureTag, boolean>,
  enableAllAlphaFeatures: false,
  customPathDirs: '',
};

/**
 * The main advanced settings atom.
 * Should be initialized from IPC on app load.
 */
export const advancedSettingsAtom = atom<AdvancedSettings>(defaultAdvancedSettings);

/**
 * Debounce timer for advanced settings persistence.
 */
let advancedPersistTimer: ReturnType<typeof setTimeout> | null = null;
const ADVANCED_PERSIST_DEBOUNCE_MS = 500;

/**
 * Persist advanced settings to main process.
 * Each setting has its own IPC endpoint, so we call them individually.
 * Debounced to avoid excessive IPC calls during rapid changes.
 */
function scheduleAdvancedPersist(
  settings: AdvancedSettings,
  changedKeys: (keyof AdvancedSettings)[]
): void {
  if (advancedPersistTimer) {
    clearTimeout(advancedPersistTimer);
  }
  advancedPersistTimer = setTimeout(async () => {
    advancedPersistTimer = null;
    if (typeof window === 'undefined' || !window.electronAPI) return;

    // Only persist the settings that changed
    for (const key of changedKeys) {
      switch (key) {
        case 'releaseChannel':
          await window.electronAPI.invoke('release-channel:set', settings.releaseChannel);
          break;
        case 'analyticsEnabled':
          await window.electronAPI.invoke('analytics:set-enabled', settings.analyticsEnabled);
          break;
        case 'extensionDevToolsEnabled':
          await window.electronAPI.extensionDevTools.setEnabled(settings.extensionDevToolsEnabled);
          break;
        case 'walkthroughsEnabled':
          await window.electronAPI.invoke('walkthroughs:set-enabled', settings.walkthroughsEnabled);
          break;
        case 'maxHeapSizeMB':
          await window.electronAPI.invoke('app-settings:set', 'maxHeapSizeMB', settings.maxHeapSizeMB);
          break;
        case 'alphaFeatures':
          await window.electronAPI.invoke('alpha-features:set', settings.alphaFeatures);
          break;
        case 'enableAllAlphaFeatures':
          await window.electronAPI.invoke('alpha-features:set-enable-all', settings.enableAllAlphaFeatures);
          break;
        case 'customPathDirs':
          await window.electronAPI.invoke('app-settings:set', 'customPathDirs', settings.customPathDirs);
          break;
        // walkthroughsViewedCount and walkthroughsTotalCount are read-only from main process
      }
    }
  }, ADVANCED_PERSIST_DEBOUNCE_MS);
}

// === Derived read-only atoms (slices) ===

/**
 * Release channel setting.
 */
export const releaseChannelAtom = atom(
  (get) => get(advancedSettingsAtom).releaseChannel
);

/**
 * Analytics enabled setting.
 */
export const analyticsEnabledAtom = atom(
  (get) => get(advancedSettingsAtom).analyticsEnabled
);

/**
 * Extension dev tools enabled setting.
 */
export const extensionDevToolsEnabledAtom = atom(
  (get) => get(advancedSettingsAtom).extensionDevToolsEnabled
);

/**
 * Walkthroughs enabled setting.
 */
export const walkthroughsEnabledAtom = atom(
  (get) => get(advancedSettingsAtom).walkthroughsEnabled
);

/**
 * Walkthroughs viewed count (read-only from main process).
 */
export const walkthroughsViewedCountAtom = atom(
  (get) => get(advancedSettingsAtom).walkthroughsViewedCount
);

/**
 * Walkthroughs total count (read-only from main process).
 */
export const walkthroughsTotalCountAtom = atom(
  (get) => get(advancedSettingsAtom).walkthroughsTotalCount
);

/**
 * Check if a specific alpha feature is enabled by tag.
 * This is the recommended way to check feature availability.
 *
 * This is an atom family pattern: a function that returns atoms dynamically.
 * Each call with a unique tag returns the SAME cached atom instance, which
 * is critical for React/Jotai stability (avoids infinite re-renders).
 *
 * Why use a function instead of declaring atoms directly:
 * - The registry can grow over time (new features added)
 * - Type safety: AlphaFeatureTag is derived from the registry
 * - Avoids manually declaring 20+ individual atoms
 * - Each unique tag gets its own reactive atom instance
 *
 * @example
 * ```ts
 * const isSyncEnabled = useAtomValue(alphaFeatureEnabledAtom('sync'));
 * if (isSyncEnabled) {
 *   // Show sync feature
 * }
 * ```
 */
const alphaFeatureAtomCache = new Map<AlphaFeatureTag, Atom<boolean>>();

export function alphaFeatureEnabledAtom(tag: AlphaFeatureTag): Atom<boolean> {
  let cached = alphaFeatureAtomCache.get(tag);
  if (!cached) {
    cached = atom(
      (get) => get(advancedSettingsAtom).alphaFeatures[tag] ?? false
    );
    alphaFeatureAtomCache.set(tag, cached);
  }
  return cached;
}

/**
 * Alpha feature: Sync enabled (convenience atom)
 */
export const alphaSyncEnabledAtom = alphaFeatureEnabledAtom('sync');

/**
 * Alpha feature: Voice mode enabled (convenience atom)
 */
export const alphaVoiceModeEnabledAtom = alphaFeatureEnabledAtom('voice-mode');

/**
 * Alpha feature: Claude plugins enabled (convenience atom)
 */
export const alphaClaudePluginsEnabledAtom = alphaFeatureEnabledAtom('claude-plugins');

/**
 * V8 heap memory limit in MB.
 */
export const maxHeapSizeMBAtom = atom(
  (get) => get(advancedSettingsAtom).maxHeapSizeMB
);

/**
 * Custom PATH directories.
 */
export const customPathDirsAtom = atom(
  (get) => get(advancedSettingsAtom).customPathDirs
);

// === Setter atoms ===

/**
 * Set advanced settings (partial update).
 * Merges with existing settings and triggers persist for changed keys only.
 */
export const setAdvancedSettingsAtom = atom(
  null,
  (get, set, updates: Partial<AdvancedSettings>) => {
    const current = get(advancedSettingsAtom);
    const newSettings = { ...current, ...updates };
    set(advancedSettingsAtom, newSettings);

    // Determine which keys changed for targeted persistence
    const changedKeys = (Object.keys(updates) as (keyof AdvancedSettings)[]).filter(
      (key) => updates[key] !== current[key]
    );
    if (changedKeys.length > 0) {
      scheduleAdvancedPersist(newSettings, changedKeys);
    }
  }
);

/**
 * Reset walkthroughs - special action that calls IPC and updates atom.
 */
export const resetWalkthroughsAtom = atom(null, async (get, set) => {
  if (typeof window !== 'undefined' && window.electronAPI) {
    await window.electronAPI.invoke('walkthroughs:reset');
  }
  const current = get(advancedSettingsAtom);
  set(advancedSettingsAtom, { ...current, walkthroughsViewedCount: 0 });
});

/**
 * Initialize advanced settings from IPC.
 * Call this once at app startup.
 */
export async function initAdvancedSettings(): Promise<AdvancedSettings> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return defaultAdvancedSettings;
  }

  try {
    const [channel, analyticsEnabled, extensionDevToolsEnabled, walkthroughState, maxHeapSizeMB, alphaFeatures, enableAllAlphaFeatures, customPathDirs] =
      await Promise.all([
        window.electronAPI.invoke('release-channel:get'),
        window.electronAPI.invoke('analytics:is-enabled'),
        window.electronAPI.extensionDevTools.isEnabled(),
        window.electronAPI.invoke('walkthroughs:get-state'),
        window.electronAPI.invoke('app-settings:get', 'maxHeapSizeMB'),
        window.electronAPI.invoke('alpha-features:get'),
        window.electronAPI.invoke('alpha-features:get-enable-all'),
        window.electronAPI.invoke('app-settings:get', 'customPathDirs'),
      ]);

    // Calculate viewed count (completed + dismissed)
    const walkthroughsViewedCount =
      (walkthroughState?.completed?.length ?? 0) + (walkthroughState?.dismissed?.length ?? 0);
    const walkthroughsTotalCount = walkthroughState?.totalCount ?? 0;

    return {
      releaseChannel: channel ?? 'stable',
      analyticsEnabled: analyticsEnabled ?? true,
      extensionDevToolsEnabled: extensionDevToolsEnabled ?? false,
      walkthroughsEnabled: walkthroughState?.enabled ?? true,
      walkthroughsViewedCount,
      walkthroughsTotalCount,
      maxHeapSizeMB: maxHeapSizeMB ?? 4096,
      alphaFeatures: alphaFeatures ?? defaultAdvancedSettings.alphaFeatures,
      enableAllAlphaFeatures: enableAllAlphaFeatures ?? false,
      customPathDirs: customPathDirs ?? '',
    };
  } catch (error) {
    console.error('[appSettings] Failed to load advanced settings:', error);
  }

  return defaultAdvancedSettings;
}

// ============================================================================
// PHASE 4: Sync Settings
// ============================================================================

export interface SyncConfig {
  enabled: boolean;
  serverUrl: string;
  enabledProjects?: string[]; // workspace paths that are enabled for sync
  environment?: 'development' | 'production'; // dev only: override environment
  idleTimeoutMinutes?: number; // minutes before user is considered idle (default: 5)
}

/**
 * Default sync settings.
 * All optional fields have explicit defaults to handle old persisted data.
 */
const defaultSyncConfig: SyncConfig = {
  enabled: false,
  serverUrl: '',
  enabledProjects: [],
  environment: undefined, // Intentionally undefined (only set in dev)
  idleTimeoutMinutes: 5,
};

/**
 * The main sync config atom.
 * Should be initialized from IPC on app load.
 */
export const syncConfigAtom = atom<SyncConfig>(defaultSyncConfig);

/**
 * Debounce timer for sync config persistence.
 */
let syncPersistTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_PERSIST_DEBOUNCE_MS = 500;

/**
 * Persist sync config to main process.
 * Debounced to avoid excessive IPC calls during rapid changes.
 */
function scheduleSyncPersist(config: SyncConfig): void {
  if (syncPersistTimer) {
    clearTimeout(syncPersistTimer);
  }
  syncPersistTimer = setTimeout(async () => {
    syncPersistTimer = null;
    if (typeof window !== 'undefined' && window.electronAPI) {
      // Save null if disabled to clear the config
      await window.electronAPI.invoke('sync:set-config', config.enabled ? config : null);
    }
  }, SYNC_PERSIST_DEBOUNCE_MS);
}

// === Derived read-only atoms (slices) ===

/**
 * Sync enabled state.
 */
export const syncEnabledAtom = atom((get) => get(syncConfigAtom).enabled);

/**
 * Sync server URL.
 */
export const syncServerUrlAtom = atom((get) => get(syncConfigAtom).serverUrl);

/**
 * Enabled projects for sync.
 */
export const syncEnabledProjectsAtom = atom((get) => get(syncConfigAtom).enabledProjects ?? []);

/**
 * Idle timeout in minutes (default 5).
 */
export const syncIdleTimeoutMinutesAtom = atom((get) => get(syncConfigAtom).idleTimeoutMinutes ?? 5);

// === Setter atoms ===

/**
 * Set sync config (partial update).
 * Merges with existing config and triggers persist.
 */
export const setSyncConfigAtom = atom(
  null,
  (get, set, updates: Partial<SyncConfig>) => {
    const current = get(syncConfigAtom);
    const newConfig = { ...current, ...updates };
    set(syncConfigAtom, newConfig);
    scheduleSyncPersist(newConfig);
  }
);

/**
 * Initialize sync config from IPC.
 * Call this once at app startup.
 */
export async function initSyncConfig(): Promise<SyncConfig> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return defaultSyncConfig;
  }

  try {
    const config = await window.electronAPI.invoke('sync:get-config');
    if (config) {
      // Merge with defaults to ensure all fields have values even when loading old persisted data
      return {
        enabled: config.enabled ?? defaultSyncConfig.enabled,
        serverUrl: config.serverUrl ?? defaultSyncConfig.serverUrl,
        enabledProjects: config.enabledProjects ?? defaultSyncConfig.enabledProjects,
        environment: config.environment ?? defaultSyncConfig.environment,
        idleTimeoutMinutes: config.idleTimeoutMinutes ?? defaultSyncConfig.idleTimeoutMinutes,
      };
    }
  } catch (error) {
    console.error('[appSettings] Failed to load sync config:', error);
  }

  return defaultSyncConfig;
}

// ============================================================================
// PHASE 5: AI Debug Settings
// ============================================================================

export interface AIDebugSettings {
  showToolCalls: boolean;
  aiDebugLogging: boolean;
  showPromptAdditions: boolean;
}

/**
 * Default AI debug settings.
 */
const defaultAIDebugSettings: AIDebugSettings = {
  showToolCalls: false,
  aiDebugLogging: false,
  showPromptAdditions: false,
};

/**
 * The main AI debug settings atom.
 * These are dev-only settings for debugging AI interactions.
 * Should be initialized from IPC on app load.
 */
export const aiDebugSettingsAtom = atom<AIDebugSettings>(defaultAIDebugSettings);

/**
 * Debounce timer for AI debug settings persistence.
 */
let aiDebugPersistTimer: ReturnType<typeof setTimeout> | null = null;
const AI_DEBUG_PERSIST_DEBOUNCE_MS = 500;

/**
 * Persist AI debug settings to main process.
 * These are saved as part of AI settings.
 */
function scheduleAIDebugPersist(settings: AIDebugSettings): void {
  if (aiDebugPersistTimer) {
    clearTimeout(aiDebugPersistTimer);
  }
  aiDebugPersistTimer = setTimeout(async () => {
    aiDebugPersistTimer = null;
    if (typeof window !== 'undefined' && window.electronAPI) {
      // We need to load existing AI settings and merge just the debug fields
      try {
        const currentSettings = await window.electronAPI.aiGetSettings();
        await window.electronAPI.aiSaveSettings({
          ...currentSettings,
          showToolCalls: settings.showToolCalls,
          aiDebugLogging: settings.aiDebugLogging,
          showPromptAdditions: settings.showPromptAdditions,
        });
      } catch (error) {
        console.error('[appSettings] Failed to save AI debug settings:', error);
      }
    }
  }, AI_DEBUG_PERSIST_DEBOUNCE_MS);
}

// === Derived read-only atoms (slices) ===

/**
 * Show tool calls setting.
 */
export const showToolCallsAtom = atom((get) => get(aiDebugSettingsAtom).showToolCalls);

/**
 * AI debug logging setting.
 */
export const aiDebugLoggingAtom = atom((get) => get(aiDebugSettingsAtom).aiDebugLogging);

/**
 * Show prompt additions setting.
 */
export const showPromptAdditionsAtom = atom((get) => get(aiDebugSettingsAtom).showPromptAdditions);

// === Setter atoms ===

/**
 * Set AI debug settings (partial update).
 * Merges with existing settings and triggers persist.
 */
export const setAIDebugSettingsAtom = atom(
  null,
  (get, set, updates: Partial<AIDebugSettings>) => {
    const current = get(aiDebugSettingsAtom);
    const newSettings = { ...current, ...updates };
    set(aiDebugSettingsAtom, newSettings);
    scheduleAIDebugPersist(newSettings);
  }
);

/**
 * Initialize AI debug settings from IPC.
 * Call this once at app startup.
 */
export async function initAIDebugSettings(): Promise<AIDebugSettings> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return defaultAIDebugSettings;
  }

  try {
    const settings = await window.electronAPI.aiGetSettings();
    return {
      showToolCalls: settings?.showToolCalls ?? false,
      aiDebugLogging: settings?.aiDebugLogging ?? false,
      showPromptAdditions: settings?.showPromptAdditions ?? false,
    };
  } catch (error) {
    console.error('[appSettings] Failed to load AI debug settings:', error);
  }

  return defaultAIDebugSettings;
}

// ============================================================================
// PHASE 5a: Agent Mode Settings (Default Model)
// ============================================================================

export interface AgentModeSettings {
  /** The last model selected by the user in agent mode, used as default for new sessions */
  defaultModel: string;
}

/**
 * Default agent mode settings.
 */
const defaultAgentModeSettings: AgentModeSettings = {
  defaultModel: 'claude-code:opus',
};

/**
 * The main agent mode settings atom.
 * Should be initialized from IPC on app load.
 */
export const agentModeSettingsAtom = atom<AgentModeSettings>(defaultAgentModeSettings);

/**
 * Debounce timer for agent mode settings persistence.
 */
let agentModePersistTimer: ReturnType<typeof setTimeout> | null = null;
const AGENT_MODE_PERSIST_DEBOUNCE_MS = 500;

/**
 * Persist agent mode settings to main process.
 */
function scheduleAgentModePersist(settings: AgentModeSettings): void {
  if (agentModePersistTimer) {
    clearTimeout(agentModePersistTimer);
  }
  console.log('[appSettings] Scheduling persist of defaultModel:', settings.defaultModel);
  agentModePersistTimer = setTimeout(async () => {
    agentModePersistTimer = null;
    if (typeof window !== 'undefined' && window.electronAPI) {
      console.log('[appSettings] Persisting defaultModel to main process:', settings.defaultModel);
      await window.electronAPI.invoke('settings:set-default-ai-model', settings.defaultModel);
    }
  }, AGENT_MODE_PERSIST_DEBOUNCE_MS);
}

// === Derived read-only atoms (slices) ===

/**
 * Default model for new agent sessions.
 */
export const defaultAgentModelAtom = atom((get) => get(agentModeSettingsAtom).defaultModel);

// === Setter atoms ===

/**
 * Set agent mode settings (partial update).
 * Merges with existing settings and triggers persist.
 */
export const setAgentModeSettingsAtom = atom(
  null,
  (get, set, updates: Partial<AgentModeSettings>) => {
    const current = get(agentModeSettingsAtom);
    const newSettings = { ...current, ...updates };
    set(agentModeSettingsAtom, newSettings);
    scheduleAgentModePersist(newSettings);
  }
);

/**
 * Initialize agent mode settings from IPC.
 * Call this once at app startup.
 */
export async function initAgentModeSettings(): Promise<AgentModeSettings> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    console.log('[appSettings] initAgentModeSettings: No window/electronAPI, using defaults');
    return defaultAgentModeSettings;
  }

  try {
    const defaultModel = await window.electronAPI.invoke('settings:get-default-ai-model');
    console.log('[appSettings] initAgentModeSettings: Loaded from main process:', defaultModel);
    const result = {
      defaultModel: defaultModel || defaultAgentModeSettings.defaultModel,
    };
    console.log('[appSettings] initAgentModeSettings: Returning:', result.defaultModel);
    return result;
  } catch (error) {
    console.error('[appSettings] Failed to load agent mode settings:', error);
  }

  console.log('[appSettings] initAgentModeSettings: Using defaults');
  return defaultAgentModeSettings;
}

// ============================================================================
// PHASE 5b: AI Provider Settings
// ============================================================================

/**
 * Provider configuration stored in AI settings.
 * This mirrors the ProviderConfig interface in SettingsView but is the source of truth.
 */
export interface ProviderConfig {
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
  testStatus?: 'idle' | 'testing' | 'success' | 'error';
  testMessage?: string;
  installed?: boolean;
  version?: string;
  updateAvailable?: boolean;
  installStatus?: 'not-installed' | 'installing' | 'installed' | 'error';
  authMethod?: string;
}

/**
 * Model definition for available models.
 */
export interface AIModel {
  id: string;
  name: string;
  provider: string;
}

/**
 * Full AI provider settings structure.
 */
export interface AIProviderSettings {
  providers: Record<string, ProviderConfig>;
  apiKeys: Record<string, string>;
  availableModels: Record<string, AIModel[]>;
}

/**
 * Default provider configurations.
 */
const defaultProviders: Record<string, ProviderConfig> = {
  claude: { enabled: false, testStatus: 'idle' },
  'claude-code': { enabled: true, testStatus: 'idle', installStatus: 'not-installed' },
  openai: { enabled: false, testStatus: 'idle' },
  'openai-codex': { enabled: false, testStatus: 'idle', installStatus: 'not-installed' },
  lmstudio: { enabled: false, baseUrl: 'http://127.0.0.1:8234', testStatus: 'idle' },
};

/**
 * Default API keys.
 */
const defaultApiKeys: Record<string, string> = {
  anthropic: '',
  openai: '',
  lmstudio_url: 'http://127.0.0.1:8234',
};

/**
 * Default AI provider settings.
 */
const defaultAIProviderSettings: AIProviderSettings = {
  providers: defaultProviders,
  apiKeys: defaultApiKeys,
  availableModels: {},
};

/**
 * The main AI provider settings atom.
 * Should be initialized from IPC on app load.
 */
export const aiProviderSettingsAtom = atom<AIProviderSettings>(defaultAIProviderSettings);

/**
 * Debounce timer for AI provider settings persistence.
 */
let aiProviderPersistTimer: ReturnType<typeof setTimeout> | null = null;
const AI_PROVIDER_PERSIST_DEBOUNCE_MS = 500;

/**
 * Persist AI provider settings to main process.
 * Debounced to avoid excessive IPC calls during rapid changes.
 */
function scheduleAIProviderPersist(settings: AIProviderSettings): void {
  if (aiProviderPersistTimer) {
    clearTimeout(aiProviderPersistTimer);
  }
  aiProviderPersistTimer = setTimeout(async () => {
    aiProviderPersistTimer = null;
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        // Get current debug settings to preserve them
        const currentSettings = await window.electronAPI.aiGetSettings();
        await window.electronAPI.aiSaveSettings({
          apiKeys: settings.apiKeys,
          providerSettings: settings.providers,
          showToolCalls: currentSettings?.showToolCalls ?? false,
          aiDebugLogging: currentSettings?.aiDebugLogging ?? false,
        });
      } catch (error) {
        console.error('[appSettings] Failed to save AI provider settings:', error);
      }
    }
  }, AI_PROVIDER_PERSIST_DEBOUNCE_MS);
}

// === Derived read-only atoms (slices) ===

/**
 * Provider configurations.
 */
export const providersAtom = atom((get) => get(aiProviderSettingsAtom).providers);

/**
 * API keys.
 */
export const apiKeysAtom = atom((get) => get(aiProviderSettingsAtom).apiKeys);

/**
 * Available models per provider.
 */
export const availableModelsAtom = atom((get) => get(aiProviderSettingsAtom).availableModels);

/**
 * Get enabled providers.
 */
export const enabledProvidersAtom = atom((get) => {
  const providers = get(aiProviderSettingsAtom).providers;
  return Object.entries(providers)
    .filter(([_, config]) => config.enabled)
    .map(([id]) => id);
});

/**
 * Get a specific provider's config.
 */
export const getProviderConfigAtom = (providerId: string) =>
  atom((get) => get(aiProviderSettingsAtom).providers[providerId]);

/**
 * Get a specific API key.
 */
export const getApiKeyAtom = (keyName: string) =>
  atom((get) => get(aiProviderSettingsAtom).apiKeys[keyName] ?? '');

// === Setter atoms ===

/**
 * Set AI provider settings (partial update).
 * Merges with existing settings and triggers persist.
 */
export const setAIProviderSettingsAtom = atom(
  null,
  (get, set, updates: Partial<AIProviderSettings>) => {
    const current = get(aiProviderSettingsAtom);
    const newSettings = {
      ...current,
      ...updates,
      providers: updates.providers ? { ...current.providers, ...updates.providers } : current.providers,
      apiKeys: updates.apiKeys ? { ...current.apiKeys, ...updates.apiKeys } : current.apiKeys,
      availableModels: updates.availableModels
        ? { ...current.availableModels, ...updates.availableModels }
        : current.availableModels,
    };
    set(aiProviderSettingsAtom, newSettings);
    scheduleAIProviderPersist(newSettings);
  }
);

/**
 * Update a single provider's config.
 */
export const setProviderConfigAtom = atom(
  null,
  (get, set, { providerId, config }: { providerId: string; config: Partial<ProviderConfig> }) => {
    const current = get(aiProviderSettingsAtom);
    const newSettings = {
      ...current,
      providers: {
        ...current.providers,
        [providerId]: { ...current.providers[providerId], ...config },
      },
    };
    set(aiProviderSettingsAtom, newSettings);
    scheduleAIProviderPersist(newSettings);
  }
);

/**
 * Update a single API key.
 */
export const setApiKeyAtom = atom(
  null,
  (get, set, { keyName, value }: { keyName: string; value: string }) => {
    const current = get(aiProviderSettingsAtom);
    const newSettings = {
      ...current,
      apiKeys: {
        ...current.apiKeys,
        [keyName]: value,
      },
    };
    set(aiProviderSettingsAtom, newSettings);
    scheduleAIProviderPersist(newSettings);
  }
);

/**
 * Update available models for a provider (no persistence - this is cached data).
 */
export const setAvailableModelsAtom = atom(
  null,
  (get, set, { providerId, models }: { providerId: string; models: AIModel[] }) => {
    const current = get(aiProviderSettingsAtom);
    set(aiProviderSettingsAtom, {
      ...current,
      availableModels: {
        ...current.availableModels,
        [providerId]: models,
      },
    });
    // Note: Available models are NOT persisted - they're fetched from APIs
  }
);

/**
 * Initialize AI provider settings from IPC.
 * Call this once at app startup.
 */
export async function initAIProviderSettings(): Promise<AIProviderSettings> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return defaultAIProviderSettings;
  }

  try {
    const settings = await window.electronAPI.aiGetSettings();
    const providers = { ...defaultProviders };
    const apiKeys = { ...defaultApiKeys };

    // Merge loaded provider settings
    if (settings?.providerSettings) {
      Object.entries(settings.providerSettings).forEach(([key, value]: [string, any]) => {
        if (providers[key]) {
          providers[key] = { ...providers[key], ...value };
        }
      });
    }

    // Merge loaded API keys
    if (settings?.apiKeys) {
      Object.assign(apiKeys, settings.apiKeys);
    }

    return {
      providers,
      apiKeys,
      availableModels: {}, // Models are fetched separately, not persisted
    };
  } catch (error) {
    console.error('[appSettings] Failed to load AI provider settings:', error);
  }

  return defaultAIProviderSettings;
}

// ============================================================================
// PHASE 6: Workspace Settings (Atom Families)
// ============================================================================

/**
 * Provider override for a single provider in a workspace.
 */
export interface ProviderOverride {
  enabled?: boolean;
  models?: string[];
  defaultModel?: string;
  apiKey?: string;
}

/**
 * AI provider overrides for a workspace.
 */
export interface AIProviderOverrides {
  defaultProvider?: string;
  providers?: Record<string, ProviderOverride>;
}

/**
 * Workspace AI settings state including loading status.
 */
export interface WorkspaceAISettingsState {
  overrides: AIProviderOverrides;
  loading: boolean;
  error: string | null;
}

/**
 * Default workspace AI settings state.
 */
const defaultWorkspaceAISettingsState: WorkspaceAISettingsState = {
  overrides: {},
  loading: true,
  error: null,
};

/**
 * Cache for workspace AI settings atoms.
 * Using a Map for O(1) lookup by workspace path.
 */
const workspaceAISettingsCache = new Map<string, ReturnType<typeof atom<WorkspaceAISettingsState>>>();

/**
 * Atom family for workspace AI settings.
 * Each workspace has its own atom storing provider overrides.
 *
 * Usage:
 * ```ts
 * const settingsAtom = workspaceAISettingsAtomFamily(workspacePath);
 * const [settings, setSettings] = useAtom(settingsAtom);
 * ```
 */
export function workspaceAISettingsAtomFamily(workspacePath: string) {
  if (!workspaceAISettingsCache.has(workspacePath)) {
    workspaceAISettingsCache.set(workspacePath, atom<WorkspaceAISettingsState>(defaultWorkspaceAISettingsState));
  }
  return workspaceAISettingsCache.get(workspacePath)!;
}

/**
 * Load workspace AI settings from IPC.
 * Call this when a workspace is opened or when settings need to be refreshed.
 */
export async function loadWorkspaceAISettings(workspacePath: string): Promise<WorkspaceAISettingsState> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return { ...defaultWorkspaceAISettingsState, loading: false };
  }

  try {
    const result = await window.electronAPI.invoke('ai:getProjectSettings', workspacePath);
    if (result.success && result.overrides) {
      return {
        overrides: result.overrides,
        loading: false,
        error: null,
      };
    }
    return { overrides: {}, loading: false, error: null };
  } catch (error) {
    console.error('[appSettings] Failed to load workspace AI settings:', error);
    return {
      overrides: {},
      loading: false,
      error: error instanceof Error ? error.message : 'Failed to load workspace AI settings',
    };
  }
}

/**
 * Save workspace AI settings to IPC.
 */
export async function saveWorkspaceAISettings(workspacePath: string, overrides: AIProviderOverrides): Promise<void> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return;
  }

  try {
    await window.electronAPI.invoke('ai:saveProjectSettings', workspacePath, overrides);
  } catch (error) {
    console.error('[appSettings] Failed to save workspace AI settings:', error);
    throw error;
  }
}

/**
 * Setter atom for workspace AI settings.
 * Updates the atom and persists to IPC.
 */
export function setWorkspaceAISettingsAtomFamily(workspacePath: string) {
  return atom(
    null,
    async (get, set, updates: Partial<AIProviderOverrides>) => {
      const settingsAtom = workspaceAISettingsAtomFamily(workspacePath);
      const current = get(settingsAtom);
      const newOverrides = {
        ...current.overrides,
        ...updates,
        providers: updates.providers
          ? { ...current.overrides.providers, ...updates.providers }
          : current.overrides.providers,
      };
      set(settingsAtom, { ...current, overrides: newOverrides });
      await saveWorkspaceAISettings(workspacePath, newOverrides);
    }
  );
}

// ============================================================================
// Workspace Permissions (Agent Permissions)
// ============================================================================

/**
 * Pattern rule for allowed/denied commands.
 */
export interface PatternRule {
  pattern: string;
  displayName: string;
  addedAt: number;
}

/**
 * Additional directory that the agent can access.
 */
export interface AdditionalDirectory {
  path: string;
  addedAt: number;
}

/**
 * Allowed URL pattern for web fetch.
 */
export interface AllowedUrlPattern {
  pattern: string;
  description: string;
  addedAt: number;
}

/**
 * Permission mode for a workspace.
 */
export type PermissionMode = 'ask' | 'allow-all' | 'bypass-all';

/**
 * Full permissions state for a workspace.
 */
export interface WorkspacePermissionsState {
  trustedAt?: number;
  permissionMode: PermissionMode | null;
  allowedPatterns: PatternRule[];
  additionalDirectories: AdditionalDirectory[];
  allowedUrlPatterns: AllowedUrlPattern[];
  loading: boolean;
  error: string | null;
}

/**
 * Default workspace permissions state.
 */
const defaultWorkspacePermissionsState: WorkspacePermissionsState = {
  permissionMode: null,
  allowedPatterns: [],
  additionalDirectories: [],
  allowedUrlPatterns: [],
  loading: true,
  error: null,
};

/**
 * Cache for workspace permissions atoms.
 */
const workspacePermissionsCache = new Map<string, ReturnType<typeof atom<WorkspacePermissionsState>>>();

/**
 * Atom family for workspace permissions.
 * Each workspace has its own atom storing permission settings.
 *
 * Usage:
 * ```ts
 * const permissionsAtom = workspacePermissionsAtomFamily(workspacePath);
 * const [permissions] = useAtom(permissionsAtom);
 * ```
 */
export function workspacePermissionsAtomFamily(workspacePath: string) {
  if (!workspacePermissionsCache.has(workspacePath)) {
    workspacePermissionsCache.set(workspacePath, atom<WorkspacePermissionsState>(defaultWorkspacePermissionsState));
  }
  return workspacePermissionsCache.get(workspacePath)!;
}

/**
 * Load workspace permissions from IPC.
 * Call this when a workspace is opened or when permissions change.
 */
export async function loadWorkspacePermissions(workspacePath: string): Promise<WorkspacePermissionsState> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return { ...defaultWorkspacePermissionsState, loading: false };
  }

  try {
    const result = await window.electronAPI.invoke('permissions:getWorkspacePermissions', workspacePath);
    if (result) {
      return {
        trustedAt: result.trustedAt,
        permissionMode: result.permissionMode,
        allowedPatterns: result.allowedPatterns || [],
        additionalDirectories: result.additionalDirectories || [],
        allowedUrlPatterns: result.allowedUrlPatterns || [],
        loading: false,
        error: null,
      };
    }
    return { ...defaultWorkspacePermissionsState, loading: false };
  } catch (error) {
    console.error('[appSettings] Failed to load workspace permissions:', error);
    return {
      ...defaultWorkspacePermissionsState,
      loading: false,
      error: error instanceof Error ? error.message : 'Failed to load workspace permissions',
    };
  }
}

/**
 * Refresh action atom for workspace permissions.
 * Use this to reload permissions after changes.
 */
export function refreshWorkspacePermissionsAtomFamily(workspacePath: string) {
  return atom(null, async (get, set) => {
    const permissionsAtom = workspacePermissionsAtomFamily(workspacePath);
    set(permissionsAtom, { ...get(permissionsAtom), loading: true });
    const newState = await loadWorkspacePermissions(workspacePath);
    set(permissionsAtom, newState);
  });
}

// ============================================================================
// PHASE 7: Developer Feature Settings
// ============================================================================

export interface DeveloperFeatureSettings {
  /** Whether developer mode is enabled globally */
  developerMode: boolean;
  /** Individual feature toggles (only checked when developerMode is true) */
  developerFeatures: Record<DeveloperFeatureTag, boolean>;
}

/**
 * Default developer feature settings.
 * All features are enabled by default when developer mode is on.
 */
const defaultDeveloperFeatureSettings: DeveloperFeatureSettings = {
  developerMode: false,
  developerFeatures: getDefaultDeveloperFeatures(),
};

/**
 * The main developer feature settings atom.
 * Should be initialized from IPC on app load.
 */
export const developerFeatureSettingsAtom = atom<DeveloperFeatureSettings>(defaultDeveloperFeatureSettings);

/**
 * Debounce timer for developer feature settings persistence.
 */
let developerFeaturePersistTimer: ReturnType<typeof setTimeout> | null = null;
const DEVELOPER_FEATURE_PERSIST_DEBOUNCE_MS = 500;

/**
 * Persist developer feature settings to main process.
 * Each setting has its own IPC endpoint, so we call them individually.
 */
function scheduleDeveloperFeaturePersist(
  settings: DeveloperFeatureSettings,
  changedKeys: (keyof DeveloperFeatureSettings)[]
): void {
  if (developerFeaturePersistTimer) {
    clearTimeout(developerFeaturePersistTimer);
  }
  developerFeaturePersistTimer = setTimeout(async () => {
    developerFeaturePersistTimer = null;
    if (typeof window === 'undefined' || !window.electronAPI) return;

    for (const key of changedKeys) {
      switch (key) {
        case 'developerMode':
          await window.electronAPI.invoke('developer-mode:set', settings.developerMode);
          break;
        case 'developerFeatures':
          await window.electronAPI.invoke('developer-features:set', settings.developerFeatures);
          break;
      }
    }
  }, DEVELOPER_FEATURE_PERSIST_DEBOUNCE_MS);
}

// === Derived read-only atoms (slices) ===

/**
 * Developer mode enabled state.
 */
export const developerModeAtom = atom(
  (get) => get(developerFeatureSettingsAtom).developerMode
);

/**
 * All developer features configuration.
 */
export const developerFeaturesAtom = atom(
  (get) => get(developerFeatureSettingsAtom).developerFeatures
);

/**
 * Check if a specific developer feature is available.
 * Feature is available if developer mode is enabled AND the specific feature is enabled.
 *
 * This is an atom family pattern: a function that returns atoms dynamically.
 * Each call with a unique tag returns the SAME cached atom instance.
 *
 * @example
 * ```ts
 * const isWorktreesAvailable = useAtomValue(developerFeatureAvailableAtom('worktrees'));
 * if (isWorktreesAvailable) {
 *   // Show worktree feature
 * }
 * ```
 */
const developerFeatureAtomCache = new Map<DeveloperFeatureTag, Atom<boolean>>();

export function developerFeatureAvailableAtom(tag: DeveloperFeatureTag): Atom<boolean> {
  let cached = developerFeatureAtomCache.get(tag);
  if (!cached) {
    cached = atom(
      (get) => {
        const settings = get(developerFeatureSettingsAtom);
        return settings.developerMode && (settings.developerFeatures[tag] ?? false);
      }
    );
    developerFeatureAtomCache.set(tag, cached);
  }
  return cached;
}

/**
 * Developer feature: Worktrees available (convenience atom)
 */
export const worktreesFeatureAvailableAtom = developerFeatureAvailableAtom('worktrees');

/**
 * Developer feature: Terminal available (convenience atom)
 */
export const terminalFeatureAvailableAtom = developerFeatureAvailableAtom('terminal');

// === Setter atoms ===

/**
 * Set developer feature settings (partial update).
 * Merges with existing settings and triggers persist for changed keys only.
 */
export const setDeveloperFeatureSettingsAtom = atom(
  null,
  (get, set, updates: Partial<DeveloperFeatureSettings>) => {
    const current = get(developerFeatureSettingsAtom);
    const newSettings = { ...current, ...updates };
    set(developerFeatureSettingsAtom, newSettings);

    // Determine which keys changed for targeted persistence
    const changedKeys = (Object.keys(updates) as (keyof DeveloperFeatureSettings)[]).filter(
      (key) => updates[key] !== current[key]
    );
    if (changedKeys.length > 0) {
      scheduleDeveloperFeaturePersist(newSettings, changedKeys);
    }
  }
);

/**
 * Initialize developer feature settings from IPC.
 * Call this once at app startup.
 */
export async function initDeveloperFeatureSettings(): Promise<DeveloperFeatureSettings> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return defaultDeveloperFeatureSettings;
  }

  try {
    const [developerMode, developerFeatures] = await Promise.all([
      window.electronAPI.invoke('developer-mode:get'),
      window.electronAPI.invoke('developer-features:get'),
    ]);

    return {
      developerMode: developerMode ?? false,
      developerFeatures: developerFeatures ?? defaultDeveloperFeatureSettings.developerFeatures,
    };
  } catch (error) {
    console.error('[appSettings] Failed to load developer feature settings:', error);
  }

  return defaultDeveloperFeatureSettings;
}

// Re-export developer feature helpers for use in UI
export { DEVELOPER_FEATURES, areAllDeveloperFeaturesEnabled, enableAllDeveloperFeatures, disableAllDeveloperFeatures };

// ============================================================================
// PHASE 8: External Editor Settings
// ============================================================================

/**
 * External editor type options.
 * 'none' means no external editor is configured.
 */
export type ExternalEditorType = 'none' | 'vscode' | 'cursor' | 'webstorm' | 'sublime' | 'vim' | 'nvim' | 'custom';

/**
 * Display names for external editors.
 */
export const EXTERNAL_EDITOR_NAMES: Record<ExternalEditorType, string> = {
  none: 'None',
  vscode: 'VS Code',
  cursor: 'Cursor',
  webstorm: 'WebStorm',
  sublime: 'Sublime Text',
  vim: 'Vim',
  nvim: 'Neovim',
  custom: 'Custom',
};

/**
 * External editor settings.
 */
export interface ExternalEditorSettings {
  editorType: ExternalEditorType;
  customPath?: string;
}

/**
 * Default external editor settings.
 */
const defaultExternalEditorSettings: ExternalEditorSettings = {
  editorType: 'none',
  customPath: '',
};

/**
 * The main external editor settings atom.
 * Should be initialized from IPC on app load.
 */
export const externalEditorSettingsAtom = atom<ExternalEditorSettings>(defaultExternalEditorSettings);

/**
 * Debounce timer for external editor settings persistence.
 */
let externalEditorPersistTimer: ReturnType<typeof setTimeout> | null = null;
const EXTERNAL_EDITOR_PERSIST_DEBOUNCE_MS = 500;

/**
 * Persist external editor settings to main process.
 */
function scheduleExternalEditorPersist(settings: ExternalEditorSettings): void {
  if (externalEditorPersistTimer) {
    clearTimeout(externalEditorPersistTimer);
  }
  externalEditorPersistTimer = setTimeout(async () => {
    externalEditorPersistTimer = null;
    if (typeof window !== 'undefined' && window.electronAPI) {
      await window.electronAPI.invoke('external-editor:set-settings', settings);
    }
  }, EXTERNAL_EDITOR_PERSIST_DEBOUNCE_MS);
}

// === Derived read-only atoms (slices) ===

/**
 * External editor type.
 */
export const externalEditorTypeAtom = atom(
  (get) => get(externalEditorSettingsAtom).editorType
);

/**
 * Custom external editor path.
 */
export const externalEditorCustomPathAtom = atom(
  (get) => get(externalEditorSettingsAtom).customPath
);

/**
 * Whether an external editor is configured.
 */
export const hasExternalEditorAtom = atom(
  (get) => get(externalEditorSettingsAtom).editorType !== 'none'
);

// === Setter atoms ===

/**
 * Set external editor settings (partial update).
 * Merges with existing settings and triggers persist.
 */
export const setExternalEditorSettingsAtom = atom(
  null,
  (get, set, updates: Partial<ExternalEditorSettings>) => {
    const current = get(externalEditorSettingsAtom);
    const newSettings = { ...current, ...updates };
    set(externalEditorSettingsAtom, newSettings);
    scheduleExternalEditorPersist(newSettings);
  }
);

/**
 * Initialize external editor settings from IPC.
 * Call this once at app startup.
 */
export async function initExternalEditorSettings(): Promise<ExternalEditorSettings> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return defaultExternalEditorSettings;
  }

  try {
    const settings = await window.electronAPI.invoke('external-editor:get-settings');
    if (settings) {
      return {
        editorType: settings.editorType ?? defaultExternalEditorSettings.editorType,
        customPath: settings.customPath ?? defaultExternalEditorSettings.customPath,
      };
    }
  } catch (error) {
    console.error('[appSettings] Failed to load external editor settings:', error);
  }

  return defaultExternalEditorSettings;
}

/**
 * Derived atom for the external editor display name.
 * Returns undefined if no editor is configured.
 */
export const externalEditorNameAtom = atom((get) => {
  const editorType = get(externalEditorTypeAtom);
  if (editorType === 'none') return undefined;
  return EXTERNAL_EDITOR_NAMES[editorType];
});

// ============================================================================
// FILE ACTIONS
// Action atoms for common file operations. Components can use these directly
// without prop drilling callbacks.
// ============================================================================

/**
 * Action atom to open a file in the configured external editor.
 * No-op if no external editor is configured.
 */
export const openInExternalEditorAtom = atom(
  null,
  async (get, _set, filePath: string) => {
    const hasEditor = get(hasExternalEditorAtom);
    if (!hasEditor) return;

    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        await window.electronAPI.openInExternalEditor(filePath);
      } catch (error) {
        console.error('[appSettings] Failed to open in external editor:', error);
      }
    }
  }
);

/**
 * Action atom to reveal a file in the system file browser (Finder on macOS).
 */
export const revealInFinderAtom = atom(
  null,
  async (_get, _set, filePath: string) => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        await window.electronAPI.invoke('show-in-finder', filePath);
      } catch (error) {
        console.error('[appSettings] Failed to reveal in finder:', error);
      }
    }
  }
);

/**
 * Action atom to copy a file path to the clipboard.
 */
export const copyFilePathAtom = atom(
  null,
  async (_get, _set, filePath: string) => {
    try {
      await navigator.clipboard.writeText(filePath);
    } catch (error) {
      console.error('[appSettings] Failed to copy path to clipboard:', error);
    }
  }
);
