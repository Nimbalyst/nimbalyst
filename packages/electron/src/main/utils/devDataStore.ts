import { app } from 'electron';
import * as path from 'path';
import * as os from 'os';

/**
 * Development Data Store Isolation
 *
 * Allows running multiple isolated instances of Nimbalyst for development/testing
 * by setting the DEV_DATA_STORE environment variable to a unique identifier.
 *
 * Example:
 *   DEV_DATA_STORE=2 npm run dev  # Uses ~/.config/nimbalyst_2
 *   DEV_DATA_STORE=3 npm run dev  # Uses ~/.config/nimbalyst_3
 *
 * This affects ALL persistent data storage:
 * - PGLite database
 * - Database backups
 * - Electron Store config files
 * - Log files
 * - Credentials
 * - Chat attachments
 * - Extensions
 */

let userDataPathOverride: string | null = null;
let appNameOverride: string | null = null;

/**
 * Initialize dev data store isolation.
 * MUST be called before app.whenReady() to properly override paths.
 */
export function initializeDevDataStore(): void {
  const devDataStore = process.env.DEV_DATA_STORE;

  if (!devDataStore) {
    return; // No override needed
  }

  // Validate the dev data store value (should be alphanumeric)
  if (!/^[a-zA-Z0-9_-]+$/.test(devDataStore)) {
    console.error(`Invalid DEV_DATA_STORE value: "${devDataStore}". Must be alphanumeric with underscores/hyphens.`);
    return;
  }

  // Override app name to change the Electron Store path
  // Electron Store uses ~/.config/{app.name}/...
  // We want ~/.config/@nimbalyst_3/electron/ instead of ~/.config/@nimbalyst/electron/
  appNameOverride = `@nimbalyst_${devDataStore}`;
  app.setName(appNameOverride);

  // Override userData path
  // Default: ~/.config/{appName} or ~/Library/Application Support/{appName} on macOS
  // Override: ~/.config/nimbalyst_{devDataStore} or ~/Library/Application Support/nimbalyst_{devDataStore}
  const configDir = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');

  userDataPathOverride = path.join(configDir, `nimbalyst_${devDataStore}`);
  app.setPath('userData', userDataPathOverride);

  console.log(`[DEV_DATA_STORE] Isolated data storage enabled:`);
  console.log(`  App Name: ${appNameOverride}`);
  console.log(`  User Data: ${userDataPathOverride}`);
  console.log(`  Electron Store: ${path.join(configDir, appNameOverride, 'electron')}`);
}

/**
 * Get the current user data path (respects DEV_DATA_STORE override).
 * Use this instead of app.getPath('userData') to ensure consistency.
 */
export function getUserDataPath(): string {
  return userDataPathOverride || app.getPath('userData');
}

/**
 * Get the current app name (respects DEV_DATA_STORE override).
 * Use this instead of app.getName() to ensure consistency.
 */
export function getAppName(): string {
  return appNameOverride || app.getName();
}

/**
 * Check if dev data store isolation is active.
 */
export function isDevDataStoreActive(): boolean {
  return userDataPathOverride !== null;
}

/**
 * Get the dev data store identifier (e.g., "3" from DEV_DATA_STORE=3).
 * Returns null if not using dev data store isolation.
 */
export function getDevDataStoreId(): string | null {
  return process.env.DEV_DATA_STORE || null;
}
