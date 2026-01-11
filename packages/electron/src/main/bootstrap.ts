/**
 * Bootstrap file - Entry point for electron-vite.
 *
 * This file handles:
 * 1. Custom user-data-dir configuration (must be set before any electron-store usage)
 * 2. Module resolution for packaged builds (native modules in unpacked asar)
 *
 * Note: electron-store is now lazy-initialized in store.ts, so we can use static
 * imports without worrying about load order. The stores are created on first access,
 * which happens well after app.setPath() is called here.
 *
 * Usage:
 *   NIMBALYST_USER_DATA_DIR=/path/to/dir npm run dev
 *   or
 *   npm run dev -- --user-data-dir=/path/to/dir
 */

import { app, ipcMain } from 'electron';
import * as path from 'path';
import Module from 'module';

// Patch ipcMain.handle to prevent "second handler" errors.
// The dynamic import below creates a chunk boundary, and Vite's bundling can
// cause modules (like electron-log) to be evaluated multiple times across chunks.
// This patch makes ipcMain.handle idempotent by removing existing handlers first.
const originalHandle = ipcMain.handle.bind(ipcMain);
(ipcMain as any).handle = (channel: string, listener: any) => {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    // No existing handler, that's fine
  }
  return originalHandle(channel, listener);
};

// Add unpacked node_modules to module resolution path for packaged builds.
// This is needed because npm workspaces hoists dependencies to the root,
// but electron-builder only packages from the local node_modules.
// Native modules like node-pty are copied via extraFiles but need their
// paths added for require() to find them.
if (app.isPackaged) {
  const unpackedNodeModules = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules'
  );
  // Add to NODE_PATH which is respected by Node.js module resolution
  const currentNodePath = process.env.NODE_PATH || '';
  process.env.NODE_PATH = unpackedNodeModules + path.delimiter + currentNodePath;
  // Reinitialize module paths after updating NODE_PATH
  (Module as typeof Module & { _initPaths: () => void })._initPaths();
}

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

// Dynamic import of main application code.
// This is required for packaged builds because:
// 1. The NODE_PATH setup above must complete before node-pty can be found
// 2. Static imports are resolved before any code in this file runs
// 3. Dynamic import defers loading until after NODE_PATH is configured
//
// Note: This creates a chunk boundary, but with lazy store initialization
// in store.ts and the electron-log external config, this no longer causes
// duplicate module issues.
import('./index.js');
