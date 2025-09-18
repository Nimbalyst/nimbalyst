import { PGlite } from '@electric-sql/pglite';

export type RuntimeDB = PGlite;

let dbInstance: PGlite | null = null;
let externalAdapter: { query: PGlite['query']; exec: PGlite['exec'] } | null = null;

export interface InitDBOptions {
  dataDir?: string;
  debug?: number;
  existingInstance?: PGlite;
}

export async function initDB(options: InitDBOptions = {}): Promise<PGlite> {
  if (externalAdapter) {
    if (!dbInstance) {
      // Cast adapter to PGlite-compatible shape
      dbInstance = externalAdapter as unknown as PGlite;
      await ensureRuntimeSchema(dbInstance);
    }
    return dbInstance;
  }
  if (options.existingInstance) {
    dbInstance = options.existingInstance;
  }

  if (dbInstance) {
    await ensureRuntimeSchema(dbInstance);
    return dbInstance;
  }

  const config: Record<string, unknown> = {
    debug: options.debug ?? 0,
  };

  if (options.dataDir) {
    config.dataDir = options.dataDir;
  } else {
    const assetBase = (globalThis as any).__PGLITE_ASSET_BASE__ ?? '/pglite/';
    const devWasm = (globalThis as any).__PGLITE_DEV_WASM__ || '';
    const devData = (globalThis as any).__PGLITE_DEV_DATA__ || '';
    const wasmOverride = (globalThis as any).__PGLITE_WASM_URL__ || '';
    const dataOverride = (globalThis as any).__PGLITE_DATA_URL__ || '';
    const isDev = Boolean((import.meta as any).env?.DEV);

    config.locateFile = (path: string) => {
      if (path.endsWith('.wasm')) {
        const wasmUrl =
          wasmOverride ||
          (isDev && devWasm ? devWasm : '') ||
          assetBase + path;
        try { console.log('[PGlite] locateFile wasm ->', wasmUrl); } catch {}
        return wasmUrl;
      }
      if (path.endsWith('.data')) {
        const dataUrl =
          dataOverride ||
          (isDev && devData ? devData : '') ||
          assetBase + path;
        try { console.log('[PGlite] locateFile data ->', dataUrl); } catch {}
        return dataUrl;
      }
      const fallback = assetBase + path;
      try { console.log('[PGlite] locateFile other ->', fallback); } catch {}
      return fallback;
    };
  }

  dbInstance = new PGlite(config as any);
  await dbInstance.waitReady;
  await ensureRuntimeSchema(dbInstance);
  return dbInstance;
}

export function getDB(): PGlite {
  if (!dbInstance) throw new Error('DB not initialized. Call initDB() first.');
  return dbInstance;
}

export async function useExternalDB(adapter: { query: PGlite['query']; exec: PGlite['exec'] }): Promise<void> {
  externalAdapter = adapter;
  dbInstance = adapter as unknown as PGlite;
  await ensureRuntimeSchema(dbInstance);
}

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
      tab_state JSONB,
      ai_chat_state JSONB,
      settings JSONB DEFAULT '{}',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE workspace_state
      ADD COLUMN IF NOT EXISTS recent_files JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  `);
}

async function createSessionStateTable(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS session_state (
      id TEXT PRIMARY KEY DEFAULT 'current',
      windows JSONB DEFAULT '[]',
      focused_window_id TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO session_state(id) VALUES('current')
    ON CONFLICT(id) DO NOTHING;

    ALTER TABLE session_state
      ADD COLUMN IF NOT EXISTS windows JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS focused_window_id TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  `);
}

async function createDocumentHistoryTable(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS document_history (
      id SERIAL PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      snapshot_path TEXT NOT NULL,
      size_bytes INTEGER,
      timestamp BIGINT NOT NULL,
      version INTEGER DEFAULT 1,
      metadata JSONB DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_history_workspace_file ON document_history(workspace_id, file_path);
    CREATE INDEX IF NOT EXISTS idx_history_timestamp ON document_history(timestamp);
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_ai_sessions_workspace ON ai_sessions(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_ai_sessions_created ON ai_sessions(created_at);

    ALTER TABLE ai_sessions
      ADD COLUMN IF NOT EXISTS workspace_id TEXT DEFAULT 'default',
      ADD COLUMN IF NOT EXISTS file_path TEXT,
      ADD COLUMN IF NOT EXISTS provider TEXT,
      ADD COLUMN IF NOT EXISTS model TEXT,
      ADD COLUMN IF NOT EXISTS title TEXT DEFAULT 'New conversation',
      ADD COLUMN IF NOT EXISTS document_context JSONB,
      ADD COLUMN IF NOT EXISTS provider_config JSONB,
      ADD COLUMN IF NOT EXISTS provider_session_id TEXT,
      ADD COLUMN IF NOT EXISTS draft_input TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

    ALTER TABLE ai_sessions ALTER COLUMN messages SET DEFAULT '[]';
    UPDATE ai_sessions SET workspace_id = COALESCE(workspace_id, 'default');
    UPDATE ai_sessions SET title = COALESCE(title, 'New conversation');
    UPDATE ai_sessions SET provider = COALESCE(provider, 'claude');
    UPDATE ai_sessions SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP);
    UPDATE ai_sessions SET updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP);

    ALTER TABLE ai_sessions ALTER COLUMN workspace_id SET NOT NULL;
    ALTER TABLE ai_sessions ALTER COLUMN provider SET NOT NULL;
    ALTER TABLE ai_sessions ALTER COLUMN title SET NOT NULL;
  `);
}
