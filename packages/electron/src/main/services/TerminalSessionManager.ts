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

import type { IPty } from 'node-pty';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { createRequire } from 'module';

// Load node-pty using explicit path resolution.
// In packaged builds, node-pty is in Resources/node-pty.
// IMPORTANT: The path must NOT contain "app.asar" because node-pty's unixTerminal.js
// does helperPath.replace('app.asar', 'app.asar.unpacked') which incorrectly transforms
// paths already containing "app.asar.unpacked" into "app.asar.unpacked.unpacked".
function loadNodePty(): typeof import('node-pty') {
  if (app.isPackaged) {
    const ptyPath = path.join(
      process.resourcesPath,
      'node-pty'
    );
    const require = createRequire(import.meta.url);
    return require(ptyPath);
  } else {
    // In dev mode, normal require works
    const require = createRequire(import.meta.url);
    return require('node-pty');
  }
}

const pty = loadNodePty();
import { promises as fs, existsSync } from 'fs';
import os from 'os';
import { ShellDetector, type ShellInfo } from './ShellDetector';
import { getEnhancedPath } from './CLIManager';
import {
  getTerminalInstance,
  updateTerminalInstance,
  readScrollback,
  writeScrollback,
  deleteScrollbackFile,
} from '../utils/terminalStore';

// Maximum scrollback buffer size (500KB)
const MAX_SCROLLBACK_SIZE = 500 * 1024;
const SCROLLBACK_PERSIST_DEBOUNCE_MS = 1000;
const TERMINAL_HISTORY_SUBDIR = 'terminal-history';

// OSC 7 escape sequence pattern: \033]7;file://hostname/path\033\\ or \033]7;file://hostname/path\007
// Also handles the BEL terminator (\x07) and ST terminator (\x1b\\)
const OSC7_REGEX = /\x1b\]7;file:\/\/[^\/]*([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;

// OSC 998 escape sequence pattern for command state tracking
// Format: \033]998;cmd-start\033\\ or \033]998;cmd-end\033\\
// Also handles BEL terminator (\x07)
const OSC_COMMAND_STATE_REGEX = /\x1b\]998;(cmd-start|cmd-end)(?:\x07|\x1b\\)/g;

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
  /** Workspace path for store lookups */
  workspacePath?: string;
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
  /** Workspace path for store lookups */
  workspacePath?: string;
  /** Whether a command is currently running in this terminal */
  isCommandRunning?: boolean;
}

interface ShellBootstrapConfig {
  args?: string[];
  env?: Record<string, string>;
}

interface SpawnConfig {
  executable: string;
  args: string[];
  cwd: string;
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

  /**
   * Load stored terminal metadata from the terminal store
   * @param terminalId Terminal ID
   * @param workspacePath Workspace path (required for store lookup)
   */
  private async loadStoredTerminalMetadata(terminalId: string, workspacePath?: string): Promise<TerminalMetadata | null> {
    try {
      // If no workspace path provided, we can't look up the terminal
      if (!workspacePath) {
        return null;
      }

      const instance = getTerminalInstance(workspacePath, terminalId);
      if (!instance) {
        return null;
      }

      // Load scrollback from file
      const scrollback = await readScrollback(terminalId);

      return {
        shell: instance.shellName,
        shellPath: instance.shellPath,
        cwd: instance.cwd,
        historyFile: instance.historyFile,
        scrollback: scrollback ?? undefined,
        scrollbackUpdatedAt: instance.lastActiveAt,
      };
    } catch (error) {
      console.error(`[TerminalSessionManager] Failed to load stored metadata for ${terminalId}:`, error);
      return null;
    }
  }

  /**
   * Get stored scrollback from file
   */
  async getStoredScrollback(terminalId: string): Promise<string | null> {
    return readScrollback(terminalId);
  }

  /**
   * Clear scrollback buffer (used when scrollback data is corrupted)
   * Removes both in-memory buffer and persisted file
   */
  async clearScrollback(terminalId: string): Promise<void> {
    console.log(`[TerminalSessionManager] Clearing scrollback for ${terminalId}`);

    // Clear in-memory buffer if terminal is active
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      terminal.scrollbackBuffer = '';
      terminal.metadata.scrollback = '';
    }

    // Delete the scrollback file
    await deleteScrollbackFile(terminalId);
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

  /**
   * Persist terminal state to the terminal store and scrollback file
   */
  private async persistTerminalState(terminalId: string, terminal: TerminalProcess, options: { force?: boolean } = {}): Promise<void> {
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

    const metadataChanged =
      options.force ||
      previous.shell !== metadata.shell ||
      previous.shellPath !== metadata.shellPath ||
      previous.cwd !== metadata.cwd ||
      previous.historyFile !== metadata.historyFile;

    const scrollbackChanged = previous.scrollback !== metadata.scrollback;

    if (!metadataChanged && !scrollbackChanged) {
      return;
    }

    terminal.metadata = metadata;

    try {
      // Persist scrollback to file if changed
      if (scrollbackChanged) {
        await writeScrollback(terminalId, scrollback);
      }

      // Update terminal instance metadata if we have workspace context
      // Note: The workspace path is stored in the TerminalProcess for new architecture
      if (terminal.workspacePath) {
        updateTerminalInstance(terminal.workspacePath, terminalId, {
          shellName: terminal.shell.name,
          shellPath: terminal.shell.path,
          cwd: terminal.cwd,
          historyFile: terminal.historyFile,
          lastActiveAt: Date.now(),
        });
      }
    } catch (error) {
      console.error(`[TerminalSessionManager] Failed to update terminal state for ${terminalId}:`, error);
    }
  }

  /**
   * Extract CWD from OSC 7 escape sequences in terminal output
   * OSC 7 format: \033]7;file://hostname/path\033\\ or \033]7;file://hostname/path\007
   */
  private extractCwdFromOsc7(data: string): string | null {
    let lastMatch: string | null = null;
    let match;

    // Reset regex state
    OSC7_REGEX.lastIndex = 0;

    while ((match = OSC7_REGEX.exec(data)) !== null) {
      const rawPath = match[1];
      if (rawPath) {
        // Decode URL-encoded path (e.g., %20 -> space)
        try {
          lastMatch = decodeURIComponent(rawPath);
        } catch {
          lastMatch = rawPath;
        }
      }
    }

    return lastMatch;
  }

  /**
   * Extract command state from OSC 998 escape sequences
   * Returns the last state found (cmd-start or cmd-end), or null if none
   */
  private extractCommandState(data: string): 'cmd-start' | 'cmd-end' | null {
    let lastState: 'cmd-start' | 'cmd-end' | null = null;
    let match;

    // Reset regex state
    OSC_COMMAND_STATE_REGEX.lastIndex = 0;

    while ((match = OSC_COMMAND_STATE_REGEX.exec(data)) !== null) {
      lastState = match[1] as 'cmd-start' | 'cmd-end';
    }

    return lastState;
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
    if (shell.cwdMode === 'wsl') {
      // WSL launches its own Linux shell inside wsl.exe. Reusing the native
      // bash/zsh bootstrap flow here would generate Windows-side rc paths that
      // do not map cleanly into the Linux shell startup contract.
      return null;
    }

    const bootstrapMode = shell.bootstrapMode || this.inferBootstrapMode(shell);
    if (bootstrapMode === 'none') {
      return null;
    }

    const shellName = shell.name?.toLowerCase() || '';
    const shellPath = shell.path?.toLowerCase() || '';
    const initCommand = this.getHistoryInitCommand(shell, historyFile);
    if (!initCommand) {
      return null;
    }

    if (bootstrapMode === 'zsh' || shellName.includes('zsh') || shellPath.includes('zsh')) {
      return this.prepareZshBootstrap(sessionId, initCommand);
    }

    // Check both name and path for bash - on some systems the shell name from /etc/passwd
    // might differ from the actual binary name
    if (bootstrapMode === 'bash' || shellName.includes('bash') || shellPath.includes('bash')) {
      return this.prepareBashBootstrap(sessionId, initCommand, shell.args);
    }

    if (bootstrapMode === 'powershell' || shellName.includes('powershell') || shellName.includes('pwsh')) {
      return this.preparePowerShellBootstrap(initCommand, shell.args);
    }

    // For unknown shells (like dash, sh, fish without history support), return null
    // to use default args without custom rcfile that might not be supported
    return null;
  }

  private getHistoryInitCommand(shell: ShellInfo, historyFile: string): string | null {
    const shellName = shell?.name?.toLowerCase() || '';
    const bootstrapMode = shell.bootstrapMode || this.inferBootstrapMode(shell);
    if (!historyFile || !shellName) {
      return null;
    }

    if (bootstrapMode === 'powershell' || shellName.includes('powershell') || shellName.includes('pwsh')) {
      const escaped = escapeForPowerShell(historyFile);
      return `$ErrorActionPreference='SilentlyContinue'; if (Get-Command Set-PSReadLineOption -ErrorAction Ignore) { Set-PSReadLineOption -HistorySavePath '${escaped}'; try { [Microsoft.PowerShell.PSConsoleReadLine]::ClearHistory(); if (Test-Path '${escaped}') { [Microsoft.PowerShell.PSConsoleReadLine]::ReadHistoryFile('${escaped}') } } catch { } }`;
    }

    if (shellName.includes('cmd')) {
      // cmd.exe does not support persistent history
      return null;
    }

    const escaped = escapeForPosixShell(historyFile);

    if (bootstrapMode === 'zsh' || shellName.includes('zsh')) {
      return `export HISTFILE=${escaped}; setopt INC_APPEND_HISTORY SHARE_HISTORY; fc -R ${escaped} 2>/dev/null || true`;
    }

    if (shellName.includes('fish') || bootstrapMode === 'none') {
      // Fish ties history to named stores rather than arbitrary file paths.
      // For now we rely on fish's default behavior.
      return null;
    }

    // Default to bash / sh style history commands
    return `export HISTFILE=${escaped}; history -c; history -r ${escaped} 2>/dev/null || true`;
  }

  private async prepareBashBootstrap(sessionId: string, initCommand: string, baseArgs: string[]): Promise<ShellBootstrapConfig> {
    // Validate sessionId to prevent malformed paths
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length === 0) {
      console.error(`[TerminalSessionManager] Invalid sessionId for bash bootstrap: ${sessionId}`);
      return { args: baseArgs };
    }

    const bootstrapDir = await this.getBootstrapDirectory();
    const rcfilePath = path.join(bootstrapDir, `${sessionId}-bashrc`);
    const homeDir = app.getPath('home');
    const userRcPath = path.join(homeDir, '.bashrc');
    const userRcEscaped = escapeForPosixShell(userRcPath);

    // OSC 7 escape sequence to report current directory
    // Format: \033]7;file://hostname/path\033\\
    // OSC 998 escape sequence to report command state
    // Format: \033]998;cmd-start\033\\ or \033]998;cmd-end\033\\
    const osc7Command = '__nimbalyst_osc7() { printf "\\033]7;file://%s%s\\033\\\\\\\\" "$(hostname)" "$(pwd)"; }';

    const rcfileContent = [
      '# Auto-generated by TerminalSessionManager',
      'if [ -f /etc/profile ]; then',
      '  . /etc/profile',
      'fi',
      'if [ -f "$HOME/.bash_profile" ]; then',
      '  . "$HOME/.bash_profile"',
      'elif [ -f "$HOME/.bash_login" ]; then',
      '  . "$HOME/.bash_login"',
      'elif [ -f "$HOME/.profile" ]; then',
      '  . "$HOME/.profile"',
      'fi',
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
      '',
      '  # OSC 7 CWD tracking',
      `  ${osc7Command}`,
      '',
      '  # OSC 998 command state tracking',
      '  # DEBUG trap fires before each command (command is starting)',
      '  __nimbalyst_cmd_start() { printf "\\033]998;cmd-start\\033\\\\\\\\"; }',
      '  # This function is called in PROMPT_COMMAND (command finished)',
      '  __nimbalyst_cmd_end() { printf "\\033]998;cmd-end\\033\\\\\\\\"; }',
      '',
      '  # Set up DEBUG trap for command start detection',
      '  # Only emit if we are not already in PROMPT_COMMAND',
      '  __nimbalyst_debug_trap() {',
      '    if [[ -z "$__NIMBALYST_IN_PROMPT" ]]; then',
      '      __nimbalyst_cmd_start',
      '    fi',
      '  }',
      '  trap __nimbalyst_debug_trap DEBUG',
      '',
      '  # Wrap PROMPT_COMMAND to emit cmd-end and track state',
      '  __nimbalyst_prompt_cmd() {',
      '    __NIMBALYST_IN_PROMPT=1',
      '    __nimbalyst_cmd_end',
      '    __nimbalyst_osc7',
      '    unset __NIMBALYST_IN_PROMPT',
      '  }',
      '',
      '  if [[ -z "$PROMPT_COMMAND" ]]; then',
      '    PROMPT_COMMAND="__nimbalyst_prompt_cmd"',
      '  elif [[ "$PROMPT_COMMAND" != *"__nimbalyst_prompt_cmd"* ]]; then',
      '    PROMPT_COMMAND="__nimbalyst_prompt_cmd;$PROMPT_COMMAND"',
      '  fi',
      '  __nimbalyst_osc7',
      'fi',
      '',
    ].join('\n');

    await fs.writeFile(rcfilePath, rcfileContent, 'utf8');

    // Verify the rcfile was created
    try {
      await fs.access(rcfilePath);
    } catch {
      console.error(`[TerminalSessionManager] Failed to create bash rcfile at ${rcfilePath}`);
      // Fall back to default args if rcfile creation failed
      return { args: baseArgs };
    }

    // Build args with --rcfile first, then other options
    // Bash requires --rcfile before -i on some Linux systems, otherwise
    // the double-dash prefix can be misinterpreted as an option terminator
    const args = ['--rcfile', rcfilePath];

    // Add -i if not already present in baseArgs
    const hasInteractive = baseArgs.some(arg => arg === '-i' || arg === '--interactive');
    if (!hasInteractive) {
      args.push('-i');
    }

    // Add any remaining args from baseArgs (excluding -i which we handle above)
    for (const arg of baseArgs) {
      if (arg !== '-i' && arg !== '--interactive') {
        args.push(arg);
      }
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

    // OSC 7 escape sequence to report current directory
    // Format: \033]7;file://hostname/path\033\\
    // OSC 998 escape sequence to report command state
    // Format: \033]998;cmd-start\033\\ or \033]998;cmd-end\033\\
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
      '',
      '  # OSC 7 CWD tracking via precmd hook',
      '  __nimbalyst_osc7() { printf "\\033]7;file://%s%s\\033\\\\" "$(hostname)" "$(pwd)"; }',
      '',
      '  # OSC 998 command state tracking',
      '  # preexec fires before command execution (command is running)',
      '  __nimbalyst_cmd_start() { printf "\\033]998;cmd-start\\033\\\\" }',
      '  # precmd fires after command completes, before prompt (command finished)',
      '  __nimbalyst_cmd_end() { printf "\\033]998;cmd-end\\033\\\\" }',
      '',
      '  autoload -Uz add-zsh-hook',
      '  add-zsh-hook preexec __nimbalyst_cmd_start',
      '  add-zsh-hook precmd __nimbalyst_cmd_end',
      '  add-zsh-hook precmd __nimbalyst_osc7',
      '  __nimbalyst_osc7',
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

  private inferBootstrapMode(shell: ShellInfo): NonNullable<ShellInfo['bootstrapMode']> {
    const shellName = shell.name?.toLowerCase() || '';
    const shellPath = shell.path?.toLowerCase() || '';

    if (shellName.includes('zsh') || shellPath.includes('zsh')) {
      return 'zsh';
    }
    if (shellName.includes('bash') || shellPath.includes('bash')) {
      return 'bash';
    }
    if (shellName.includes('powershell') || shellName.includes('pwsh')) {
      return 'powershell';
    }
    return 'none';
  }

  private resolveSpawnConfig(shell: ShellInfo, args: string[], cwd: string): SpawnConfig {
    if (process.platform === 'win32' && shell.cwdMode === 'wsl') {
      const wslCwd = this.translateWindowsPathToWsl(cwd);
      return {
        executable: shell.path,
        args: ['--cd', wslCwd, ...args],
        cwd,
      };
    }

    return {
      executable: shell.path,
      args,
      cwd,
    };
  }

  private resolveStoredShell(metadata: TerminalMetadata | null): ShellInfo | null {
    if (!metadata?.shellPath && !metadata?.shell) {
      return null;
    }

    const availableShells = ShellDetector.getAvailableShells();
    const shellPath = metadata.shellPath?.toLowerCase();
    const shellName = metadata.shell?.toLowerCase();

    return availableShells.find((shell) => {
      if (shellPath && shell.path.toLowerCase() === shellPath) {
        return true;
      }
      return Boolean(shellName && shell.name.toLowerCase() === shellName);
    }) ?? null;
  }

  private translateWindowsPathToWsl(windowsPath: string): string {
    const match = windowsPath.match(/^([A-Za-z]):[\\/](.*)$/);
    if (match) {
      const drive = match[1].toLowerCase();
      const rest = match[2].replace(/\\/g, '/');
      return `/mnt/${drive}/${rest}`;
    }

    return windowsPath.replace(/\\/g, '/');
  }

  /**
   * Create a new terminal for a session
   * @param terminalId Unique terminal identifier
   * @param options Terminal options including workspacePath for store lookups
   */
  async createTerminal(terminalId: string, options: TerminalOptions = {}): Promise<void> {
    // If terminal already exists, just return
    if (this.terminals.has(terminalId)) {
      console.log(`[TerminalSessionManager] Terminal ${terminalId} already exists`);
      return;
    }

    // Load stored metadata from terminal store (requires workspacePath)
    const storedMetadata = await this.loadStoredTerminalMetadata(terminalId, options.workspacePath);

    // Get shell info
    const shell = options.shell || this.resolveStoredShell(storedMetadata) || ShellDetector.getDefaultShell();
    // Prefer stored CWD (from previous session) over passed CWD, as the stored CWD
    // reflects where the user actually navigated to (tracked via OSC 7).
    // Validate that the CWD exists — a stale stored CWD (e.g., deleted worktree)
    // causes posix_spawnp to fail because the kernel can't chdir before exec.
    const candidateCwd = storedMetadata?.cwd || options.cwd || process.cwd();
    const cwd = existsSync(candidateCwd) ? candidateCwd : (options.workspacePath || os.homedir());
    const cols = options.cols || 80;
    const rows = options.rows || 30;
    const historyFile = await this.ensureHistoryFile(terminalId, storedMetadata?.historyFile);
    let scrollbackBuffer = storedMetadata?.scrollback || '';
    if (scrollbackBuffer.length > MAX_SCROLLBACK_SIZE) {
      scrollbackBuffer = scrollbackBuffer.slice(-MAX_SCROLLBACK_SIZE);
    }

    const bootstrapConfig = await this.prepareShellBootstrap(terminalId, shell, historyFile);
    const spawnArgs = bootstrapConfig?.args || shell.args;
    const spawnEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: getEnhancedPath(),
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

    // Filter out any undefined/null/empty args to prevent shell errors
    const filteredArgs = spawnArgs.filter((arg): arg is string =>
      typeof arg === 'string' && arg.length > 0
    );
    const spawnConfig = this.resolveSpawnConfig(shell, filteredArgs, cwd);

    // Log detailed spawn info for debugging - helpful when diagnosing shell errors
    console.log(`[TerminalSessionManager] Creating terminal ${terminalId}:`, {
      shell: spawnConfig.executable,
      shellName: shell.name,
      originalArgs: JSON.stringify(spawnArgs),
      filteredArgs: JSON.stringify(spawnConfig.args),
      cwd: spawnConfig.cwd,
      platform: process.platform,
      provider: shell.provider,
    });

    // Create PTY process
    const ptyProcess = pty.spawn(spawnConfig.executable, spawnConfig.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: spawnConfig.cwd,
      env: spawnEnv,
    });

    const terminalProcess: TerminalProcess = {
      pty: ptyProcess,
      sessionId: terminalId,
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
      workspacePath: options.workspacePath,
    };

    // Handle output from PTY
    ptyProcess.onData((data: string) => {
      // Append to scrollback buffer (with size limit)
      terminalProcess.scrollbackBuffer += data;
      if (terminalProcess.scrollbackBuffer.length > MAX_SCROLLBACK_SIZE) {
        terminalProcess.scrollbackBuffer = terminalProcess.scrollbackBuffer.slice(-MAX_SCROLLBACK_SIZE);
      }

      // Check for OSC 7 escape sequences to track CWD changes
      const newCwd = this.extractCwdFromOsc7(data);
      if (newCwd && newCwd !== terminalProcess.cwd) {
        terminalProcess.cwd = newCwd;
      }

      // Check for OSC 998 escape sequences to track command running state
      const commandState = this.extractCommandState(data);
      if (commandState !== null) {
        const isRunning = commandState === 'cmd-start';
        if (terminalProcess.isCommandRunning !== isRunning) {
          terminalProcess.isCommandRunning = isRunning;
          this.broadcastToWindows('terminal:command-running', {
            terminalId,
            isRunning,
          });
        }
      }

      this.scheduleScrollbackPersist(terminalId);

      // Send to all windows
      this.broadcastToWindows('terminal:output', {
        sessionId: terminalId,
        data,
      });
    });

    // Handle PTY exit
    ptyProcess.onExit(async ({ exitCode }) => {
      console.log(`[TerminalSessionManager] Terminal ${terminalId} exited with code ${exitCode}`);

      this.clearScrollbackTimer(terminalId);
      await this.persistScrollback(terminalId, { force: true });

      // Send exit event to all windows
      this.broadcastToWindows('terminal:exited', {
        sessionId: terminalId,
        exitCode,
      });

      // Remove from map
      this.terminals.delete(terminalId);
    });

    // Persist initial state before adding to map to avoid race with quick exit
    await this.persistTerminalState(terminalId, terminalProcess, { force: true });

    this.terminals.set(terminalId, terminalProcess);
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
    if (!terminal) {
      return;
    }

    try {
      terminal.pty.resize(cols, rows);
      terminal.cols = cols;
      terminal.rows = rows;
    } catch (error) {
      // EBADF errors occur when the PTY file descriptor is no longer valid
      // (e.g., terminal exited). This is expected and can be safely ignored.
      console.warn(`[TerminalSessionManager] Failed to resize terminal ${sessionId}:`, error);
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
   * Destroy terminals for specific session IDs (used when archiving worktrees)
   */
  async destroyTerminalsForSessions(sessionIds: string[]): Promise<void> {
    console.log(`[TerminalSessionManager] Destroying terminals for ${sessionIds.length} sessions`);
    let destroyedCount = 0;
    for (const sessionId of sessionIds) {
      if (this.terminals.has(sessionId)) {
        await this.destroyTerminal(sessionId);
        destroyedCount++;
      }
    }
    console.log(`[TerminalSessionManager] Destroyed ${destroyedCount} terminals out of ${sessionIds.length} sessions`);
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
