/**
 * SQLite Browser Panel Component
 *
 * Main panel UI for browsing SQLite databases.
 * Uses native Electron file dialog and persists recent databases.
 */

import { useState, useEffect, useId, useCallback } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import initSqlJs, { type Database } from 'sql.js';
import { registerDatabase, unregisterDatabase } from './databaseRegistry';
import './SQLiteBrowserPanel.css';

// Storage keys
const STORAGE_KEY_RECENT_DBS = 'recentDatabases';
const STORAGE_KEY_CURRENT_DB = 'currentDatabasePath';
const MAX_RECENT_DATABASES = 10;

interface RecentDatabase {
  path: string;
  name: string;
  lastOpened: number;
}

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
  const [recentDatabases, setRecentDatabases] = useState<RecentDatabase[]>([]);

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

  // Load recent databases from storage on mount
  useEffect(() => {
    const stored = host.storage.get<RecentDatabase[]>(STORAGE_KEY_RECENT_DBS);
    if (stored && Array.isArray(stored)) {
      setRecentDatabases(stored);
    }
  }, [host.storage]);

  // Add database to recent list
  const addToRecentDatabases = useCallback(async (filePath: string, fileName: string) => {
    const newEntry: RecentDatabase = {
      path: filePath,
      name: fileName,
      lastOpened: Date.now(),
    };

    // Update recent list - remove existing entry if present, add to front
    const filtered = recentDatabases.filter(db => db.path !== filePath);
    const updated = [newEntry, ...filtered].slice(0, MAX_RECENT_DATABASES);

    setRecentDatabases(updated);
    await host.storage.set(STORAGE_KEY_RECENT_DBS, updated);
    await host.storage.set(STORAGE_KEY_CURRENT_DB, filePath);
  }, [recentDatabases, host.storage]);

  // Remove database from recent list
  const removeFromRecentDatabases = useCallback(async (filePath: string) => {
    const updated = recentDatabases.filter(db => db.path !== filePath);
    setRecentDatabases(updated);
    await host.storage.set(STORAGE_KEY_RECENT_DBS, updated);
  }, [recentDatabases, host.storage]);

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

      // Update AI context with database info
      host.ai?.setContext({
        databaseName: fileName,
        databasePath: filePath,
        tables,
        tableCount: tables.length,
      });

      // Add to recent databases
      await addToRecentDatabases(filePath, fileName);
    } catch (err) {
      console.error('Failed to load database:', err);
      setError(err instanceof Error ? err.message : 'Failed to load database');
      setDatabase(null);
    } finally {
      setLoading(false);
    }
  }, [db, panelInstanceId, addToRecentDatabases]);

  // Cleanup database on unmount
  useEffect(() => {
    return () => {
      unregisterDatabase(panelInstanceId);
      db?.close();
    };
  }, [db, panelInstanceId]);

  // Load last opened database on mount
  useEffect(() => {
    const currentPath = host.storage.get<string>(STORAGE_KEY_CURRENT_DB);
    if (currentPath && !database) {
      loadDatabaseFromPath(currentPath);
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
    // Clear current database path but keep recent list
    await host.storage.delete(STORAGE_KEY_CURRENT_DB);
    // Clear AI context
    host.ai?.clearContext();
  };

  const handleTableSelect = (tableName: string) => {
    if (!db) return;

    setSelectedTable(tableName);
    setQueryError(null);

    try {
      // Get table schema
      const schemaResult = db.exec(`PRAGMA table_info("${tableName}")`);
      let schema: TableSchema[] = [];
      if (schemaResult.length > 0) {
        schema = schemaResult[0].values.map((row: any[]) => ({
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

      // Update AI context with selected table info
      host.ai?.setContext({
        databaseName: database?.name,
        databasePath: database?.path,
        tables: database?.tables,
        tableCount: database?.tables.length,
        selectedTable: tableName,
        selectedTableSchema: schema.map(col => ({
          name: col.name,
          type: col.type,
          nullable: !col.notnull,
          primaryKey: col.pk,
        })),
      });
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

  // Format relative time for recent databases
  const formatRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
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

            {/* Recent databases */}
            {recentDatabases.length > 0 && (
              <div className="sqlite-browser-recent">
                <h4>Recent Databases</h4>
                <div className="sqlite-browser-recent-list">
                  {recentDatabases.map((recent) => (
                    <div key={recent.path} className="sqlite-browser-recent-item">
                      <button
                        className="sqlite-browser-recent-btn"
                        onClick={() => loadDatabaseFromPath(recent.path)}
                        title={recent.path}
                      >
                        <span className="sqlite-browser-recent-name">{recent.name}</span>
                        <span className="sqlite-browser-recent-time">{formatRelativeTime(recent.lastOpened)}</span>
                      </button>
                      <button
                        className="sqlite-browser-recent-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromRecentDatabases(recent.path);
                        }}
                        title="Remove from recent"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
