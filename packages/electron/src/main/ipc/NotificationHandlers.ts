/**
 * IPC Handlers for OS Notifications
 */

import { ipcMain, BrowserWindow } from 'electron';
import { notificationService } from '../services/NotificationService';
import { logger } from '../utils/logger';
import {
  isOSNotificationsEnabled,
  setOSNotificationsEnabled,
} from '../utils/store';

export function registerNotificationHandlers(): void {
  // Show OS notification
  ipcMain.handle('notifications:show', async (event, options) => {
    try {
      // Get the window ID from the event
      const window = BrowserWindow.fromWebContents(event.sender);
      const windowId = window?.id;

      await notificationService.showNotification({
        ...options,
        windowId,
      });

      return { success: true };
    } catch (error) {
      logger.main.error('[NotificationHandlers] Error showing notification:', error);
      return { success: false, error: String(error) };
    }
  });

  // Clear notification for a session
  ipcMain.handle('notifications:clear', async (_event, sessionId: string) => {
    try {
      notificationService.clearNotification(sessionId);
      return { success: true };
    } catch (error) {
      logger.main.error('[NotificationHandlers] Error clearing notification:', error);
      return { success: false, error: String(error) };
    }
  });

  // Clear all notifications
  ipcMain.handle('notifications:clear-all', async () => {
    try {
      notificationService.clearAllNotifications();
      return { success: true };
    } catch (error) {
      logger.main.error('[NotificationHandlers] Error clearing all notifications:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get OS notifications enabled status
  ipcMain.handle('notifications:get-enabled', async () => {
    try {
      return isOSNotificationsEnabled();
    } catch (error) {
      logger.main.error('[NotificationHandlers] Error getting notification status:', error);
      return false;
    }
  });

  // Set OS notifications enabled status
  ipcMain.handle('notifications:set-enabled', async (_event, enabled: boolean) => {
    try {
      setOSNotificationsEnabled(enabled);
      return { success: true };
    } catch (error) {
      logger.main.error('[NotificationHandlers] Error setting notification status:', error);
      return { success: false, error: String(error) };
    }
  });

  logger.main.info('[NotificationHandlers] Notification IPC handlers registered');
}
