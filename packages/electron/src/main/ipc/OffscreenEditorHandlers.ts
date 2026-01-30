/**
 * IPC handlers for offscreen editor operations.
 *
 * Provides handlers for:
 * - Mounting editors offscreen
 * - Unmounting editors
 * - Checking availability
 * - Getting statistics
 */

import { OffscreenEditorManager } from '../services/OffscreenEditorManager';
import { logger } from '../utils/logger';
import { safeHandle, safeOn } from '../utils/ipcRegistry';

/**
 * Register IPC handlers for offscreen editor operations.
 */
export function registerOffscreenEditorHandlers(): void {
  const manager = OffscreenEditorManager.getInstance();

  // Mount an editor offscreen
  safeHandle(
    'offscreen-editor:mount',
    async (_event, payload: { filePath: string; workspacePath: string }) => {
      logger.main.info(`[OffscreenEditorHandlers] Mount request: ${payload.filePath}`);

      try {
        await manager.mountOffscreen(payload.filePath, payload.workspacePath);
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.main.error(`[OffscreenEditorHandlers] Mount failed: ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
        };
      }
    }
  );

  // Unmount an offscreen editor
  safeHandle('offscreen-editor:unmount', async (_event, payload: { filePath: string }) => {
    logger.main.info(`[OffscreenEditorHandlers] Unmount request: ${payload.filePath}`);

    try {
      manager.unmountOffscreen(payload.filePath);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.main.error(`[OffscreenEditorHandlers] Unmount failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Check if editor is available (visible or offscreen)
  safeHandle('offscreen-editor:is-available', async (_event, payload: { filePath: string }) => {
    const isAvailable = manager.isAvailable(payload.filePath);
    return { success: true, isAvailable };
  });

  // Get statistics for debugging
  safeHandle('offscreen-editor:get-stats', async () => {
    const stats = manager.getStats();
    return {
      success: true,
      stats: {
        mounted: stats.mounted,
        cache: Array.from(stats.cache.entries()).map(([filePath, info]) => ({
          filePath,
          mountedAt: info.mountedAt.toISOString(),
          lastUsed: info.lastUsed.toISOString(),
          refCount: info.refCount,
        })),
      },
    };
  });

  // Capture screenshot from offscreen editor
  safeHandle(
    'offscreen-editor:capture-screenshot',
    async (_event, payload: { filePath: string; workspacePath?: string; selector?: string }) => {
      logger.main.info(`[OffscreenEditorHandlers] Screenshot request: ${payload.filePath}`);

      try {
        // Determine workspace path
        const workspacePath = payload.workspacePath || require('path').dirname(payload.filePath);

        const imageBuffer = await manager.captureScreenshot(
          payload.filePath,
          workspacePath,
          payload.selector
        );

        const imageBase64 = imageBuffer.toString('base64');

        return {
          success: true,
          imageBase64,
          mimeType: 'image/png',
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.main.error(`[OffscreenEditorHandlers] Screenshot failed: ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
        };
      }
    }
  );

  logger.main.info('[OffscreenEditorHandlers] Offscreen editor handlers registered');
}
