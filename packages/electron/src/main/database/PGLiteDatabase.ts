/**
 * PGLite Database Service for Main Process
 * PostgreSQL in WASM for portable, dependency-free database
 */

import { PGlite } from '@electric-sql/pglite';
import { app } from 'electron';
import path from 'path';
import { logger } from '../utils/logger';

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

      logger.main.info('[PGLite] Database ready, creating schemas...');

      // Create schemas
      await this.createSchemas();

      this.initialized = true;
      logger.main.info('[PGLite] Database initialized successfully');
    } catch (error) {
      logger.main.error('[PGLite] Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Create database schemas
   */
  private async createSchemas(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // AI Sessions table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_path TEXT,
        provider TEXT NOT NULL,
        model TEXT,
        title TEXT NOT NULL,
        messages JSONB NOT NULL DEFAULT '[]',
        document_context JSONB,
        provider_config JSONB,
        provider_session_id TEXT,
        draft_input TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_ai_sessions_project ON ai_sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_created ON ai_sessions(created_at);
    `);

    // App Settings table (single row)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        theme TEXT DEFAULT 'system',
        sidebar_width INTEGER DEFAULT 240,
        recent_projects JSONB DEFAULT '[]',
        ai_providers JSONB DEFAULT '{}',
        editor_settings JSONB DEFAULT '{}',
        keyboard_shortcuts JSONB DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Ensure single row
      INSERT INTO app_settings (id) VALUES ('default')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Project State table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_state (
        project_path TEXT PRIMARY KEY,
        window_state JSONB,
        recent_files JSONB DEFAULT '[]',
        tab_state JSONB,
        ai_chat_state JSONB,
        settings JSONB DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Session State table (for window restoration)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_state (
        id TEXT PRIMARY KEY DEFAULT 'current',
        windows JSONB DEFAULT '[]',
        focused_window_id TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Ensure single row
      INSERT INTO session_state (id) VALUES ('current')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Document History table (metadata only, content on filesystem)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_history (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        snapshot_path TEXT NOT NULL,
        size_bytes INTEGER,
        timestamp BIGINT NOT NULL,
        version INTEGER DEFAULT 1,
        metadata JSONB DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_history_project_file ON document_history(project_id, file_path);
      CREATE INDEX IF NOT EXISTS idx_history_timestamp ON document_history(timestamp);
    `);

    logger.main.info('[PGLite] Database schemas created');
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
        (SELECT COUNT(*) FROM project_state) as projects_count,
        (SELECT COUNT(*) FROM document_history) as history_count,
        pg_database_size(current_database()) as database_size
    `);
    return result.rows[0];
  }
}

// Export singleton instance
export const database = new PGLiteDatabase();