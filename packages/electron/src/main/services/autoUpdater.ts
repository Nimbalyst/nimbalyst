import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import log from 'electron-log';

export class AutoUpdaterService {
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private isCheckingForUpdate = false;
  private static isUpdating = false;

  constructor() {
    // Configure electron-updater logger
    log.transports.file.level = 'info';
    autoUpdater.logger = log;

    // Configure auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    
    // Set the feed URL for GitHub releases
    // This will look for latest-mac.yml, latest.yml, etc. in the release assets
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'stravu',
      repo: 'preditor-releases'
    });

    // Set up event handlers
    this.setupEventHandlers();
    
    // Set up IPC handlers for renderer communication
    this.setupIpcHandlers();
  }

  private setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      log.info('Checking for update...');
      this.isCheckingForUpdate = true;
      this.sendToAllWindows('update-checking');
    });

    autoUpdater.on('update-available', (info) => {
      log.info('Update available:', info);
      this.isCheckingForUpdate = false;
      
      // Show dialog to user
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `A new version ${info.version} is available. Would you like to download it now?`,
        detail: info.releaseNotes ? `Release notes:\n${info.releaseNotes}` : 'A new version is available for download.',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1
      }).then(result => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate();
        }
      });

      this.sendToAllWindows('update-available', info);
    });

    autoUpdater.on('update-not-available', (info) => {
      log.info('Update not available:', info);
      this.isCheckingForUpdate = false;
      this.sendToAllWindows('update-not-available', info);
    });

    autoUpdater.on('error', (err) => {
      log.error('Update error:', err);
      this.isCheckingForUpdate = false;
      this.sendToAllWindows('update-error', err.message);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      let logMessage = `Download speed: ${progressObj.bytesPerSecond}`;
      logMessage = `${logMessage} - Downloaded ${progressObj.percent}%`;
      logMessage = `${logMessage} (${progressObj.transferred}/${progressObj.total})`;
      log.info(logMessage);
      
      this.sendToAllWindows('update-download-progress', progressObj);
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info('Update downloaded:', info);
      
      // Show dialog to user
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'Update downloaded. The application will restart to apply the update.',
        detail: 'Would you like to restart now or later?',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1
      }).then(result => {
        if (result.response === 0) {
          setImmediate(() => {
            try {
              log.info('Attempting to quit and install update...');
              // Set flag to bypass quit prevention
              AutoUpdaterService.isUpdating = true;
              // Force remove all before-quit listeners that might prevent quit
              app.removeAllListeners('before-quit');
              app.removeAllListeners('window-all-closed');
              // Now quit and install
              autoUpdater.quitAndInstall(false, true);
            } catch (error) {
              log.error('Failed to quit and install:', error);
              // Fallback to force quit
              AutoUpdaterService.isUpdating = true;
              app.removeAllListeners('before-quit');
              app.removeAllListeners('window-all-closed');
              app.relaunch();
              app.exit(0);
            }
          });
        }
      });

      this.sendToAllWindows('update-downloaded', info);
    });
  }

  private setupIpcHandlers() {
    ipcMain.handle('check-for-updates', async () => {
      if (this.isCheckingForUpdate) {
        return { checking: true };
      }
      
      try {
        const result = await autoUpdater.checkForUpdatesAndNotify();
        return result;
      } catch (error) {
        log.error('Failed to check for updates:', error);
        throw error;
      }
    });

    ipcMain.handle('download-update', async () => {
      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error) {
        log.error('Failed to download update:', error);
        throw error;
      }
    });

    ipcMain.handle('quit-and-install', () => {
      setImmediate(() => {
        try {
          log.info('IPC: Attempting to quit and install update...');
          // Set flag to bypass quit prevention
          AutoUpdaterService.isUpdating = true;
          // Force remove all before-quit listeners that might prevent quit
          app.removeAllListeners('before-quit');
          app.removeAllListeners('window-all-closed');
          // Now quit and install
          autoUpdater.quitAndInstall(false, true);
        } catch (error) {
          log.error('Failed to quit and install update:', error);
          // Fallback to force quit
          AutoUpdaterService.isUpdating = true;
          app.removeAllListeners('before-quit');
          app.removeAllListeners('window-all-closed');
          app.relaunch();
          app.exit(0);
        }
      });
    });

    ipcMain.handle('get-current-version', () => {
      return app.getVersion();
    });
  }

  private sendToAllWindows(channel: string, data?: any) {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send(channel, data);
    });
  }

  public startAutoUpdateCheck(intervalMinutes = 60) {
    // Initial check after 30 seconds
    setTimeout(() => {
      this.checkForUpdates();
    }, 30000);

    // Set up periodic checks
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, intervalMinutes * 60 * 1000);
  }

  public stopAutoUpdateCheck() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }

  public static isUpdatingApp(): boolean {
    return AutoUpdaterService.isUpdating;
  }

  public async checkForUpdates() {
    if (this.isCheckingForUpdate) {
      log.info('Already checking for updates, skipping...');
      return;
    }

    try {
      log.info('Checking for updates...');
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      log.error('Failed to check for updates:', error);
    }
  }

  public async checkForUpdatesWithUI() {
    if (this.isCheckingForUpdate) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Check',
        message: 'Already checking for updates...',
        buttons: ['OK']
      });
      return;
    }

    try {
      const result = await autoUpdater.checkForUpdates();
      
      if (!result || !result.updateInfo) {
        dialog.showMessageBox({
          type: 'info',
          title: 'No Updates',
          message: 'You are running the latest version.',
          buttons: ['OK']
        });
      }
    } catch (error) {
      log.error('Failed to check for updates:', error);
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Check Failed',
        message: 'Failed to check for updates.',
        detail: error instanceof Error ? error.message : 'Unknown error',
        buttons: ['OK']
      });
    }
  }
}

// Export singleton instance
export const autoUpdaterService = new AutoUpdaterService();