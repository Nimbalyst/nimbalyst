/**
 * Atoms for Claude Code usage tracking
 *
 * These atoms store the current usage data from Anthropic's API,
 * including 5-hour session and 7-day weekly utilization percentages.
 */

import { atom } from 'jotai';

export interface ClaudeUsageWindow {
  utilization: number; // 0-100 percentage
  resetsAt: string | null; // ISO timestamp
}

export interface ClaudeUsageData {
  fiveHour: ClaudeUsageWindow;
  sevenDay: ClaudeUsageWindow;
  sevenDayOpus?: ClaudeUsageWindow;
  lastUpdated: number; // Unix timestamp
  error?: string;
}

/**
 * Current Claude usage data from the API.
 * Updated by the centralized IPC listener when main process sends updates.
 */
export const claudeUsageAtom = atom<ClaudeUsageData | null>(null);

/**
 * Whether the usage indicator is enabled (user preference).
 * Defaults to true - user can disable it in the popover or settings.
 * Persisted via AI settings.
 */
export const claudeUsageIndicatorEnabledAtom = atom<boolean>(true);

/**
 * Debounce timer for persistence.
 */
let usageIndicatorPersistTimer: ReturnType<typeof setTimeout> | null = null;
const USAGE_INDICATOR_PERSIST_DEBOUNCE_MS = 500;

/**
 * Persist usage indicator setting to main process.
 */
function scheduleUsageIndicatorPersist(enabled: boolean): void {
  if (usageIndicatorPersistTimer) {
    clearTimeout(usageIndicatorPersistTimer);
  }
  usageIndicatorPersistTimer = setTimeout(async () => {
    usageIndicatorPersistTimer = null;
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        const currentSettings = await window.electronAPI.aiGetSettings();
        await window.electronAPI.aiSaveSettings({
          ...currentSettings,
          showUsageIndicator: enabled,
        });
      } catch (error) {
        console.error('[claudeUsageAtoms] Failed to save usage indicator setting:', error);
      }
    }
  }, USAGE_INDICATOR_PERSIST_DEBOUNCE_MS);
}

/**
 * Setter atom for usage indicator enabled state.
 * Updates the atom and persists to IPC.
 */
export const setClaudeUsageIndicatorEnabledAtom = atom(
  null,
  (_get, set, enabled: boolean) => {
    set(claudeUsageIndicatorEnabledAtom, enabled);
    scheduleUsageIndicatorPersist(enabled);
  }
);

/**
 * Initialize usage indicator setting from IPC.
 * Call this once at app startup.
 */
export async function initClaudeUsageIndicatorSetting(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return false;
  }

  try {
    const settings = await window.electronAPI.aiGetSettings();
    // Default to true if setting hasn't been explicitly set
    return settings?.showUsageIndicator ?? true;
  } catch (error) {
    console.error('[claudeUsageAtoms] Failed to load usage indicator setting:', error);
  }

  return true;
}

/**
 * Derived atom: whether usage data is available to display.
 * Shows the indicator whenever we have received any usage payload from main process.
 * Error payloads still render the indicator so users can hover/click for the reason.
 */
export const claudeUsageAvailableAtom = atom((get) => {
  const usage = get(claudeUsageAtom);
  return Boolean(usage);
});

/**
 * Derived atom: color for the session (5-hour) indicator
 */
export const claudeUsageSessionColorAtom = atom((get) => {
  const usage = get(claudeUsageAtom);
  if (!usage) return 'muted';
  const util = usage.fiveHour.utilization;
  if (util >= 80) return 'red';
  if (util >= 50) return 'yellow';
  return 'green';
});

/**
 * Derived atom: color for the weekly (7-day) indicator
 */
export const claudeUsageWeeklyColorAtom = atom((get) => {
  const usage = get(claudeUsageAtom);
  if (!usage) return 'muted';
  const util = usage.sevenDay.utilization;
  if (util >= 80) return 'red';
  if (util >= 50) return 'yellow';
  return 'green';
});

/**
 * Helper to format reset time as human-readable string
 */
export function formatResetTime(resetsAt: string | null): string {
  if (!resetsAt) return 'Unknown';

  const resetDate = new Date(resetsAt);
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();

  if (diffMs < 0) return 'Now';

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    const remainingHours = diffHours % 24;
    return `${diffDays}d ${remainingHours}h`;
  }
  if (diffHours > 0) {
    const remainingMinutes = diffMinutes % 60;
    return `${diffHours}h ${remainingMinutes}m`;
  }
  return `${diffMinutes}m`;
}
