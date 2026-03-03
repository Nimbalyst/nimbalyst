/**
 * TerminalHandlers - IPC handlers for terminal operations
 *
 * Provides the bridge between renderer process and TerminalSessionManager.
 * Terminals are stored in a dedicated terminal store (not the AI sessions database).
 */

import { getTerminalSessionManager } from '../services/TerminalSessionManager';
import { safeHandle } from '../utils/ipcRegistry';
import { ulid } from 'ulid';
import { AnalyticsService } from '../services/analytics/AnalyticsService';
import {
  createTerminalInstance,
  deleteTerminalInstance,
  getTerminalInstance,
  listTerminals,
  setActiveTerminal,
  getActiveTerminalId,
  setTabOrder,
  getWorkspaceTerminalState,
  getTerminalPanelState,
  updateTerminalPanelState,
  setTerminalPanelVisible,
  setTerminalPanelHeight,
  updateTerminalInstance,
  type TerminalInstance,
} from '../utils/terminalStore';
import { getDatabase } from '../database/initialize';
import { createWorktreeStore } from '../services/WorktreeStore';

// Track if handlers are registered
let handlersRegistered = false;

/**
 * Fetch worktree display name from the database
 * Returns displayName if available, otherwise falls back to branch name
 */
async function fetchWorktreeName(worktreeId: string): Promise<string | undefined> {
  try {
    const db = getDatabase();
    if (db) {
      const worktreeStore = createWorktreeStore(db);
      const worktree = await worktreeStore.get(worktreeId);
      if (worktree) {
        if (worktree.displayName) {
          return worktree.displayName;
        }
        // Strip 'worktree/' prefix from branch name if present
        const branch = worktree.branch;
        return branch.startsWith('worktree/') ? branch.slice('worktree/'.length) : branch;
      }
    }
  } catch (err) {
    console.warn('[TerminalHandlers] Failed to fetch worktree name:', err);
  }
  return undefined;
}

export function registerTerminalHandlers(): void {
  if (handlersRegistered) {
    console.log('[TerminalHandlers] Handlers already registered, skipping');
    return;
  }

  handlersRegistered = true;
  const manager = getTerminalSessionManager();

  /**
   * Create a new terminal
   * Creates both the store entry and the PTY process
   */
  safeHandle(
    'terminal:create',
    async (
      _event,
      payload: {
        workspacePath: string;
        cwd?: string;
        worktreeId?: string;
        title?: string;
        source?: 'panel' | 'worktree';
      }
    ) => {
      try {
        const terminalId = ulid();
        const terminalCwd = payload.cwd || payload.workspacePath;
        const now = Date.now();

        // Create PTY process first to get shell info
        await manager.createTerminal(terminalId, {
          cwd: terminalCwd,
          workspacePath: payload.workspacePath,
        });

        const terminalInfo = manager.getTerminalInfo(terminalId);

        // Fetch worktree name if worktreeId is provided
        const worktreeName = payload.worktreeId ? await fetchWorktreeName(payload.worktreeId) : undefined;

        // Create terminal instance in store
        const instance: TerminalInstance = {
          id: terminalId,
          title: payload.title || 'Terminal',
          shellName: terminalInfo?.shell.name || 'unknown',
          shellPath: terminalInfo?.shell.path || '',
          cwd: terminalInfo?.cwd || terminalCwd,
          worktreeId: payload.worktreeId,
          worktreeName,
          createdAt: now,
          lastActiveAt: now,
          historyFile: terminalInfo?.historyFile,
        };

        createTerminalInstance(payload.workspacePath, instance);

        console.log(`[TerminalHandlers] Created terminal ${terminalId}`);

        // Track terminal creation
        AnalyticsService.getInstance().sendEvent('terminal_created', {
          shell: terminalInfo?.shell.name || 'unknown',
          source: payload.source || 'panel',
        });

        return {
          success: true,
          terminalId,
          shell: terminalInfo?.shell,
          instance,
        };
      } catch (error) {
        console.error('[TerminalHandlers] Error creating terminal:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  /**
   * Legacy handler for backward compatibility
   * @deprecated Use terminal:create instead
   */
  safeHandle(
    'terminal:create-session',
    async (
      _event,
      payload: {
        workspacePath: string;
        cwd?: string;
        worktreeId?: string;
        worktreePath?: string;
      }
    ) => {
      // Redirect to new handler
      const terminalId = ulid();
      const terminalCwd = payload.worktreePath || payload.cwd || payload.workspacePath;
      const now = Date.now();

      try {
        await manager.createTerminal(terminalId, {
          cwd: terminalCwd,
          workspacePath: payload.workspacePath,
        });

        const terminalInfo = manager.getTerminalInfo(terminalId);

        // Fetch worktree name if worktreeId is provided
        const worktreeName = payload.worktreeId ? await fetchWorktreeName(payload.worktreeId) : undefined;

        // Create terminal instance in store
        const instance: TerminalInstance = {
          id: terminalId,
          title: 'Terminal',
          shellName: terminalInfo?.shell.name || 'unknown',
          shellPath: terminalInfo?.shell.path || '',
          cwd: terminalInfo?.cwd || terminalCwd,
          worktreeId: payload.worktreeId,
          worktreeName,
          createdAt: now,
          lastActiveAt: now,
          historyFile: terminalInfo?.historyFile,
        };

        createTerminalInstance(payload.workspacePath, instance);

        console.log(`[TerminalHandlers] Created terminal session ${terminalId} (legacy)`);

        AnalyticsService.getInstance().sendEvent('terminal_created', {
          shell: terminalInfo?.shell.name || 'unknown',
        });

        return {
          success: true,
          sessionId: terminalId,
          shell: terminalInfo?.shell,
        };
      } catch (error) {
        console.error('[TerminalHandlers] Error creating terminal session:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  /**
   * Initialize PTY for an existing terminal
   * Used when reopening a terminal tab
   */
  safeHandle(
    'terminal:initialize',
    async (
      _event,
      terminalId: string,
      options: {
        workspacePath: string;
        cwd?: string;
        cols?: number;
        rows?: number;
      }
    ) => {
      try {
        // Check if already active
        if (manager.isTerminalActive(terminalId)) {
          return { success: true, alreadyActive: true };
        }

        // Create PTY process with workspace context
        await manager.createTerminal(terminalId, {
          ...options,
          workspacePath: options.workspacePath,
        });

        // Update last active timestamp
        updateTerminalInstance(options.workspacePath, terminalId, {
          lastActiveAt: Date.now(),
        });

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
  safeHandle('terminal:is-active', async (_event, sessionId: string) => {
    return manager.isTerminalActive(sessionId);
  });

  /**
   * Write data to a terminal (user input)
   */
  safeHandle('terminal:write', async (_event, sessionId: string, data: string) => {
    manager.writeToTerminal(sessionId, data);
    return { success: true };
  });

  /**
   * Resize a terminal
   */
  safeHandle('terminal:resize', async (_event, sessionId: string, cols: number, rows: number) => {
    manager.resizeTerminal(sessionId, cols, rows);
    return { success: true };
  });

  /**
   * Get scrollback buffer for restoration
   */
  safeHandle('terminal:get-scrollback', async (_event, sessionId: string) => {
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
   * Clear scrollback buffer (used when scrollback is corrupted)
   */
  safeHandle('terminal:clear-scrollback', async (_event, sessionId: string) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('sessionId is required and must be a string');
    }
    await manager.clearScrollback(sessionId);
    return { success: true };
  });

  /**
   * Destroy a terminal
   */
  safeHandle('terminal:destroy', async (_event, sessionId: string) => {
    await manager.destroyTerminal(sessionId);
    return { success: true };
  });

  /**
   * Get terminal info (PTY info)
   */
  safeHandle('terminal:get-info', async (_event, terminalId: string) => {
    return manager.getTerminalInfo(terminalId);
  });

  // =========================================================================
  // Terminal Store Operations
  // =========================================================================

  /**
   * List all terminals for a workspace
   */
  safeHandle(
    'terminal:list',
    async (_event, workspacePath: string) => {
      return listTerminals(workspacePath);
    }
  );

  /**
   * Get a single terminal instance
   */
  safeHandle(
    'terminal:get',
    async (_event, workspacePath: string, terminalId: string) => {
      return getTerminalInstance(workspacePath, terminalId);
    }
  );

  /**
   * Update terminal metadata (title, etc.)
   */
  safeHandle(
    'terminal:update',
    async (
      _event,
      workspacePath: string,
      terminalId: string,
      updates: Partial<Omit<TerminalInstance, 'id' | 'createdAt'>>
    ) => {
      const updated = updateTerminalInstance(workspacePath, terminalId, {
        ...updates,
        lastActiveAt: Date.now(),
      });
      return { success: !!updated, terminal: updated };
    }
  );

  /**
   * Delete a terminal (also destroys PTY if active)
   */
  safeHandle(
    'terminal:delete',
    async (_event, workspacePath: string, terminalId: string) => {
      // Destroy PTY if active
      if (manager.isTerminalActive(terminalId)) {
        await manager.destroyTerminal(terminalId);
      }
      // Delete from store (also deletes scrollback file)
      deleteTerminalInstance(workspacePath, terminalId);
      return { success: true };
    }
  );

  /**
   * Set active terminal
   */
  safeHandle(
    'terminal:set-active',
    async (_event, workspacePath: string, terminalId: string | undefined) => {
      setActiveTerminal(workspacePath, terminalId);
      return { success: true };
    }
  );

  /**
   * Get active terminal ID
   */
  safeHandle(
    'terminal:get-active',
    async (_event, workspacePath: string) => {
      return getActiveTerminalId(workspacePath);
    }
  );

  /**
   * Update tab order
   */
  safeHandle(
    'terminal:set-tab-order',
    async (_event, workspacePath: string, tabOrder: string[]) => {
      setTabOrder(workspacePath, tabOrder);
      return { success: true };
    }
  );

  /**
   * Get workspace terminal state (all terminals + active + tab order)
   */
  safeHandle(
    'terminal:get-workspace-state',
    async (_event, workspacePath: string) => {
      return getWorkspaceTerminalState(workspacePath);
    }
  );

  // =========================================================================
  // Panel State Operations
  // =========================================================================

  /**
   * Get terminal panel state (height, visibility) for a workspace
   */
  safeHandle('terminal:get-panel-state', async (_event, workspacePath: string) => {
    return getTerminalPanelState(workspacePath);
  });

  /**
   * Update terminal panel state for a workspace
   */
  safeHandle(
    'terminal:update-panel-state',
    async (_event, workspacePath: string, updates: { panelHeight?: number; panelVisible?: boolean }) => {
      return updateTerminalPanelState(workspacePath, updates);
    }
  );

  /**
   * Set panel visibility for a workspace
   */
  safeHandle('terminal:set-panel-visible', async (_event, workspacePath: string, visible: boolean) => {
    setTerminalPanelVisible(workspacePath, visible);
    return { success: true };
  });

  /**
   * Set panel height for a workspace
   */
  safeHandle('terminal:set-panel-height', async (_event, workspacePath: string, height: number) => {
    setTerminalPanelHeight(workspacePath, height);
    return { success: true };
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
