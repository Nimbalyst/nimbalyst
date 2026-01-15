/**
 * SQLite Browser Panel Component
 *
 * Main panel UI for browsing SQLite databases.
 * Uses native Electron file dialog and persists the open database path.
 */

import { useState, useEffect, useId, useCallback } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import initSqlJs, { type Database } from 'sql.js';
import { registerDatabase, unregisterDatabase } from './databaseRegistry';
import './SQLiteBrowserPanel.css';

// Storage key for persisted database path
const STORAGE_KEY_DB_PATH = 'lastDatabasePath';

interface DatabaseInfo {
  name: string;
  path: string;
  tables: string[];
}

interface TableSchema {
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: string | null;
  pk: boolean;
}

interface QueryResult {
  columns: string[];
  values: any[][];
  rowCount: number;
}

// Cache the SQL.js instance
let sqlPromise: Promise<any> | null = null;

async function getSqlJs() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      // Load sql-wasm.wasm from CDN
      locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
    });
  }
  return sqlPromise;
}

// Get file name from path
function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

export function SQLiteBrowserPanel({ host }: PanelHostProps) {
  // Unique ID for this panel instance
  const panelInstanceId = useId();

  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Table browser state
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableSchema, setTableSchema] = useState<TableSchema[]>([]);
  const [tableData, setTableData] = useState<QueryResult | null>(null);

  // Query state
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryTime, setQueryTime] = useState<number | null>(null);

  // View mode
  const [viewMode, setViewMode] = useState<'browse' | 'query'>('browse');

  // Load database from file path
  const loadDatabaseFromPath = useCallback(async (filePath: string) => {
    setError(null);
    setLoading(true);
    setSelectedTable(null);
    setTableSchema([]);
    setTableData(null);
    setQueryResult(null);

    try {
      // Read file content via Electron API
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        throw new Error('Electron API not available');
      }

      const result = await electronAPI.readFileContent(filePath, { binary: true });
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to read file');
      }

      // Convert base64 to Uint8Array
      const binaryString = atob(result.content);
      const data = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        data[i] = binaryString.charCodeAt(i);
      }

      const SQL = await getSqlJs();

      // Close existing database
      db?.close();

      const newDb = new SQL.Database(data);
      setDb(newDb);

      const tablesResult = newDb.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      );

      const tables = tablesResult.length > 0
        ? tablesResult[0].values.map((row: any[]) => row[0] as string)
        : [];

      const fileName = getFileName(filePath);

      setDatabase({
        name: fileName,
        path: filePath,
        tables,
      });

      // Register database for AI tools
      registerDatabase(panelInstanceId, newDb, fileName, tables);

      // Persist the database path
      await host.storage.set(STORAGE_KEY_DB_PATH, filePath);
    } catch (err) {
      console.error('Failed to load database:', err);
      setError(err instanceof Error ? err.message : 'Failed to load database');
      setDatabase(null);
      // Clear persisted path on error
      await host.storage.delete(STORAGE_KEY_DB_PATH);
    } finally {
      setLoading(false);
    }
  }, [db, panelInstanceId, host.storage]);

  // Cleanup database on unmount
  useEffect(() => {
    return () => {
      unregisterDatabase(panelInstanceId);
      db?.close();
    };
  }, [db, panelInstanceId]);

  // Load persisted database on mount
  useEffect(() => {
    const persistedPath = host.storage.get<string>(STORAGE_KEY_DB_PATH);
    if (persistedPath && !database) {
      loadDatabaseFromPath(persistedPath);
    }
  }, [host.storage, database, loadDatabaseFromPath]);

  const handleOpenClick = async () => {
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) {
        setError('Electron API not available');
        return;
      }

      const result = await electronAPI.openFileDialog({
        title: 'Open SQLite Database',
        buttonLabel: 'Open',
        filters: [
          { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return;
      }

      const filePath = result.filePaths[0];
      await loadDatabaseFromPath(filePath);
    } catch (err) {
      console.error('Failed to open file dialog:', err);
      setError(err instanceof Error ? err.message : 'Failed to open file');
    }
  };

  const handleClose = async () => {
    unregisterDatabase(panelInstanceId);
    db?.close();
    setDb(null);
    setDatabase(null);
    setSelectedTable(null);
    setTableSchema([]);
    setTableData(null);
    setQueryResult(null);
    setError(null);
    // Clear persisted path
    await host.storage.delete(STORAGE_KEY_DB_PATH);
  };

  const handleTableSelect = (tableName: string) => {
    if (!db) return;

    setSelectedTable(tableName);
    setQueryError(null);

    try {
      // Get table schema
      const schemaResult = db.exec(`PRAGMA table_info("${tableName}")`);
      if (schemaResult.length > 0) {
        const schema = schemaResult[0].values.map((row: any[]) => ({
          name: row[1] as string,
          type: row[2] as string,
          notnull: row[3] === 1,
          dflt_value: row[4] as string | null,
          pk: row[5] === 1,
        }));
        setTableSchema(schema);
      }

      // Get table data (limited to 100 rows)
      const dataResult = db.exec(`SELECT * FROM "${tableName}" LIMIT 100`);
      if (dataResult.length > 0) {
        setTableData({
          columns: dataResult[0].columns,
          values: dataResult[0].values,
          rowCount: dataResult[0].values.length,
        });
      } else {
        setTableData({
          columns: [],
          values: [],
          rowCount: 0,
        });
      }
    } catch (err) {
      console.error('Failed to load table:', err);
      setQueryError(err instanceof Error ? err.message : 'Failed to load table');
    }
  };

  const handleRunQuery = () => {
    if (!db || !query.trim()) return;

    setQueryError(null);
    setQueryResult(null);

    const startTime = performance.now();

    try {
      const result = db.exec(query);
      const endTime = performance.now();
      setQueryTime(endTime - startTime);

      if (result.length > 0) {
        setQueryResult({
          columns: result[0].columns,
          values: result[0].values,
          rowCount: result[0].values.length,
        });
      } else {
        // Query executed but returned no results (e.g., UPDATE, INSERT)
        setQueryResult({
          columns: [],
          values: [],
          rowCount: 0,
        });
      }
    } catch (err) {
      console.error('Query error:', err);
      setQueryError(err instanceof Error ? err.message : 'Query failed');
      setQueryTime(null);
    }
  };

  const renderDataTable = (result: QueryResult) => {
    if (result.columns.length === 0) {
      return <p className="sqlite-browser-no-data">Query executed successfully (no rows returned)</p>;
    }

    return (
      <div className="sqlite-browser-data-table-wrapper">
        <table className="sqlite-browser-data-table">
          <thead>
            <tr>
              {result.columns.map((col, i) => (
                <th key={i}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.values.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, cellIdx) => (
                  <td key={cellIdx}>
                    {cell === null ? (
                      <span className="sqlite-browser-null">NULL</span>
                    ) : typeof cell === 'object' ? (
                      <span className="sqlite-browser-blob">[BLOB]</span>
                    ) : (
                      String(cell)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="sqlite-browser-panel">
      <div className="sqlite-browser-header">
        <h3>SQLite Browser</h3>
        <div className="sqlite-browser-header-actions">
          <button className="sqlite-browser-btn" onClick={handleOpenClick} disabled={loading}>
            {loading ? 'Loading...' : 'Open Database'}
          </button>
          {database && (
            <button className="sqlite-browser-btn sqlite-browser-btn-secondary" onClick={handleClose}>
              Close
            </button>
          )}
        </div>
      </div>

      <div className="sqlite-browser-content">
        {error && (
          <div className="sqlite-browser-error">
            <p>{error}</p>
          </div>
        )}

        {loading ? (
          <div className="sqlite-browser-loading">
            <p>Loading database...</p>
          </div>
        ) : !database ? (
          <div className="sqlite-browser-empty">
            <div className="sqlite-browser-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 5v14c0 1.65-4.03 3-9 3s-9-1.35-9-3V5" />
                <path d="M21 12c0 1.65-4.03 3-9 3s-9-1.35-9-3" />
              </svg>
            </div>
            <p className="sqlite-browser-empty-title">No database selected</p>
            <p className="sqlite-browser-empty-hint">
              Click "Open Database" to browse a SQLite database file
            </p>
            <button className="sqlite-browser-btn sqlite-browser-btn-primary" onClick={handleOpenClick}>
              Open Database
            </button>
          </div>
        ) : (
          <div className="sqlite-browser-main">
            {/* Sidebar with tables */}
            <div className="sqlite-browser-sidebar">
              <div className="sqlite-browser-sidebar-header">
                <h4 title={database.path}>{database.name}</h4>
                <span className="sqlite-browser-table-count">{database.tables.length} table(s)</span>
              </div>
              <div className="sqlite-browser-table-list">
                {database.tables.map((table) => (
                  <button
                    key={table}
                    className={`sqlite-browser-table-item ${selectedTable === table ? 'active' : ''}`}
                    onClick={() => handleTableSelect(table)}
                  >
                    {table}
                  </button>
                ))}
              </div>
            </div>

            {/* Main content area */}
            <div className="sqlite-browser-detail">
              {/* View mode tabs */}
              <div className="sqlite-browser-tabs">
                <button
                  className={`sqlite-browser-tab ${viewMode === 'browse' ? 'active' : ''}`}
                  onClick={() => setViewMode('browse')}
                >
                  Browse
                </button>
                <button
                  className={`sqlite-browser-tab ${viewMode === 'query' ? 'active' : ''}`}
                  onClick={() => setViewMode('query')}
                >
                  Query
                </button>
              </div>

              {viewMode === 'browse' ? (
                <div className="sqlite-browser-browse">
                  {selectedTable ? (
                    <>
                      <div className="sqlite-browser-schema">
                        <h5>Schema: {selectedTable}</h5>
                        <div className="sqlite-browser-schema-list">
                          {tableSchema.map((col) => (
                            <div key={col.name} className="sqlite-browser-schema-col">
                              <span className="sqlite-browser-col-name">
                                {col.pk && <span className="sqlite-browser-pk">PK</span>}
                                {col.name}
                              </span>
                              <span className="sqlite-browser-col-type">{col.type}</span>
                              {col.notnull && <span className="sqlite-browser-notnull">NOT NULL</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="sqlite-browser-data">
                        <h5>Data (showing up to 100 rows)</h5>
                        {tableData && renderDataTable(tableData)}
                      </div>
                    </>
                  ) : (
                    <div className="sqlite-browser-select-table">
                      <p>Select a table from the sidebar to view its data</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="sqlite-browser-query-view">
                  <div className="sqlite-browser-query-input">
                    <textarea
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Enter SQL query..."
                      spellCheck={false}
                    />
                    <button
                      className="sqlite-browser-btn sqlite-browser-btn-primary"
                      onClick={handleRunQuery}
                      disabled={!query.trim()}
                    >
                      Run Query
                    </button>
                  </div>
                  {queryError && (
                    <div className="sqlite-browser-query-error">
                      <p>{queryError}</p>
                    </div>
                  )}
                  {queryResult && (
                    <div className="sqlite-browser-query-result">
                      <div className="sqlite-browser-query-stats">
                        {queryResult.rowCount} row(s) returned
                        {queryTime !== null && ` in ${queryTime.toFixed(1)}ms`}
                      </div>
                      {renderDataTable(queryResult)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
