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
      return this.initPromise;
    }

    // Already initialized
    if (this.initialized) {
      return;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  /**
   * Create and set up a new worker thread
   */
  private createWorker(): void {
    // Create worker thread - use the bundled worker in production
    // In production, the worker.bundle.js is in the resources directory
    const workerPath = app.isPackaged
      ? path.join(process.resourcesPath, 'worker.bundle.js')
      : path.join(__dirname, '../../src/main/database/worker.js');

    // Use test-specific userData path for Playwright tests to avoid touching production database
    const userDataPath = process.env.PLAYWRIGHT === '1'
      ? path.join(app.getPath('temp'), 'nimbalyst-test-db')
      : app.getPath('userData');

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
          const response = await dialog.showMessageBox({
            type: 'warning',
            title: 'Database Corruption Detected',
            message: 'The application database was corrupted, but verified backups are available.\n\nNo file data has been lost.',
            detail: `Would you like to:\n\n• Restore from backup (recommended) - Recover your AI sessions and history\nor\n• Start fresh - Create a new database and lose previous data\n\nThe corrupted database has been backed up to:\n${initResult.dataDir}.backup-[timestamp]`,
            buttons: ['Restore from Backup', 'Start Fresh'],
            defaultId: 0,
            cancelId: 1
          });

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
              title: 'Confirm Start Fresh',
              message: 'Are you sure you want to start fresh?',
              detail: 'This will permanently delete all AI chat sessions and document history. Your document files will not be affected.\n\nThis action cannot be undone.',
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
    } catch (error) {
      logger.main.error('[PGLite Worker] Failed to initialize:', error);
      this.initPromise = null;

      // The worker should have already provided a detailed error message
      // Just re-throw it
      throw error;
    }
  }

  /**
   * Send a message to the worker and wait for response
   */
  private sendMessage(type: string, payload?: any): Promise<any> {
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

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${type} timed out`));
        }
      }, 30000);
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
   */
  async exec(sql: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    try {
      await this.sendMessage('exec', { sql });
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
   * Start the PostgreSQL protocol server in the worker
   */
  async startProtocolServer(): Promise<{ port: number; host: string; message: string }> {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return await this.sendMessage('startProtocolServer');
  }

  /**
   * Stop the PostgreSQL protocol server in the worker
   */
  async stopProtocolServer(): Promise<{ message: string }> {
    return await this.sendMessage('stopProtocolServer');
  }

  /**
   * Get the protocol server status from the worker
   */
  async getProtocolServerStatus(): Promise<{ running: boolean; port: number | null; host: string | null }> {
    return await this.sendMessage('getProtocolServerStatus');
  }

  /**
   * Verify a backup database
   */
  async verifyBackup(backupPath: string): Promise<{ valid: boolean; error?: string }> {
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
}

// Export singleton instance
export const database = new PGLiteDatabaseWorker();