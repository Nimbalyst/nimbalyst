/**
 * Atoms for Codex usage tracking
 *
 * These atoms store usage data parsed from Codex CLI session files,
 * including 5-hour session and weekly utilization percentages.
 * Only populated for subscription users (ChatGPT Plus/Pro).
 */

import { atom } from 'jotai';
import { formatResetTime } from './claudeUsageAtoms';

export { formatResetTime };

export interface CodexUsageData {
  fiveHour: {
    utilization: number; // 0-100 percentage
    resetsAt: string | null; // ISO timestamp
  };
  sevenDay: {
    utilization: number;
    resetsAt: string | null;
  };
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: number | null;
  };
  lastUpdated: number; // Unix timestamp
  error?: string;
}

export const codexUsageAtom = atom<CodexUsageData | null>(null);

export const codexUsageIndicatorEnabledAtom = atom<boolean>(true);

let codexUsageIndicatorPersistTimer: ReturnType<typeof setTimeout> | null = null;
const CODEX_USAGE_INDICATOR_PERSIST_DEBOUNCE_MS = 500;

function scheduleCodexUsageIndicatorPersist(enabled: boolean): void {
  if (codexUsageIndicatorPersistTimer) {
    clearTimeout(codexUsageIndicatorPersistTimer);
  }
  codexUsageIndicatorPersistTimer = setTimeout(async () => {
    codexUsageIndicatorPersistTimer = null;
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        const currentSettings = await window.electronAPI.aiGetSettings();
        await window.electronAPI.aiSaveSettings({
          ...currentSettings,
          showCodexUsageIndicator: enabled,
        });
      } catch (error) {
        console.error('[codexUsageAtoms] Failed to save usage indicator setting:', error);
      }
    }
  }, CODEX_USAGE_INDICATOR_PERSIST_DEBOUNCE_MS);
}

export const setCodexUsageIndicatorEnabledAtom = atom(
  null,
  (_get, set, enabled: boolean) => {
    set(codexUsageIndicatorEnabledAtom, enabled);
    scheduleCodexUsageIndicatorPersist(enabled);
  }
);

export async function initCodexUsageIndicatorSetting(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return false;
  }

  try {
    const settings = await window.electronAPI.aiGetSettings();
    return (settings as Record<string, unknown>)?.showCodexUsageIndicator as boolean ?? true;
  } catch (error) {
    console.error('[codexUsageAtoms] Failed to load usage indicator setting:', error);
  }

  return true;
}

export const codexUsageAvailableAtom = atom((get) => {
  const usage = get(codexUsageAtom);
  if (!usage) return false;
  // Only hide for "no data" errors (API key users or no sessions)
  if (usage.error?.includes('No Codex usage data')) return false;
  // Show if we have actual usage data (utilization or reset times), or credits info.
  const hasUsageData =
    usage.fiveHour.utilization > 0 ||
    usage.sevenDay.utilization > 0 ||
    Boolean(usage.fiveHour.resetsAt) ||
    Boolean(usage.sevenDay.resetsAt);
  const hasCreditsData = Boolean(usage.credits?.hasCredits) || usage.credits?.balance !== null;
  return hasUsageData || hasCreditsData;
});

export const codexUsageSessionColorAtom = atom((get) => {
  const usage = get(codexUsageAtom);
  if (!usage) return 'muted';
  const util = usage.fiveHour.utilization;
  if (util >= 80) return 'red';
  if (util >= 50) return 'yellow';
  return 'green';
});

export const codexUsageWeeklyColorAtom = atom((get) => {
  const usage = get(codexUsageAtom);
  if (!usage) return 'muted';
  const util = usage.sevenDay.utilization;
  if (util >= 80) return 'red';
  if (util >= 50) return 'yellow';
  return 'green';
});
