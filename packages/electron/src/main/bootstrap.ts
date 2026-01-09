/**
 * Bootstrap file that runs BEFORE all other imports.
 *
 * CRITICAL: This file must be the entry point for electron-vite.
 * It handles user-data-dir configuration before any electron-store
 * instances are created (which happens at module load time).
 *
 * Usage:
 *   NIMBALYST_USER_DATA_DIR=/path/to/dir npm run dev
 *   or
 *   npm run dev -- --user-data-dir=/path/to/dir
 */

import { app } from 'electron';
import * as path from 'path';

// Parse --user-data-dir from command line args
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
  // Must call setPath BEFORE any electron-store instances are created
  app.setPath('userData', customUserDataDir);
  // Also set appData to parent directory for consistency
  app.setPath('appData', path.dirname(customUserDataDir));
  console.log(`[Bootstrap] Using custom userData directory: ${customUserDataDir}`);
}

// Dynamic import to ensure the above code runs BEFORE index.ts is loaded
// This causes Vite to code-split, placing the main app in a chunk.
// All __dirname-relative paths in the main app need to use app.getAppPath() instead.
import('./index.js');
