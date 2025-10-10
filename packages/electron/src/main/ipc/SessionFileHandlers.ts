/**
 * IPC handlers for session-file link operations
 */

import { ipcMain } from 'electron';
import { SessionFilesRepository } from '@stravu/runtime';
import { logger } from '../utils/logger';

export function setupSessionFileHandlers(): void {
  /**
   * Get all file links for a session
   */
  ipcMain.handle('session-files:get-by-session', async (event, sessionId: string, linkType?: string) => {
    try {
      const files = await SessionFilesRepository.getFilesBySession(sessionId, linkType as any);
      return { success: true, files };
    } catch (error) {
      logger.main.error('[SessionFileHandlers] Failed to get files by session:', error);
      return { success: false, error: String(error), files: [] };
    }
  });

  /**
   * Get all sessions that have links to a specific file
   */
  ipcMain.handle('session-files:get-sessions-by-file', async (event, workspaceId: string, filePath: string, linkType?: string) => {
    try {
      const sessionIds = await SessionFilesRepository.getSessionsByFile(workspaceId, filePath, linkType as any);
      return { success: true, sessionIds };
    } catch (error) {
      logger.main.error('[SessionFileHandlers] Failed to get sessions by file:', error);
      return { success: false, error: String(error), sessionIds: [] };
    }
  });

  /**
   * Get aggregated file stats for a session (count by type)
   */
  ipcMain.handle('session-files:get-stats', async (event, sessionId: string) => {
    try {
      const [edited, referenced, read] = await Promise.all([
        SessionFilesRepository.getFilesBySession(sessionId, 'edited'),
        SessionFilesRepository.getFilesBySession(sessionId, 'referenced'),
        SessionFilesRepository.getFilesBySession(sessionId, 'read')
      ]);

      return {
        success: true,
        stats: {
          edited: edited.length,
          referenced: referenced.length,
          read: read.length,
          total: edited.length + referenced.length + read.length
        }
      };
    } catch (error) {
      logger.main.error('[SessionFileHandlers] Failed to get file stats:', error);
      return {
        success: false,
        error: String(error),
        stats: { edited: 0, referenced: 0, read: 0, total: 0 }
      };
    }
  });

  /**
   * Delete all file links for a session
   */
  ipcMain.handle('session-files:delete-session-links', async (event, sessionId: string) => {
    try {
      await SessionFilesRepository.deleteSessionLinks(sessionId);
      return { success: true };
    } catch (error) {
      logger.main.error('[SessionFileHandlers] Failed to delete session links:', error);
      return { success: false, error: String(error) };
    }
  });
}
