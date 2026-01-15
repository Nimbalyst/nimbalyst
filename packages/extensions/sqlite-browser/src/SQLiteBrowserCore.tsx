/**
 * SQLite Browser Core Component
 *
 * Shared UI component for browsing SQLite databases.
 * Used by both the panel (with file picker) and custom editor (with file path).
 */

import { useState, useEffect, useId, useCallback } from 'react';
import initSqlJs, { type Database } from 'sql.js';
import { registerDatabase, unregisterDatabase, setDisplayCallback, type DisplayQueryResult } from './databaseRegistry';
import { getQueryHistory, addQueryToHistory, type QueryHistoryEntry } from './queryHistory';

// ============================================================================
// Types
// ============================================================================

export interface DatabaseInfo {
  name: string;
  path: string;
  tables: string[];
}

export interface TableSchema {
  name: string;
  type: string;
  notnull: boolean;
  dflt_value: string | null;
  pk: boolean;
}

export interface QueryResult {
  columns: string[];
  values: any[][];
  rowCount: number;
}

/** Extension storage interface (subset of ExtensionStorage) */
interface StorageService {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): Promise<void>;
}

export interface SQLiteBrowserCoreProps {
  /** Database info if already loaded, or null to show empty state */
  database: DatabaseInfo | null;
  /** The sql.js Database instance */
  db: Database | null;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Called when close button is clicked (panel only) */
  onClose?: () => void;
  /** Called when open button is clicked (panel only) */
  onOpenClick?: () => void;
  /** AI context setter (optional) */
  onAIContextChange?: (context: Record<string, unknown> | null) => void;
  /** Whether to show the header with open/close buttons */
  showHeader?: boolean;
  /** Additional content to render in empty state (e.g., recent databases) */
  emptyStateExtra?: React.ReactNode;
  /** Storage service for persisting query history */
  storage?: StorageService;
}

// ============================================================================
// Utilities
// ============================================================================

// Cache the SQL.js instance
let sqlPromise: Promise<any> | null = null;

export async function getSqlJs() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      // Load sql-wasm.wasm from CDN
      locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
    });
  }
  return sqlPromise;
}

// Get file name from path
export function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

// ============================================================================
// Component
// ============================================================================

export function SQLiteBrowserCore({
  database,
  db,
  loading,
  error,
  onClose,
  onOpenClick,
  onAIContextChange,
  showHeader = true,
  emptyStateExtra,
  storage,
}: SQLiteBrowserCoreProps) {
  // Unique ID for this component instance (for AI tool registration)
  const instanceId = useId();

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

  // Query history
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load query history when database changes
  useEffect(() => {
    if (database?.path) {
      const history = getQueryHistory(storage, database.path);
      setQueryHistory(history);
    } else {
      setQueryHistory([]);
    }
  }, [database?.path, storage]);

  // Handler for AI-dispatched query results
  // Populates the query input and displays results using the same UI as manual queries
  const handleAiQueryResult = useCallback((result: DisplayQueryResult) => {
    setQuery(result.sql); // Put the SQL in the editable textarea
    setViewMode('query'); // Switch to query view
    setQueryTime(result.executionTime);

    if (result.error) {
      setQueryError(result.error);
      setQueryResult(null);
    } else {
      setQueryError(null);
      setQueryResult({
        columns: result.columns,
        values: result.values,
        rowCount: result.rowCount,
      });
    }

    // Save to query history
    if (database?.path && result.sql.trim()) {
      addQueryToHistory(storage, database.path, result.sql).then(() => {
        // Refresh history list
        setQueryHistory(getQueryHistory(storage, database.path));
      });
    }
  }, [database?.path, storage]);

  // Register/unregister database for AI tools
  useEffect(() => {
    if (db && database) {
      registerDatabase(instanceId, db, database.name, database.tables);
      setDisplayCallback(instanceId, handleAiQueryResult);
    }
    return () => {
      setDisplayCallback(instanceId, undefined);
      unregisterDatabase(instanceId);
    };
  }, [db, database, instanceId, handleAiQueryResult]);

  // Reset state when database changes
  useEffect(() => {
    setSelectedTable(null);
    setTableSchema([]);
    setTableData(null);
    setQueryResult(null);
    setQueryError(null);
  }, [database?.path]);

  const handleTableSelect = useCallback((tableName: string) => {
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
      onAIContextChange?.({
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
  }, [db, database, onAIContextChange]);

  // Handler for selecting a query from history
  const handleSelectHistoryQuery = useCallback((entry: QueryHistoryEntry) => {
    setQuery(entry.sql);
    setShowHistory(false);
  }, []);

  // Format relative time for history display
  const formatRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const handleRunQuery = useCallback(() => {
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

      // Save to query history on successful execution
      if (database?.path) {
        addQueryToHistory(storage, database.path, query).then(() => {
          setQueryHistory(getQueryHistory(storage, database.path));
        });
      }
    } catch (err) {
      console.error('Query error:', err);
      setQueryError(err instanceof Error ? err.message : 'Query failed');
      setQueryTime(null);
    }
  }, [db, query, database?.path, storage]);

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
      {showHeader && (
        <div className="sqlite-browser-header">
          <h3>SQLite Browser</h3>
          <div className="sqlite-browser-header-actions">
            {onOpenClick && (
              <button className="sqlite-browser-btn" onClick={onOpenClick} disabled={loading}>
                {loading ? 'Loading...' : 'Open Database'}
              </button>
            )}
            {database && onClose && (
              <button className="sqlite-browser-btn sqlite-browser-btn-secondary" onClick={onClose}>
                Close
              </button>
            )}
          </div>
        </div>
      )}

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
              {onOpenClick
                ? 'Click "Open Database" to browse a SQLite database file'
                : 'Open a .db or .sqlite file to browse its contents'}
            </p>
            {onOpenClick && (
              <button className="sqlite-browser-btn sqlite-browser-btn-primary" onClick={onOpenClick}>
                Open Database
              </button>
            )}
            {emptyStateExtra}
          </div>
        ) : (
          <div className="sqlite-browser-main">
            {/* Sidebar with query and tables */}
            <div className="sqlite-browser-sidebar">
              <div className="sqlite-browser-sidebar-header">
                <h4 title={database.path}>{database.name}</h4>
                <span className="sqlite-browser-table-count">{database.tables.length} table(s)</span>
              </div>

              {/* Query section */}
              <div className="sqlite-browser-sidebar-section">
                <button
                  className={`sqlite-browser-sidebar-item sqlite-browser-query-item ${viewMode === 'query' ? 'active' : ''}`}
                  onClick={() => {
                    setViewMode('query');
                    setSelectedTable(null);
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  Query
                </button>
              </div>

              {/* Tables section */}
              <div className="sqlite-browser-sidebar-section">
                <div className="sqlite-browser-sidebar-section-header">Tables</div>
                <div className="sqlite-browser-table-list">
                  {database.tables.map((table) => (
                    <button
                      key={table}
                      className={`sqlite-browser-table-item ${selectedTable === table && viewMode === 'browse' ? 'active' : ''}`}
                      onClick={() => {
                        setViewMode('browse');
                        handleTableSelect(table);
                      }}
                    >
                      {table}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Main content area */}
            <div className="sqlite-browser-detail">
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
                      <p>Select a table or Query from the sidebar</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="sqlite-browser-query-view">
                  <div className="sqlite-browser-query-input">
                    <div className="sqlite-browser-query-header">
                      <div className="sqlite-browser-query-history-wrapper">
                        <button
                          className="sqlite-browser-btn sqlite-browser-btn-secondary"
                          onClick={() => setShowHistory(!showHistory)}
                          disabled={queryHistory.length === 0}
                          title={queryHistory.length === 0 ? 'No query history' : `${queryHistory.length} recent queries`}
                        >
                          History ({queryHistory.length})
                        </button>
                        {showHistory && queryHistory.length > 0 && (
                          <div className="sqlite-browser-query-history-dropdown">
                            {queryHistory.map((entry, index) => (
                              <button
                                key={index}
                                className="sqlite-browser-query-history-item"
                                onClick={() => handleSelectHistoryQuery(entry)}
                              >
                                <span className="sqlite-browser-query-history-sql">
                                  {entry.sql.length > 80 ? entry.sql.substring(0, 80) + '...' : entry.sql}
                                </span>
                                <span className="sqlite-browser-query-history-time">
                                  {formatRelativeTime(entry.timestamp)}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <textarea
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Enter SQL query..."
                      spellCheck={false}
                      onFocus={() => setShowHistory(false)}
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
