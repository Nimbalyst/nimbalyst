/**
 * ClaudeUsageService - Tracks Claude Code API usage limits
 *
 * This service:
 * - Reads OAuth credentials from macOS Keychain (where Claude Code stores them)
 * - Calls Anthropic's usage API to get 5-hour session and 7-day weekly limits
 * - Implements activity-aware polling (active when using Claude, sleeps when idle)
 * - Broadcasts usage updates to renderer via IPC
 */

import { execSync } from 'child_process';
import { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';

export interface ClaudeUsageData {
  fiveHour: {
    utilization: number; // 0-100 percentage
    resetsAt: string | null; // ISO timestamp
  };
  sevenDay: {
    utilization: number;
    resetsAt: string | null;
  };
  sevenDayOpus?: {
    utilization: number;
    resetsAt: string | null;
  };
  lastUpdated: number; // Unix timestamp
  error?: string;
}

interface KeychainCredentials {
  claudeAiOauth?: {
    accessToken?: string;
  };
}

const USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage';
const KEYCHAIN_SERVICES = ['Claude Code-credentials', 'Claude Code']; // Primary and fallback
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes before going to sleep
const KEYCHAIN_RETRY_DELAY_MS = 2000; // Retry delay for keychain errors (post-unlock)
const KEYCHAIN_MAX_RETRIES = 3;
const NETWORK_RETRY_DELAY_MS = 3000; // Retry delay for network errors
const NETWORK_MAX_RETRIES = 3;

class ClaudeUsageServiceImpl {
  private cachedUsage: ClaudeUsageData | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastActivityTime: number = 0;
  private isPolling: boolean = false;
  private isSleeping: boolean = true;

  /**
   * Initialize the service. Does not start polling until activity is detected.
   */
  initialize(): void {
    logger.main.info('[ClaudeUsageService] Initialized (sleeping until activity detected)');
  }

  /**
   * Called when user sends a message to a Claude agent session.
   * Wakes up the service and triggers an immediate refresh.
   */
  async recordActivity(): Promise<void> {
    this.lastActivityTime = Date.now();

    if (this.isSleeping) {
      logger.main.info('[ClaudeUsageService] Waking up due to activity');
      this.isSleeping = false;
      this.startPolling();
      // Immediate refresh on wake
      await this.refresh();
    }
  }

  /**
   * Get the current cached usage data. Returns null if no data available.
   */
  getCachedUsage(): ClaudeUsageData | null {
    return this.cachedUsage;
  }

  /**
   * Force a refresh of usage data from the API.
   */
  async refresh(): Promise<ClaudeUsageData> {
    try {
      const token = this.getAccessTokenFromKeychain();
      if (!token) {
        const errorData: ClaudeUsageData = {
          fiveHour: { utilization: 0, resetsAt: null },
          sevenDay: { utilization: 0, resetsAt: null },
          lastUpdated: Date.now(),
          error: 'No Claude Code credentials found. Please log in to Claude Code.',
        };
        this.cachedUsage = errorData;
        this.broadcastUpdate();
        return errorData;
      }

      const usageData = await this.fetchUsageData(token);
      this.cachedUsage = usageData;
      this.broadcastUpdate();
      return usageData;
    } catch (error) {
      logger.main.error('[ClaudeUsageService] Error refreshing usage:', error);
      const errorData: ClaudeUsageData = {
        fiveHour: { utilization: 0, resetsAt: null },
        sevenDay: { utilization: 0, resetsAt: null },
        lastUpdated: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error fetching usage',
      };
      this.cachedUsage = errorData;
      this.broadcastUpdate();
      return errorData;
    }
  }

  /**
   * Stop the service and clean up timers.
   */
  stop(): void {
    this.stopPolling();
    logger.main.info('[ClaudeUsageService] Stopped');
  }

  private startPolling(): void {
    if (this.isPolling) return;

    this.isPolling = true;
    this.pollTimer = setInterval(() => {
      this.pollTick();
    }, POLL_INTERVAL_MS);

    logger.main.info('[ClaudeUsageService] Started polling (every 5 minutes)');
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
  }

  private async pollTick(): Promise<void> {
    // Check if we should go to sleep due to inactivity
    const timeSinceActivity = Date.now() - this.lastActivityTime;
    if (timeSinceActivity > IDLE_TIMEOUT_MS) {
      logger.main.info('[ClaudeUsageService] Going to sleep due to inactivity');
      this.isSleeping = true;
      this.stopPolling();
      return;
    }

    // Refresh usage data
    await this.refresh();
  }

  private getAccessTokenFromKeychain(): string | null {
    // Only supported on macOS (reads from macOS Keychain)
    if (process.platform !== 'darwin') {
      return null;
    }

    // Try each keychain service name (primary and fallback)
    for (const serviceName of KEYCHAIN_SERVICES) {
      const token = this.tryGetTokenFromKeychain(serviceName);
      if (token) {
        return token;
      }
    }

    logger.main.debug('[ClaudeUsageService] Claude Code credentials not found in any keychain entry');
    return null;
  }

  private tryGetTokenFromKeychain(serviceName: string): string | null {
    try {
      // Read credentials from macOS Keychain
      const result = execSync(
        `security find-generic-password -s "${serviceName}" -w`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();

      // Parse the JSON credentials
      const credentials: KeychainCredentials = JSON.parse(result);
      const token = credentials.claudeAiOauth?.accessToken;

      if (!token) {
        logger.main.debug(`[ClaudeUsageService] No access token in keychain entry: ${serviceName}`);
        return null;
      }

      return token;
    } catch (error) {
      // Security command returns error if item not found - this is expected
      if (error instanceof Error && error.message.includes('could not be found')) {
        // Silent - will try fallback
        return null;
      }
      // Log other errors but continue to try fallback
      logger.main.debug(`[ClaudeUsageService] Error reading keychain entry ${serviceName}:`, error);
      return null;
    }
  }

  private async fetchUsageData(accessToken: string): Promise<ClaudeUsageData> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < NETWORK_MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(USAGE_API_URL, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'anthropic-beta': 'oauth-2025-04-20',
            'User-Agent': 'Nimbalyst/1.0',
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            // Non-retryable: auth expired
            throw new Error('Authentication expired. Please re-login to Claude Code.');
          }
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        return {
          fiveHour: {
            utilization: data.five_hour?.utilization ?? 0,
            resetsAt: data.five_hour?.resets_at ?? null,
          },
          sevenDay: {
            utilization: data.seven_day?.utilization ?? 0,
            resetsAt: data.seven_day?.resets_at ?? null,
          },
          sevenDayOpus: data.seven_day_opus ? {
            utilization: data.seven_day_opus.utilization ?? 0,
            resetsAt: data.seven_day_opus.resets_at ?? null,
          } : undefined,
          lastUpdated: Date.now(),
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry auth errors
        if (lastError.message.includes('Authentication expired')) {
          throw lastError;
        }

        // Retry on network errors
        if (attempt < NETWORK_MAX_RETRIES - 1) {
          logger.main.debug(`[ClaudeUsageService] Fetch attempt ${attempt + 1} failed, retrying in ${NETWORK_RETRY_DELAY_MS}ms...`);
          await this.sleep(NETWORK_RETRY_DELAY_MS);
        }
      }
    }

    throw lastError || new Error('Failed to fetch usage data after retries');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private broadcastUpdate(): void {
    // Send update to all browser windows
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('claude-usage:update', this.cachedUsage);
      }
    }
  }
}

// Singleton instance
export const claudeUsageService = new ClaudeUsageServiceImpl();
