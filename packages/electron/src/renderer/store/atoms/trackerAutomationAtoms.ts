/**
 * Atoms for tracker automation settings
 *
 * Controls automatic commit-tracker item linking behavior:
 * - Auto-link commits to session's tracker items
 * - Parse issue keys (NIM-123) from commit messages
 * - Auto-close items on Fixes/Closes/Resolves keywords
 * - Agent appends issue keys to commit messages
 *
 * Disabled by default (opt-in). Persisted via AI settings.
 */

import { atom } from 'jotai';

export interface TrackerAutomationSettings {
  enabled: boolean;
  autoLinkCommitsToSessions: boolean;
  parseIssueKeysFromCommits: boolean;
  autoCloseOnCommit: boolean;
  agentAppendIssueKeys: boolean;
}

const DEFAULT_TRACKER_AUTOMATION: TrackerAutomationSettings = {
  enabled: false,
  autoLinkCommitsToSessions: true,
  parseIssueKeysFromCommits: true,
  autoCloseOnCommit: true,
  agentAppendIssueKeys: true,
};

/**
 * Current tracker automation settings.
 * Sub-toggles default to true but only take effect when `enabled` is true.
 */
export const trackerAutomationAtom = atom<TrackerAutomationSettings>({ ...DEFAULT_TRACKER_AUTOMATION });

/**
 * Debounce timer for persistence.
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 500;

function scheduleTrackerAutomationPersist(settings: TrackerAutomationSettings): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        await window.electronAPI.aiSaveSettings({ trackerAutomation: settings });
      } catch (error) {
        console.error('[trackerAutomationAtoms] Failed to save tracker automation settings:', error);
      }
    }
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Setter atom for tracker automation settings.
 * Accepts a partial update, merges with current, and persists.
 */
export const setTrackerAutomationAtom = atom(
  null,
  (get, set, update: Partial<TrackerAutomationSettings>) => {
    const current = get(trackerAutomationAtom);
    const merged = { ...current, ...update };
    set(trackerAutomationAtom, merged);
    scheduleTrackerAutomationPersist(merged);
  }
);

/**
 * Initialize tracker automation settings from IPC.
 * Call once at app startup. Returns the loaded settings.
 */
export async function initTrackerAutomationSettings(): Promise<TrackerAutomationSettings> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return { ...DEFAULT_TRACKER_AUTOMATION };
  }

  try {
    const settings = await window.electronAPI.aiGetSettings();
    const ta = settings?.trackerAutomation;
    if (ta) {
      return {
        enabled: ta.enabled ?? DEFAULT_TRACKER_AUTOMATION.enabled,
        autoLinkCommitsToSessions: ta.autoLinkCommitsToSessions ?? DEFAULT_TRACKER_AUTOMATION.autoLinkCommitsToSessions,
        parseIssueKeysFromCommits: ta.parseIssueKeysFromCommits ?? DEFAULT_TRACKER_AUTOMATION.parseIssueKeysFromCommits,
        autoCloseOnCommit: ta.autoCloseOnCommit ?? DEFAULT_TRACKER_AUTOMATION.autoCloseOnCommit,
        agentAppendIssueKeys: ta.agentAppendIssueKeys ?? DEFAULT_TRACKER_AUTOMATION.agentAppendIssueKeys,
      };
    }
  } catch (error) {
    console.error('[trackerAutomationAtoms] Failed to load tracker automation settings:', error);
  }

  return { ...DEFAULT_TRACKER_AUTOMATION };
}
