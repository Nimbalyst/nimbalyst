import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { VList } from 'virtua';

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
  const [queryTimeMs, setQueryTimeMs] = useState<number | null>(null);
  const [tableLoadTimeMs, setTableLoadTimeMs] = useState<number | null>(null);

  // Cell detail modal
  const [expandedCell, setExpandedCell] = useState<{ column: string; value: any } | null>(null);
  const [copiedCell, setCopiedCell] = useState(false);

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
      setTableLoadTimeMs(null);

      const startTime = performance.now();
      const result = await window.electronAPI.invoke(
        'database:getTableData',
        tableName,
        pageSize,
        offset,
        sort?.column,
        sort?.direction
      );
      const endTime = performance.now();

      setTableLoadTimeMs(Math.round(endTime - startTime));

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
      setQueryTimeMs(null);

      const startTime = performance.now();
      const result = await window.electronAPI.invoke('database:executeQuery', sqlQuery);
      const endTime = performance.now();

      setQueryTimeMs(Math.round(endTime - startTime));

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

  // Format cell value for display/copy
  const formatCellValue = (value: any): string => {
    if (value === null) return 'NULL';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  // Copy cell value to clipboard
  const handleCopyCellValue = async () => {
    if (!expandedCell) return;
    try {
      await navigator.clipboard.writeText(formatCellValue(expandedCell.value));
      setCopiedCell(true);
      setTimeout(() => setCopiedCell(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Handle cell click to expand
  const handleCellClick = (column: string, value: any) => {
    setExpandedCell({ column, value });
    setCopiedCell(false);
  };

  const totalPages = tableData ? Math.ceil(tableData.totalCount / pageSize) : 0;

  return (
    <div className="database-browser flex h-screen w-screen overflow-hidden font-[-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,Oxygen,Ubuntu,Cantarell,sans-serif] before:content-[''] before:fixed before:inset-x-0 before:top-0 before:h-10 before:z-[1000] before:pointer-events-none before:[-webkit-app-region:drag] bg-nim text-nim">
      <div className="database-browser-sidebar w-[250px] flex flex-col border-r border-[var(--nim-border)] bg-nim-secondary">
        <div className="sidebar-header flex items-center justify-between p-4 border-b border-[var(--nim-border)] relative z-[1001]">
          <h2 className="text-base font-semibold m-0">Tables</h2>
          <button onClick={loadTables} className="refresh-button bg-transparent border-none text-xl cursor-pointer py-1 px-2 rounded [-webkit-app-region:no-drag] text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]" title="Refresh tables">
            ↻
          </button>
        </div>

        <div className="tables-list flex-1 overflow-y-auto p-2">
          {loading && tables.length === 0 && <div className="loading py-5 text-center text-[var(--nim-text-muted)]">Loading tables...</div>}
          {error && <div className="error text-[#ff6b6b] bg-[rgba(255,107,107,0.1)] p-3 rounded mt-2 text-[13px]">{error}</div>}
          {tables.map(table => (
            <div
              key={table}
              className={`table-item py-2 px-3 cursor-pointer rounded mb-0.5 text-sm hover:bg-[var(--nim-bg-hover)] ${selectedTable === table ? 'bg-[var(--nim-primary)] text-white' : ''}`}
              onClick={() => handleTableSelect(table)}
            >
              {table}
            </div>
          ))}
        </div>
      </div>

      <div className="database-browser-main flex-1 flex flex-col overflow-hidden p-4 gap-4">
        <div className={`query-panel border border-[var(--nim-border)] rounded-lg transition-all duration-200 bg-nim-secondary ${sqlExpanded ? 'p-4' : 'p-0'}`}>
          <div className={`query-header flex items-center justify-between cursor-pointer select-none ${!sqlExpanded ? 'py-3 px-4' : 'mb-3'}`} onClick={() => setSqlExpanded(!sqlExpanded)}>
            <div className="query-title flex items-center gap-2">
              <span className="expand-icon text-xs text-[var(--nim-text-muted)] transition-transform duration-200">{sqlExpanded ? '▼' : '▶'}</span>
              <h3 className="text-sm font-semibold m-0">SQL Query</h3>
            </div>
            {sqlExpanded && (
              <button
                onClick={(e) => { e.stopPropagation(); executeQuery(); }}
                disabled={loading}
                className="execute-button text-white border-none py-1.5 px-4 rounded text-sm cursor-pointer font-medium bg-[var(--nim-primary)] hover:enabled:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Execute
              </button>
            )}
          </div>
          {sqlExpanded && (
            <>
              <textarea
                className="query-input w-full border border-[var(--nim-border)] rounded p-3 font-mono text-[13px] resize-y bg-[var(--nim-bg)] text-[var(--nim-text)] placeholder:text-[var(--nim-text-faint)]"
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    executeQuery();
                  }
                }}
                placeholder="Enter SELECT query... (Cmd+Enter to execute)"
                rows={5}
              />
              {queryError && <div className="error text-[#ff6b6b] bg-[rgba(255,107,107,0.1)] p-3 rounded mt-2 text-[13px]">{queryError}</div>}
            </>
          )}
        </div>

        {selectedTable && !queryResult && (
          <div className="table-view flex-1 border border-[var(--nim-border)] rounded-lg flex flex-col overflow-hidden bg-nim-secondary">
            <div className="table-header flex items-center justify-between p-4 border-b border-[var(--nim-border)]">
              <h3 className="text-base font-semibold m-0">Table: {selectedTable}</h3>
              <div className="tab-buttons flex gap-2">
                <button
                  className={`tab-button border border-[var(--nim-border)] py-1.5 px-4 rounded cursor-pointer text-[13px] font-medium transition-all duration-200 ${activeTab === 'data' ? 'bg-[var(--nim-primary)] text-white border-[var(--nim-primary)]' : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)]'}`}
                  onClick={() => setActiveTab('data')}
                >
                  Data
                </button>
                <button
                  className={`tab-button border border-[var(--nim-border)] py-1.5 px-4 rounded cursor-pointer text-[13px] font-medium transition-all duration-200 ${activeTab === 'schema' ? 'bg-[var(--nim-primary)] text-white border-[var(--nim-primary)]' : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)]'}`}
                  onClick={() => setActiveTab('schema')}
                >
                  Schema
                </button>
              </div>
            </div>

            {activeTab === 'schema' && tableSchema.length > 0 && (
              <div className="schema-tab flex-1 overflow-auto p-4">
                <div className="table-container flex-1 overflow-auto border border-[var(--nim-border)] rounded bg-nim">
                  <table className="schema-table w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th className="py-2 px-3 text-left border-b border-r border-[var(--nim-border)] font-semibold text-nim-muted sticky top-0 z-[1] bg-nim-tertiary">Column</th>
                        <th className="py-2 px-3 text-left border-b border-r border-[var(--nim-border)] font-semibold text-nim-muted sticky top-0 z-[1] bg-nim-tertiary">Type</th>
                        <th className="py-2 px-3 text-left border-b border-r border-[var(--nim-border)] font-semibold text-nim-muted sticky top-0 z-[1] bg-nim-tertiary">Nullable</th>
                        <th className="py-2 px-3 text-left border-b border-r border-[var(--nim-border)] font-semibold text-nim-muted sticky top-0 z-[1] bg-nim-tertiary">Default</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableSchema.map(col => (
                        <tr key={col.column_name}>
                          <td className="py-2 px-3 text-left border-b border-r border-[var(--nim-border)]"><code className="py-0.5 px-1.5 rounded text-xs font-mono bg-nim-tertiary">{col.column_name}</code></td>
                          <td className="py-2 px-3 text-left border-b border-r border-[var(--nim-border)]">{col.data_type}</td>
                          <td className="py-2 px-3 text-left border-b border-r border-[var(--nim-border)]">{col.is_nullable}</td>
                          <td className="py-2 px-3 text-left border-b border-r border-[var(--nim-border)]">{col.column_default || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'data' && tableData && (
              <div className="data-tab flex-1 flex flex-col overflow-hidden p-4 gap-3">
                <div className="data-header flex items-center justify-between">
                  <div className="data-header-left flex items-center gap-3">
                    <h4 className="text-sm font-semibold m-0">{tableData.totalCount} total rows{tableLoadTimeMs !== null && <span className="query-time font-normal text-[var(--nim-text-muted)] text-[13px]"> - {tableLoadTimeMs}ms</span>}</h4>
                    <button
                      className="column-picker-button py-1 px-3 rounded cursor-pointer text-[13px] border border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
                      onClick={() => setShowColumnPicker(!showColumnPicker)}
                      title="Show/hide columns"
                    >
                      ⚙ Columns
                    </button>
                  </div>
                  {totalPages > 1 && (
                    <div className="pagination flex items-center gap-3 text-[13px]">
                      <button
                        className="py-1 px-3 rounded cursor-pointer text-[13px] border border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] hover:enabled:bg-[var(--nim-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 0 || loading}
                      >
                        Previous
                      </button>
                      <span>
                        Page {currentPage + 1} of {totalPages}
                      </span>
                      <button
                        className="py-1 px-3 rounded cursor-pointer text-[13px] border border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] hover:enabled:bg-[var(--nim-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage >= totalPages - 1 || loading}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>

                {showColumnPicker && tableData.rows.length > 0 && (
                  <div className="column-picker p-3 mb-2 rounded border border-[var(--nim-border)] shadow-sm bg-nim-secondary">
                    <div className="column-picker-header flex items-center justify-between mb-3 pb-2 border-b border-[var(--nim-border)]">
                      <strong className="text-[13px]">Show/Hide Columns</strong>
                      <button className="bg-transparent border-none text-xl cursor-pointer p-0 w-6 h-6 flex items-center justify-center rounded text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]" onClick={() => setShowColumnPicker(false)}>×</button>
                    </div>
                    <div className="column-picker-list grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2 max-h-[300px] overflow-y-auto">
                      {Object.keys(tableData.rows[0]).map(col => (
                        <label key={col} className="column-picker-item flex items-center gap-2 py-1 px-2 rounded cursor-pointer text-[13px] select-none hover:bg-[var(--nim-bg-hover)]">
                          <input
                            type="checkbox"
                            className="cursor-pointer"
                            checked={!isColumnHidden(selectedTable, col)}
                            onChange={() => toggleColumnVisibility(selectedTable!, col)}
                          />
                          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{col}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {loading && <div className="loading py-5 text-center text-[var(--nim-text-muted)]">Loading...</div>}

                {!loading && tableData.rows.length > 0 && (() => {
                  const allColumns = Object.keys(tableData.rows[0]);
                  const visibleColumns = getVisibleColumns(selectedTable, allColumns);

                  return (
                    <div className="virtual-table-container flex-1 flex flex-col border border-[var(--nim-border)] rounded overflow-hidden min-h-0 bg-nim">
                      <div className="virtual-table-header shrink-0 overflow-x-auto bg-nim-tertiary">
                        <table className="data-table w-full border-collapse text-[13px] table-fixed">
                          <thead>
                            <tr>
                              {visibleColumns.map(key => (
                                <th key={key} onClick={() => handleSort(key)} className="sortable py-2 px-3 text-left border-b border-r border-[var(--nim-border)] font-semibold text-nim-muted cursor-pointer select-none static hover:bg-nim-hover bg-nim-tertiary">
                                  {key}
                                  {sortColumn === key && (
                                    <span className="sort-indicator text-[10px] ml-1">
                                      {sortDirection === 'asc' ? ' ↑' : ' ↓'}
                                    </span>
                                  )}
                                </th>
                              ))}
                            </tr>
                          </thead>
                        </table>
                      </div>
                      <VList className="virtual-table-body flex-1 min-h-0">
                        {tableData.rows.map((row, idx) => (
                          <div key={idx} className="virtual-table-row flex border-b border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)]">
                            {visibleColumns.map(col => {
                              const value = row[col];
                              return (
                                <div
                                  key={col}
                                  className="virtual-table-cell clickable flex-1 min-w-[120px] max-w-[300px] py-2 px-3 text-[13px] border-r border-[var(--nim-border)] overflow-hidden text-ellipsis whitespace-nowrap last:border-r-0 cursor-pointer hover:bg-[var(--nim-bg-hover)]"
                                  onClick={() => handleCellClick(col, value)}
                                  title="Click to expand"
                                >
                                  {value === null ? (
                                    <span className="null-value text-[var(--nim-text-faint)] italic">NULL</span>
                                  ) : typeof value === 'object' ? (
                                    <span className="json-preview text-[var(--nim-text-muted)] font-mono text-xs">{JSON.stringify(value)}</span>
                                  ) : (
                                    String(value)
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </VList>
                    </div>
                  );
                })()}

                {!loading && tableData.rows.length === 0 && (
                  <div className="no-data py-5 text-center text-[var(--nim-text-muted)]">No data</div>
                )}
              </div>
            )}
          </div>
        )}

        {queryResult && (
          <div className="query-results flex-1 border border-[var(--nim-border)] rounded-lg p-4 flex flex-col overflow-hidden gap-3 bg-nim-secondary">
            <div className="data-header flex items-center justify-between">
              <h4 className="text-sm font-semibold m-0">Query Results ({queryResult.rowCount} rows){queryTimeMs !== null && <span className="query-time font-normal text-[var(--nim-text-muted)] text-[13px]"> - {queryTimeMs}ms</span>}</h4>
            </div>

            {loading && <div className="loading py-5 text-center text-[var(--nim-text-muted)]">Loading...</div>}

            {!loading && queryResult.rows.length > 0 && (() => {
              const columns = Object.keys(queryResult.rows[0]);
              const sortedRows = getSortedQueryResults();

              return (
                <div className="virtual-table-container flex-1 flex flex-col border border-[var(--nim-border)] rounded overflow-hidden min-h-0 bg-nim">
                  <div className="virtual-table-header shrink-0 overflow-x-auto bg-nim-tertiary">
                    <table className="data-table w-full border-collapse text-[13px] table-fixed">
                      <thead>
                        <tr>
                          {columns.map(key => (
                            <th key={key} onClick={() => handleSort(key)} className="sortable py-2 px-3 text-left border-b border-r border-[var(--nim-border)] font-semibold text-nim-muted cursor-pointer select-none static hover:bg-nim-hover bg-nim-tertiary">
                              {key}
                              {sortColumn === key && (
                                <span className="sort-indicator text-[10px] ml-1">
                                  {sortDirection === 'asc' ? ' ↑' : ' ↓'}
                                </span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                    </table>
                  </div>
                  <VList className="virtual-table-body flex-1 min-h-0">
                    {sortedRows.map((row, idx) => (
                      <div key={idx} className="virtual-table-row flex border-b border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)]">
                        {columns.map((col, colIdx) => {
                          const value = row[col];
                          return (
                            <div
                              key={colIdx}
                              className="virtual-table-cell clickable flex-1 min-w-[120px] max-w-[300px] py-2 px-3 text-[13px] border-r border-[var(--nim-border)] overflow-hidden text-ellipsis whitespace-nowrap last:border-r-0 cursor-pointer hover:bg-[var(--nim-bg-hover)]"
                              onClick={() => handleCellClick(col, value)}
                              title="Click to expand"
                            >
                              {value === null ? (
                                <span className="null-value text-[var(--nim-text-faint)] italic">NULL</span>
                              ) : typeof value === 'object' ? (
                                <span className="json-preview text-[var(--nim-text-muted)] font-mono text-xs">{JSON.stringify(value)}</span>
                              ) : (
                                String(value)
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </VList>
                </div>
              );
            })()}

            {!loading && queryResult.rows.length === 0 && (
              <div className="no-data py-5 text-center text-[var(--nim-text-muted)]">No results</div>
            )}
          </div>
        )}

        {!selectedTable && !queryResult && (
          <div className="empty-state flex-1 flex items-center justify-center text-[var(--nim-text-faint)] text-sm">
            <p>Select a table from the sidebar or execute a SQL query</p>
          </div>
        )}
      </div>

      {/* Cell Detail Modal */}
      {expandedCell && (
        <div className="cell-modal-overlay fixed inset-0 flex items-center justify-center z-[2000] bg-black/50" onClick={() => setExpandedCell(null)}>
          <div className="cell-modal flex flex-col w-[90vw] max-w-[800px] max-h-[80vh] overflow-hidden rounded-lg border border-[var(--nim-border)] shadow-[0_8px_32px_rgba(0,0,0,0.3)] bg-nim" onClick={e => e.stopPropagation()}>
            <div className="cell-modal-header flex items-center justify-between py-3 px-4 border-b border-[var(--nim-border)] rounded-t-lg bg-nim-secondary">
              <h3 className="m-0 text-sm font-semibold text-[var(--nim-text)]">{expandedCell.column}</h3>
              <div className="cell-modal-actions flex items-center gap-2">
                <button
                  className="cell-modal-copy text-white border-none py-1.5 px-3 rounded text-[13px] cursor-pointer min-w-[70px] bg-[var(--nim-primary)] hover:bg-[var(--nim-primary-hover)]"
                  onClick={handleCopyCellValue}
                >
                  {copiedCell ? 'Copied!' : 'Copy'}
                </button>
                <button
                  className="cell-modal-close bg-transparent border-none text-2xl cursor-pointer p-0 w-8 h-8 flex items-center justify-center rounded text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
                  onClick={() => setExpandedCell(null)}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="cell-modal-content flex-1 overflow-auto p-4 min-h-[100px]">
              <pre className="m-0 whitespace-pre-wrap break-all font-mono text-[13px] leading-relaxed text-[var(--nim-text)]">{formatCellValue(expandedCell.value)}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
