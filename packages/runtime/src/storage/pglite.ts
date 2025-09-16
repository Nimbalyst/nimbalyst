import { PGlite } from '@electric-sql/pglite';

export type RuntimeDB = PGlite;

let dbInstance: PGlite | null = null;

export async function initDB(): Promise<PGlite> {
  if (dbInstance) return dbInstance;

  // In browser/mobile webview, PGlite runs with default persistence (OPFS/IDB) when available
  // In Electron, this will be ignored (Electron has its own main-process DB in this repo).
  // Allow host app to override asset base at runtime (e.g., '/assets/pglite/')
  const assetBase = (globalThis as any).__PGLITE_ASSET_BASE__ ?? '/pglite/';
  const devWasm = (globalThis as any).__PGLITE_DEV_WASM__ || '';
  const devData = (globalThis as any).__PGLITE_DEV_DATA__ || '';
  const wasmOverride = (globalThis as any).__PGLITE_WASM_URL__ || '';
  const dataOverride = (globalThis as any).__PGLITE_DATA_URL__ || '';
  const isDev = Boolean((import.meta as any).env?.DEV);

  dbInstance = new PGlite({
    debug: 0,
    // Prefer Emscripten's built-in streaming by telling it where to find assets
    locateFile: (path: string) => {
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
    },
  } as any);
  await dbInstance.waitReady;
  await ensureSchema(dbInstance);
  return dbInstance;
}

async function ensureSchema(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      theme TEXT DEFAULT 'auto',
      ai_settings JSONB DEFAULT '{}',
      updated_at BIGINT NOT NULL DEFAULT 0
    );

    INSERT INTO settings(id, theme, updated_at)
    VALUES('default', 'auto', 0)
    ON CONFLICT(id) DO NOTHING;

    -- Ensure new columns exist when upgrading
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE settings ADD COLUMN IF NOT EXISTS ai_settings JSONB DEFAULT '{}';
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END $$;

    -- AI sessions table
    CREATE TABLE IF NOT EXISTS ai_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT,
      model TEXT,
      messages JSONB DEFAULT '[]',
      updated_at BIGINT NOT NULL
    );
  `);
}

export function getDB(): PGlite {
  if (!dbInstance) throw new Error('DB not initialized. Call initDB() first.');
  return dbInstance;
}
