/**
 * CodexUsageService - Tracks OpenAI Codex usage limits
 *
 * This service:
 * - Reads Codex CLI session files from ~/.codex/sessions/
 * - Extracts rate_limits data from token_count events in JSONL files
 * - Implements activity-aware polling (active when using Codex, sleeps when idle)
 * - Broadcasts usage updates to renderer via IPC
 *
 * Only works for subscription users (ChatGPT Plus/Pro) - API key users
 * get null rate_limits and the indicator won't show.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';

export interface CodexUsageData {
  fiveHour: {
    utilization: number; // 0-100 percentage
    resetsAt: string | null; // ISO timestamp
  };
  sevenDay: {
    utilization: number;
    resetsAt: string | null;
  };
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: number | null;
  };
  lastUpdated: number; // Unix timestamp
  error?: string;
}

interface CodexRateLimits {
  limit_id?: string;
  primary?: {
    used_percent: number;
    window_minutes: number;
    resets_at: number; // Unix seconds
  } | null;
  secondary?: {
    used_percent: number;
    window_minutes: number;
    resets_at: number; // Unix seconds
  } | null;
  credits?: {
    has_credits: boolean;
    unlimited: boolean;
    balance: number | null;
  } | null;
}

const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes before going to sleep
const MAX_FILES_TO_CHECK = 5; // Check up to N recent session files for rate_limits

class CodexUsageServiceImpl {
  private cachedUsage: CodexUsageData | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastActivityTime: number = 0;
  private isPolling: boolean = false;
  private isSleeping: boolean = true;

  initialize(): void {
    logger.main.info('[CodexUsageService] Initialized (sleeping until activity detected)');
  }

  async recordActivity(): Promise<void> {
    this.lastActivityTime = Date.now();

    if (this.isSleeping) {
      logger.main.info('[CodexUsageService] Waking up due to activity');
      this.isSleeping = false;
      this.startPolling();
      await this.refresh();
    }
  }

  getCachedUsage(): CodexUsageData | null {
    return this.cachedUsage;
  }

  async refresh(): Promise<CodexUsageData> {
    try {
      const rateLimits = await this.findLatestRateLimits();
      logger.main.debug('[CodexUsageService] findLatestRateLimits result:', rateLimits ? 'found data' : 'null');
      if (!rateLimits) {
        const noData: CodexUsageData = {
          fiveHour: { utilization: 0, resetsAt: null },
          sevenDay: { utilization: 0, resetsAt: null },
          lastUpdated: Date.now(),
          error: 'No Codex usage data found. Use Codex CLI with a ChatGPT subscription to see usage.',
        };
        this.cachedUsage = noData;
        this.broadcastUpdate();
        return noData;
      }

      const usageData = this.convertRateLimits(rateLimits);
      this.cachedUsage = usageData;
      this.broadcastUpdate();
      return usageData;
    } catch (error) {
      logger.main.error('[CodexUsageService] Error refreshing usage:', error);
      const errorData: CodexUsageData = {
        fiveHour: { utilization: 0, resetsAt: null },
        sevenDay: { utilization: 0, resetsAt: null },
        lastUpdated: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error reading Codex session files',
      };
      this.cachedUsage = errorData;
      this.broadcastUpdate();
      return errorData;
    }
  }

  stop(): void {
    this.stopPolling();
    logger.main.info('[CodexUsageService] Stopped');
  }

  private startPolling(): void {
    if (this.isPolling) return;

    this.isPolling = true;
    this.pollTimer = setInterval(() => {
      this.pollTick();
    }, POLL_INTERVAL_MS);

    logger.main.info('[CodexUsageService] Started polling (every 5 minutes)');
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
  }

  private async pollTick(): Promise<void> {
    const timeSinceActivity = Date.now() - this.lastActivityTime;
    if (timeSinceActivity > IDLE_TIMEOUT_MS) {
      logger.main.info('[CodexUsageService] Going to sleep due to inactivity');
      this.isSleeping = true;
      this.stopPolling();
      return;
    }

    await this.refresh();
  }

  /**
   * Find the latest rate_limits data from recent Codex session files.
   * Walks the session directory tree to find the most recent files,
   * then reads them to extract rate_limits from token_count events.
   */
  private async findLatestRateLimits(): Promise<CodexRateLimits | null> {
    if (!existsSync(CODEX_SESSIONS_DIR)) {
      logger.main.debug('[CodexUsageService] Sessions directory does not exist:', CODEX_SESSIONS_DIR);
      return null;
    }

    const recentFiles = await this.getRecentSessionFiles();
    logger.main.debug('[CodexUsageService] Found session files:', recentFiles.length);
    if (recentFiles.length === 0) {
      return null;
    }

    // Check files from most recent to oldest
    for (const filePath of recentFiles.slice(0, MAX_FILES_TO_CHECK)) {
      logger.main.debug('[CodexUsageService] Checking file:', filePath);
      const rateLimits = await this.extractRateLimitsFromFile(filePath);
      if (rateLimits) {
        logger.main.debug('[CodexUsageService] Found rate_limits in file');
        return rateLimits;
      }
    }

    return null;
  }

  /**
   * Get recent session files sorted by modification time (newest first).
   */
  private async getRecentSessionFiles(): Promise<string[]> {
    const files: Array<{ path: string; mtime: number }> = [];

    try {
      // Walk year/month/day directory structure
      const years = await this.getSortedSubdirs(CODEX_SESSIONS_DIR);
      // Check most recent years first (reversed)
      for (const year of years.reverse().slice(0, 2)) {
        const yearPath = join(CODEX_SESSIONS_DIR, year);
        const months = await this.getSortedSubdirs(yearPath);
        for (const month of months.reverse().slice(0, 2)) {
          const monthPath = join(yearPath, month);
          const days = await this.getSortedSubdirs(monthPath);
          for (const day of days.reverse().slice(0, 3)) {
            const dayPath = join(monthPath, day);
            const entries = await readdir(dayPath);
            const jsonlFiles = entries.filter((f: string) => f.endsWith('.jsonl') && f.startsWith('rollout-'));

            for (const file of jsonlFiles) {
              const filePath = join(dayPath, file);
              try {
                const fileStat = await stat(filePath);
                files.push({ path: filePath, mtime: fileStat.mtimeMs });
              } catch {
                // Skip files we can't stat
              }
            }
          }
          // If we have enough files, stop searching
          if (files.length >= MAX_FILES_TO_CHECK) break;
        }
        if (files.length >= MAX_FILES_TO_CHECK) break;
      }
    } catch (error) {
      logger.main.debug('[CodexUsageService] Error walking session directory:', error);
    }

    // Sort by modification time, newest first
    files.sort((a, b) => b.mtime - a.mtime);
    return files.map((f: { path: string; mtime: number }) => f.path);
  }

  private async getSortedSubdirs(dirPath: string): Promise<string[]> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Extract the last rate_limits with non-null primary from a JSONL file.
   * Reads the entire file and scans for token_count events.
   */
  private async extractRateLimitsFromFile(filePath: string): Promise<CodexRateLimits | null> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split('\n');

      // Scan from the end for the last token_count event with non-null primary
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const event = JSON.parse(line);
          const rateLimits = this.extractRateLimitsFromEvent(event);
          if (rateLimits) {
            return rateLimits;
          }
        } catch {
          // Skip unparseable lines
        }
      }
    } catch (error) {
      logger.main.debug(`[CodexUsageService] Error reading file ${filePath}:`, error);
    }

    return null;
  }

  /**
   * Extract rate_limits from a single JSONL event if it's a token_count event
   * with non-null primary data.
   */
  private extractRateLimitsFromEvent(event: Record<string, unknown>): CodexRateLimits | null {
    // Handle both wrapped (event_msg -> payload) and direct token_count events
    let tokenCountPayload: Record<string, unknown> | null = null;

    if (event.type === 'event_msg') {
      const payload = event.payload as Record<string, unknown> | undefined;
      if (payload?.type === 'token_count') {
        tokenCountPayload = payload;
      }
    } else if (event.type === 'token_count') {
      tokenCountPayload = event;
    }

    if (!tokenCountPayload) return null;

    const rateLimits = tokenCountPayload.rate_limits as CodexRateLimits | undefined;
    if (!rateLimits?.primary) return null;

    return rateLimits;
  }

  private convertRateLimits(rateLimits: CodexRateLimits): CodexUsageData {
    const data: CodexUsageData = {
      fiveHour: {
        utilization: rateLimits.primary?.used_percent ?? 0,
        resetsAt: rateLimits.primary?.resets_at
          ? new Date(rateLimits.primary.resets_at * 1000).toISOString()
          : null,
      },
      sevenDay: {
        utilization: rateLimits.secondary?.used_percent ?? 0,
        resetsAt: rateLimits.secondary?.resets_at
          ? new Date(rateLimits.secondary.resets_at * 1000).toISOString()
          : null,
      },
      lastUpdated: Date.now(),
    };

    if (rateLimits.credits) {
      data.credits = {
        hasCredits: rateLimits.credits.has_credits,
        unlimited: rateLimits.credits.unlimited,
        balance: rateLimits.credits.balance,
      };
    }

    return data;
  }

  private broadcastUpdate(): void {
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('codex-usage:update', this.cachedUsage);
      }
    }
  }
}

// Singleton instance
export const codexUsageService = new CodexUsageServiceImpl();
