/**
 * Database schema creation for PGLite
 */

import type { PGlite } from '@electric-sql/pglite';

export async function ensureRuntimeSchema(db: PGlite): Promise<void> {
  await createWorkspaceAndDocumentTables(db);
  await createWorkspaceStateTable(db);
  await createSessionStateTable(db);
  await createDocumentHistoryTable(db);
  await createAISessionsTable(db);
}

async function createWorkspaceAndDocumentTables(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id);
  `);
}

async function createWorkspaceStateTable(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_state (
      workspace_path TEXT PRIMARY KEY,
      window_state JSONB,
      recent_files JSONB DEFAULT '[]',
      window_bounds JSONB,
      tab_state JSONB DEFAULT '[]',
      ai_chat_state JSONB,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function createSessionStateTable(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS session_state (
      id TEXT PRIMARY KEY DEFAULT 'global',
      windows JSONB DEFAULT '[]',
      focus_order TEXT[],
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function createDocumentHistoryTable(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS document_history (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      workspace_path TEXT,
      file_path TEXT NOT NULL,
      content BYTEA NOT NULL,
      snapshot_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_history_file ON document_history(file_path);
    CREATE INDEX IF NOT EXISTS idx_document_history_workspace ON document_history(workspace_path);
  `);
}

async function createAISessionsTable(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      file_path TEXT,
      provider TEXT NOT NULL,
      model TEXT,
      title TEXT NOT NULL DEFAULT 'New conversation',
      messages JSONB NOT NULL DEFAULT '[]',
      document_context JSONB,
      provider_config JSONB,
      provider_session_id TEXT,
      draft_input TEXT,
      token_usage JSONB DEFAULT '{}',
      total_tokens JSONB DEFAULT '{"input": 0, "output": 0, "total": 0}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_ai_sessions_workspace ON ai_sessions(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_ai_sessions_created ON ai_sessions(created_at);
  `);

  // Add columns if they don't exist (for migration)
  const alterStatements = [
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS workspace_id TEXT DEFAULT 'default'",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS file_path TEXT",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS provider TEXT",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS model TEXT",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS title TEXT DEFAULT 'New conversation'",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS document_context JSONB",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS provider_config JSONB",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS provider_session_id TEXT",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS draft_input TEXT",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS token_usage JSONB DEFAULT '{}'",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS total_tokens JSONB DEFAULT '{\"input\": 0, \"output\": 0, \"total\": 0}'",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
  ];

  for (const statement of alterStatements) {
    try {
      await db.exec(statement);
    } catch (error) {
      // Column might already exist, ignore the error
      console.debug(`[Schema] Column might already exist: ${statement}`);
    }
  }
}