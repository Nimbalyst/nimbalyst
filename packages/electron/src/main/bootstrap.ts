/**
 * Bootstrap file - Entry point for electron-vite.
 *
 * This file handles custom user-data-dir configuration, which must be set
 * before any electron-store usage.
 *
 * Note: electron-store is lazy-initialized in store.ts, so we can use static
 * imports without worrying about load order. The stores are created on first
 * access, which happens well after app.setPath() is called here.
 *
 * Native modules (node-pty) are handled via explicit path resolution in
 * TerminalSessionManager.ts using createRequire, which eliminates the need
 * for NODE_PATH manipulation and dynamic imports.
 *
 * V8 Memory Configuration:
 *   The heap memory limit can be configured via app-settings.json (maxHeapSizeMB).
 *   This must be applied before app.whenReady() via app.commandLine.appendSwitch().
 *
 * Usage:
 *   NIMBALYST_USER_DATA_DIR=/path/to/dir npm run dev
 *   or
 *   npm run dev -- --user-data-dir=/path/to/dir
 */

import { app, dialog } from 'electron';
import * as path from 'path';
import Store from 'electron-store';

// Global uncaught exception handler - must be registered early
// This catches errors that bubble up from async SDK operations
// Throttling: suppress duplicate errors and cap dialog frequency to prevent dialog floods
const _recentErrors = new Map<string, number>(); // error key -> timestamp
const _ERROR_THROTTLE_MS = 5000; // suppress duplicate errors within this window
const _MAX_DIALOGS_PER_MINUTE = 3;
let _dialogTimestamps: number[] = [];

process.on('uncaughtException', (error: Error & { code?: string }) => {
  // Check if this is the known Claude Agent SDK stream error
  // This happens when the SDK tries to write to a process stdin after it has terminated
  if (error.code === 'ERR_STREAM_WRITE_AFTER_END' &&
      error.stack?.includes('claude-agent-sdk')) {
    // Log the error but don't show a dialog - this is a known SDK issue
    console.warn('[Bootstrap] Suppressed Claude Agent SDK stream error:', error.message);
    return;
  }

  // Always log the error
  console.error('[Bootstrap] Uncaught exception:', error);

  // Throttle dialogs to prevent flood from rapid-fire errors
  const now = Date.now();
  const errorKey = `${error.name}:${error.message}`;

  // Suppress duplicate errors within the throttle window
  const lastSeen = _recentErrors.get(errorKey);
  if (lastSeen && (now - lastSeen) < _ERROR_THROTTLE_MS) {
    console.warn('[Bootstrap] Suppressed duplicate error dialog:', errorKey);
    return;
  }
  _recentErrors.set(errorKey, now);

  // Clean up old entries
  for (const [key, ts] of _recentErrors) {
    if ((now - ts) > _ERROR_THROTTLE_MS) _recentErrors.delete(key);
  }

  // Cap total dialogs per minute
  _dialogTimestamps = _dialogTimestamps.filter(ts => (now - ts) < 60_000);
  if (_dialogTimestamps.length >= _MAX_DIALOGS_PER_MINUTE) {
    console.warn('[Bootstrap] Too many error dialogs, suppressing. Error:', errorKey);
    return;
  }
  _dialogTimestamps.push(now);

  dialog.showErrorBox('Nimbalyst - Uncaught Exception', `${error.name}: ${error.message}\n\n${error.stack || ''}`);
});

// Parse --user-data-dir from command line args or environment variable
function getCustomUserDataDir(): string | undefined {
  // Check environment variable first (more reliable for npm scripts)
  if (process.env.NIMBALYST_USER_DATA_DIR) {
    return process.env.NIMBALYST_USER_DATA_DIR;
  }

  // Check command line args
  for (const arg of process.argv) {
    if (arg.startsWith('--user-data-dir=')) {
      return arg.substring('--user-data-dir='.length);
    }
  }

  return undefined;
}

const customUserDataDir = getCustomUserDataDir();

if (customUserDataDir) {
  // Set userData path before any electron-store instances are created.
  // With lazy initialization in store.ts, this is guaranteed to run first.
  app.setPath('userData', customUserDataDir);
  // Also set appData to parent directory for consistency
  app.setPath('appData', path.dirname(customUserDataDir));
  console.log(`[Bootstrap] Using custom userData directory: ${customUserDataDir}`);
}

// Configure V8 heap memory limit from app settings
// This must happen before app.whenReady() for the flag to take effect
// Default to 4096MB (4GB) if not configured
try {
  const appSettings = new Store<{ maxHeapSizeMB?: number }>({ name: 'app-settings' });
  const maxHeapSizeMB = appSettings.get('maxHeapSizeMB', 4096);
  if (maxHeapSizeMB && maxHeapSizeMB > 0) {
    app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${maxHeapSizeMB}`);
    console.log(`[Bootstrap] V8 heap limit set to ${maxHeapSizeMB}MB`);
  }
} catch (error) {
  // If we can't read settings, use default
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
  console.log('[Bootstrap] V8 heap limit set to 4096MB (default)');
}

// Enable CDP remote debugging in dev mode for Playwright extension testing.
// This allows `playwright connectOverCDP("http://localhost:9222")` to drive
// the running Nimbalyst instance without launching a separate Electron process.
if (process.env.NODE_ENV !== 'production') {
  const cdpPort = process.env.NIMBALYST_CDP_PORT || '9222';
  app.commandLine.appendSwitch('remote-debugging-port', cdpPort);
  console.log(`[Bootstrap] CDP remote debugging enabled on port ${cdpPort}`);
}

// Static import - no chunk boundary, no module duplication issues.
// This works because:
// 1. electron-store is lazy-initialized (store.ts)
// 2. node-pty uses explicit path resolution (TerminalSessionManager.ts)
import './index.js';
