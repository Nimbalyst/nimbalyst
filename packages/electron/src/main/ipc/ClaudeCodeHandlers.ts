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
      console.error('[ClaudeCodeHandlers] Error checking login status:', error);

      // If error mentions authentication, user is definitely not logged in
      if (error.message?.toLowerCase().includes('auth') ||
          error.message?.toLowerCase().includes('login') ||
          error.message?.toLowerCase().includes('token')) {
        return {
          isLoggedIn: false,
          hasOAuthToken: false,
          isExpired: true,
          error: error.message
        };
      }

      // For other errors, return not logged in
      return {
        isLoggedIn: false,
        hasOAuthToken: false,
        isExpired: true,
        error: error.message
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

        // Use node to run the bundled CLI
        const script = `
tell application "Terminal"
  activate
  do script "clear && echo 'Claude Code Authentication' && echo '' && echo 'Please complete the OAuth flow in your browser.' && echo 'When finished, you can close this window.' && echo '' && node '${cliPath}' setup-token"
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

        spawn('cmd', ['/c', 'start', 'cmd', '/k', `node "${cliPath}" setup-token`], {
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

        // Try common terminal emulators
        const terminals = ['gnome-terminal', 'konsole', 'xterm', 'x-terminal-emulator'];
        let terminalOpened = false;

        for (const terminal of terminals) {
          try {
            spawn(terminal, ['-e', `bash -c "node '${cliPath}' setup-token; read -p 'Press Enter to close...'"`], {
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
          throw new Error('No terminal emulator found. Please run "node ' + cliPath + ' setup-token" manually in your terminal.');
        }
      }
    } catch (error) {
      console.error('[ClaudeCodeHandlers] Login error:', error);
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
