import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { claudeCodeDetector } from '../services/ClaudeCodeDetector';
import { query } from '@anthropic-ai/claude-agent-sdk';

/**
 * Register Claude Code related IPC handlers
 */
export function registerClaudeCodeHandlers() {
  // Check if Claude Code is installed
  ipcMain.handle('claude-code:check-installation', async () => {
    console.log('[ClaudeCodeHandlers] Checking installation...');
    const status = await claudeCodeDetector.getStatus();
    return {
      installed: status.installed,
      version: status.version,
    };
  });

  // Get full Claude Code status
  ipcMain.handle('claude-code:get-status', async () => {
    console.log('[ClaudeCodeHandlers] Getting full status...');
    const status = await claudeCodeDetector.getStatus();
    return status;
  });

  // Refresh Claude Code detection (clears cache)
  ipcMain.handle('claude-code:refresh-status', async () => {
    console.log('[ClaudeCodeHandlers] Refreshing status...');
    claudeCodeDetector.clearCache();
    const status = await claudeCodeDetector.getStatus();
    return status;
  });
  // Check login status
  ipcMain.handle('claude-code:check-login', async () => {
    console.log('[ClaudeCodeHandlers] Checking login status...');

    try {
      // Call query with proper signature: { prompt, options }
      // Use empty string prompt - SDK will write it directly without async iteration
      const session = query({
        prompt: '',
        options: {}
      });

      // Get account info
      const accountInfo = await session.accountInfo();
      console.log('[ClaudeCodeHandlers] Account info:', accountInfo);

      // If we got account info, user is logged in
      if (accountInfo && accountInfo.email) {
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
      return {
        isLoggedIn: false,
        hasOAuthToken: false,
        isExpired: true
      };
    } catch (error: any) {
      console.log('[ClaudeCodeHandlers] Failed to get account info:', error.message);
      return {
        isLoggedIn: false,
        hasOAuthToken: false,
        isExpired: true
      };
    }
  });

  // Handle claude login command
  ipcMain.handle('claude-code:login', async () => {
    console.log('[ClaudeCodeHandlers] Starting claude login...');

    try {
      // Use the bundled CLI - no need for global installation
      const cliPath = findBundledCli();
      if (!cliPath) {
        throw new Error('Claude Agent SDK CLI not found in bundled installation. This is a build configuration issue.');
      }

      console.log('[ClaudeCodeHandlers] Found bundled CLI at:', cliPath);

      // Open a Terminal window with the claude setup-token command
      // This provides a proper TTY environment for the interactive OAuth flow
      const platform = process.platform;

      if (platform === 'darwin') {
        // macOS: Use AppleScript to open Terminal with the command
        console.log('[ClaudeCodeHandlers] Opening Terminal window for OAuth setup...');

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
        console.log('[ClaudeCodeHandlers] Opening command prompt for OAuth setup...');

        const nodePath = process.execPath;
        // TODO: On windows only, assume we have access to a working claude installation because I could not figure out
        //  how to use the weird Windows shell to run the command with ELECTRON_RUN_AS_NODE=1 properly.
        spawn('cmd', ['/c', 'start', 'cmd', '/k', `claude setup-token`], {
          detached: true,
          stdio: 'ignore'
        }).unref();

        return {
          success: true,
          message: 'Command prompt opened. Please complete the authentication in your browser, then click "Refresh Status" to verify.'
        };
      } else {
        // Linux: Try to open a terminal emulator
        console.log('[ClaudeCodeHandlers] Opening terminal for OAuth setup...');

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
            console.log(`[ClaudeCodeHandlers] ${terminal} not available`);
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
      console.error('[ClaudeCodeHandlers] Login error:', error);
      throw error;
    }
  });

  // Handle claude logout command
  ipcMain.handle('claude-code:logout', async () => {
    console.log('[ClaudeCodeHandlers] Starting claude logout...');

    try {
      // Use the bundled CLI - same as login
      const cliPath = findBundledCli();
      if (!cliPath) {
        throw new Error('Claude Agent SDK CLI not found in bundled installation. This is a build configuration issue.');
      }

      console.log('[ClaudeCodeHandlers] Found bundled CLI at:', cliPath);

      // Open an interactive Terminal session where the user can type /logout
      // This avoids the stdin raw mode issues when piping commands
      const platform = process.platform;

      if (platform === 'darwin') {
        // macOS: Use AppleScript to open Terminal with an interactive session
        console.log('[ClaudeCodeHandlers] Opening Terminal window for interactive logout...');

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
        console.log('[ClaudeCodeHandlers] Opening command prompt for interactive logout...');

        const nodePath = process.execPath;
        spawn('cmd', ['/c', 'start', 'cmd', '/k', `echo Claude Code Logout && echo. && echo Type /logout and press Enter to logout: && echo. && set ELECTRON_RUN_AS_NODE=1 && "${nodePath}" "${cliPath}"`], {
          detached: true,
          stdio: 'ignore'
        }).unref();

        return {
          success: true,
          message: 'Command prompt opened. Type /logout and press Enter to complete logout.'
        };
      } else {
        // Linux: Try to open a terminal emulator
        console.log('[ClaudeCodeHandlers] Opening terminal for interactive logout...');

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
            console.log(`[ClaudeCodeHandlers] ${terminal} not available`);
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
      console.error('[ClaudeCodeHandlers] Logout error:', error);
      throw error;
    }
  });

  console.log('[ClaudeCodeHandlers] Registered IPC handlers');
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

    console.error('[ClaudeCodeHandlers] CLI not found at expected path:', cliPath);
    return null;
  } catch (error) {
    console.error('[ClaudeCodeHandlers] Error finding bundled CLI:', error);
    return null;
  }
}
