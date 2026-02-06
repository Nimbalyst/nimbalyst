import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { claudeCodeDetector } from '../services/ClaudeCodeDetector';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '../utils/logger';
import { setupClaudeCodeEnvironment, getClaudeCodeExecutableOptions } from '@nimbalyst/runtime/electron/claudeCodeEnvironment';
import { AnalyticsService } from "../services/analytics/AnalyticsService.ts";
import { shouldShowClaudeCodeWindowsWarning, dismissClaudeCodeWindowsWarning } from '../utils/store';
import os from "os";
import { safeHandle, safeOn } from '../utils/ipcRegistry';

// Use IPC component logger for this file
const log = logger.ipc;
const analytics = AnalyticsService.getInstance();

/**
 * Register Claude Code related IPC handlers
 */
export function registerClaudeCodeHandlers() {
  // Check if Claude Code is installed
  safeHandle('claude-code:check-installation', async () => {
    const status = await claudeCodeDetector.getStatus();
    return {
      installed: status.installed,
      version: status.version,
    };
  });

  // Get full Claude Code status
  safeHandle('claude-code:get-status', async () => {
    const status = await claudeCodeDetector.getStatus();
    return status;
  });

  // Refresh Claude Code detection (clears cache)
  safeHandle('claude-code:refresh-status', async () => {
    claudeCodeDetector.clearCache();
    const status = await claudeCodeDetector.getStatus();
    return status;
  });
  // Check login status
  safeHandle('claude-code:check-login', async () => {
    try {
      // Setup environment for packaged builds
      const env = setupClaudeCodeEnvironment();

      // Build options for query - CRITICAL: pass env to options so SDK can find credentials
      // This is especially important on Intel Macs where HOME may not be set correctly
      // in packaged builds without explicitly passing the environment.
      const { options: executableOptions } = getClaudeCodeExecutableOptions();
      const options: any = {
        ...executableOptions,
        env
      };

      // Call query with proper signature: { prompt, options }
      // Use empty string prompt - SDK will write it directly without async iteration
      const session = query({
        prompt: '',
        options
      });

      // Get account info
      const accountInfo = await session.accountInfo();

      // If we got account info, user is logged in
      if (accountInfo && accountInfo.email) {
        analytics.sendEvent('check_claude_login_status', { isLoggedIn: true });
        return {
          isLoggedIn: true,
          hasOAuthToken: true,
          isExpired: false,
          email: accountInfo.email,
          organization: accountInfo.organization,
          subscriptionType: accountInfo.subscriptionType,
          tokenSource: accountInfo.tokenSource,
          apiKeySource: accountInfo.apiKeySource
        };
      }

      // No account info means not logged in
      analytics.sendEvent('check_claude_login_status', { isLoggedIn: false });
      return {
        isLoggedIn: false,
        hasOAuthToken: false,
        isExpired: true
      };
    } catch (error: any) {
      log.error('[ClaudeCodeHandlers] Login check failed:', error.message);
      analytics.sendEvent('check_claude_login_error');

      return {
        isLoggedIn: false,
        hasOAuthToken: false,
        isExpired: true,
        error: error.message
      };
    }
  });

  // Handle claude login command
  safeHandle('claude-code:login', async () => {
    try {
      // Use the bundled CLI - no need for global installation
      const platform = process.platform;
      analytics.sendEvent('do_claude_code_login', {platform: platform});
      const cliPath = findBundledCli();
      if (!cliPath) {
        throw new Error('Claude Agent SDK CLI not found in bundled installation. This is a build configuration issue.');
      }

      // Open a Terminal window with an interactive Claude session for /login
      // The setup-token command is for CI/CD token generation, not interactive login
      // Users need to type /login in the interactive session to authenticate
      if (platform === 'darwin') {
        // macOS: Use AppleScript to open Terminal with interactive Claude session

        // Use Electron's bundled Node.js to run the CLI
        const nodePath = process.execPath;
        const script = `
tell application "Terminal"
  activate
  do script "clear && echo 'Claude Code Authentication' && echo '' && echo 'Type /login and press Enter to authenticate.' && echo 'Complete the OAuth flow in your browser when prompted.' && echo 'When finished, type /quit to exit and close this window.' && echo '' && ELECTRON_RUN_AS_NODE=1 '${nodePath}' '${cliPath}'"
end tell`;

        spawn('osascript', ['-e', script], {
          detached: true,
          stdio: 'ignore'
        }).unref();

        // Return immediately - user will complete the flow in the terminal
        return {
          success: true,
          message: 'Terminal window opened. Type /login and press Enter to authenticate, then click "Refresh Status" to verify.'
        };
      } else if (platform === 'win32') {
        // Windows: Use start command to open a new cmd window with interactive Claude session
        // Windows requires a native Claude installation because the Windows console host
        // can't provide proper TTY raw mode required by Ink-based CLIs when running through Electron's Node.js
        const claudeCodePath = findWindowsClaudeExecutable();
        if (!claudeCodePath) {
          throw new Error('Claude Code executable not found. Please install Claude Code using the native installer or npm.');
        }
        spawn('cmd', ['/c', 'start', '"Claude Code Authentication"', 'cmd', '/k', `echo Claude Code Authentication && echo. && echo Type /login and press Enter to authenticate. && echo Complete the OAuth flow in your browser when prompted. && echo When finished, type /quit to exit and close this window. && echo. && "${claudeCodePath}"`], {
          detached: true,
          stdio: 'ignore',
          shell: true
        }).unref();

        return {
          success: true,
          message: 'Terminal window opened. Type /login and press Enter to authenticate, then click "Refresh Status" to verify.'
        };
      } else {
        // Linux: Try to open a terminal emulator with interactive Claude session
        const nodePath = process.execPath;
        // Try common terminal emulators
        const terminals = ['gnome-terminal', 'konsole', 'xterm', 'x-terminal-emulator'];
        let terminalOpened = false;

        for (const terminal of terminals) {
          try {
            spawn(terminal, ['-e', `bash -c "clear; echo 'Claude Code Authentication'; echo ''; echo 'Type /login and press Enter to authenticate.'; echo 'Complete the OAuth flow in your browser when prompted.'; echo 'When finished, type /quit to exit.'; echo ''; ELECTRON_RUN_AS_NODE=1 '${nodePath}' '${cliPath}'"`], {
              detached: true,
              stdio: 'ignore'
            }).unref();
            terminalOpened = true;
            break;
          } catch (error) {
            // Terminal not available, try next one
          }
        }

        if (terminalOpened) {
          return {
            success: true,
            message: 'Terminal opened. Type /login and press Enter to authenticate, then click "Refresh Status" to verify.'
          };
        } else {
          throw new Error('No terminal emulator found. Please run "' + nodePath + ' ' + cliPath + '" manually and type /login to authenticate.');
        }
      }
    } catch (error) {
      log.error('[ClaudeCodeHandlers] Login error:', error);
      throw error;
    }
  });

  // Handle claude logout command
  safeHandle('claude-code:logout', async () => {
    try {
      const platform = process.platform;
      analytics.sendEvent('do_claude_code_logout', {platform: platform});
      // Use the bundled CLI - same as login
      const cliPath = findBundledCli();
      if (!cliPath) {
        throw new Error('Claude Agent SDK CLI not found in bundled installation. This is a build configuration issue.');
      }

      // Open an interactive Terminal session where the user can type /logout
      // This avoids the stdin raw mode issues when piping commands
      if (platform === 'darwin') {
        // macOS: Use AppleScript to open Terminal with an interactive session

        const nodePath = process.execPath;
        const script = `
tell application "Terminal"
  activate
  do script "clear && echo 'Claude Code Logout' && echo '' && echo 'Type /logout and press Enter to logout:' && echo '' && ELECTRON_RUN_AS_NODE=1 '${nodePath}' '${cliPath}'"
end tell`;

        spawn('osascript', ['-e', script], {
          detached: true,
          stdio: 'ignore'
        }).unref();

        // Return immediately - user will complete logout in the terminal
        return {
          success: true,
          message: 'Terminal window opened. Type /logout and press Enter to complete logout.'
        };
      } else if (platform === 'win32') {
        // Windows: Use start command to open a new cmd window
        const claudeCodePath = findWindowsClaudeExecutable();
        if (!claudeCodePath) {
          throw new Error('Claude Code executable not found. Please install Claude Code using the native installer or npm.');
        }
        // TODO: On windows only, require access to a working claude installation because the Windows console
        //  host is unable to provide a proper TTY raw mode required by Ink-based CLIs when running in Electron-NodeJS.
        spawn('cmd', ['/c', 'start', '"Claude Code Logout"', 'cmd', '/k', `"${claudeCodePath}"`], {
          detached: true,
          stdio: 'ignore',
          shell: true
        }).unref();

        return {
          success: true,
          message: 'Command prompt opened. Type /logout and press Enter to complete logout.'
        };
      } else {
        // Linux: Try to open a terminal emulator
        const nodePath = process.execPath;
        // Try common terminal emulators
        const terminals = ['gnome-terminal', 'konsole', 'xterm', 'x-terminal-emulator'];
        let terminalOpened = false;

        for (const terminal of terminals) {
          try {
            spawn(terminal, ['-e', `bash -c "clear; echo 'Claude Code Logout'; echo ''; echo 'Type /logout and press Enter to logout:'; echo ''; ELECTRON_RUN_AS_NODE=1 '${nodePath}' '${cliPath}'"`], {
              detached: true,
              stdio: 'ignore'
            }).unref();
            terminalOpened = true;
            break;
          } catch (error) {
            // Terminal not available, try next one
          }
        }

        if (terminalOpened) {
          return {
            success: true,
            message: 'Terminal opened. Type /logout and press Enter to complete logout.'
          };
        } else {
          throw new Error('No terminal emulator found. Please run "' + nodePath + ' ' + cliPath + '" manually and type /logout in your terminal.');
        }
      }
    } catch (error) {
      log.error('[ClaudeCodeHandlers] Logout error:', error);
      throw error;
    }
  });

  // Check if Windows Claude Code warning should be shown
  safeHandle('claude-code:should-show-windows-warning', async () => {
    return shouldShowClaudeCodeWindowsWarning();
  });

  // Dismiss Windows Claude Code warning permanently
  safeHandle('claude-code:dismiss-windows-warning', async () => {
    dismissClaudeCodeWindowsWarning();
    return { success: true };
  });
}

/**
 * Find the Claude Code executable on Windows
 * Checks native installer location and npm global location
 */
function findWindowsClaudeExecutable(): string | null {
  // Check native installer location first
  const nativePath = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (fs.existsSync(nativePath)) {
    log.info('[ClaudeCodeHandlers] Found Claude at native path:', nativePath);
    return nativePath;
  }

  // Check npm global bin directory (where claude.cmd is installed)
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const npmCmdPath = path.join(appData, 'npm', 'claude.cmd');
  if (fs.existsSync(npmCmdPath)) {
    log.info('[ClaudeCodeHandlers] Found Claude at npm path:', npmCmdPath);
    return npmCmdPath;
  }

  // Fallback: check the homedir variant
  const npmCmdPathAlt = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd');
  if (fs.existsSync(npmCmdPathAlt)) {
    log.info('[ClaudeCodeHandlers] Found Claude at npm alt path:', npmCmdPathAlt);
    return npmCmdPathAlt;
  }

  log.error('[ClaudeCodeHandlers] Claude executable not found in any known location');
  return null;
}

/**
 * Find the bundled Claude Agent SDK CLI
 */
function findBundledCli(): string | null {
  try {
    // Try to resolve the package
    const packagePath = require.resolve('@anthropic-ai/claude-agent-sdk');
    const packageDir = path.dirname(packagePath);
    const cliPath = path.join(packageDir, 'cli.js');

    if (fs.existsSync(cliPath)) {
      return cliPath;
    }

    log.error('[ClaudeCodeHandlers] CLI not found at expected path:', cliPath);
    return null;
  } catch (error) {
    log.error('[ClaudeCodeHandlers] Error finding bundled CLI:', error);
    return null;
  }
}
