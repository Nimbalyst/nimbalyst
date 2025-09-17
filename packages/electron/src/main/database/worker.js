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

    parentPort.on('message', async (message) => {
      try {
        const response = await this.handleMessage(message);
        parentPort.postMessage(response);
      } catch (error) {
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

    // Create PGlite instance
    // Use file-based storage for persistent data
    this.db = new PGlite({
      dataDir: this.dataDir,
      debug: 0  // Disable PGLite debug logging
    });

    // Wait for database to be ready
    await this.db.waitReady;

    // Run migrations first
    await this.runMigrations();

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
  }

  async runMigrations() {
    if (!this.db) throw new Error('Database not initialized');

    try {
      // Check if we need to migrate from project_id to workspace_id
      const aiSessionsResult = await this.db.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'ai_sessions'
        AND column_name IN ('project_id', 'workspace_id')
      `);

      const hasProjectId = aiSessionsResult.rows.some((row) => row.column_name === 'project_id');
      const hasWorkspaceId = aiSessionsResult.rows.some((row) => row.column_name === 'workspace_id');

      if (hasProjectId && !hasWorkspaceId) {
        console.log('[PGLite Worker] Migrating ai_sessions table from project_id to workspace_id...');
        await this.db.exec(`
          ALTER TABLE ai_sessions RENAME COLUMN project_id TO workspace_id;
          DROP INDEX IF EXISTS idx_ai_sessions_project;
          CREATE INDEX IF NOT EXISTS idx_ai_sessions_workspace ON ai_sessions(workspace_id);
        `);
      }

      // Check document_history table
      const historyResult = await this.db.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'document_history'
        AND column_name IN ('project_id', 'workspace_id')
      `);

      const historyHasProjectId = historyResult.rows.some((row) => row.column_name === 'project_id');
      const historyHasWorkspaceId = historyResult.rows.some((row) => row.column_name === 'workspace_id');

      if (historyHasProjectId && !historyHasWorkspaceId) {
        console.log('[PGLite Worker] Migrating document_history table from project_id to workspace_id...');
        await this.db.exec(`
          ALTER TABLE document_history RENAME COLUMN project_id TO workspace_id;
          DROP INDEX IF EXISTS idx_history_project_file;
          DROP INDEX IF EXISTS idx_history_workspace_file;
          CREATE INDEX IF NOT EXISTS idx_history_workspace_file ON document_history(workspace_id, file_path);
        `);
      }

      // Check app_settings table for recent_projects column
      const settingsResult = await this.db.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'app_settings'
        AND column_name IN ('recent_projects', 'recent_workspaces')
      `);

      const hasRecentProjects = settingsResult.rows.some((row) => row.column_name === 'recent_projects');
      const hasRecentWorkspaces = settingsResult.rows.some((row) => row.column_name === 'recent_workspaces');

      if (hasRecentProjects && !hasRecentWorkspaces) {
        console.log('[PGLite Worker] Migrating app_settings table from recent_projects to recent_workspaces...');
        await this.db.exec(`
          ALTER TABLE app_settings RENAME COLUMN recent_projects TO recent_workspaces;
        `);
      }

      console.log('[PGLite Worker] Database migrations completed');
    } catch (error) {
      console.warn('[PGLite Worker] Migration check/execution:', error);
      // Don't fail if migration fails - tables might not exist yet
    }
  }

  async createSchemas() {
    if (!this.db) throw new Error('Database not initialized');

    // AI Sessions table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
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

      CREATE INDEX IF NOT EXISTS idx_ai_sessions_workspace ON ai_sessions(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_created ON ai_sessions(created_at);
    `);

    // App Settings table - GLOBAL settings only
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        theme TEXT DEFAULT 'system',
        recent_workspaces JSONB DEFAULT '[]',
        ai_providers JSONB DEFAULT '{}',
        global_editor_settings JSONB DEFAULT '{}',
        keyboard_shortcuts JSONB DEFAULT '{}',
        auto_update_enabled BOOLEAN DEFAULT true,
        telemetry_enabled BOOLEAN DEFAULT false,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO app_settings (id) VALUES ('default')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Workspace State table with comprehensive state
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_state (
        workspace_path TEXT PRIMARY KEY,
        last_opened TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        -- Window state
        window_state JSONB DEFAULT '{"width": 1200, "height": 800}',

        -- UI layout state
        ui_state JSONB DEFAULT '{"sidebarWidth": 240, "sidebarCollapsed": false, "aiChatWidth": 350, "aiChatCollapsed": false}',

        -- Documents and tabs
        documents JSONB DEFAULT '{"recentDocuments": [], "openTabs": [], "activeTabId": null, "tabOrder": []}',

        -- File tree state
        file_tree JSONB DEFAULT '{"expandedFolders": [], "scrollPosition": 0}',

        -- AI Chat state
        ai_chat JSONB DEFAULT '{"sessionHistory": []}',

        -- Editor settings
        editor_settings JSONB,

        -- Workspace preferences
        preferences JSONB DEFAULT '{"autoSave": true, "autoSaveInterval": 30000}',

        -- Metadata
        version TEXT DEFAULT '1.0.0',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_workspace_state_last_opened ON workspace_state(last_opened);
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
    `);
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
        (SELECT COUNT(*) FROM workspace_state) as workspaces_count,
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
            inspect: true  // Enable debug output
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