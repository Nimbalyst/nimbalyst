import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Setup environment for Claude Agent SDK in packaged builds
 * This is used by both ClaudeCodeHandlers and ClaudeCodeProvider
 *
 * Returns an environment object suitable for:
 * - Setting process.env temporarily (in IPC handlers)
 * - Passing as options.env to the SDK (in providers)
 */
export function setupClaudeCodeEnvironment(): NodeJS.ProcessEnv {
  const isPackaged = app.isPackaged;

  if (!isPackaged) {
    // Development mode - use current environment
    return { ...process.env };
  }

  // Packaged mode - set up enhanced environment
  const env = { ...process.env };
  const platform = process.platform;
  const homedir = os.homedir();
  const username = os.userInfo().username;

  // Platform-specific environment setup
  // NOTE: Custom PATH directories from app settings are handled by the electron package
  // (CLIManager.getEnhancedPath) and should already be in process.env.PATH when this is called.
  if (platform === 'win32') {
    // Windows environment setup
    env.USERPROFILE = homedir;
    env.USERNAME = username;
    env.TEMP = env.TEMP || path.join(homedir, 'AppData', 'Local', 'Temp');
    env.TMP = env.TMP || env.TEMP;

    // Windows PATH - preserve existing and add common locations
    const pathSeparator = ';';
    const appData = env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
    const commonPaths = [
      env.PATH || '',
      path.join(appData, 'npm'),  // npm global bin directory
      path.join(homedir, 'AppData', 'Roaming', 'npm'),  // fallback npm path
      path.join(homedir, '.local', 'bin'),  // native installer location
      path.join(homedir, 'AppData', 'Local', 'Programs'),
      'C:\\Program Files\\nodejs',
      'C:\\Program Files (x86)\\nodejs',
    ].filter(Boolean);
    env.PATH = commonPaths.join(pathSeparator);
  } else {
    // Unix-like (macOS/Linux) environment setup
    env.HOME = homedir;
    env.USER = username;
    env.LOGNAME = username;
    env.SHELL = env.SHELL || process.env.SHELL || '/bin/bash';
    env.TMPDIR = env.TMPDIR || os.tmpdir() || '/tmp';

    // Unix PATH - preserve existing and add common locations
    const pathSeparator = ':';
    const commonPaths = [
      env.PATH || '',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      path.join(homedir, '.local', 'bin'),
      path.join(homedir, 'bin'),
      '/opt/homebrew/bin',
      '/opt/local/bin',
    ].filter(Boolean);
    env.PATH = commonPaths.join(pathSeparator);
  }

  // CRITICAL: Set NODE_PATH to unpacked modules
  const appPath = app.getAppPath();
  const unpackedPath = appPath.includes('app.asar')
    ? appPath.replace(/app\.asar(?=[\/\\]|$)/, 'app.asar.unpacked')
    : appPath;

  env.NODE_PATH = path.join(unpackedPath, 'node_modules');

  // Verify the unpacked node_modules directory exists
  if (!fs.existsSync(env.NODE_PATH)) {
    const error = `Unpacked node_modules directory not found at: ${env.NODE_PATH}. ` +
                 `This indicates a build configuration issue. The Claude Agent SDK must be unpacked during the build process.`;
    throw new Error(error);
  }

  // Use Electron as Node
  env.ELECTRON_RUN_AS_NODE = '1';

  // Prevent dock icon from appearing on macOS when running as background process
  if (platform === 'darwin') {
    env.ELECTRON_NO_ATTACH_CONSOLE = '1';
  }

  return env;
}

/**
 * Get SDK options for packaged builds
 * Sets the executable to use Electron as Node with background processing flags
 */
export function getClaudeCodeExecutableOptions(): { executable: string; executableArgs: string[] } | {} {
  if (!app.isPackaged) {
    return {};
  }

  return {
    executable: process.execPath,
    executableArgs: []
  };
}
