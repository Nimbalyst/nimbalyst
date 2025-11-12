/**
 * NotificationService
 *
 * Handles OS-level notifications for AI/agent completion events.
 * Respects user preferences and system Do Not Disturb settings.
 */

import { Notification, BrowserWindow, app, systemPreferences } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import { isOSNotificationsEnabled } from '../utils/store';
import { findWindowByWorkspace } from '../window/WindowManager';

const execAsync = promisify(exec);

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  sessionId?: string;
  workspacePath: string;  // REQUIRED: stable identifier for routing
  provider?: string;
}

class NotificationService {
  private activeNotifications: Map<string, Notification> = new Map();

  constructor() {
    logger.main.info('[NotificationService] Service initialized');
    this.requestPermissions();
  }

  /**
   * Check if running in development mode
   */
  private isDevelopmentMode(): boolean {
    return !app.isPackaged;
  }

  /**
   * Show notification using AppleScript (fallback for development mode)
   */
  private async showAppleScriptNotification(title: string, body: string): Promise<void> {
    if (process.platform !== 'darwin') {
      return;
    }

    try {
      const escapedTitle = title.replace(/"/g, '\\"');
      const escapedBody = body.replace(/"/g, '\\"');
      const script = `display notification "${escapedBody}" with title "${escapedTitle}"`;

      await execAsync(`osascript -e '${script}'`);
      logger.main.info('[NotificationService] AppleScript notification shown (dev mode)');
    } catch (error) {
      logger.main.error('[NotificationService] AppleScript notification failed:', error);
    }
  }

  /**
   * Request notification permissions from the OS
   */
  private async requestPermissions(): Promise<void> {
    try {
      if (process.platform === 'darwin') {
        // Check current notification permission status
        const status = systemPreferences.getMediaAccessStatus('screen');
        logger.main.info('[NotificationService] macOS notification support:', {
          platform: process.platform,
          doNotDisturbEnabled: systemPreferences.doNotDisturb,
        });

        // Try to show a test notification to trigger permission request
        logger.main.info('[NotificationService] Notification support initialized for macOS');
      }
    } catch (error) {
      logger.main.error('[NotificationService] Error checking permissions:', error);
    }
  }

  /**
   * Show an OS notification if:
   * 1. User has enabled OS notifications in settings
   * 2. The app window is not focused
   * 3. System allows notifications (respects Do Not Disturb)
   */
  async showNotification(options: NotificationOptions): Promise<void> {
    logger.main.info('[NotificationService] showNotification called:', {
      title: options.title,
      sessionId: options.sessionId,
    });

    // Check if OS notifications are enabled in settings
    const osNotificationsEnabled = isOSNotificationsEnabled();
    logger.main.info('[NotificationService] OS notifications enabled:', osNotificationsEnabled);
    if (!osNotificationsEnabled) {
      logger.main.info('[NotificationService] SKIPPED: OS notifications disabled in settings');
      return;
    }

    // Check if app has permission to show notifications
    if (!Notification.isSupported()) {
      logger.main.warn('[NotificationService] SKIPPED: Notifications not supported on this platform');
      return;
    }

    // Check if any window is visible and focused
    const allWindows = BrowserWindow.getAllWindows();
    const hasVisibleFocusedWindow = allWindows.some(win => win.isVisible() && win.isFocused());
    logger.main.info('[NotificationService] Has visible focused window:', hasVisibleFocusedWindow);
    if (hasVisibleFocusedWindow) {
      logger.main.info('[NotificationService] SKIPPED: App window is focused (notifications only show when app is in background)');
      return;
    }

    // In development mode, use AppleScript for more reliable notifications on macOS
    // if (this.isDevelopmentMode() && process.platform === 'darwin') {
    //   logger.main.info('[NotificationService] Using AppleScript notification (development mode)');
    //   try {
    //     await this.showAppleScriptNotification(options.title, options.body);
    //   } catch (error) {
    //     logger.main.error('[NotificationService] AppleScript notification failed:', error);
    //   }
    //   return;
    // }

    try {
      // Create and show the notification using Electron API (production mode)
      const notification = new Notification({
        title: options.title,
        body: options.body,
        icon: options.icon || this.getAppIcon(),
        silent: false, // Use system notification sound
        urgency: 'normal', // macOS notification urgency
        timeoutType: 'default', // Use system default timeout
      });

      // Handle notification click - focus window and switch to session
      notification.on('click', () => {
        this.handleNotificationClick(options);
      });

      // Handle notification errors
      notification.on('failed', (event, error) => {
        logger.main.error('[NotificationService] Notification failed:', error);
      });

      // Track notification
      if (options.sessionId) {
        this.activeNotifications.set(options.sessionId, notification);
      }

      // Show the notification
      notification.show();

      logger.main.info('[NotificationService] Notification shown:', {
        title: options.title,
        sessionId: options.sessionId,
      });

      // Log additional debug info
      logger.main.info('[NotificationService] Notification object created:', {
        hasIcon: !!notification,
        title: options.title,
        bodyLength: options.body.length,
      });
    } catch (error) {
      logger.main.error('[NotificationService] Error showing notification:', error);
    }
  }

  /**
   * Handle notification click - bring window to focus and switch to session
   */
  private handleNotificationClick(options: NotificationOptions): void {
    logger.main.info('[NotificationService] Notification clicked:', {
      sessionId: options.sessionId,
      workspacePath: options.workspacePath,
    });

    // REQUIRED: workspacePath must be provided - sessions are tied to workspaces
    if (!options.workspacePath) {
      throw new Error('workspacePath is required for notification routing');
    }

    // Find window by workspace path (the only stable identifier)
    const targetWindow = findWindowByWorkspace(options.workspacePath);

    if (!targetWindow) {
      logger.main.warn('[NotificationService] No window found for workspace:', options.workspacePath);
      return;
    }

    logger.main.info('[NotificationService] Found window for workspace:', options.workspacePath);

    // Focus the window
    if (targetWindow.isMinimized()) {
      targetWindow.restore();
    }
    targetWindow.focus();
    targetWindow.show();

    // If session ID provided, send IPC event to switch to that session
    if (options.sessionId) {
      targetWindow.webContents.send('notification-clicked', {
        sessionId: options.sessionId,
      });
    }
  }

  /**
   * Clear notifications for a specific session
   */
  clearNotification(sessionId: string): void {
    const notification = this.activeNotifications.get(sessionId);
    if (notification) {
      notification.close();
      this.activeNotifications.delete(sessionId);
      logger.main.debug('[NotificationService] Cleared notification for session:', sessionId);
    }
  }

  /**
   * Clear all active notifications
   */
  clearAllNotifications(): void {
    this.activeNotifications.forEach((notification) => {
      notification.close();
    });
    this.activeNotifications.clear();
    logger.main.debug('[NotificationService] Cleared all notifications');
  }

  /**
   * Get app icon path for notifications
   */
  private getAppIcon(): string {
    // Use app icon path based on platform
    if (process.platform === 'darwin') {
      return app.getPath('exe');
    } else if (process.platform === 'win32') {
      return app.getPath('exe');
    }
    return '';
  }

  /**
   * Truncate text for notification body
   */
  static truncateBody(text: string, maxLength: number = 100): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
