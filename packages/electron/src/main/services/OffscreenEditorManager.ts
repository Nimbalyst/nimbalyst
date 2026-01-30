/**
 * Offscreen Editor Manager
 *
 * Manages lifecycle of offscreen editor instances for MCP tool access.
 * Editors can be mounted in hidden containers without visible UI, allowing
 * AI tools to work with files that aren't currently open in tabs.
 *
 * Key features:
 * - Reference counting for concurrent tool usage
 * - TTL-based caching to avoid repeated mount/unmount
 * - Seamless integration with visible editors (same registry)
 */

import { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import { findWindowByWorkspace } from '../window/WindowManager';

interface OffscreenEditorEntry {
  filePath: string;
  mountedAt: Date;
  lastUsed: Date;
  refCount: number;
  unmountTimer: NodeJS.Timeout | null;
}

export class OffscreenEditorManager {
  private static instance: OffscreenEditorManager | null = null;

  // Track mounted offscreen editors by file path
  private editors = new Map<string, OffscreenEditorEntry>();

  // Configuration
  private cacheTTL = 30000; // 30 seconds
  private maxCached = 5;

  private constructor() {}

  public static getInstance(): OffscreenEditorManager {
    if (!OffscreenEditorManager.instance) {
      OffscreenEditorManager.instance = new OffscreenEditorManager();
    }
    return OffscreenEditorManager.instance;
  }

  /**
   * Mount an editor offscreen for a file.
   * If already mounted, increments reference count and refreshes TTL.
   */
  public async mountOffscreen(filePath: string, workspacePath: string): Promise<void> {
    logger.main.info(`[OffscreenEditorManager] Mount request for ${filePath}`);

    // Check if already mounted
    const existing = this.editors.get(filePath);
    if (existing) {
      logger.main.info(`[OffscreenEditorManager] Already mounted, incrementing ref count`);
      existing.refCount++;
      existing.lastUsed = new Date();

      // Cancel pending unmount timer
      if (existing.unmountTimer) {
        clearTimeout(existing.unmountTimer);
        existing.unmountTimer = null;
      }

      return;
    }

    // Check cache limit
    if (this.editors.size >= this.maxCached) {
      logger.main.info(`[OffscreenEditorManager] Cache full, evicting LRU entry`);
      this.evictLRU();
    }

    // Send mount request to renderer
    const window = this.getTargetWindow(workspacePath);
    if (!window || window.isDestroyed()) {
      throw new Error('No renderer window available for offscreen mounting');
    }

    logger.main.info(`[OffscreenEditorManager] Sending mount request to renderer`);

    // Create entry before sending IPC (renderer will report when ready)
    const entry: OffscreenEditorEntry = {
      filePath,
      mountedAt: new Date(),
      lastUsed: new Date(),
      refCount: 1,
      unmountTimer: null,
    };

    this.editors.set(filePath, entry);

    // Send IPC to renderer to mount
    try {
      window.webContents.send('offscreen-editor:mount', {
        filePath,
        workspacePath,
      });

      // Wait for editor to be ready (renderer will register API)
      // Longer delay for editors with iframes (mockups, etc.)
      await new Promise(resolve => setTimeout(resolve, 3000));

      logger.main.info(`[OffscreenEditorManager] Editor mounted for ${filePath}`);
    } catch (error) {
      // Clean up on failure
      this.editors.delete(filePath);
      throw error;
    }
  }

  /**
   * Unmount an offscreen editor.
   * Decrements reference count and schedules unmount after TTL if count reaches 0.
   */
  public unmountOffscreen(filePath: string): void {
    const entry = this.editors.get(filePath);
    if (!entry) {
      logger.main.warn(`[OffscreenEditorManager] No offscreen editor for ${filePath}`);
      return;
    }

    entry.refCount--;
    entry.lastUsed = new Date();

    if (entry.refCount <= 0) {
      logger.main.info(`[OffscreenEditorManager] Ref count 0, scheduling unmount after TTL`);

      // Schedule unmount after TTL
      entry.unmountTimer = setTimeout(() => {
        this.performUnmount(filePath);
      }, this.cacheTTL);
    } else {
      logger.main.info(`[OffscreenEditorManager] Ref count: ${entry.refCount}, keeping mounted`);
    }
  }

  /**
   * Check if an editor is available (visible or offscreen).
   * This delegates to the renderer's editor registry.
   */
  public isAvailable(filePath: string): boolean {
    // Check if we have it mounted offscreen
    return this.editors.has(filePath);
  }

  /**
   * Get statistics for debugging.
   */
  public getStats(): { mounted: number; cache: Map<string, { mountedAt: Date; lastUsed: Date; refCount: number }> } {
    const cache = new Map();
    for (const [filePath, entry] of this.editors) {
      cache.set(filePath, {
        mountedAt: entry.mountedAt,
        lastUsed: entry.lastUsed,
        refCount: entry.refCount,
      });
    }

    return {
      mounted: this.editors.size,
      cache,
    };
  }

  /**
   * Capture screenshot from an offscreen editor.
   * If not mounted, mounts it temporarily.
   * Delegates to renderer to capture the DOM element via IPC.
   */
  public async captureScreenshot(filePath: string, workspacePath: string, selector?: string): Promise<Buffer> {
    // Check if already mounted offscreen
    const wasMounted = this.editors.has(filePath);

    logger.main.info(`[OffscreenEditorManager] captureScreenshot - wasMounted: ${wasMounted}, editorCount: ${this.editors.size}, filePath: ${filePath}`);
    logger.main.info(`[OffscreenEditorManager] Current editors: ${Array.from(this.editors.keys()).join(', ')}`);

    if (!wasMounted) {
      logger.main.info(`[OffscreenEditorManager] Mounting temporarily for screenshot: ${filePath}`);
      await this.mountOffscreen(filePath, workspacePath);
    }

    // Request screenshot via IPC (renderer handles the actual capture)
    const window = this.getTargetWindow(workspacePath);
    if (!window || window.isDestroyed()) {
      throw new Error('No renderer window available for screenshot');
    }

    // Send request and wait for response
    const result = await new Promise<{ success: boolean; imageBase64?: string; error?: string }>((resolve, reject) => {
      const responseChannel = `offscreen-editor:capture-screenshot-response:${Date.now()}-${Math.random()}`;

      logger.main.info(`[OffscreenEditorManager] Sending screenshot request, response channel: ${responseChannel}`);

      // Set up one-time listener for response
      const { ipcMain } = require('electron');
      const timeout = setTimeout(() => {
        ipcMain.removeHandler(responseChannel);
        reject(new Error('Screenshot request timed out after 30s'));
      }, 30000);

      ipcMain.handle(responseChannel, async (_event: any, response: any) => {
        clearTimeout(timeout);
        ipcMain.removeHandler(responseChannel);
        logger.main.info(`[OffscreenEditorManager] Screenshot response received: ${response.success}`);
        resolve(response);
        return { received: true };
      });

      // Send request to renderer
      window.webContents.send('offscreen-editor:capture-screenshot-request', {
        filePath,
        selector,
        responseChannel,
      });
    });

    // If we mounted temporarily, unmount after screenshot completes
    if (!wasMounted) {
      this.unmountOffscreen(filePath);
    }

    if (!result.success || !result.imageBase64) {
      throw new Error(result.error || 'Screenshot failed');
    }

    const buffer = Buffer.from(result.imageBase64, 'base64');
    logger.main.info(`[OffscreenEditorManager] Screenshot captured: ${buffer.length} bytes`);

    return buffer;
  }

  /**
   * Actually unmount the editor and notify renderer.
   */
  private performUnmount(filePath: string): void {
    const entry = this.editors.get(filePath);
    if (!entry) return;

    logger.main.info(`[OffscreenEditorManager] Unmounting ${filePath}`);

    // Get any window to send unmount request
    const window = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    if (window) {
      window.webContents.send('offscreen-editor:unmount', { filePath });
    }

    this.editors.delete(filePath);
  }

  /**
   * Evict least recently used editor to make room.
   */
  private evictLRU(): void {
    let oldest: { filePath: string; entry: OffscreenEditorEntry } | null = null;

    for (const [filePath, entry] of this.editors) {
      if (!oldest || entry.lastUsed < oldest.entry.lastUsed) {
        oldest = { filePath, entry };
      }
    }

    if (oldest) {
      logger.main.info(`[OffscreenEditorManager] Evicting LRU: ${oldest.filePath}`);

      // Cancel unmount timer if any
      if (oldest.entry.unmountTimer) {
        clearTimeout(oldest.entry.unmountTimer);
      }

      this.performUnmount(oldest.filePath);
    }
  }

  /**
   * Find a renderer window for the workspace.
   */
  private getTargetWindow(workspacePath: string): BrowserWindow | null {
    // Route to the correct window for this workspace
    const window = findWindowByWorkspace(workspacePath);

    if (window && !window.isDestroyed()) {
      logger.main.info(`[OffscreenEditorManager] Found window for workspace: ${workspacePath}`);
      return window;
    }

    logger.main.warn(`[OffscreenEditorManager] No window found for workspace ${workspacePath}, trying first available`);
    const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    return windows.length > 0 ? windows[0] : null;
  }

  /**
   * Cleanup on shutdown.
   */
  public cleanup(): void {
    logger.main.info('[OffscreenEditorManager] Cleaning up');

    // Cancel all timers
    for (const entry of this.editors.values()) {
      if (entry.unmountTimer) {
        clearTimeout(entry.unmountTimer);
      }
    }

    // Send unmount for all editors
    const window = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    if (window) {
      for (const filePath of this.editors.keys()) {
        window.webContents.send('offscreen-editor:unmount', { filePath });
      }
    }

    this.editors.clear();
  }
}
