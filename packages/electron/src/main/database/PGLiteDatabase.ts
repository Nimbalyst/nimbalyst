/**
 * PGLite Database Service for Main Process
 * PostgreSQL in WASM for portable, dependency-free database
 */

import { PGlite } from '@electric-sql/pglite';
import { app } from 'electron';
import path from 'path';
import { logger } from '../utils/logger';
import { initDB as registerRuntimeDB } from '@stravu/runtime/storage/pglite';

export class PGLiteDatabase {
  private db: PGlite | null = null;
  private dataDir: string;
  private initialized = false;

  constructor() {
    // Store database in user data directory
    this.dataDir = path.join(app.getPath('userData'), 'pglite-db');
    logger.main.info('[PGLite] Database directory:', this.dataDir);
  }

  /**
   * Initialize the database and create tables
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      logger.main.info('[PGLite] Initializing database...');

      // Create PGlite instance
      this.db = new PGlite({
        dataDir: this.dataDir,
        debug: process.env.NODE_ENV === 'development' ? 1 : 0
      });

      // Wait for database to be ready
      await this.db.waitReady;

      logger.main.info('[PGLite] Database ready, checking for migrations...');

      // Run migrations first
      await this.runMigrations();

      // Create schemas
      await registerRuntimeDB({ existingInstance: this.db });
      logger.main.info('[PGLite] Runtime schema ensured');

      this.initialized = true;
      logger.main.info('[PGLite] Database initialized successfully');
    } catch (error) {
      logger.main.error('[PGLite] Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Run database migrations
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

  }

  /**
   * Get the database instance
   */
  getDB(): PGlite {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Get the database instance (alias for protocol server)
   */
  getDatabase(): PGlite | null {
    return this.db;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.initialized = false;
      logger.main.info('[PGLite] Database closed');
    }
  }

  /**
   * Execute a query
   */
  async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
    const db = this.getDB();
    return await db.query(sql, params);
  }

  /**
   * Execute a statement (no return value)
   */
  async exec(sql: string): Promise<void> {
    const db = this.getDB();
    await db.exec(sql);
  }

  /**
   * Begin a transaction
   */
  async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const db = this.getDB();
    return await db.transaction(fn);
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
    const db = this.getDB();
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM ai_sessions) as ai_sessions_count,
        (SELECT COUNT(*) FROM document_history) as history_count,
        pg_database_size(current_database()) as database_size
    `);
    return result.rows[0];
  }
}

// Export singleton instance
export const database = new PGLiteDatabase();
