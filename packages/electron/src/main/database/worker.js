/**
 * PGLite Worker Thread (JavaScript)
 * Runs PGLite in an isolated worker thread to avoid module conflicts
 *
 * CRITICAL: Date/Timestamp Handling
 * ==================================
 * PostgreSQL TIMESTAMP columns store UTC time but return Date objects to JavaScript
 * that are parsed as LOCAL time. This creates a timezone mismatch.
 *
 * Example:
 *   - PostgreSQL stores: "2025-11-19 04:25:00" (UTC)
 *   - PGlite returns: Date object representing "2025-11-19 04:25:00 EST" (local)
 *   - This is WRONG - it should be converted to "2025-11-18 23:25:00 EST"
 *
 * Solution:
 *   - The toMillis() function in PGLiteSessionStore.ts handles this conversion
 *   - It treats Date object components as UTC and converts to proper epoch milliseconds
 *   - JavaScript's toLocaleString() then correctly displays in local timezone
 *
 * Rules:
 *   1. Always use CURRENT_TIMESTAMP for database inserts/updates (PostgreSQL handles as UTC)
 *   2. Never use Date.now() with to_timestamp() - causes double timezone conversion
 *   3. All timestamp retrieval must go through toMillis() for proper UTC conversion
 *   4. Display timestamps using toLocaleString() to show in user's local timezone
 */

const { parentPort, workerData } = require('worker_threads');
const { PGlite } = require('@electric-sql/pglite');
const path = require('path');

class PGLiteWorker {
  constructor() {
    this.db = null;
    this.dataDir = path.join(workerData.userDataPath, 'pglite-db');
    console.log('[PGLite Worker] Worker thread instantiated, dataDir:', this.dataDir);
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
      case 'verifyBackup':
        return await this.verifyBackup(message);
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  async initialize(message) {
    console.log('[PGLite Worker] initialize() called, existing db:', !!this.db, 'dataDir:', this.dataDir);

    if (this.db) {
      console.log('[PGLite Worker] Database already initialized - returning early');
      return {
        id: message.id,
        success: true,
        data: { message: 'Database already initialized' }
      };
    }

    try {
      // Ensure parent directory exists (needed for test environments)
      const fs = require('fs');
      const parentDir = path.dirname(this.dataDir);
      if (!fs.existsSync(parentDir)) {
        console.log('[PGLite Worker] Creating parent directory:', parentDir);
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Attempt to initialize database, with automatic recovery on corruption
      let initAttempt = 0;
      const maxAttempts = 2;

      while (initAttempt < maxAttempts) {
        initAttempt++;

        try {
          // Clean up stale lock files before each initialization attempt
          // This handles crash recovery - if the app crashed, PGlite may have left
          // a postmaster.pid file that prevents startup
          try {
            const lockPath = path.join(this.dataDir, 'postmaster.pid');
            if (fs.existsSync(lockPath)) {
              console.log('[PGLite Worker] Removing stale lock file from previous crash:', lockPath);
              fs.unlinkSync(lockPath);
            }
          } catch (lockError) {
            console.warn('[PGLite Worker] Failed to remove lock file:', lockError);
            // Continue anyway - PGlite will handle it if it's a real lock
          }

          // Create PGlite instance
          // Use file-based storage for persistent data
          console.log('[PGLite Worker] Creating PGlite instance at:', this.dataDir);
          this.db = new PGlite({
            dataDir: this.dataDir,
            debug: 0  // Disable PGLite debug logging
          });

          console.log('[PGLite Worker] PGlite instance created, waiting for ready...');
          // Wait for database to be ready
          await this.db.waitReady;
          console.log('[PGLite Worker] PGlite is ready');

          // If we get here, initialization succeeded
          break;

        } catch (dbError) {
          // Database initialization failed
          const errorStr = String(dbError?.message || dbError);
          const errorName = dbError?.name || dbError?.constructor?.name || 'UnknownError';

          console.error(`[PGLite Worker] Database initialization failed (attempt ${initAttempt}/${maxAttempts}):`, errorStr);

          // Check if this looks like corruption/abort (not a real lock)
          const isCorruptionError = errorStr.includes('Aborted') || errorName === 'RuntimeError';

          if (isCorruptionError && initAttempt < maxAttempts && fs.existsSync(this.dataDir)) {
            // Database appears corrupted - move it and try fresh
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = `${this.dataDir}.backup-${timestamp}`;

            console.log('[PGLite Worker] Database appears corrupted, moving to backup:', backupDir);
            console.log('[PGLite Worker] Creating fresh database...');

            try {
              fs.renameSync(this.dataDir, backupDir);
              console.log('[PGLite Worker] Corrupted database backed up successfully');
              console.log('[PGLite Worker] User data is preserved at:', backupDir);
              // Continue to next attempt with fresh database directory
              continue;
            } catch (backupError) {
              console.error('[PGLite Worker] Failed to backup corrupted database:', backupError);
              // Fall through to re-throw the original error
            }
          }

          // Either not a corruption error, or we failed to recover - re-throw
          throw dbError;
        }
      }

      // Create schemas
      await this.createSchemas();

      // Check if we recovered from corruption
      const recovered = initAttempt > 1;

      return {
        id: message.id,
        success: true,
        data: {
          message: recovered ? 'Database recovered from corruption' : 'Database initialized successfully',
          dataDir: this.dataDir,
          recovered: recovered,
          backupLocation: recovered ? `${this.dataDir}.backup-*` : null
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
        metadata JSONB DEFAULT '{}',
        last_read_message_id TEXT,
        last_read_timestamp TIMESTAMP,
        has_been_named BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_ai_sessions_workspace ON ai_sessions(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_created ON ai_sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_type ON ai_sessions(session_type);
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_updated ON ai_sessions(updated_at);

      -- One-time fix: Ensure all sessions have updated_at set to at least created_at
      -- This fixes sessions created before updated_at tracking was working properly
      UPDATE ai_sessions
      SET updated_at = created_at
      WHERE updated_at < created_at OR updated_at IS NULL;
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

        -- Add session state tracking columns (migration)
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ai_sessions' AND column_name = 'status'
        ) THEN
          ALTER TABLE ai_sessions ADD COLUMN status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'waiting_for_input', 'error', 'interrupted'));
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ai_sessions' AND column_name = 'last_activity'
        ) THEN
          ALTER TABLE ai_sessions ADD COLUMN last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ai_sessions' AND column_name = 'has_been_named'
        ) THEN
          ALTER TABLE ai_sessions ADD COLUMN has_been_named BOOLEAN DEFAULT FALSE;
        END IF;

        -- Add mode column for session behavior (planning vs agent)
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ai_sessions' AND column_name = 'mode'
        ) THEN
          ALTER TABLE ai_sessions ADD COLUMN mode TEXT DEFAULT 'agent' CHECK (mode IN ('planning', 'agent'));
        END IF;

        -- Add is_archived column for session archiving feature
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ai_sessions' AND column_name = 'is_archived'
        ) THEN
          ALTER TABLE ai_sessions ADD COLUMN is_archived BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);

    // Create index for archived sessions filtering
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_archived ON ai_sessions(is_archived);
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

      -- Create index to speed up duplicate detection (most recent snapshot check)
      -- This is just for performance, not uniqueness
      CREATE INDEX IF NOT EXISTS idx_history_file_content_hash
        ON document_history(file_path, (metadata->>'baseMarkdownHash'))
        WHERE metadata->>'baseMarkdownHash' IS NOT NULL;

      -- Migration: Clean up duplicate pending tags before creating unique index
      -- Keep only the most recent pending tag per file (any type)
      DELETE FROM document_history
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY file_path
                   ORDER BY timestamp DESC
                 ) as rn
          FROM document_history
          WHERE metadata->>'status' = 'pending-review'
        ) t
        WHERE rn > 1
      );

      -- Drop old separate indexes if they exist
      DROP INDEX IF EXISTS idx_history_pending_pre_edit_per_file;
      DROP INDEX IF EXISTS idx_history_pending_incremental_approval_per_file;

      -- CRITICAL: Only ONE tag with status='pending-review' per file at a time
      -- This ensures unambiguous diff baseline and prevents multiple pending tags
      -- Applies to ALL tag types (pre-edit, incremental-approval, etc.)
      CREATE UNIQUE INDEX IF NOT EXISTS idx_history_one_pending_per_file
        ON document_history(file_path)
        WHERE metadata->>'status' = 'pending-review';
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
      // console.log('[PGLite Worker] tracker_items table created successfully');
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

    // Add hidden column to ai_agent_messages table (migration)
    try {
      await this.db.exec(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'ai_agent_messages' AND column_name = 'hidden'
          ) THEN
            ALTER TABLE ai_agent_messages ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT FALSE;
          END IF;
        END $$;
      `);
    } catch (error) {
      console.error('[PGLite Worker] Failed to add hidden column:', error);
      throw error;
    }

    // Add provider_message_id column to ai_agent_messages table (migration)
    // This stores the provider-assigned message ID (e.g., SDK uuid) for sync deduplication
    try {
      await this.db.exec(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'ai_agent_messages' AND column_name = 'provider_message_id'
          ) THEN
            ALTER TABLE ai_agent_messages ADD COLUMN provider_message_id TEXT;
          END IF;
        END $$;
      `);
    } catch (error) {
      console.error('[PGLite Worker] Failed to add provider_message_id column:', error);
      throw error;
    }

    // Queued Prompts table - stores prompts queued from any device for execution
    // Uses simple row-level atomic updates instead of JSONB array manipulation
    console.log('[PGLite Worker] Creating queued_prompts table...');
    try {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS queued_prompts (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          prompt TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed')),
          attachments JSONB,
          document_context JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          claimed_at TIMESTAMP,
          completed_at TIMESTAMP,
          error_message TEXT,
          CONSTRAINT fk_queued_prompts_session
            FOREIGN KEY (session_id)
            REFERENCES ai_sessions(id)
            ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_queued_prompts_session ON queued_prompts(session_id);
        CREATE INDEX IF NOT EXISTS idx_queued_prompts_status ON queued_prompts(status);
        CREATE INDEX IF NOT EXISTS idx_queued_prompts_session_status ON queued_prompts(session_id, status);
        CREATE INDEX IF NOT EXISTS idx_queued_prompts_created ON queued_prompts(created_at);
      `);
      console.log('[PGLite Worker] queued_prompts table created successfully');
    } catch (error) {
      console.error('[PGLite Worker] Failed to create queued_prompts table:', error);
      throw error;
    }

    // Worktrees table - stores git worktree metadata
    console.log('[PGLite Worker] Creating worktrees table...');
    try {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS worktrees (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          branch TEXT NOT NULL,
          base_branch TEXT DEFAULT 'main',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_worktrees_workspace ON worktrees(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_worktrees_path ON worktrees(path);
      `);
      console.log('[PGLite Worker] worktrees table created successfully');
    } catch (error) {
      console.error('[PGLite Worker] Failed to create worktrees table:', error);
      throw error;
    }

    // Add worktree_id column to ai_sessions (migration)
    try {
      await this.db.exec(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'ai_sessions' AND column_name = 'worktree_id'
          ) THEN
            ALTER TABLE ai_sessions ADD COLUMN worktree_id TEXT REFERENCES worktrees(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);

      // Create index for worktree sessions
      await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_ai_sessions_worktree ON ai_sessions(worktree_id);
      `);

      console.log('[PGLite Worker] worktree_id column added to ai_sessions');
    } catch (error) {
      console.error('[PGLite Worker] Failed to add worktree_id column:', error);
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
      console.log('[PGLite Worker] Closing database...');
      try {
        // Close the database connection
        await this.db.close();
        console.log('[PGLite Worker] Database closed successfully');

        // Explicitly remove lock file if it still exists
        // This is critical for Windows where forced shutdowns may not clean up properly
        const fs = require('fs');
        const lockPath = path.join(this.dataDir, 'postmaster.pid');
        try {
          if (fs.existsSync(lockPath)) {
            fs.unlinkSync(lockPath);
            console.log('[PGLite Worker] Removed lock file after close');
          }
        } catch (lockError) {
          console.warn('[PGLite Worker] Failed to remove lock file after close:', lockError);
        }

        this.db = null;
      } catch (error) {
        console.error('[PGLite Worker] Error during database close:', error);
        this.db = null;
        throw error;
      }
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

  async verifyBackup(message) {
    const backupPath = message.payload.backupPath;
    let testDb = null;

    try {
      console.log('[PGLite Worker] Verifying backup at:', backupPath);

      // Attempt to open the backup database
      testDb = new PGlite({
        dataDir: backupPath,
        debug: 0
      });

      await testDb.waitReady;

      // Execute a simple query to verify it works
      await testDb.query('SELECT 1');

      // Check data counts in key tables for integrity verification
      let sessionCount = 0;
      let historyCount = 0;
      try {
        const countResult = await testDb.query(`
          SELECT
            (SELECT COUNT(*) FROM ai_sessions) as sessions,
            (SELECT COUNT(*) FROM document_history) as history
        `);
        if (countResult.rows && countResult.rows[0]) {
          sessionCount = parseInt(countResult.rows[0].sessions) || 0;
          historyCount = parseInt(countResult.rows[0].history) || 0;
        }
      } catch (countError) {
        // Tables might not exist yet - that's okay for a fresh database
        console.log('[PGLite Worker] Could not count records (tables may not exist):', countError.message);
      }

      // Close cleanly
      await testDb.close();

      console.log('[PGLite Worker] Backup verification successful', {
        sessionCount,
        historyCount
      });

      return {
        id: message.id,
        success: true,
        data: {
          valid: true,
          sessionCount,
          historyCount,
          hasData: sessionCount > 0 || historyCount > 0
        }
      };
    } catch (error) {
      console.error('[PGLite Worker] Backup verification failed:', error);

      if (testDb) {
        try {
          await testDb.close();
        } catch (closeError) {
          // Ignore close errors
        }
      }

      return {
        id: message.id,
        success: true,
        data: { valid: false, error: error.message || String(error) }
      };
    }
  }
}

// Start the worker
new PGLiteWorker();
