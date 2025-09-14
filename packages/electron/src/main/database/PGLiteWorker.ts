/**
 * PGLite Worker Thread
 * Runs PGLite in an isolated worker thread to avoid module conflicts
 */

import { parentPort, workerData } from 'worker_threads';
import { PGlite } from '@electric-sql/pglite';
import path from 'path';

// Message types for worker communication
interface WorkerMessage {
  id: string;
  type: 'init' | 'query' | 'exec' | 'close' | 'getStats';
  payload?: any;
}

interface WorkerResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
}

class PGLiteWorker {
  private db: PGlite | null = null;
  private dataDir: string;

  constructor() {
    // Get user data path from worker data (passed from main thread)
    if (!workerData || !workerData.userDataPath) {
      throw new Error('userDataPath must be provided in workerData');
    }
    this.dataDir = path.join(workerData.userDataPath, 'pglite-db');
    this.setupMessageHandler();
  }

  private setupMessageHandler() {
    if (!parentPort) {
      throw new Error('This module must be run in a Worker thread');
    }

    parentPort.on('message', async (message: WorkerMessage) => {
      try {
        const response = await this.handleMessage(message);
        parentPort!.postMessage(response);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        parentPort!.postMessage({
          id: message.id,
          success: false,
          error: errorMessage
        });
      }
    });
  }

  private async handleMessage(message: WorkerMessage): Promise<WorkerResponse> {
    switch (message.type) {
      case 'init':
        return await this.initialize();

      case 'query':
        return await this.query(message.payload);

      case 'exec':
        return await this.exec(message.payload);

      case 'close':
        return await this.close();

      case 'getStats':
        return await this.getStats();

      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  private async initialize(): Promise<WorkerResponse> {
    if (this.db) {
      return {
        id: 'init',
        success: true,
        data: { message: 'Database already initialized' }
      };
    }

    // Create PGlite instance
    this.db = new PGlite({
      dataDir: this.dataDir,
      debug: process.env.NODE_ENV === 'development' ? 1 : 0
    });

    // Wait for database to be ready
    await this.db.waitReady;

    // Create schemas
    await this.createSchemas();

    return {
      id: 'init',
      success: true,
      data: { message: 'Database initialized successfully', dataDir: this.dataDir }
    };
  }

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

    // App Settings table
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

    // Session State table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_state (
        id TEXT PRIMARY KEY DEFAULT 'current',
        windows JSONB DEFAULT '[]',
        focused_window_id TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO session_state (id) VALUES ('current')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Document History table
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
  }

  private async query(payload: { sql: string; params?: any[] }): Promise<WorkerResponse> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.query(payload.sql, payload.params);
    return {
      id: 'query',
      success: true,
      data: result
    };
  }

  private async exec(payload: { sql: string }): Promise<WorkerResponse> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.exec(payload.sql);
    return {
      id: 'exec',
      success: true
    };
  }

  private async close(): Promise<WorkerResponse> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    return {
      id: 'close',
      success: true
    };
  }

  private async getStats(): Promise<WorkerResponse> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.query(`
      SELECT
        (SELECT COUNT(*) FROM ai_sessions) as ai_sessions_count,
        (SELECT COUNT(*) FROM project_state) as projects_count,
        (SELECT COUNT(*) FROM document_history) as history_count,
        pg_database_size(current_database()) as database_size
    `);

    return {
      id: 'getStats',
      success: true,
      data: result.rows[0]
    };
  }
}

// Start the worker
new PGLiteWorker();