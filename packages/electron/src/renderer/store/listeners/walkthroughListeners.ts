/**
 * Centralized IPC listeners for walkthrough commands
 *
 * Follows the centralized IPC listener architecture:
 * - Components NEVER subscribe to IPC events directly
 * - Central listeners update atoms
 * - Components read from atoms
 *
 * Events handled:
 * - trigger-walkthrough → walkthroughTriggerCommandAtom
 * - reset-walkthroughs → walkthroughResetCommandAtom
 *
 * Call initWalkthroughListeners() once in App.tsx on mount.
 */

import { store } from '../index';
import {
  walkthroughTriggerCommandAtom,
  walkthroughResetCommandAtom,
} from '../atoms/walkthroughCommands';

/**
 * Initialize walkthrough IPC listeners.
 * Should be called once at app startup.
 *
 * @returns Cleanup function to remove listeners
 */
export function initWalkthroughListeners(): () => void {
  const cleanups: Array<() => void> = [];

  const handleTriggerWalkthrough = (walkthroughId: string) => {
    store.set(walkthroughTriggerCommandAtom, {
      walkthroughId,
      timestamp: Date.now(),
    });
  };

  const handleResetWalkthroughs = () => {
    store.set(walkthroughResetCommandAtom, (prev) => prev + 1);
  };

  cleanups.push(
    window.electronAPI.on('trigger-walkthrough', handleTriggerWalkthrough),
    window.electronAPI.on('reset-walkthroughs', handleResetWalkthroughs),
  );

  return () => {
    cleanups.forEach(fn => fn?.());
  };
}
