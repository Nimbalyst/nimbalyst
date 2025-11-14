/**
 * PGLite Database Service using Worker Thread
 * Main thread wrapper that communicates with PGLite running in a worker
 */

import { Worker } from 'worker_threads';
import { app } from 'electron';
import path from 'path';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { AnalyticsService } from '../services/analytics/AnalyticsService';

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

  private async doInitialize(): Promise<void> {
    try {
      logger.main.info('[PGLite Worker] Starting database worker thread...');


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

      // Initialize database in worker
      await this.sendMessage('init');

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
}

// Export singleton instance
export const database = new PGLiteDatabaseWorker();