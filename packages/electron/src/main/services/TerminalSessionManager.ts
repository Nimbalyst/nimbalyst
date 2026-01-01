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
import { BrowserWindow } from 'electron';
import { ShellDetector, type ShellInfo } from './ShellDetector';

// Maximum scrollback buffer size (500KB)
const MAX_SCROLLBACK_SIZE = 500 * 1024;

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
}

export class TerminalSessionManager {
  private terminals = new Map<string, TerminalProcess>();

  /**
   * Create a new terminal for a session
   */
  async createTerminal(sessionId: string, options: TerminalOptions = {}): Promise<void> {
    // If terminal already exists, just return
    if (this.terminals.has(sessionId)) {
      console.log(`[TerminalSessionManager] Terminal ${sessionId} already exists`);
      return;
    }

    // Get shell info
    const shell = options.shell || ShellDetector.getDefaultShell();
    const cwd = options.cwd || process.cwd();
    const cols = options.cols || 80;
    const rows = options.rows || 30;

    console.log(`[TerminalSessionManager] Creating terminal ${sessionId} with shell: ${shell.path}`);

    // Create PTY process
    const ptyProcess = pty.spawn(shell.path, shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: process.env.LANG || 'en_US.UTF-8',
      },
    });

    const terminalProcess: TerminalProcess = {
      pty: ptyProcess,
      sessionId,
      scrollbackBuffer: '',
      cwd,
      shell,
      cols,
      rows,
    };

    this.terminals.set(sessionId, terminalProcess);

    // Handle output from PTY
    ptyProcess.onData((data: string) => {
      // Append to scrollback buffer (with size limit)
      terminalProcess.scrollbackBuffer += data;
      if (terminalProcess.scrollbackBuffer.length > MAX_SCROLLBACK_SIZE) {
        terminalProcess.scrollbackBuffer = terminalProcess.scrollbackBuffer.slice(-MAX_SCROLLBACK_SIZE);
      }

      // Send to all windows
      this.broadcastToWindows('terminal:output', {
        sessionId,
        data,
      });
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[TerminalSessionManager] Terminal ${sessionId} exited with code ${exitCode}`);

      // Send exit event to all windows
      this.broadcastToWindows('terminal:exited', {
        sessionId,
        exitCode,
      });

      // Remove from map
      this.terminals.delete(sessionId);
    });
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
  destroyTerminal(sessionId: string): void {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      console.log(`[TerminalSessionManager] Destroying terminal ${sessionId}`);
      terminal.pty.kill();
      this.terminals.delete(sessionId);
    }
  }

  /**
   * Destroy all terminals (used on app quit)
   */
  destroyAllTerminals(): void {
    console.log(`[TerminalSessionManager] Destroying all terminals (${this.terminals.size} active)`);
    for (const [sessionId] of this.terminals) {
      this.destroyTerminal(sessionId);
    }
  }

  /**
   * Get terminal info for a session
   */
  getTerminalInfo(sessionId: string): { shell: ShellInfo; cwd: string; cols: number; rows: number } | null {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) return null;

    return {
      shell: terminal.shell,
      cwd: terminal.cwd,
      cols: terminal.cols,
      rows: terminal.rows,
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
