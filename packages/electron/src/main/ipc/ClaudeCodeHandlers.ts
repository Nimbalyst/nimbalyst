import { ipcMain, app } from 'electron';
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

// Use IPC component logger for this file
const log = logger.ipc;
const analytics = AnalyticsService.getInstance();

/**
 * Register Claude Code related IPC handlers
 */
export function registerClaudeCodeHandlers() {
  // Check if Claude Code is installed
  ipcMain.handle('claude-code:check-installation', async () => {
    const status = await claudeCodeDetector.getStatus();
    return {
      installed: status.installed,
      version: status.version,
    };
  });

  // Get full Claude Code status
  ipcMain.handle('claude-code:get-status', async () => {
    const status = await claudeCodeDetector.getStatus();
    return status;
  });

  // Refresh Claude Code detection (clears cache)
  ipcMain.handle('claude-code:refresh-status', async () => {
    claudeCodeDetector.clearCache();
    const status = await claudeCodeDetector.getStatus();
    return status;
  });
  // Check login status
  ipcMain.handle('claude-code:check-login', async () => {
    // Save original environment to restore later
    const originalEnv = { ...process.env };

    try {
      // Setup environment for packaged builds
      const env = setupClaudeCodeEnvironment();

      // Apply environment to current process temporarily
      Object.assign(process.env, env);

      // Build options for query
      const options: any = getClaudeCodeExecutableOptions();

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
    } finally {
      // Always restore original environment
      Object.keys(process.env).forEach(key => delete process.env[key]);
      Object.assign(process.env, originalEnv);
    }
  });

  // Handle claude login command
  ipcMain.handle('claude-code:login', async () => {
    try {
      // Use the bundled CLI - no need for global installation
      const platform = process.platform;
      analytics.sendEvent('do_claude_code_login', {platform: platform});
      const cliPath = findBundledCli();
      if (!cliPath) {
        throw new Error('Claude Agent SDK CLI not found in bundled installation. This is a build configuration issue.');
      }

      // Open a Terminal window with the claude setup-token command
      // This provides a proper TTY environment for the interactive OAuth flow
      if (platform === 'darwin') {
        // macOS: Use AppleScript to open Terminal with the command

        // Use Electron's bundled Node.js to run the CLI
        const nodePath = process.execPath;
        const script = `
tell application "Terminal"
  activate
  do script "clear && echo 'Claude Code Authentication' && echo '' && echo 'Please complete the OAuth flow in your browser.' && echo 'When finished, you can close this window.' && echo '' && ELECTRON_RUN_AS_NODE=1 '${nodePath}' '${cliPath}' setup-token"
end tell`;

        spawn('osascript', ['-e', script], {
          detached: true,
          stdio: 'ignore'
        }).unref();

        // Return immediately - user will complete the flow in the terminal
        return {
          success: true,
          message: 'Terminal window opened. Please complete the authentication in your browser, then click "Refresh Status" to verify.'
        };
      } else if (platform === 'win32') {
        // Windows: Use start command to open a new cmd window
        const claudeCodePath = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
        // TODO: On windows only, require access to a working claude installation because the Windows console
        //  host is unable to provide a proper TTY raw mode required by Ink-based CLIs when running in Electron-NodeJS.
        spawn('cmd', ['/c', 'start', '"Claude Code Authentication"', 'cmd', '/k', `"${claudeCodePath}" setup-token`], {
          detached: true,
          stdio: 'ignore',
          shell: true
        }).unref();

        return {
          success: true,
          message: 'Command prompt opened. Please complete the authentication in your browser, then click "Refresh Status" to verify.'
        };
      } else {
        // Linux: Try to open a terminal emulator
        const nodePath = process.execPath;
        // Try common terminal emulators
        const terminals = ['gnome-terminal', 'konsole', 'xterm', 'x-terminal-emulator'];
        let terminalOpened = false;

        for (const terminal of terminals) {
          try {
            spawn(terminal, ['-e', `bash -c "ELECTRON_RUN_AS_NODE=1 '${nodePath}' '${cliPath}' setup-token; read -p 'Press Enter to close...'"`], {
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
            message: 'Terminal opened. Please complete the authentication in your browser, then click "Refresh Status" to verify.'
          };
        } else {
          throw new Error('No terminal emulator found. Please run "' + nodePath + ' ' + cliPath + ' setup-token" manually in your terminal.');
        }
      }
    } catch (error) {
      log.error('[ClaudeCodeHandlers] Login error:', error);
      throw error;
    }
  });

  // Handle claude logout command
  ipcMain.handle('claude-code:logout', async () => {
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
        const claudeCodePath = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
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
  ipcMain.handle('claude-code:should-show-windows-warning', async () => {
    return shouldShowClaudeCodeWindowsWarning();
  });

  // Dismiss Windows Claude Code warning permanently
  ipcMain.handle('claude-code:dismiss-windows-warning', async () => {
    dismissClaudeCodeWindowsWarning();
    return { success: true };
  });
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
