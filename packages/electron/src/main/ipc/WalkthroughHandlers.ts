/**
 * IPC handlers for Walkthrough Guide System
 *
 * Provides handlers for:
 * - Getting walkthrough state
 * - Enabling/disabling walkthroughs globally
 * - Marking walkthroughs as completed or dismissed
 * - Resetting walkthrough state (for testing)
 */

import { safeHandle } from '../utils/ipcRegistry';
import {
  getWalkthroughState,
  setWalkthroughsEnabled,
  markWalkthroughCompleted,
  markWalkthroughDismissed,
  recordWalkthroughShown,
  resetWalkthroughState,
  type WalkthroughState,
} from '../utils/store';

export function registerWalkthroughHandlers(): void {
  /**
   * Get the current walkthrough state
   */
  safeHandle('walkthroughs:get-state', async (): Promise<WalkthroughState> => {
    return getWalkthroughState();
  });

  /**
   * Enable or disable walkthroughs globally
   */
  safeHandle('walkthroughs:set-enabled', async (_event, enabled: boolean): Promise<void> => {
    setWalkthroughsEnabled(enabled);
  });

  /**
   * Mark a walkthrough as completed (user finished all steps)
   */
  safeHandle(
    'walkthroughs:mark-completed',
    async (_event, walkthroughId: string, version?: number): Promise<void> => {
      markWalkthroughCompleted(walkthroughId, version);
    }
  );

  /**
   * Mark a walkthrough as dismissed (user skipped/closed it)
   */
  safeHandle(
    'walkthroughs:mark-dismissed',
    async (_event, walkthroughId: string, version?: number): Promise<void> => {
      markWalkthroughDismissed(walkthroughId, version);
    }
  );

  /**
   * Record that a walkthrough was shown (for analytics tracking)
   */
  safeHandle(
    'walkthroughs:record-shown',
    async (_event, walkthroughId: string, version?: number): Promise<void> => {
      recordWalkthroughShown(walkthroughId, version);
    }
  );

  /**
   * Reset all walkthrough state (for testing/debugging)
   */
  safeHandle('walkthroughs:reset', async (): Promise<void> => {
    resetWalkthroughState();
  });
}
