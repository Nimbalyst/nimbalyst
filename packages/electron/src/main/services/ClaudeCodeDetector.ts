import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface ClaudeCodeStatus {
  installed: boolean;
  loggedIn: boolean;
  version?: string;
  hasSession?: boolean;
  hasApiKey?: boolean;
}

/**
 * Service to detect Claude Code CLI installation and login status
 */
export class ClaudeCodeDetector {
  private cachedStatus: ClaudeCodeStatus | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 30000; // 30 seconds

  /**
   * Check if Claude Code CLI is installed
   */
  async isInstalled(): Promise<boolean> {
    const status = await this.getStatus();
    return status.installed;
  }

  /**
   * Check if user is logged in to Claude Code
   */
  async isLoggedIn(): Promise<boolean> {
    const status = await this.getStatus();
    return status.loggedIn;
  }

  /**
   * Get full installation and login status
   */
  async getStatus(): Promise<ClaudeCodeStatus> {
    const now = Date.now();

    // Return cached result if still valid
    if (this.cachedStatus && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      return this.cachedStatus;
    }

    // Check installation
    const installed = await this.checkInstallation();

    // Check login status
    const loginStatus = await this.checkLoginStatus();

    const status: ClaudeCodeStatus = {
      installed: installed.installed,
      version: installed.version,
      loggedIn: loginStatus.loggedIn,
      hasSession: loginStatus.hasSession,
      hasApiKey: loginStatus.hasApiKey,
    };

    // Cache the result
    this.cachedStatus = status;
    this.cacheTimestamp = now;

    return status;
  }

  /**
   * Clear the cache to force a fresh check
   */
  clearCache(): void {
    this.cachedStatus = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Check if the bundled SDK CLI is available
   */
  private async checkInstallation(): Promise<{ installed: boolean; version?: string }> {
    try {
      // Try to find the bundled Claude Agent SDK CLI
      const cliPath = this.findBundledCli();

      if (!cliPath) {
        console.log('[ClaudeCodeDetector] Bundled CLI not found');
        return { installed: false };
      }

      // Try to get version
      const version = await this.getCliVersion(cliPath);

      return {
        installed: true,
        version,
      };
    } catch (error) {
      console.error('[ClaudeCodeDetector] Installation check failed:', error);
      return { installed: false };
    }
  }

  /**
   * Get the CLI version
   */
  private async getCliVersion(cliPath: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      try {
        const versionProcess = spawn('node', [cliPath, '--version'], {
          timeout: 5000,
          shell: true,
        });

        let output = '';

        versionProcess.stdout?.on('data', (data) => {
          output += data.toString();
        });

        versionProcess.on('close', (code) => {
          if (code === 0 && output) {
            const version = output.trim();
            resolve(version);
          } else {
            resolve(undefined);
          }
        });

        versionProcess.on('error', () => {
          resolve(undefined);
        });
      } catch (error) {
        resolve(undefined);
      }
    });
  }

  /**
   * Check login status by looking for credentials
   */
  private async checkLoginStatus(): Promise<{
    loggedIn: boolean;
    hasSession?: boolean;
    hasApiKey?: boolean;
  }> {
    try {
      // Check for stored credentials in the config directory
      // Claude SDK stores credentials in ~/.config/claude-code/credentials.json
      const configDir = path.join(os.homedir(), '.config', 'claude-code');
      const credentialsPath = path.join(configDir, 'credentials.json');

      if (!fs.existsSync(credentialsPath)) {
        return { loggedIn: false };
      }

      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

      // Check if credentials are valid (has session token or API key)
      const hasSession = !!credentials.sessionToken;
      const hasApiKey = !!credentials.apiKey;
      const loggedIn = hasSession || hasApiKey;

      return {
        loggedIn,
        hasSession,
        hasApiKey,
      };
    } catch (error) {
      console.error('[ClaudeCodeDetector] Login status check failed:', error);
      return { loggedIn: false };
    }
  }

  /**
   * Find the bundled Claude Agent SDK CLI
   */
  private findBundledCli(): string | null {
    try {
      // Try to resolve the package
      const packagePath = require.resolve('@anthropic-ai/claude-agent-sdk');
      const packageDir = path.dirname(packagePath);
      const cliPath = path.join(packageDir, 'cli.js');

      if (fs.existsSync(cliPath)) {
        return cliPath;
      }

      console.error('[ClaudeCodeDetector] CLI not found at expected path:', cliPath);
      return null;
    } catch (error) {
      console.error('[ClaudeCodeDetector] Error finding bundled CLI:', error);
      return null;
    }
  }
}

// Singleton instance
export const claudeCodeDetector = new ClaudeCodeDetector();
