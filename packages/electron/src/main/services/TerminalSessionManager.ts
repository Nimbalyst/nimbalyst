/**
 * TerminalSessionManager - Manages PTY processes for terminal sessions
 *
 * Responsibilities:
 * - Create/destroy PTY processes using node-pty
 * - Manage terminal lifecycle (spawn, write, resize, kill)
 * - Store scrollback buffer (limited to 500KB)
 * - Handle PTY output → IPC events
 * - State persistence on close
 */

import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';
import { AISessionsRepository } from '@nimbalyst/runtime';
import { ShellDetector, type ShellInfo } from './ShellDetector';

// Maximum scrollback buffer size (500KB)
const MAX_SCROLLBACK_SIZE = 500 * 1024;
const SCROLLBACK_PERSIST_DEBOUNCE_MS = 1000;
const TERMINAL_HISTORY_SUBDIR = 'terminal-history';

interface TerminalMetadata {
  shell?: string;
  shellPath?: string;
  cwd?: string;
  historyFile?: string;
  scrollback?: string;
  scrollbackUpdatedAt?: number;
}

function escapeForPosixShell(value: string): string {
  return `"${value.replace(/(["$`\\])/g, '\\$1')}"`;
}

function escapeForPowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

export interface TerminalOptions {
  cwd?: string;
  shell?: ShellInfo;
  cols?: number;
  rows?: number;
}

export interface TerminalProcess {
  pty: IPty;
  sessionId: string;
  scrollbackBuffer: string;
  cwd: string;
  shell: ShellInfo;
  cols: number;
  rows: number;
  historyFile: string;
  metadata: TerminalMetadata;
  isPersisting?: boolean;
  hasPendingPersist?: boolean;
  pendingForcePersist?: boolean;
}

interface ShellBootstrapConfig {
  args?: string[];
  env?: Record<string, string>;
}

export class TerminalSessionManager {
  private terminals = new Map<string, TerminalProcess>();
  private scrollbackPersistTimers = new Map<string, NodeJS.Timeout>();
  private historyDirPromise: Promise<string> | null = null;
  private bootstrapDirPromise: Promise<string> | null = null;

  private async getHistoryDirectory(): Promise<string> {
    if (!this.historyDirPromise) {
      this.historyDirPromise = (async () => {
        if (!app.isReady()) {
          await app.whenReady();
        }
        const dir = path.join(app.getPath('userData'), TERMINAL_HISTORY_SUBDIR);
        await fs.mkdir(dir, { recursive: true });
        return dir;
      })();
    }

    return this.historyDirPromise;
  }

  private async getBootstrapDirectory(): Promise<string> {
    if (!this.bootstrapDirPromise) {
      this.bootstrapDirPromise = (async () => {
        const dir = path.join(os.tmpdir(), 'nimbalyst-terminal-bootstrap');
        await fs.mkdir(dir, { recursive: true });
        return dir;
      })();
    }

    return this.bootstrapDirPromise;
  }

  private async ensureHistoryFile(sessionId: string, existingPath?: string): Promise<string> {
    const baseDir = await this.getHistoryDirectory();
    let historyPath = existingPath && path.isAbsolute(existingPath) ? existingPath : path.join(baseDir, `${sessionId}.history`);

    try {
      await fs.mkdir(path.dirname(historyPath), { recursive: true });
      await fs.writeFile(historyPath, '', { flag: 'a' });
    } catch (error) {
      console.warn(`[TerminalSessionManager] Failed to prepare history file at ${historyPath}, using default`, error);
      historyPath = path.join(baseDir, `${sessionId}.history`);
      await fs.writeFile(historyPath, '', { flag: 'a' });
    }

    return historyPath;
  }

  private async loadStoredTerminalMetadata(sessionId: string): Promise<TerminalMetadata | null> {
    try {
      const session = await AISessionsRepository.get(sessionId);
      const metadata = (session?.metadata as { terminal?: TerminalMetadata } | undefined)?.terminal;
      if (!metadata) {
        return null;
      }

      return {
        shell: typeof metadata.shell === 'string' ? metadata.shell : undefined,
        shellPath: typeof metadata.shellPath === 'string' ? metadata.shellPath : undefined,
        cwd: typeof metadata.cwd === 'string' ? metadata.cwd : undefined,
        historyFile: typeof metadata.historyFile === 'string' ? metadata.historyFile : undefined,
        scrollback: typeof metadata.scrollback === 'string' ? metadata.scrollback : undefined,
        scrollbackUpdatedAt: typeof metadata.scrollbackUpdatedAt === 'number' ? metadata.scrollbackUpdatedAt : undefined,
      };
    } catch (error) {
      console.error(`[TerminalSessionManager] Failed to load stored metadata for ${sessionId}:`, error);
      return null;
    }
  }

  async getStoredScrollback(sessionId: string): Promise<string | null> {
    const metadata = await this.loadStoredTerminalMetadata(sessionId);
    return metadata?.scrollback ?? null;
  }

  private scheduleScrollbackPersist(sessionId: string): void {
    if (this.scrollbackPersistTimers.has(sessionId)) {
      return;
    }

    const timeout = setTimeout(() => {
      this.scrollbackPersistTimers.delete(sessionId);
      this.persistScrollback(sessionId).catch(error => {
        console.error(`[TerminalSessionManager] Failed to persist scrollback for ${sessionId}:`, error);
      });
    }, SCROLLBACK_PERSIST_DEBOUNCE_MS);

    this.scrollbackPersistTimers.set(sessionId, timeout);
  }

  private clearScrollbackTimer(sessionId: string): void {
    const timer = this.scrollbackPersistTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.scrollbackPersistTimers.delete(sessionId);
    }
  }

  private async persistTerminalState(sessionId: string, terminal: TerminalProcess, options: { force?: boolean } = {}): Promise<void> {
    const previous = terminal.metadata ?? {};
    const scrollback = terminal.scrollbackBuffer;
    const metadata: TerminalMetadata = {
      shell: terminal.shell.name,
      shellPath: terminal.shell.path,
      cwd: terminal.cwd,
      historyFile: terminal.historyFile,
      scrollback,
      scrollbackUpdatedAt: options.force || previous.scrollback !== scrollback ? Date.now() : previous.scrollbackUpdatedAt,
    };

    const changed =
      options.force ||
      previous.shell !== metadata.shell ||
      previous.shellPath !== metadata.shellPath ||
      previous.cwd !== metadata.cwd ||
      previous.historyFile !== metadata.historyFile ||
      previous.scrollback !== metadata.scrollback;

    if (!changed) {
      return;
    }

    terminal.metadata = metadata;

    try {
      await AISessionsRepository.updateMetadata(sessionId, {
        metadata: {
          terminal: metadata,
        },
      });
    } catch (error) {
      console.error(`[TerminalSessionManager] Failed to update terminal metadata for ${sessionId}:`, error);
    }
  }

  private async persistScrollback(sessionId: string, options: { force?: boolean } = {}): Promise<void> {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      return;
    }

    if (terminal.isPersisting) {
      terminal.hasPendingPersist = true;
      terminal.pendingForcePersist = terminal.pendingForcePersist || Boolean(options.force);
      return;
    }

    terminal.isPersisting = true;

    try {
      if (terminal.scrollbackBuffer.length > MAX_SCROLLBACK_SIZE) {
        terminal.scrollbackBuffer = terminal.scrollbackBuffer.slice(-MAX_SCROLLBACK_SIZE);
      }
      await this.persistTerminalState(sessionId, terminal, { force: options.force });
    } catch (error) {
      console.error(`[TerminalSessionManager] Error persisting scrollback for ${sessionId}:`, error);
    } finally {
      terminal.isPersisting = false;
      if (terminal.hasPendingPersist) {
        const pendingForce = terminal.pendingForcePersist;
        terminal.hasPendingPersist = false;
        terminal.pendingForcePersist = false;
        await this.persistScrollback(sessionId, { force: pendingForce });
      }
    }
  }

  private async prepareShellBootstrap(sessionId: string, shell: ShellInfo, historyFile: string): Promise<ShellBootstrapConfig | null> {
    const shellName = shell.name?.toLowerCase() || '';
    const initCommand = this.getHistoryInitCommand(shell, historyFile);
    if (!initCommand) {
      return null;
    }

    if (shellName.includes('zsh')) {
      return this.prepareZshBootstrap(sessionId, initCommand);
    }

    if (shellName.includes('bash')) {
      return this.prepareBashBootstrap(sessionId, initCommand, shell.args);
    }

    if (shellName.includes('powershell') || shellName.includes('pwsh')) {
      return this.preparePowerShellBootstrap(initCommand, shell.args);
    }

    return null;
  }

  private getHistoryInitCommand(shell: ShellInfo, historyFile: string): string | null {
    const shellName = shell?.name?.toLowerCase() || '';
    if (!historyFile || !shellName) {
      return null;
    }

    if (shellName.includes('powershell') || shellName.includes('pwsh')) {
      const escaped = escapeForPowerShell(historyFile);
      return `$ErrorActionPreference='SilentlyContinue'; if (Get-Command Set-PSReadLineOption -ErrorAction Ignore) { Set-PSReadLineOption -HistorySavePath '${escaped}'; try { [Microsoft.PowerShell.PSConsoleReadLine]::ClearHistory(); if (Test-Path '${escaped}') { [Microsoft.PowerShell.PSConsoleReadLine]::ReadHistoryFile('${escaped}') } } catch { } }`;
    }

    if (shellName.includes('cmd')) {
      // cmd.exe does not support persistent history
      return null;
    }

    const escaped = escapeForPosixShell(historyFile);

    if (shellName.includes('zsh')) {
      return `export HISTFILE=${escaped}; setopt INC_APPEND_HISTORY SHARE_HISTORY; fc -R ${escaped} 2>/dev/null || true`;
    }

    if (shellName.includes('fish')) {
      // Fish ties history to named stores rather than arbitrary file paths.
      // For now we rely on fish's default behavior.
      return null;
    }

    // Default to bash / sh style history commands
    return `export HISTFILE=${escaped}; history -c; history -r ${escaped} 2>/dev/null || true`;
  }

  private async prepareBashBootstrap(sessionId: string, initCommand: string, baseArgs: string[]): Promise<ShellBootstrapConfig> {
    const bootstrapDir = await this.getBootstrapDirectory();
    const rcfilePath = path.join(bootstrapDir, `${sessionId}-bashrc`);
    const homeDir = app.getPath('home');
    const userRcPath = path.join(homeDir, '.bashrc');
    const userRcEscaped = escapeForPosixShell(userRcPath);

    const rcfileContent = [
      '# Auto-generated by TerminalSessionManager',
      'if [ -f /etc/bashrc ]; then',
      '  . /etc/bashrc',
      'elif [ -f /etc/bash.bashrc ]; then',
      '  . /etc/bash.bashrc',
      'fi',
      `if [ -f ${userRcEscaped} ]; then`,
      `  . ${userRcEscaped}`,
      'fi',
      '',
      'if [ -z "$NIMBALYST_HISTORY_BOOTSTRAPPED" ]; then',
      '  export NIMBALYST_HISTORY_BOOTSTRAPPED=1',
      `  ${initCommand}`,
      'fi',
      '',
    ].join('\n');

    await fs.writeFile(rcfilePath, rcfileContent, 'utf8');

    const args = [...baseArgs];
    args.push('--rcfile', rcfilePath);
    if (!args.some(arg => arg === '-i' || arg === '--interactive')) {
      args.push('-i');
    }

    return { args };
  }

  private async prepareZshBootstrap(sessionId: string, initCommand: string): Promise<ShellBootstrapConfig> {
    const bootstrapDir = await this.getBootstrapDirectory();
    const zshDir = path.join(bootstrapDir, `${sessionId}-zsh`);
    await fs.mkdir(zshDir, { recursive: true });

    const originalZdotdir = process.env.ZDOTDIR || app.getPath('home');
    const escapedOriginal = escapeForPosixShell(originalZdotdir);

    const zshenvContent = [
      '# Auto-generated by TerminalSessionManager',
      'if [ -z "$__NIMBALYST_ORIGINAL_ZDOTDIR" ]; then',
      `  export __NIMBALYST_ORIGINAL_ZDOTDIR=${escapedOriginal}`,
      'fi',
      'if [ -f "$__NIMBALYST_ORIGINAL_ZDOTDIR/.zshenv" ]; then',
      '  source "$__NIMBALYST_ORIGINAL_ZDOTDIR/.zshenv"',
      'fi',
      '',
    ].join('\n');

    const zshrcContent = [
      '# Auto-generated by TerminalSessionManager',
      'if [ -z "$__NIMBALYST_ORIGINAL_ZDOTDIR" ]; then',
      `  export __NIMBALYST_ORIGINAL_ZDOTDIR=${escapedOriginal}`,
      'fi',
      'export ZDOTDIR="$__NIMBALYST_ORIGINAL_ZDOTDIR"',
      'if [ -f "$__NIMBALYST_ORIGINAL_ZDOTDIR/.zshrc" ]; then',
      '  source "$__NIMBALYST_ORIGINAL_ZDOTDIR/.zshrc"',
      'fi',
      '',
      'if [ -z "$NIMBALYST_HISTORY_BOOTSTRAPPED" ]; then',
      '  export NIMBALYST_HISTORY_BOOTSTRAPPED=1',
      `  ${initCommand}`,
      'fi',
      '',
    ].join('\n');

    await fs.writeFile(path.join(zshDir, '.zshenv'), zshenvContent, 'utf8');
    await fs.writeFile(path.join(zshDir, '.zshrc'), zshrcContent, 'utf8');

    return {
      env: {
        ZDOTDIR: zshDir,
      },
    };
  }

  private preparePowerShellBootstrap(initCommand: string, baseArgs: string[]): ShellBootstrapConfig {
    const bootstrapScript = [
      'if (-not (Test-Path Env:NIMBALYST_HISTORY_BOOTSTRAPPED)) {',
      "  $env:NIMBALYST_HISTORY_BOOTSTRAPPED = '1';",
      `  ${initCommand}`,
      '}',
    ].join('\n');

    const args = [...baseArgs];
    args.push('-Command', `& { ${bootstrapScript} }`);

    return { args };
  }

  /**
   * Create a new terminal for a session
   */
  async createTerminal(sessionId: string, options: TerminalOptions = {}): Promise<void> {
    // If terminal already exists, just return
    if (this.terminals.has(sessionId)) {
      console.log(`[TerminalSessionManager] Terminal ${sessionId} already exists`);
      return;
    }

    const storedMetadata = await this.loadStoredTerminalMetadata(sessionId);

    // Get shell info
    const shell = options.shell || ShellDetector.getDefaultShell();
    const cwd = options.cwd || storedMetadata?.cwd || process.cwd();
    const cols = options.cols || 80;
    const rows = options.rows || 30;
    const historyFile = await this.ensureHistoryFile(sessionId, storedMetadata?.historyFile);
    let scrollbackBuffer = storedMetadata?.scrollback || '';
    if (scrollbackBuffer.length > MAX_SCROLLBACK_SIZE) {
      scrollbackBuffer = scrollbackBuffer.slice(-MAX_SCROLLBACK_SIZE);
    }

    const bootstrapConfig = await this.prepareShellBootstrap(sessionId, shell, historyFile);
    const spawnArgs = bootstrapConfig?.args || shell.args;
    const spawnEnv: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
      HISTFILE: historyFile,
      HISTCONTROL: process.env.HISTCONTROL || 'ignoredups:erasedups',
      HISTSIZE: process.env.HISTSIZE || '10000',
      HISTFILESIZE: process.env.HISTFILESIZE || '20000',
    };

    if (bootstrapConfig?.env) {
      Object.assign(spawnEnv, bootstrapConfig.env);
    }

    console.log(`[TerminalSessionManager] Creating terminal ${sessionId} with shell: ${shell.path}`);

    // Create PTY process
    const ptyProcess = pty.spawn(shell.path, spawnArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: spawnEnv,
    });

    const terminalProcess: TerminalProcess = {
      pty: ptyProcess,
      sessionId,
      scrollbackBuffer,
      cwd,
      shell,
      cols,
      rows,
      historyFile,
      metadata: storedMetadata || {},
      isPersisting: false,
      hasPendingPersist: false,
      pendingForcePersist: false,
    };

    // Handle output from PTY
    ptyProcess.onData((data: string) => {
      // Append to scrollback buffer (with size limit)
      terminalProcess.scrollbackBuffer += data;
      if (terminalProcess.scrollbackBuffer.length > MAX_SCROLLBACK_SIZE) {
        terminalProcess.scrollbackBuffer = terminalProcess.scrollbackBuffer.slice(-MAX_SCROLLBACK_SIZE);
      }

      this.scheduleScrollbackPersist(sessionId);

      // Send to all windows
      this.broadcastToWindows('terminal:output', {
        sessionId,
        data,
      });
    });

    // Handle PTY exit
    ptyProcess.onExit(async ({ exitCode }) => {
      console.log(`[TerminalSessionManager] Terminal ${sessionId} exited with code ${exitCode}`);

      this.clearScrollbackTimer(sessionId);
      await this.persistScrollback(sessionId, { force: true });

      // Send exit event to all windows
      this.broadcastToWindows('terminal:exited', {
        sessionId,
        exitCode,
      });

      // Remove from map
      this.terminals.delete(sessionId);
    });

    // Persist initial state before adding to map to avoid race with quick exit
    await this.persistTerminalState(sessionId, terminalProcess, { force: true });

    this.terminals.set(sessionId, terminalProcess);
  }

  /**
   * Check if a terminal exists and is active
   */
  isTerminalActive(sessionId: string): boolean {
    return this.terminals.has(sessionId);
  }

  /**
   * Write data to a terminal (user input)
   */
  writeToTerminal(sessionId: string, data: string): void {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.pty.write(data);
    } else {
      console.warn(`[TerminalSessionManager] Cannot write to terminal ${sessionId}: not found`);
    }
  }

  /**
   * Resize a terminal
   */
  resizeTerminal(sessionId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.pty.resize(cols, rows);
      terminal.cols = cols;
      terminal.rows = rows;
    }
  }

  /**
   * Get the scrollback buffer for a terminal
   */
  getScrollbackBuffer(sessionId: string): string | null {
    const terminal = this.terminals.get(sessionId);
    return terminal?.scrollbackBuffer || null;
  }

  /**
   * Destroy a terminal
   */
  async destroyTerminal(sessionId: string): Promise<void> {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      return;
    }

    console.log(`[TerminalSessionManager] Destroying terminal ${sessionId}`);
    this.clearScrollbackTimer(sessionId);
    await this.persistScrollback(sessionId, { force: true });

    try {
      terminal.pty.kill();
    } catch (error) {
      console.warn(`[TerminalSessionManager] Failed to kill terminal ${sessionId}:`, error);
    }

    this.terminals.delete(sessionId);
  }

  /**
   * Destroy all terminals (used on app quit)
   */
  async destroyAllTerminals(): Promise<void> {
    console.log(`[TerminalSessionManager] Destroying all terminals (${this.terminals.size} active)`);
    const sessionIds = Array.from(this.terminals.keys());
    for (const sessionId of sessionIds) {
      await this.destroyTerminal(sessionId);
    }
  }

  /**
   * Get terminal info for a session
   */
  getTerminalInfo(sessionId: string): { shell: ShellInfo; cwd: string; cols: number; rows: number; historyFile?: string } | null {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) return null;

    return {
      shell: terminal.shell,
      cwd: terminal.cwd,
      cols: terminal.cols,
      rows: terminal.rows,
      historyFile: terminal.historyFile,
    };
  }

  /**
   * Broadcast a message to all windows
   */
  private broadcastToWindows(channel: string, data: any): void {
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, data);
      }
    }
  }
}

// Singleton instance
let terminalSessionManager: TerminalSessionManager | null = null;

export function getTerminalSessionManager(): TerminalSessionManager {
  if (!terminalSessionManager) {
    terminalSessionManager = new TerminalSessionManager();
  }
  return terminalSessionManager;
}
