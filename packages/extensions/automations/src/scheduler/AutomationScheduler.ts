/**
 * AutomationScheduler - Discovers automation files and manages timer execution.
 *
 * Runs in the renderer process via the extension's activate() hook.
 * Uses setTimeout chains for scheduling (not setInterval).
 */

import type { AutomationStatus } from '../frontmatter/types';
import { parseAutomationStatus, extractPromptBody, updateAutomationStatus } from '../frontmatter/parser';
import { calculateNextRun, msUntilNextRun } from './scheduleUtils';

interface ExtensionFileSystem {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  fileExists: (path: string) => Promise<boolean>;
  findFiles: (pattern: string) => Promise<string[]>;
}

interface ExtensionUI {
  showInfo: (message: string) => void;
  showWarning: (message: string) => void;
  showError: (message: string) => void;
}

interface ScheduledAutomation {
  filePath: string;
  status: AutomationStatus;
  timerId: ReturnType<typeof setTimeout> | null;
}

/** Callback invoked when an automation fires. */
export type OnAutomationFire = (
  filePath: string,
  status: AutomationStatus,
  prompt: string,
) => Promise<string>;

export class AutomationScheduler {
  private automations = new Map<string, ScheduledAutomation>();
  private fs: ExtensionFileSystem;
  private ui: ExtensionUI;
  private onFire: OnAutomationFire | null = null;
  private disposed = false;

  constructor(fs: ExtensionFileSystem, ui: ExtensionUI) {
    this.fs = fs;
    this.ui = ui;
  }

  /** Set the callback invoked when an automation timer fires. */
  setOnFire(callback: OnAutomationFire): void {
    this.onFire = callback;
  }

  /** Discover automation files and schedule enabled ones. */
  async initialize(): Promise<void> {
    await this.rescan();
  }

  /** Re-scan the automations directory and update timers. */
  async rescan(): Promise<void> {
    if (this.disposed) return;

    let files: string[];
    try {
      files = await this.fs.findFiles('nimbalyst-local/automations/*.md');
    } catch {
      // Directory might not exist yet
      return;
    }

    const currentPaths = new Set(files);

    // Remove automations whose files no longer exist
    for (const [path, automation] of this.automations) {
      if (!currentPaths.has(path)) {
        this.clearTimer(automation);
        this.automations.delete(path);
      }
    }

    // Add/update automations
    for (const filePath of files) {
      try {
        const content = await this.fs.readFile(filePath);
        const status = parseAutomationStatus(content);
        if (!status) continue;

        const existing = this.automations.get(filePath);
        if (existing) {
          // Update status and reschedule if changed
          const scheduleChanged =
            JSON.stringify(existing.status.schedule) !== JSON.stringify(status.schedule) ||
            existing.status.enabled !== status.enabled;

          existing.status = status;
          if (scheduleChanged) {
            this.clearTimer(existing);
            this.scheduleNext(existing);
          }
        } else {
          const automation: ScheduledAutomation = {
            filePath,
            status,
            timerId: null,
          };
          this.automations.set(filePath, automation);
          this.scheduleNext(automation);
        }
      } catch (err) {
        console.error(`[Automations] Failed to read ${filePath}:`, err);
      }
    }
  }

  /** Manually run an automation immediately. */
  async runNow(filePath: string): Promise<void> {
    const automation = this.automations.get(filePath);
    if (!automation) {
      // Try to load it fresh
      try {
        const content = await this.fs.readFile(filePath);
        const status = parseAutomationStatus(content);
        if (!status) {
          this.ui.showError('No valid automation found in this file.');
          return;
        }
        await this.executeAutomation(filePath, status);
      } catch (err) {
        this.ui.showError(`Failed to run automation: ${err}`);
      }
      return;
    }

    await this.executeAutomation(automation.filePath, automation.status);
  }

  /** Get all tracked automations. */
  getAutomations(): Array<{ filePath: string; status: AutomationStatus }> {
    return Array.from(this.automations.values()).map((a) => ({
      filePath: a.filePath,
      status: a.status,
    }));
  }

  /** Clean up all timers. */
  dispose(): void {
    this.disposed = true;
    for (const automation of this.automations.values()) {
      this.clearTimer(automation);
    }
    this.automations.clear();
  }

  private scheduleNext(automation: ScheduledAutomation): void {
    if (this.disposed || !automation.status.enabled) return;

    const ms = msUntilNextRun(automation.status.schedule);
    if (ms === null) return;

    // Cap at ~24 hours to prevent setTimeout overflow issues
    const cappedMs = Math.min(ms, 86_400_000);

    automation.timerId = setTimeout(async () => {
      if (this.disposed) return;

      // Re-check if enough time passed (handles the cap case)
      const now = new Date();
      const nextRun = calculateNextRun(automation.status.schedule, new Date(now.getTime() - 1000));
      if (nextRun && nextRun > now) {
        // Not yet time - reschedule
        this.scheduleNext(automation);
        return;
      }

      await this.executeAutomation(automation.filePath, automation.status);
      // Reschedule for next run
      this.scheduleNext(automation);
    }, cappedMs);
  }

  private clearTimer(automation: ScheduledAutomation): void {
    if (automation.timerId !== null) {
      clearTimeout(automation.timerId);
      automation.timerId = null;
    }
  }

  private async executeAutomation(filePath: string, status: AutomationStatus): Promise<void> {
    if (!this.onFire) {
      console.warn('[Automations] No onFire callback set, skipping execution');
      return;
    }

    this.ui.showInfo(`Running automation: ${status.title}`);

    try {
      // Read fresh content to get the latest prompt
      const content = await this.fs.readFile(filePath);
      const prompt = extractPromptBody(content);

      const response = await this.onFire(filePath, status, prompt);

      // Update frontmatter with run results
      const now = new Date().toISOString();
      const nextRun = calculateNextRun(status.schedule);
      const freshContent = await this.fs.readFile(filePath);
      const updated = updateAutomationStatus(freshContent, {
        lastRun: now,
        lastRunStatus: 'success',
        lastRunError: undefined,
        nextRun: nextRun?.toISOString(),
        runCount: (status.runCount ?? 0) + 1,
      });
      await this.fs.writeFile(filePath, updated);

      // Update in-memory status
      const tracked = this.automations.get(filePath);
      if (tracked) {
        tracked.status = {
          ...tracked.status,
          lastRun: now,
          lastRunStatus: 'success',
          lastRunError: undefined,
          nextRun: nextRun?.toISOString(),
          runCount: (status.runCount ?? 0) + 1,
        };
      }

      this.ui.showInfo(`Automation "${status.title}" completed. Output: ${response.slice(0, 100)}...`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Update frontmatter with error
      try {
        const freshContent = await this.fs.readFile(filePath);
        const updated = updateAutomationStatus(freshContent, {
          lastRun: new Date().toISOString(),
          lastRunStatus: 'error',
          lastRunError: errorMsg,
        });
        await this.fs.writeFile(filePath, updated);
      } catch {
        // Best effort
      }

      this.ui.showError(`Automation "${status.title}" failed: ${errorMsg}`);
    }
  }
}
