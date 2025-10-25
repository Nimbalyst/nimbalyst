import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Register Claude Code related IPC handlers
 */
export function registerClaudeCodeHandlers() {
  // Check login status
  ipcMain.handle('claude-code:check-login', async () => {
    console.log('[ClaudeCodeHandlers] Checking login status...');

    try {
      // Check for stored credentials in the config directory
      // Claude SDK stores credentials in ~/.config/claude-code/credentials.json
      const configDir = path.join(os.homedir(), '.config', 'claude-code');
      const credentialsPath = path.join(configDir, 'credentials.json');

      if (fs.existsSync(credentialsPath)) {
        try {
          const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
          console.log('[ClaudeCodeHandlers] Found credentials file');

          // Check if credentials are valid (has session token or API key)
          const isLoggedIn = !!(credentials.sessionToken || credentials.apiKey);

          return {
            isLoggedIn,
            // Don't send sensitive data to renderer
            hasSession: !!credentials.sessionToken,
            hasApiKey: !!credentials.apiKey
          };
        } catch (error) {
          console.error('[ClaudeCodeHandlers] Error reading credentials:', error);
          return { isLoggedIn: false };
        }
      }

      console.log('[ClaudeCodeHandlers] No credentials file found');
      return { isLoggedIn: false };
    } catch (error) {
      console.error('[ClaudeCodeHandlers] Error checking login status:', error);
      return { isLoggedIn: false };
    }
  });

  // Handle claude login command
  ipcMain.handle('claude-code:login', async () => {
    console.log('[ClaudeCodeHandlers] Starting claude login...');

    try {
      // Find the bundled Claude Agent SDK CLI
      const cliPath = findBundledCli();

      if (!cliPath) {
        throw new Error('Claude Agent SDK CLI not found');
      }

      console.log('[ClaudeCodeHandlers] Found CLI at:', cliPath);

      // Spawn the login command with piped stdio to handle interactive prompts
      return new Promise((resolve, reject) => {
        console.log('[ClaudeCodeHandlers] Spawning login process...');
        console.log('[ClaudeCodeHandlers] Command: node', [cliPath, 'login']);

        const loginProcess = spawn('node', [cliPath, 'login'], {
          stdio: ['pipe', 'pipe', 'pipe'], // Pipe stdin/stdout/stderr so we can handle prompts
          detached: false, // Don't detach - we need to handle prompts
          shell: true,
          env: {
            ...process.env,
            // Try to skip interactive prompts if possible
            CI: 'true',
            FORCE_COLOR: '0'
          }
        });

        console.log('[ClaudeCodeHandlers] Process spawned, PID:', loginProcess.pid);

        let output = '';
        let errorOutput = '';
        let hasOutput = false;

        // Set a timeout in case process hangs
        const timeout = setTimeout(() => {
          console.error('[ClaudeCodeHandlers] Login process timeout after 30 seconds');
          loginProcess.kill();
          reject(new Error('Login process timed out. The CLI may not be compatible with automated login.'));
        }, 30000);

        // Handle stdout
        loginProcess.stdout?.on('data', (data) => {
          hasOutput = true;
          const text = data.toString();
          output += text;
          console.log('[ClaudeCodeHandlers] Login stdout:', text);

          // Auto-respond to CLAUDE.md import prompt
          // Answer "1" (Yes, allow external imports) to the prompt
          if (text.includes('Allow external CLAUDE.md file imports')) {
            console.log('[ClaudeCodeHandlers] Auto-responding to CLAUDE.md prompt with "1" (allow)');
            loginProcess.stdin?.write('1\n');
          }
        });

        // Handle stderr
        loginProcess.stderr?.on('data', (data) => {
          hasOutput = true;
          const text = data.toString();
          errorOutput += text;
          console.error('[ClaudeCodeHandlers] Login stderr:', text);
        });

        loginProcess.on('error', (error) => {
          clearTimeout(timeout);
          console.error('[ClaudeCodeHandlers] Login process error:', error);
          reject(error);
        });

        loginProcess.on('exit', (code) => {
          clearTimeout(timeout);
          console.log('[ClaudeCodeHandlers] Login process exited with code:', code);
          console.log('[ClaudeCodeHandlers] Had output:', hasOutput);
          console.log('[ClaudeCodeHandlers] Total output:', output);
          console.log('[ClaudeCodeHandlers] Total error output:', errorOutput);

          if (code === 0) {
            console.log('[ClaudeCodeHandlers] Login successful');
            resolve({ success: true });
          } else {
            console.error('[ClaudeCodeHandlers] Login failed with code:', code);
            reject(new Error(`Login failed with exit code ${code}. Output: ${output}\nError: ${errorOutput}`));
          }
        });

        // Check if process started
        setTimeout(() => {
          if (!hasOutput && loginProcess.killed) {
            console.error('[ClaudeCodeHandlers] Process died immediately without output');
            clearTimeout(timeout);
            reject(new Error('Login process failed to start'));
          } else {
            console.log('[ClaudeCodeHandlers] Process appears to be running...');
          }
        }, 2000);
      });
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
