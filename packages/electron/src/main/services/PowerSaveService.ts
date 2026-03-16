/**
 * PowerSaveService - Prevents system sleep using Electron's powerSaveBlocker.
 *
 * Uses 'prevent-app-suspension' mode which prevents the system from sleeping
 * but allows the display to dim/sleep normally. Similar to `caffeinate -i` on macOS.
 *
 * Intended to keep sync connections alive while a mobile device is paired.
 */

import { powerSaveBlocker } from 'electron';
import { logger } from '../utils/logger';

let blockerId: number | null = null;

/**
 * Start preventing system sleep. No-op if already active.
 */
export function startPreventingSleep(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    // logger.main.info('(POWER) Sleep prevention already active');
    return;
  }
  blockerId = powerSaveBlocker.start('prevent-app-suspension');
  logger.main.info(`(POWER) Started sleep prevention (blocker id: ${blockerId})`);
}

/**
 * Stop preventing system sleep. No-op if not active.
 */
export function stopPreventingSleep(): void {
  if (blockerId === null) {
    return;
  }
  if (powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
    logger.main.info(`(POWER) Stopped sleep prevention (blocker id: ${blockerId})`);
  }
  blockerId = null;
}

/**
 * Returns whether sleep prevention is currently active.
 */
export function isPreventingSleep(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId);
}
