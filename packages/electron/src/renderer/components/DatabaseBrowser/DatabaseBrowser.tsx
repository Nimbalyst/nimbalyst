import React, { useState, useEffect, useCallback } from 'react';
import './DatabaseBrowser.css';

interface Table {
  name: string;
}

interface Column {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface TableData {
  rows: any[];
  totalCount: number;
  limit: number;
  offset: number;
}

interface QueryResult {
  rows: any[];
  rowCount: number;
}

type ViewTab = 'data' | 'schema';

export function DatabaseBrowser() {
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableSchema, setTableSchema] = useState<Column[]>([]);
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('data');

  // SQL Query
  const [sqlQuery, setSqlQuery] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [sqlExpanded, setSqlExpanded] = useState(false);

  // Sorting
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Column visibility - persisted in localStorage
  const [hiddenColumns, setHiddenColumns] = useState<Record<string, Set<string>>>(() => {
    try {
      const saved = localStorage.getItem('database-browser-hidden-columns');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Convert arrays back to Sets
        const result: Record<string, Set<string>> = {};
        for (const [table, cols] of Object.entries(parsed)) {
          result[table] = new Set(cols as string[]);
        }
        return result;
      }
    } catch (err) {
      console.error('Failed to load hidden columns:', err);
    }
    return {};
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  // Save hidden columns to localStorage whenever they change
  useEffect(() => {
    try {
      const toSave: Record<string, string[]> = {};
      for (const [table, cols] of Object.entries(hiddenColumns)) {
        toSave[table] = Array.from(cols);
      }
      localStorage.setItem('database-browser-hidden-columns', JSON.stringify(toSave));
    } catch (err) {
      console.error('Failed to save hidden columns:', err);
    }
  }, [hiddenColumns]);

  // Load tables on mount
  useEffect(() => {
    loadTables();
  }, []);

  const loadTables = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await window.electronAPI.invoke('database:getTables');

      if (result.success) {
        setTables(result.tables);
      } else {
        setError(result.error || 'Failed to load tables');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadTableSchema = async (tableName: string) => {
    try {
      setLoading(true);
      setError(null);
      const result = await window.electronAPI.invoke('database:getTableSchema', tableName);

      if (result.success) {
        setTableSchema(result.columns);
      } else {
        setError(result.error || 'Failed to load table schema');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadTableData = async (tableName: string, offset: number = 0, sort?: { column: string; direction: 'asc' | 'desc' }) => {
    try {
      setLoading(true);
      setError(null);
      const result = await window.electronAPI.invoke(
        'database:getTableData',
        tableName,
        pageSize,
        offset,
        sort?.column,
        sort?.direction
      );

      if (result.success) {
        setTableData(result);
      } else {
        setError(result.error || 'Failed to load table data');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleTableSelect = useCallback((tableName: string) => {
    setSelectedTable(tableName);
    setCurrentPage(0);
    setQueryResult(null);
    setQueryError(null);
    setActiveTab('data');
    setSortColumn(null);
    setSortDirection('asc');
    loadTableSchema(tableName);
    loadTableData(tableName, 0);
  }, []);

  const handlePageChange = (newPage: number) => {
    if (selectedTable && tableData) {
      const offset = newPage * pageSize;
      setCurrentPage(newPage);
      const sort = sortColumn ? { column: sortColumn, direction: sortDirection } : undefined;
      loadTableData(selectedTable, offset, sort);
    }
  };

  const executeQuery = async () => {
    if (!sqlQuery.trim()) {
      setQueryError('Please enter a SQL query');
      return;
    }

    try {
      setLoading(true);
      setQueryError(null);
      setQueryResult(null);

      const result = await window.electronAPI.invoke('database:executeQuery', sqlQuery);

      if (result.success) {
        setQueryResult(result);
        setSortColumn(null);
        setSortDirection('asc');
      } else {
        setQueryError(result.error || 'Query failed');
      }
    } catch (err) {
      setQueryError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (columnName: string) => {
    const newDirection = sortColumn === columnName && sortDirection === 'asc' ? 'desc' : 'asc';
    setSortColumn(columnName);
    setSortDirection(newDirection);

    // Reload data with new sorting
    if (selectedTable) {
      setCurrentPage(0); // Reset to first page when sorting changes
      loadTableData(selectedTable, 0, { column: columnName, direction: newDirection });
    }
  };

  const toggleColumnVisibility = (table: string, column: string) => {
    setHiddenColumns(prev => {
      const newHidden = { ...prev };
      if (!newHidden[table]) {
        newHidden[table] = new Set();
      } else {
        newHidden[table] = new Set(newHidden[table]);
      }

      if (newHidden[table].has(column)) {
        newHidden[table].delete(column);
      } else {
        newHidden[table].add(column);
      }

      return newHidden;
    });
  };

  const getVisibleColumns = (table: string | null, allColumns: string[]) => {
    if (!table) return allColumns;
    const hidden = hiddenColumns[table] || new Set();
    return allColumns.filter(col => !hidden.has(col));
  };

  const isColumnHidden = (table: string | null, column: string) => {
    if (!table) return false;
    return hiddenColumns[table]?.has(column) || false;
  };

  // Client-side sorting only for query results (table data is sorted server-side)
  const getSortedQueryResults = () => {
    if (!queryResult || !sortColumn) return queryResult?.rows || [];

    return [...queryResult.rows].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      if (aVal === null) return sortDirection === 'asc' ? 1 : -1;
      if (bVal === null) return sortDirection === 'asc' ? -1 : 1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();

      if (aStr < bStr) return sortDirection === 'asc' ? -1 : 1;
      if (aStr > bStr) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const totalPages = tableData ? Math.ceil(tableData.totalCount / pageSize) : 0;

  return (
    <div className="database-browser">
      <div className="database-browser-sidebar">
        <div className="sidebar-header">
          <h2>Tables</h2>
          <button onClick={loadTables} className="refresh-button" title="Refresh tables">
            ↻
          </button>
        </div>

        <div className="tables-list">
          {loading && tables.length === 0 && <div className="loading">Loading tables...</div>}
          {error && <div className="error">{error}</div>}
          {tables.map(table => (
            <div
              key={table}
              className={`table-item ${selectedTable === table ? 'selected' : ''}`}
              onClick={() => handleTableSelect(table)}
            >
              {table}
            </div>
          ))}
        </div>
      </div>

      <div className="database-browser-main">
        <div className={`query-panel ${sqlExpanded ? 'expanded' : 'collapsed'}`}>
          <div className="query-header" onClick={() => setSqlExpanded(!sqlExpanded)}>
            <div className="query-title">
              <span className="expand-icon">{sqlExpanded ? '▼' : '▶'}</span>
              <h3>SQL Query</h3>
            </div>
            {sqlExpanded && (
              <button
                onClick={(e) => { e.stopPropagation(); executeQuery(); }}
                disabled={loading}
                className="execute-button"
              >
                Execute
              </button>
            )}
          </div>
          {sqlExpanded && (
            <>
              <textarea
                className="query-input"
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                placeholder="Enter SELECT query... (write operations disabled for safety)"
                rows={5}
              />
              {queryError && <div className="error">{queryError}</div>}
            </>
          )}
        </div>

        {selectedTable && (
          <div className="table-view">
            <div className="table-header">
              <h3>Table: {selectedTable}</h3>
              <div className="tab-buttons">
                <button
                  className={`tab-button ${activeTab === 'data' ? 'active' : ''}`}
                  onClick={() => setActiveTab('data')}
                >
                  Data
                </button>
                <button
                  className={`tab-button ${activeTab === 'schema' ? 'active' : ''}`}
                  onClick={() => setActiveTab('schema')}
                >
                  Schema
                </button>
              </div>
            </div>

            {activeTab === 'schema' && tableSchema.length > 0 && (
              <div className="schema-tab">
                <div className="table-container">
                  <table className="schema-table">
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Nullable</th>
                        <th>Default</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableSchema.map(col => (
                        <tr key={col.column_name}>
                          <td><code>{col.column_name}</code></td>
                          <td>{col.data_type}</td>
                          <td>{col.is_nullable}</td>
                          <td>{col.column_default || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'data' && tableData && (
              <div className="data-tab">
                <div className="data-header">
                  <div className="data-header-left">
                    <h4>{tableData.totalCount} total rows</h4>
                    <button
                      className="column-picker-button"
                      onClick={() => setShowColumnPicker(!showColumnPicker)}
                      title="Show/hide columns"
                    >
                      ⚙ Columns
                    </button>
                  </div>
                  {totalPages > 1 && (
                    <div className="pagination">
                      <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 0 || loading}
                      >
                        Previous
                      </button>
                      <span>
                        Page {currentPage + 1} of {totalPages}
                      </span>
                      <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage >= totalPages - 1 || loading}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>

                {showColumnPicker && tableData.rows.length > 0 && (
                  <div className="column-picker">
                    <div className="column-picker-header">
                      <strong>Show/Hide Columns</strong>
                      <button onClick={() => setShowColumnPicker(false)}>×</button>
                    </div>
                    <div className="column-picker-list">
                      {Object.keys(tableData.rows[0]).map(col => (
                        <label key={col} className="column-picker-item">
                          <input
                            type="checkbox"
                            checked={!isColumnHidden(selectedTable, col)}
                            onChange={() => toggleColumnVisibility(selectedTable!, col)}
                          />
                          <span>{col}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {loading && <div className="loading">Loading...</div>}

                {!loading && tableData.rows.length > 0 && (() => {
                  const allColumns = Object.keys(tableData.rows[0]);
                  const visibleColumns = getVisibleColumns(selectedTable, allColumns);

                  return (
                    <div className="table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            {visibleColumns.map(key => (
                              <th key={key} onClick={() => handleSort(key)} className="sortable">
                                {key}
                                {sortColumn === key && (
                                  <span className="sort-indicator">
                                    {sortDirection === 'asc' ? ' ↑' : ' ↓'}
                                  </span>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableData.rows.map((row, idx) => (
                            <tr key={idx}>
                              {visibleColumns.map(col => (
                                <td key={col}>
                                  {row[col] === null ? (
                                    <span className="null-value">NULL</span>
                                  ) : typeof row[col] === 'object' ? (
                                    <pre className="json-value">{JSON.stringify(row[col], null, 2)}</pre>
                                  ) : (
                                    String(row[col])
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {!loading && tableData.rows.length === 0 && (
                  <div className="no-data">No data</div>
                )}
              </div>
            )}
          </div>
        )}

        {queryResult && !selectedTable && (
          <div className="query-results">
            <div className="data-header">
              <h4>Query Results ({queryResult.rowCount} rows)</h4>
            </div>

            {loading && <div className="loading">Loading...</div>}

            {!loading && queryResult.rows.length > 0 && (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(queryResult.rows[0]).map(key => (
                        <th key={key} onClick={() => handleSort(key)} className="sortable">
                          {key}
                          {sortColumn === key && (
                            <span className="sort-indicator">
                              {sortDirection === 'asc' ? ' ↑' : ' ↓'}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedQueryResults().map((row, idx) => (
                      <tr key={idx}>
                        {Object.values(row).map((value: any, colIdx) => (
                          <td key={colIdx}>
                            {value === null ? (
                              <span className="null-value">NULL</span>
                            ) : typeof value === 'object' ? (
                              <pre className="json-value">{JSON.stringify(value, null, 2)}</pre>
                            ) : (
                              String(value)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && queryResult.rows.length === 0 && (
              <div className="no-data">No results</div>
            )}
          </div>
        )}

        {!selectedTable && !queryResult && (
          <div className="empty-state">
            <p>Select a table from the sidebar or execute a SQL query</p>
          </div>
        )}
      </div>
    </div>
  );
}
