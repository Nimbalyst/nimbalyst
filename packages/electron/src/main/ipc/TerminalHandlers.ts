/**
 * TerminalHandlers - IPC handlers for terminal operations
 *
 * Provides the bridge between renderer process and TerminalSessionManager.
 */

import { ipcMain } from 'electron';
import { getTerminalSessionManager } from '../services/TerminalSessionManager';
import { AISessionsRepository } from '@nimbalyst/runtime';
import { ulid } from 'ulid';
import { AnalyticsService } from '../services/analytics/AnalyticsService';

// Track if handlers are registered
let handlersRegistered = false;

export function registerTerminalHandlers(): void {
  if (handlersRegistered) {
    console.log('[TerminalHandlers] Handlers already registered, skipping');
    return;
  }

  handlersRegistered = true;
  const manager = getTerminalSessionManager();

  /**
   * Create a new terminal session
   * Creates both the database session and the PTY process
   */
  ipcMain.handle(
    'terminal:create-session',
    async (
      _event,
      payload: {
        workspacePath: string;
        cwd?: string;
      }
    ) => {
      try {
        const sessionId = ulid();

        // Create session in database
        await AISessionsRepository.create({
          id: sessionId,
          provider: 'terminal',
          title: 'Terminal',
          workspaceId: payload.workspacePath,
          sessionType: 'terminal',
        });

        // Create PTY process
        await manager.createTerminal(sessionId, {
          cwd: payload.cwd || payload.workspacePath,
        });

        const terminalInfo = manager.getTerminalInfo(sessionId);

        // Update session with terminal metadata
        const scrollbackBuffer = manager.getScrollbackBuffer(sessionId) || undefined;
        await AISessionsRepository.updateMetadata(sessionId, {
          metadata: {
            terminal: {
              shell: terminalInfo?.shell.name || 'unknown',
              shellPath: terminalInfo?.shell.path || '',
              cwd: terminalInfo?.cwd || payload.workspacePath,
              historyFile: terminalInfo?.historyFile || '',
              scrollback: scrollbackBuffer,
              scrollbackUpdatedAt: scrollbackBuffer ? Date.now() : undefined,
            },
          },
        });

        console.log(`[TerminalHandlers] Created terminal session ${sessionId}`);

        // Track terminal session creation
        AnalyticsService.getInstance().sendEvent('terminal_session_created', {
          shell: terminalInfo?.shell.name || 'unknown',
        });

        return {
          success: true,
          sessionId,
          shell: terminalInfo?.shell,
        };
      } catch (error) {
        console.error('[TerminalHandlers] Error creating terminal session:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  /**
   * Initialize PTY for an existing session
   * Used when reopening a terminal session
   */
  ipcMain.handle(
    'terminal:initialize',
    async (
      _event,
      sessionId: string,
      options: {
        cwd?: string;
        cols?: number;
        rows?: number;
      }
    ) => {
      try {
        // Check if already active
        if (manager.isTerminalActive(sessionId)) {
          return { success: true, alreadyActive: true };
        }

        // Create PTY process
        await manager.createTerminal(sessionId, options);

        return { success: true };
      } catch (error) {
        console.error('[TerminalHandlers] Error initializing terminal:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  /**
   * Check if a terminal is active
   */
  ipcMain.handle('terminal:is-active', async (_event, sessionId: string) => {
    return manager.isTerminalActive(sessionId);
  });

  /**
   * Write data to a terminal (user input)
   */
  ipcMain.handle('terminal:write', async (_event, sessionId: string, data: string) => {
    manager.writeToTerminal(sessionId, data);
    return { success: true };
  });

  /**
   * Resize a terminal
   */
  ipcMain.handle('terminal:resize', async (_event, sessionId: string, cols: number, rows: number) => {
    manager.resizeTerminal(sessionId, cols, rows);
    return { success: true };
  });

  /**
   * Get scrollback buffer for restoration
   */
  ipcMain.handle('terminal:get-scrollback', async (_event, sessionId: string) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('sessionId is required and must be a string');
    }

    const inMemory = manager.getScrollbackBuffer(sessionId);
    if (inMemory !== null) {
      return inMemory;
    }
    return await manager.getStoredScrollback(sessionId);
  });

  /**
   * Destroy a terminal
   */
  ipcMain.handle('terminal:destroy', async (_event, sessionId: string) => {
    await manager.destroyTerminal(sessionId);
    return { success: true };
  });

  /**
   * Get terminal info
   */
  ipcMain.handle('terminal:get-info', async (_event, sessionId: string) => {
    return manager.getTerminalInfo(sessionId);
  });

  console.log('[TerminalHandlers] Registered');
}

/**
 * Shutdown handler - destroy all terminals on app quit
 */
export async function shutdownTerminalHandlers(): Promise<void> {
  const manager = getTerminalSessionManager();
  await manager.destroyAllTerminals();
}
