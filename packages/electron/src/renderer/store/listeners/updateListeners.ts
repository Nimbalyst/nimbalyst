/**
 * Centralized IPC listeners for auto-update state
 *
 * Follows the centralized IPC listener architecture:
 * - Components NEVER subscribe to IPC events directly
 * - Central listeners update atoms
 * - Components read from atoms
 *
 * Events handled:
 * - update-toast:show-available → updateStateAtom
 * - update-toast:progress → updateStateAtom
 * - update-toast:show-ready → updateStateAtom
 * - update-toast:error → updateStateAtom
 * - update-toast:checking → updateStateAtom
 * - update-toast:up-to-date → updateStateAtom
 * - update-toast:sessions-finished → updateStateAtom
 *
 * Call initUpdateListeners() once in App.tsx on mount.
 */

import { store } from '../index';
import { updateStateAtom, type DownloadProgress, type UpdateStateData } from '../atoms/updateState';

/**
 * Check if a version update reminder is suppressed.
 */
async function checkReminderSuppression(version: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.invoke('update:check-reminder-suppression', version);
    return result.suppressed === true;
  } catch (error) {
    console.error('[UpdateListeners] Failed to check reminder suppression:', error);
    return false;
  }
}

/**
 * Initialize auto-update IPC listeners.
 * Should be called once at app startup.
 *
 * @returns Cleanup function to remove listeners
 */
export function initUpdateListeners(): () => void {
  const cleanups: Array<() => void> = [];

  // States that should not be overwritten by a stale 'available' event
  const ACTIVE_STATES = new Set(['downloading', 'ready', 'waiting-for-sessions', 'viewing-notes']);

  const handleUpdateAvailable = async (data: {
    currentVersion: string;
    newVersion: string;
    releaseNotes?: string;
    releaseDate?: string;
    releaseChannel?: string;
    isManualCheck?: boolean;
  }) => {
    console.log('[UpdateListeners] Update available:', data);

    // Don't regress from an active state back to 'available' for the same version
    // (e.g. user already clicked "Update Now" and main process re-fires show-available)
    const current = store.get(updateStateAtom);
    if (ACTIVE_STATES.has(current.state) && current.updateInfo?.version === data.newVersion) {
      console.log('[UpdateListeners] Ignoring show-available for same version while in state:', current.state);
      return;
    }

    // Check if reminder is suppressed for this version
    // Skip suppression for manual checks (user explicitly clicked "Check for Updates")
    if (!data.isManualCheck) {
      const suppressed = await checkReminderSuppression(data.newVersion);
      if (suppressed) {
        console.log('[UpdateListeners] Reminder suppressed for version:', data.newVersion);
        store.set(updateStateAtom, (prev) => ({ ...prev, state: 'idle' as const }));
        return;
      }

      // Re-check after async suppression call -- state may have advanced
      const afterCheck = store.get(updateStateAtom);
      if (ACTIVE_STATES.has(afterCheck.state) && afterCheck.updateInfo?.version === data.newVersion) {
        console.log('[UpdateListeners] Ignoring show-available after suppression check, state advanced to:', afterCheck.state);
        return;
      }
    }

    // Suppression checks passed; the toast is actually about to display.
    // Track here (not in main) so we count real displays, not every
    // electron-updater 'update-available' callback. Skip if we're already
    // showing the toast for this same version (no re-display happening).
    const latest = store.get(updateStateAtom);
    const alreadyShowingSameVersion =
      latest.state === 'available' && latest.updateInfo?.version === data.newVersion;
    if (!alreadyShowingSameVersion) {
      window.electronAPI.send('analytics:update-toast-shown', {
        releaseChannel: data.releaseChannel ?? 'unknown',
        newVersion: data.newVersion,
      });
    }

    store.set(updateStateAtom, (prev) => ({
      ...prev,
      state: 'available' as const,
      currentVersion: data.currentVersion,
      updateInfo: {
        version: data.newVersion,
        releaseNotes: data.releaseNotes,
        releaseDate: data.releaseDate,
      },
    }));
  };

  const handleDownloadProgress = (data: DownloadProgress) => {
    // console.log('[UpdateListeners] Download progress:', data.percent);
    store.set(updateStateAtom, (prev) => ({
      ...prev,
      state: 'downloading' as const,
      downloadProgress: data,
    }));
  };

  const handleUpdateReady = (data: { version: string }) => {
    console.log('[UpdateListeners] Update ready:', data);
    store.set(updateStateAtom, (prev) => ({
      ...prev,
      state: 'ready' as const,
      updateInfo: prev.updateInfo
        ? { ...prev.updateInfo, version: data.version }
        : { version: data.version },
    }));
  };

  const handleUpdateError = (data: { message: string }) => {
    console.log('[UpdateListeners] Update error:', data);
    store.set(updateStateAtom, (prev) => ({
      ...prev,
      state: 'error' as const,
      errorMessage: data.message,
    }));
  };

  const handleCheckingForUpdate = () => {
    console.log('[UpdateListeners] Checking for updates...');
    store.set(updateStateAtom, (prev) => ({
      ...prev,
      state: 'checking' as const,
    }));
  };

  const handleUpToDate = () => {
    console.log('[UpdateListeners] Already up to date');
    store.set(updateStateAtom, (prev) => ({
      ...prev,
      state: 'up-to-date' as const,
    }));
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      store.set(updateStateAtom, (prev) =>
        prev.state === 'up-to-date' ? { ...prev, state: 'idle' as const } : prev
      );
    }, 3000);
  };

  const handleSessionsFinished = () => {
    console.log('[UpdateListeners] All AI sessions finished, installing update...');
    store.set(updateStateAtom, (prev) => ({
      ...prev,
      state: 'ready' as const,
    }));
  };

  cleanups.push(
    window.electronAPI.on('update-toast:show-available', handleUpdateAvailable),
    window.electronAPI.on('update-toast:progress', handleDownloadProgress),
    window.electronAPI.on('update-toast:show-ready', handleUpdateReady),
    window.electronAPI.on('update-toast:error', handleUpdateError),
    window.electronAPI.on('update-toast:checking', handleCheckingForUpdate),
    window.electronAPI.on('update-toast:up-to-date', handleUpToDate),
    window.electronAPI.on('update-toast:sessions-finished', handleSessionsFinished),
  );

  // Fetch current version on startup
  window.electronAPI.invoke('get-current-version').then((version: string) => {
    store.set(updateStateAtom, (prev) => ({ ...prev, currentVersion: version }));
  }).catch((error: Error) => {
    console.error('[UpdateListeners] Failed to get current version:', error);
  });

  return () => {
    cleanups.forEach(fn => fn?.());
  };
}
