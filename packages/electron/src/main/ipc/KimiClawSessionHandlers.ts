/**
 * KimiClaw Session IPC Handlers
 *
 * IPC handlers for session import/export, using safeHandle and safeOn.
 * workspacePath is required for all handlers.
 */

import { safeHandle, safeOn } from '../utils/ipcRegistry';
import { scanKimiClawSessions } from '../services/KimiClawSessionScanner';
import { syncKimiClawSessions } from '../services/KimiClawSessionSync';

export function registerKimiClawSessionHandlers(): void {
  /**
   * Scan KCS for importable swarms.
   */
  safeHandle('kimiclaw:scan-sessions', async (event, { workspacePath, endpoint, auth, limit, offset }) => {
    if (!workspacePath) throw new Error('workspacePath is required');
    return scanKimiClawSessions(endpoint, auth, limit, offset);
  });

  /**
   * Sync KCS swarms into nimbalyst sessions.
   */
  safeHandle('kimiclaw:sync-sessions', async (event, { workspacePath, swarms }) => {
    if (!workspacePath) throw new Error('workspacePath is required');
    return syncKimiClawSessions(workspacePath, swarms);
  });
}
