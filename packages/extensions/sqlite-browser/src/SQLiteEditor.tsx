/**
 * SQLite Editor Component
 *
 * Custom editor wrapper for viewing SQLite databases when opening .db/.sqlite files.
 * Uses EditorHost to get the file path and loads the database automatically.
 */

import { useState, useEffect, useCallback } from 'react';
import type { EditorHostProps } from '@nimbalyst/extension-sdk';
import type { Database } from 'sql.js';
import { SQLiteBrowserCore, getSqlJs, getFileName, type DatabaseInfo } from './SQLiteBrowserCore';

export function SQLiteEditor({ host }: EditorHostProps) {
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load database from the file path provided by EditorHost
  const loadDatabase = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      // Load binary content via EditorHost
      const arrayBuffer = await host.loadBinaryContent();
      const data = new Uint8Array(arrayBuffer);

      const SQL = await getSqlJs();

      // Close existing database if any
      db?.close();

      const newDb = new SQL.Database(data);
      setDb(newDb);

      const tablesResult = newDb.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      );

      const tables = tablesResult.length > 0
        ? tablesResult[0].values.map((row: any[]) => row[0] as string)
        : [];

      const fileName = getFileName(host.filePath);

      setDatabase({
        name: fileName,
        path: host.filePath,
        tables,
      });
    } catch (err) {
      console.error('Failed to load database:', err);
      setError(err instanceof Error ? err.message : 'Failed to load database');
      setDatabase(null);
    } finally {
      setLoading(false);
    }
  }, [host, db]);

  // Load database on mount
  useEffect(() => {
    loadDatabase();
  }, []);  // Only on mount - don't re-run when loadDatabase changes

  // Cleanup database on unmount
  useEffect(() => {
    return () => {
      db?.close();
    };
  }, [db]);

  // Subscribe to file changes (external edits to the database file)
  useEffect(() => {
    const unsubscribe = host.onFileChanged(async () => {
      // Reload the database when the file changes externally
      await loadDatabase();
    });
    return unsubscribe;
  }, [host, loadDatabase]);

  // Note: Custom editors are read-only for SQLite, so no AI context or saving needed
  // The document context will come from the EditorHost automatically

  return (
    <SQLiteBrowserCore
      database={database}
      db={db}
      loading={loading}
      error={error}
      showHeader={false}  // No header in editor mode - file name is in tab
      storage={host.storage}
    />
  );
}
