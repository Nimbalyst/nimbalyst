import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';

/**
 * Options passed to the spawn function by the Claude Agent SDK.
 */
interface ClaudeSpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env: { [envVar: string]: string | undefined };
  signal: AbortSignal;
}

/**
 * Claude helper method used for spawning Claude Code subprocess.
 * - 'electron': Use Electron binary in node mode (default, works everywhere)
 * - 'standalone': Use Bun-compiled standalone binary (hides dock icon on macOS)
 */
export type ClaudeHelperMethod = 'electron' | 'standalone';

/**
 * Result of getting executable options, includes the method used for logging/analytics.
 */
export interface ClaudeCodeExecutableResult {
  options: { executable?: string; executableArgs?: string[]; pathToClaudeCodeExecutable?: string };
  method: ClaudeHelperMethod;
}

function getCandidateNodePaths(isPackaged: boolean): string[] {
  const candidates = new Set<string>();
  const existingNodePath = process.env.NODE_PATH;

  if (existingNodePath) {
    for (const entry of existingNodePath.split(path.delimiter)) {
      if (entry) {
        candidates.add(entry);
      }
    }
  }

  const appPath = app.getAppPath();
  const unpackedPath = appPath.includes('app.asar')
    ? appPath.replace(/app\.asar(?=[\/\\]|$)/, 'app.asar.unpacked')
    : appPath;

  if (isPackaged) {
    candidates.add(path.join(unpackedPath, 'node_modules'));
  } else {
    candidates.add(path.join(appPath, 'node_modules'));
    // In dev, the Electron app lives under packages/electron while optional SDK
    // image binaries are often hoisted to the repo root node_modules directory.
    candidates.add(path.resolve(appPath, '../../node_modules'));
    candidates.add(path.resolve(appPath, '../runtime/node_modules'));
  }

  return Array.from(candidates).filter((candidate) => fs.existsSync(candidate));
}

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
  const env = { ...process.env };

  const nodePaths = getCandidateNodePaths(isPackaged);
  if (nodePaths.length > 0) {
    env.NODE_PATH = nodePaths.join(path.delimiter);
  }

  if (!isPackaged) {
    // The SDK may execute its extracted CLI from a temp location, so provide
    // explicit module roots in dev mode instead of relying on relative lookup.
    return env;
  }

  // Packaged mode - set up enhanced environment
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

  if (nodePaths.length === 0) {
    const error = `Unable to resolve any unpacked node_modules directories for Claude Code. ` +
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
 * Get the path to the standalone binary for the current platform.
 */
function getStandaloneBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'claude-helper.exe' : 'claude-helper';
  return path.join(
    process.resourcesPath,
    'claude-helper-bin',
    binaryName
  );
}

/**
 * Check if the standalone Bun-compiled binary is available.
 * Available on all platforms in packaged builds if the binary was built and included.
 */
export function isStandaloneBinaryAvailable(): boolean {
  if (!app.isPackaged) {
    return false;
  }

  return fs.existsSync(getStandaloneBinaryPath());
}

/**
 * Get SDK options for packaged builds.
 * Sets the executable to use for spawning Claude Code subprocess.
 *
 * @param useStandaloneBinary - If true, use the standalone Bun-compiled binary (macOS only).
 *                              If false or binary unavailable, use Electron binary.
 * @param log - Optional logging function for diagnostics
 * @returns Object containing executable options and the method that was used
 */
export function getClaudeCodeExecutableOptions(
  useStandaloneBinary: boolean = false,
  log?: (message: string, data?: Record<string, unknown>) => void
): ClaudeCodeExecutableResult {
  const logInfo = log || ((msg: string, data?: Record<string, unknown>) => {
    console.log(`[ClaudeCodeEnvironment] ${msg}`, data || '');
  });

  if (!app.isPackaged) {
    logInfo('Development mode - using default SDK spawn behavior', { method: 'electron' });
    return {
      options: {},
      method: 'electron'
    };
  }

  const helperBinaryPath = getStandaloneBinaryPath();
  const standaloneBinaryExists = fs.existsSync(helperBinaryPath);

  if (useStandaloneBinary) {
    // User requested standalone - use it regardless of whether it exists
    // If it doesn't exist, the spawn will fail and the user will see the error
    logInfo('Using standalone Bun-compiled binary for Claude Code', {
      method: 'standalone',
      path: helperBinaryPath,
      binaryExists: standaloneBinaryExists,
      platform: process.platform
    });
    if (!standaloneBinaryExists) {
      logInfo('WARNING: Standalone binary not found - spawn will likely fail', {
        binaryPath: helperBinaryPath
      });
    }
    return {
      options: {
        pathToClaudeCodeExecutable: helperBinaryPath
      },
      method: 'standalone'
    };
  } else {
    logInfo('Using Electron binary for Claude Code (standalone not enabled)', {
      method: 'electron',
      standaloneBinaryAvailable: standaloneBinaryExists,
      platform: process.platform
    });
  }

  // Default: use Electron binary
  return {
    options: {
      executable: process.execPath,
      executableArgs: []
    },
    method: 'electron'
  };
}

/**
 * Get a custom spawn function for the Claude Agent SDK.
 * - On Windows: Uses windowsHide to prevent console window
 * - On macOS/Linux: Uses default spawn (macOS uses wrapper via executable option)
 */
export function getClaudeCodeSpawnFunction(): ((options: ClaudeSpawnOptions) => ChildProcess) | undefined {
  if (!app.isPackaged) {
    return undefined;
  }

  // On Windows, use windowsHide to prevent console window from appearing
  if (process.platform === 'win32') {
    return (options: ClaudeSpawnOptions): ChildProcess => {
      return spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    };
  }

  // On macOS/Linux, use default spawn (macOS wrapper handles dock icon)
  return undefined;
}
