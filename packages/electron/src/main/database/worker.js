/**
 * PGLite Worker Thread (JavaScript)
 * Runs PGLite in an isolated worker thread to avoid module conflicts
 */

const { parentPort, workerData } = require('worker_threads');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const path = require('path');

class PGLiteWorker {
  constructor() {
    this.db = null;
    this.dataDir = path.join(workerData.userDataPath, 'pglite-db');
    this.protocolServer = null;
    this.protocolServerPort = 5433;
    this.setupMessageHandler();
  }

  setupMessageHandler() {
    if (!parentPort) {
      throw new Error('This module must be run in a Worker thread');
    }

    // Global error handlers for the worker
    process.on('uncaughtException', (error) => {
      console.error('[PGLite Worker] Uncaught exception:', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('[PGLite Worker] Unhandled rejection at:', promise, 'reason:', reason);
    });

    parentPort.on('message', async (message) => {
      try {
        const response = await this.handleMessage(message);
        parentPort.postMessage(response);
      } catch (error) {
        console.error('[PGLite Worker] Error handling message:', error);
        parentPort.postMessage({
          id: message.id,
          success: false,
          error: error.message || String(error)
        });
      }
    });
  }

  async handleMessage(message) {
    switch (message.type) {
      case 'init':
        return await this.initialize(message);
      case 'query':
        return await this.query(message);
      case 'exec':
        return await this.exec(message);
      case 'close':
        return await this.close(message);
      case 'getStats':
        return await this.getStats(message);
      case 'startProtocolServer':
        return await this.startProtocolServer(message);
      case 'stopProtocolServer':
        return await this.stopProtocolServer(message);
      case 'getProtocolServerStatus':
        return await this.getProtocolServerStatus(message);
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  async initialize(message) {
    if (this.db) {
      return {
        id: message.id,
        success: true,
        data: { message: 'Database already initialized' }
      };
    }

    try {
      // Create PGlite instance
      // Use file-based storage for persistent data
      this.db = new PGlite({
        dataDir: this.dataDir,
        debug: 0  // Disable PGLite debug logging
      });

      // Wait for database to be ready
      await this.db.waitReady;

      // Create schemas
      await this.createSchemas();

      return {
        id: message.id,
        success: true,
        data: {
          message: 'Database initialized successfully',
          dataDir: this.dataDir
        }
      };
    } catch (error) {
      // Capture ALL error properties for debugging
      const errorStr = String(error?.message || error);
      const errorStack = error?.stack || '';
      const errorName = error?.name || error?.constructor?.name || 'UnknownError';

      // Log full error details for diagnosis
      console.error('[PGLite Worker] Full error object:', {
        message: error?.message,
        name: errorName,
        stack: errorStack,
        code: error?.code,
        errno: error?.errno,
        syscall: error?.syscall,
        path: error?.path,
        // PGlite DatabaseError fields if present
        severity: error?.severity,
        detail: error?.detail,
        hint: error?.hint,
        // All other properties
        ...error
      });

      // Check for specific error types we can identify
      const fs = require('fs');
      let lockInfo = '';

      // Check for file system lock indicators
      try {
        const lockPath = path.join(this.dataDir, 'postmaster.pid');
        if (fs.existsSync(lockPath)) {
          lockInfo = `\n\nPostgreSQL lock file found at: ${lockPath}`;
        }
      } catch (e) {
        // Ignore lock check errors
      }

      // Check if database directory is accessible
      let accessInfo = '';
      try {
        fs.accessSync(this.dataDir, fs.constants.R_OK | fs.constants.W_OK);
      } catch (e) {
        accessInfo = `\n\nDirectory access error: ${e.message}`;
      }

      // Detect specific error patterns
      if (errorStr.includes('Aborted') || errorName === 'RuntimeError') {
        // WebAssembly abort - likely file lock or corruption
        throw new Error(
          `DATABASE_INIT_FAILED: WebAssembly abort during PGlite initialization\n\n` +
          `Database path: ${this.dataDir}\n` +
          `Error: ${errorStr}\n` +
          lockInfo +
          accessInfo +
          `\n\nThis usually indicates:\n` +
          `1. Another process has the database locked\n` +
          `2. Database files are corrupted\n` +
          `3. Insufficient file system permissions\n` +
          `\nStack trace:\n${errorStack}`
        );
      }

      if (error?.code === 'EBUSY' || error?.code === 'EACCES' || error?.code === 'EPERM') {
        // File system permission/lock error
        throw new Error(
          `DATABASE_LOCKED: File system error (${error.code})\n\n` +
          `Database path: ${this.dataDir}\n` +
          `Syscall: ${error.syscall || 'unknown'}\n` +
          `Target: ${error.path || 'unknown'}\n` +
          lockInfo +
          `\n\nAnother process is using this database or you lack permissions.`
        );
      }

      // Generic error with full context
      throw new Error(
        `Failed to initialize PGlite\n\n` +
        `Database path: ${this.dataDir}\n` +
        `Error type: ${errorName}\n` +
        `Error: ${errorStr}\n` +
        (error?.code ? `Code: ${error.code}\n` : '') +
        lockInfo +
        accessInfo +
        `\n\nStack trace:\n${errorStack}`
      );
    }
  }


  async createSchemas() {
    if (!this.db) throw new Error('Database not initialized');

    // AI Sessions table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'default',
        file_path TEXT,
        provider TEXT NOT NULL,
        model TEXT,
        title TEXT NOT NULL DEFAULT 'New conversation',
        session_type TEXT DEFAULT 'chat',
        document_context JSONB,
        provider_config JSONB,
        provider_session_id TEXT,
        draft_input TEXT,
        token_usage JSONB DEFAULT '{}',
        total_tokens JSONB DEFAULT '{"input": 0, "output": 0, "total": 0}',
        metadata JSONB DEFAULT '{}',
        last_read_message_id TEXT,
        last_read_timestamp TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_ai_sessions_workspace ON ai_sessions(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_created ON ai_sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_type ON ai_sessions(session_type);
    `);

    // Add read state columns to existing ai_sessions tables (migration)
    await this.db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ai_sessions' AND column_name = 'last_read_message_id'
        ) THEN
          ALTER TABLE ai_sessions ADD COLUMN last_read_message_id TEXT;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ai_sessions' AND column_name = 'last_read_timestamp'
        ) THEN
          ALTER TABLE ai_sessions ADD COLUMN last_read_timestamp TIMESTAMP;
        END IF;
      END $$;
    `);

    // Document History table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_history (
        id SERIAL PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content BYTEA NOT NULL,
        size_bytes INTEGER,
        timestamp BIGINT NOT NULL,
        version INTEGER DEFAULT 1,
        metadata JSONB DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_history_workspace_file ON document_history(workspace_id, file_path);
      CREATE INDEX IF NOT EXISTS idx_history_timestamp ON document_history(timestamp);

      -- Migration: Clean up duplicate pending pre-edit tags before creating unique index
      -- Keep only the most recent pending tag per file
      DELETE FROM document_history
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY file_path
                   ORDER BY timestamp DESC
                 ) as rn
          FROM document_history
          WHERE metadata->>'type' = 'pre-edit'
            AND metadata->>'status' = 'pending-review'
        ) t
        WHERE rn > 1
      );

      -- Partial unique index: only one pending pre-edit tag per file at a time
      -- This prevents race conditions when AI makes multiple rapid edits
      CREATE UNIQUE INDEX IF NOT EXISTS idx_history_pending_pre_edit_per_file
        ON document_history(file_path)
        WHERE metadata->>'type' = 'pre-edit' AND metadata->>'status' = 'pending-review';
    `);

    // Session Files table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_files (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        link_type TEXT NOT NULL CHECK (link_type IN ('edited', 'referenced', 'read')),
        timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_files_file ON session_files(file_path);
      CREATE INDEX IF NOT EXISTS idx_session_files_type ON session_files(link_type);
      CREATE INDEX IF NOT EXISTS idx_session_files_workspace ON session_files(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_session_files_workspace_file ON session_files(workspace_id, file_path);
      CREATE INDEX IF NOT EXISTS idx_session_files_unique ON session_files(session_id, file_path, link_type);
    `);

    // Tracker Items table (JSONB structure)
    console.log('[PGLite Worker] Creating tracker_items table...');
    try {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS tracker_items (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          data JSONB NOT NULL,
          workspace TEXT NOT NULL,
          document_path TEXT,
          line_number INTEGER,
          created TIMESTAMP DEFAULT NOW(),
          updated TIMESTAMP DEFAULT NOW(),
          last_indexed TIMESTAMP DEFAULT NOW(),
          title TEXT GENERATED ALWAYS AS (data->>'title') STORED,
          status TEXT GENERATED ALWAYS AS (data->>'status') STORED
        );

        CREATE INDEX IF NOT EXISTS idx_tracker_type ON tracker_items(type);
        CREATE INDEX IF NOT EXISTS idx_tracker_workspace ON tracker_items(workspace);
        CREATE INDEX IF NOT EXISTS idx_tracker_status ON tracker_items(status);
        CREATE INDEX IF NOT EXISTS idx_tracker_created ON tracker_items(created);
        CREATE INDEX IF NOT EXISTS idx_tracker_updated ON tracker_items(updated);
        CREATE INDEX IF NOT EXISTS idx_tracker_data_gin ON tracker_items USING GIN(data);
      `);
      console.log('[PGLite Worker] tracker_items table created successfully');
    } catch (error) {
      console.error('[PGLite Worker] Failed to create tracker_items table:', error);
      throw error;
    }

    // AI Agent Messages table - write-only raw storage for AI interactions
    console.log('[PGLite Worker] Creating ai_agent_messages table...');
    try {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS ai_agent_messages (
          id BIGSERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          source TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('input', 'output')),
          content TEXT NOT NULL,
          metadata JSONB,
          CONSTRAINT fk_ai_agent_messages_session
            FOREIGN KEY (session_id)
            REFERENCES ai_sessions(id)
            ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_ai_agent_messages_session ON ai_agent_messages(session_id, id);
        CREATE INDEX IF NOT EXISTS idx_ai_agent_messages_created ON ai_agent_messages(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_agent_messages_source_direction ON ai_agent_messages(source, direction);
      `);
      console.log('[PGLite Worker] ai_agent_messages table created successfully');
    } catch (error) {
      console.error('[PGLite Worker] Failed to create ai_agent_messages table:', error);
      throw error;
    }
  }

  async query(message) {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.query(message.payload.sql, message.payload.params);
    return {
      id: message.id,
      success: true,
      data: result
    };
  }

  async exec(message) {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.exec(message.payload.sql);
    return {
      id: message.id,
      success: true
    };
  }

  async close(message) {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    return {
      id: message.id,
      success: true
    };
  }

  async getStats(message) {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.query(`
      SELECT
        (SELECT COUNT(*) FROM ai_sessions) as ai_sessions_count,
        (SELECT COUNT(*) FROM document_history) as history_count,
        pg_database_size(current_database()) as database_size
    `);

    return {
      id: message.id,
      success: true,
      data: result.rows[0]
    };
  }

  async startProtocolServer(message) {
    try {
      // Check if server is already running
      if (this.protocolServer) {
        return {
          id: message.id,
          success: false,
          error: 'Protocol server is already running'
        };
      }

      // Ensure database is initialized
      if (!this.db) {
        return {
          id: message.id,
          success: false,
          error: 'Database must be initialized before starting protocol server'
        };
      }

      // Try to start the server, incrementing port if needed
      let attempts = 0;
      const maxAttempts = 10;
      let port = this.protocolServerPort;

      while (attempts < maxAttempts) {
        try {
          this.protocolServer = new PGLiteSocketServer({
            db: this.db,
            port: port,
            host: '127.0.0.1',
            inspect: false  // Disable verbose protocol logging
          });

          await this.protocolServer.start();
          this.protocolServerPort = port;

          return {
            id: message.id,
            success: true,
            data: {
              port: port,
              host: '127.0.0.1',
              message: `PostgreSQL protocol server started on port ${port}`
            }
          };
        } catch (error) {
          if (error.code === 'EADDRINUSE') {
            port++;
            attempts++;
          } else {
            throw error;
          }
        }
      }

      throw new Error('Could not find an available port');
    } catch (error) {
      return {
        id: message.id,
        success: false,
        error: error.message || String(error)
      };
    }
  }

  async stopProtocolServer(message) {
    try {
      if (!this.protocolServer) {
        return {
          id: message.id,
          success: false,
          error: 'Protocol server is not running'
        };
      }

      await this.protocolServer.stop();
      this.protocolServer = null;

      return {
        id: message.id,
        success: true,
        data: {
          message: 'PostgreSQL protocol server stopped'
        }
      };
    } catch (error) {
      return {
        id: message.id,
        success: false,
        error: error.message || String(error)
      };
    }
  }

  async getProtocolServerStatus(message) {
    return {
      id: message.id,
      success: true,
      data: {
        running: !!this.protocolServer,
        port: this.protocolServer ? this.protocolServerPort : null,
        host: this.protocolServer ? '127.0.0.1' : null
      }
    };
  }
}

// Start the worker
new PGLiteWorker();
