/**
 * PGLite Database Service using Worker Thread
 * Main thread wrapper that communicates with PGLite running in a worker
 */

import { Worker } from 'worker_threads';
import { app, dialog } from 'electron';
import path from 'path';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { AnalyticsService } from '../services/analytics/AnalyticsService';
import { DatabaseBackupService } from '../services/database/DatabaseBackupService';

// Helper to categorize database errors
function categorizeDBError(error: any): string {
  const message = error?.message?.toLowerCase() || String(error).toLowerCase();
  if (message.includes('permission') || message.includes('eacces')) return 'permission';
  if (message.includes('disk') || message.includes('enospc')) return 'disk_full';
  if (message.includes('lock') || message.includes('busy')) return 'lock';
  if (message.includes('corrupt')) return 'corruption';
  if (message.includes('syntax')) return 'syntax';
  return 'unknown';
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export class PGLiteDatabaseWorker {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private analytics = AnalyticsService.getInstance();
  private backupService: DatabaseBackupService | null = null;

  /**
   * Initialize the database worker
   */
  async initialize(): Promise<void> {
    // Return existing initialization if in progress
    if (this.initPromise) {
      logger.main.info('[PGLite] initialize() called but initPromise already exists - returning existing promise');
      return this.initPromise;
    }

    // Already initialized
    if (this.initialized) {
      logger.main.info('[PGLite] initialize() called but already initialized - returning immediately');
      return;
    }

    logger.main.info('[PGLite] initialize() called - starting fresh initialization');
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  /**
   * Create and set up a new worker thread
   */
  private createWorker(): void {
    // Create worker thread - use the bundled worker
    // app.getAppPath() returns different values depending on context:
    // - Packaged app: use resourcesPath
    // - Built but not packaged (Playwright): returns out/main, need ../worker.bundle.js
    // - Dev mode (npm run dev): returns package root, need out/worker.bundle.js
    const appPath = app.getAppPath();
    let workerPath: string;
    if (app.isPackaged) {
      workerPath = path.join(process.resourcesPath, 'worker.bundle.js');
    } else if (appPath.includes('/out/main') || appPath.includes('\\out\\main')) {
      // Running from built output (e.g., Playwright tests)
      workerPath = path.join(appPath, '..', 'worker.bundle.js');
    } else {
      // Dev mode - running from source
      workerPath = path.join(appPath, 'out', 'worker.bundle.js');
    }

    // Use test-specific userData path for Playwright tests to avoid touching production database
    const userDataPath = process.env.PLAYWRIGHT === '1'
      ? path.join(app.getPath('temp'), 'nimbalyst-test-db')
      : app.getPath('userData');

    logger.main.info('[PGLite] createWorker() called', {
      existingWorker: !!this.worker,
      workerPath,
      userDataPath
    });

    this.worker = new Worker(workerPath, {
      workerData: {
        userDataPath
      }
    });

    // Set up message handler
    this.worker.on('message', (response) => {
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if (response.success) {
          pending.resolve(response.data);
        } else {
          pending.reject(new Error(response.error || 'Unknown error'));
        }
      }
    });

    // Set up error handler
    this.worker.on('error', (error) => {
      logger.main.error('[PGLite Worker] Worker error:', error);
      // Reject all pending requests with the original error
      this.pendingRequests.forEach((pending) => {
        pending.reject(error);
      });
      this.pendingRequests.clear();
    });

    // Set up exit handler
    this.worker.on('exit', (code) => {
      if (code !== 0) {
        logger.main.error(`[PGLite Worker] Worker exited with code ${code}`);
        // Reject all pending requests
        this.pendingRequests.forEach((pending) => {
          pending.reject(new Error(`Worker exited with code ${code}`));
        });
        this.pendingRequests.clear();
        this.initialized = false;
        this.worker = null;
      }
    });
  }

  private async doInitialize(): Promise<void> {
    try {
      logger.main.info('[PGLite Worker] Starting database worker thread...');

      // Create the worker
      this.createWorker();

      // Initialize database in worker
      const initResult = await this.sendMessage('init');

      // Check if database was recovered from corruption
      if (initResult.recovered) {
        logger.main.warn('[PGLite Worker] Database was corrupted and has been auto-recovered');
        logger.main.warn('[PGLite Worker] Checking for backups...');

        // Track corruption detection
        this.analytics.sendEvent('database_corruption_detected', {
          hasBackups: !!(this.backupService && this.backupService.hasBackups())
        });

        // Check if we have backups available
        if (this.backupService && this.backupService.hasBackups()) {
          logger.main.info('[PGLite Worker] Backups available - offering restore option');

          // Show dialog with restore option
          const response = await dialog.showMessageBox(this.getRecoveryDialogOptions());

          if (response.response === 0) {
            // User chose to restore from backup
            logger.main.info('[PGLite Worker] User chose to restore from backup');
            this.analytics.sendEvent('database_corruption_recovery_choice', {
              choice: 'restore_from_backup'
            });

            // Don't close yet - we need the worker for backup verification!
            // The restore process will handle closing and reopening

            // Attempt restore
            const restoreResult = await this.backupService.restoreFromBackup();

            if (restoreResult.success) {
              logger.main.info(`[PGLite Worker] Successfully restored from ${restoreResult.source} backup`);
              this.analytics.sendEvent('database_corruption_restore_result', {
                success: true,
                source: restoreResult.source
              });

              // Worker was closed during restore - recreate it
              logger.main.info('[PGLite Worker] Recreating worker thread after restore...');
              this.createWorker();

              // Re-initialize with restored database
              await this.sendMessage('init');

              dialog.showMessageBox({
                type: 'info',
                title: 'Database Restored',
                message: `Your database has been successfully restored from the ${restoreResult.source} backup.`,
                buttons: ['OK']
              }).catch(() => {});
            } else {
              logger.main.error('[PGLite Worker] Failed to restore from backup:', restoreResult.error);
              this.analytics.sendEvent('database_corruption_restore_result', {
                success: false,
                errorType: restoreResult.error?.includes('verification') ? 'verification_failed' : 'restore_failed'
              });

              dialog.showMessageBox({
                type: 'error',
                title: 'Restore Failed',
                message: 'Failed to restore from backup. Starting with a fresh database.',
                detail: restoreResult.error,
                buttons: ['OK']
              }).catch(() => {});
            }
          } else {
            // User clicked "Start Fresh" - show confirmation dialog
            logger.main.info('[PGLite Worker] User clicked Start Fresh - showing confirmation');

            const confirmResponse = await dialog.showMessageBox({
              type: 'warning',
              title: 'Start Fresh?',
              message: 'This will clear your AI chat sessions.',
              detail: 'Your files will not be affected, but all AI chat history will be permanently deleted.\n\nAre you sure you want to continue?',
              buttons: ['Cancel', 'Yes, Start Fresh'],
              defaultId: 0,
              cancelId: 0
            });

            if (confirmResponse.response === 1) {
              // User confirmed starting fresh
              logger.main.info('[PGLite Worker] User confirmed starting fresh');
              this.analytics.sendEvent('database_corruption_recovery_choice', {
                choice: 'start_fresh',
                confirmed: true
              });
            } else {
              // User cancelled - go back to restore option
              logger.main.info('[PGLite Worker] User cancelled start fresh - attempting restore');
              this.analytics.sendEvent('database_corruption_recovery_choice', {
                choice: 'start_fresh',
                confirmed: false
              });

              // Attempt restore as fallback
              const restoreResult = await this.backupService.restoreFromBackup();

              if (restoreResult.success) {
                logger.main.info(`[PGLite Worker] Successfully restored from ${restoreResult.source} backup`);
                this.analytics.sendEvent('database_corruption_restore_result', {
                  success: true,
                  source: restoreResult.source,
                  trigger: 'cancel_start_fresh'
                });

                // Worker was closed during restore - recreate it
                logger.main.info('[PGLite Worker] Recreating worker thread after restore...');
                this.createWorker();

                // Re-initialize with restored database
                await this.sendMessage('init');

                dialog.showMessageBox({
                  type: 'info',
                  title: 'Database Restored',
                  message: `Your database has been successfully restored from the ${restoreResult.source} backup.`,
                  buttons: ['OK']
                }).catch(() => {});
              } else {
                logger.main.error('[PGLite Worker] Failed to restore from backup:', restoreResult.error);
                this.analytics.sendEvent('database_corruption_restore_result', {
                  success: false,
                  errorType: restoreResult.error?.includes('verification') ? 'verification_failed' : 'restore_failed',
                  trigger: 'cancel_start_fresh'
                });

                dialog.showMessageBox({
                  type: 'error',
                  title: 'Restore Failed',
                  message: 'Failed to restore from backup. Starting with a fresh database.',
                  detail: restoreResult.error,
                  buttons: ['OK']
                }).catch(() => {});
              }
            }
          }
        } else {
          // No backups available - just show the auto-recovery notification
          logger.main.warn('[PGLite Worker] No backups available - fresh database created');
          this.analytics.sendEvent('database_corruption_recovery_choice', {
            choice: 'auto_fresh',
            reason: 'no_backups_available'
          });

          dialog.showMessageBox({
            type: 'warning',
            title: 'Database Recovered',
            message: 'The application database was corrupted and has been automatically repaired.',
            detail: `A fresh database has been created. Your old data has been backed up to:\n\n${initResult.dataDir}.backup-[timestamp]\n\nYour document files have not been lost - they are still on disk. Only the internal application database (AI chat sessions and document history) needs to be rebuilt.`,
            buttons: ['OK']
          }).catch(() => {});
        }
      }

      logger.main.info('[PGLite Worker] Database initialized in worker thread');

      // Create schemas
      logger.main.info('[PGLite Worker] Database schemas created');

      this.initialized = true;
    } catch (error: any) {
      logger.main.error('[PGLite Worker] Failed to initialize:', error);
      this.initPromise = null;

      // Check for database locked error (another instance running)
      if (error?.message?.includes('DATABASE_LOCKED') || error?.message?.includes('locked by another process')) {
        dialog.showMessageBox({
          type: 'error',
          title: 'Database Locked',
          message: 'Another instance of Nimbalyst is already running.',
          detail: 'The database is locked by another process. Please close the other instance before starting a new one.\n\nRunning multiple instances simultaneously can cause data corruption.',
          buttons: ['Quit']
        }).then(() => {
          app.quit();
        }).catch(() => {
          app.quit();
        });

        // Don't re-throw - we're quitting
        return;
      }

      // The worker should have already provided a detailed error message
      // Just re-throw it
      throw error;
    }
  }

  /**
   * Send a message to the worker and wait for response
   * @param timeoutMs - Timeout in milliseconds (default: 30000)
   */
  private sendMessage(type: string, payload?: any, timeoutMs: number = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const id = uuidv4();
      this.pendingRequests.set(id, { resolve, reject });

      this.worker.postMessage({
        id,
        type,
        payload
      });

      // Timeout (default 30 seconds, can be extended for long operations)
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${type} timed out`));
        }
      }, timeoutMs);
    });
  }

  /**
   * Execute a query
   */
  async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    try {
      return await this.sendMessage('query', { sql, params });
    } catch (error) {
      // Track database error
      this.analytics.sendEvent('database_error', {
        operation: 'read',
        errorType: categorizeDBError(error),
        tableName: this.extractTableName(sql)
      });
      throw error;
    }
  }

  /**
   * Execute a statement (no return value)
   * @param timeoutMs - Timeout in milliseconds (default: 30000, use longer for index creation)
   */
  async exec(sql: string, timeoutMs: number = 30000): Promise<void> {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    try {
      await this.sendMessage('exec', { sql }, timeoutMs);
    } catch (error) {
      // Track database error
      this.analytics.sendEvent('database_error', {
        operation: 'write',
        errorType: categorizeDBError(error),
        tableName: this.extractTableName(sql)
      });
      throw error;
    }
  }

  /**
   * Extract table name from SQL query (simple heuristic)
   */
  private extractTableName(sql: string): string {
    const match = sql.match(/(?:FROM|INTO|UPDATE|TABLE)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
    return match ? match[1] : 'unknown';
  }

  /**
   * Begin a transaction
   * Note: Transactions in worker threads are more complex - simplified for now
   */
  async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    // For now, just execute the function
    // Real transaction support would need message batching
    return await fn({
      query: (sql: string, params?: any[]) => this.query(sql, params),
      exec: (sql: string) => this.exec(sql)
    });
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.sendMessage('close');
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
      this.initPromise = null;
      logger.main.info('[PGLite Worker] Database worker terminated');
    }
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get database stats
   */
  async getStats(): Promise<any> {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return await this.sendMessage('getStats');
  }

  /**
   * Get the database instance (compatibility method)
   * Note: With worker threads, we can't return the actual DB instance
   */
  getDB(): any {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    // Return a proxy object that forwards calls
    return {
      query: (sql: string, params?: any[]) => this.query(sql, params),
      exec: (sql: string) => this.exec(sql)
    };
  }

  /**
   * Verify a backup database
   * Returns validity status plus data integrity info (session/history counts)
   */
  async verifyBackup(backupPath: string): Promise<{
    valid: boolean;
    error?: string;
    hasData?: boolean;
    sessionCount?: number;
    historyCount?: number;
  }> {
    return await this.sendMessage('verifyBackup', { backupPath });
  }

  /**
   * Set the backup service instance
   */
  setBackupService(backupService: DatabaseBackupService): void {
    this.backupService = backupService;
  }

  /**
   * Create a database backup
   */
  async createBackup(): Promise<{ success: boolean; error?: string }> {
    if (!this.backupService) {
      return { success: false, error: 'Backup service not initialized' };
    }
    return await this.backupService.createBackup();
  }

  /**
   * Get the backup service instance
   */
  getBackupService(): DatabaseBackupService | null {
    return this.backupService;
  }

  /**
   * Get the recovery dialog options (shared between real recovery and dev menu preview)
   */
  private getRecoveryDialogOptions(): Electron.MessageBoxOptions {
    const backupStatus = this.backupService?.getBackupStatus();
    const backupTimestamp = backupStatus?.currentBackup?.timestamp
      || backupStatus?.previousBackup?.timestamp
      || backupStatus?.oldestBackup?.timestamp;

    let backupDateStr = '';
    if (backupTimestamp) {
      // Convert timestamp format from "2026-01-12T19-10-17-765Z" to valid ISO
      const isoTimestamp = backupTimestamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
      const backupDate = new Date(isoTimestamp);
      backupDateStr = backupDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    }

    return {
      type: 'info',
      title: 'Restore Your Data',
      message: 'No file data has been lost.',
      detail: backupDateStr
        ? `Your files are safe, but your chat history will need to be restored from a backup dated ${backupDateStr}.`
        : `Your files are safe and your AI chat sessions can be restored from a recent backup.`,
      buttons: ['Restore (Recommended)', 'Start Fresh'],
      defaultId: 0,
      cancelId: 1
    };
  }

  /**
   * Show the database recovery dialog (for testing via developer menu)
   * This shows the exact same dialog that would appear during actual recovery
   */
  async showRecoveryDialog(): Promise<void> {
    if (!this.backupService || !this.backupService.hasBackups()) {
      dialog.showMessageBox({
        type: 'info',
        title: 'No Backups Available',
        message: 'No backups are available to test the recovery dialog.',
        buttons: ['OK']
      });
      return;
    }

    dialog.showMessageBox(this.getRecoveryDialogOptions());
  }
}

// Export singleton instance
export const database = new PGLiteDatabaseWorker();