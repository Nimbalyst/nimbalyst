/**
 * SpreadsheetEditor Component
 *
 * The main editor component for CSV files. Integrates with Nimbalyst's
 * custom editor system and provides a spreadsheet-like editing experience.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { RevoGrid, type RevoGridCustomEvent, type ColumnRegular } from '@revolist/react-datagrid';
import type { CustomEditorProps } from '../types';
import { createSpreadsheetStore, type SpreadsheetStoreApi } from '../hooks/useSpreadsheetStore';
import { columnIndexToLetter, generateColumnHeaders } from '../utils/csvParser';
import { isFormula } from '../utils/formulaEngine';
import { SpreadsheetToolbar } from './SpreadsheetToolbar';
import { FormulaBar } from './FormulaBar';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { registerEditorStore, unregisterEditorStore } from '../aiTools';

/**
 * Convert spreadsheet data to RevoGrid source format
 */
function toGridSource(
  rows: { raw: string; computed: string | number | null; error?: string }[][],
  columnCount: number
): Record<string, string | number>[] {
  return rows.map((row) => {
    const rowData: Record<string, string | number> = {};
    for (let c = 0; c < columnCount; c++) {
      const cell = row[c];
      const colKey = columnIndexToLetter(c);

      // Display computed value, or error, or raw formula
      if (cell?.error) {
        rowData[colKey] = cell.error;
      } else if (cell?.computed !== null && cell?.computed !== undefined) {
        rowData[colKey] = cell.computed;
      } else {
        rowData[colKey] = cell?.raw || '';
      }
    }
    return rowData;
  });
}

/**
 * Generate column definitions for RevoGrid
 */
function generateColumns(
  columnCount: number,
  headers?: string[],
  hasHeaders?: boolean
): ColumnRegular[] {
  const columnHeaders = generateColumnHeaders(columnCount);

  return columnHeaders.map((letter, index) => ({
    prop: letter,
    name: hasHeaders && headers?.[index] ? headers[index] : letter,
    size: 120,
    sortable: true,
  }));
}

export function SpreadsheetEditor({
  filePath,
  fileName,
  initialContent,
  theme,
  onContentChange,
  onDirtyChange,
  onGetContentReady,
  onReloadContent,
}: CustomEditorProps) {
  // Create store instance for this editor
  const storeRef = useRef<SpreadsheetStoreApi | null>(null);
  if (!storeRef.current) {
    storeRef.current = createSpreadsheetStore();
  }
  const store = storeRef.current;

  // Local state for forcing re-renders
  const [, forceUpdate] = useState(0);

  // Track selected cell for formula bar
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Load initial content
  useEffect(() => {
    if (initialContent) {
      store.getState().loadFromCSV(initialContent, filePath);
    }
    forceUpdate((n) => n + 1);
  }, [initialContent, filePath, store]);

  // Set up dirty tracking callbacks
  useEffect(() => {
    store.getState().setCallbacks({
      onDirtyChange: (isDirty) => {
        onDirtyChange?.(isDirty);
        if (isDirty) {
          onContentChange?.();
        }
      },
    });
  }, [store, onDirtyChange, onContentChange]);

  // Register getContent function for saving
  const getContent = useCallback(() => {
    return store.getState().toCSV();
  }, [store]);

  useEffect(() => {
    onGetContentReady?.(getContent);
  }, [getContent, onGetContentReady]);

  // Subscribe to store changes
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      forceUpdate((n) => n + 1);
    });
    return unsubscribe;
  }, [store]);

  // Register store for AI tool access
  useEffect(() => {
    registerEditorStore(filePath, store);
    return () => {
      unregisterEditorStore(filePath);
    };
  }, [filePath, store]);

  // Handle external content reload
  const handleReloadContent = useCallback(
    (newContent: string) => {
      console.log('[CSV] Reloading content from external change');
      store.getState().loadFromCSV(newContent, filePath);
      store.getState().markClean();
      forceUpdate((n) => n + 1);
    },
    [store, filePath]
  );

  useEffect(() => {
    onReloadContent?.(handleReloadContent);
  }, [onReloadContent, handleReloadContent]);

  // Get current state
  const state = store.getState();
  const { data, sortConfig } = state;

  // Generate columns (memoized for stability)
  const columns = useMemo(
    () => generateColumns(data.columnCount, data.headers, data.hasHeaders),
    [data.columnCount, data.headers, data.hasHeaders]
  );

  // Convert data to grid source (memoized)
  const source = useMemo(
    () => toGridSource(data.rows, data.columnCount),
    [data.rows, data.columnCount]
  );

  // Handle cell edit
  const handleAfterEdit = useCallback(
    (event: RevoGridCustomEvent<{
      rgRow?: { [key: string]: unknown };
      model?: Record<string, unknown>;
      value?: unknown;
      val?: unknown;
      rowIndex?: number;
      prop?: string;
      colIndex?: number;
    } | null>) => {
      if (!event.detail) return;

      // RevoGrid uses different property names in different versions
      const detail = event.detail;
      const rowIndex = detail.rowIndex;
      const prop = detail.prop;
      const value = detail.val ?? detail.value;

      console.log('[CSV] afterEdit event:', { rowIndex, prop, value, detail });

      if (rowIndex === undefined || prop === undefined) return;

      const colIndex = columnIndexToLetter(0) === prop ? 0 :
        generateColumnHeaders(data.columnCount).indexOf(prop);

      if (colIndex >= 0) {
        console.log('[CSV] Updating cell:', { rowIndex, colIndex, value: String(value ?? '') });
        store.getState().updateCell(rowIndex, colIndex, String(value ?? ''));
        forceUpdate((n) => n + 1);
      }
    },
    [store, data.columnCount]
  );

  // Handle cell focus (selection)
  const handleFocusCell = useCallback(
    (event: RevoGridCustomEvent<{ rowIndex: number; colIndex: number } | null>) => {
      if (!event.detail) return;
      const { rowIndex, colIndex } = event.detail;
      setSelectedCell({ row: rowIndex, col: colIndex });
      store.getState().selectCell(rowIndex, colIndex);
    },
    [store]
  );

  // Get raw value for formula bar
  const getSelectedCellRaw = useCallback((): string => {
    if (!selectedCell) return '';
    const cell = data.rows[selectedCell.row]?.[selectedCell.col];
    return cell?.raw || '';
  }, [selectedCell, data.rows]);

  // Handle formula bar input
  const handleFormulaChange = useCallback(
    (value: string) => {
      if (selectedCell) {
        store.getState().updateCell(selectedCell.row, selectedCell.col, value);
        forceUpdate((n) => n + 1);
      }
    },
    [selectedCell, store]
  );

  // Toolbar actions
  const handleAddRow = useCallback(() => {
    const insertIndex = selectedCell ? selectedCell.row + 1 : undefined;
    store.getState().addRow(insertIndex);
    forceUpdate((n) => n + 1);
  }, [store, selectedCell]);

  const handleDeleteRow = useCallback(() => {
    if (selectedCell) {
      store.getState().deleteRow(selectedCell.row);
      setSelectedCell(null);
      forceUpdate((n) => n + 1);
    }
  }, [store, selectedCell]);

  const handleAddColumn = useCallback(() => {
    const insertIndex = selectedCell ? selectedCell.col + 1 : undefined;
    store.getState().addColumn(insertIndex);
    forceUpdate((n) => n + 1);
  }, [store, selectedCell]);

  const handleDeleteColumn = useCallback(() => {
    if (selectedCell) {
      store.getState().deleteColumn(selectedCell.col);
      setSelectedCell(null);
      forceUpdate((n) => n + 1);
    }
  }, [store, selectedCell]);

  const handleSort = useCallback(
    (direction: 'asc' | 'desc') => {
      if (selectedCell) {
        store.getState().sortByColumn(selectedCell.col, direction);
        forceUpdate((n) => n + 1);
      }
    },
    [store, selectedCell]
  );

  const handleToggleHeaders = useCallback(() => {
    store.getState().toggleHeaders();
    forceUpdate((n) => n + 1);
  }, [store]);

  // Context menu handler
  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const container = gridContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    setContextMenu({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Build context menu items
  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    const s = store.getState();
    const hasClipboard = !!s.clipboard;

    return [
      {
        label: 'Cut',
        action: () => {
          store.getState().cutCell();
          forceUpdate((n) => n + 1);
        },
        disabled: !selectedCell,
      },
      {
        label: 'Copy',
        action: () => {
          store.getState().copyCell();
          forceUpdate((n) => n + 1);
        },
        disabled: !selectedCell,
      },
      {
        label: 'Paste',
        action: () => {
          store.getState().pasteCell();
          forceUpdate((n) => n + 1);
        },
        disabled: !selectedCell || !hasClipboard,
      },
      {
        label: 'Clear',
        action: () => {
          store.getState().clearCell();
          forceUpdate((n) => n + 1);
        },
        disabled: !selectedCell,
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Insert Row Above',
        action: () => {
          store.getState().insertRowAbove();
          forceUpdate((n) => n + 1);
        },
        disabled: !selectedCell,
      },
      {
        label: 'Insert Row Below',
        action: () => {
          store.getState().insertRowBelow();
          forceUpdate((n) => n + 1);
        },
        disabled: !selectedCell,
      },
      {
        label: 'Delete Row',
        action: () => {
          if (selectedCell) {
            store.getState().deleteRow(selectedCell.row);
            setSelectedCell(null);
            forceUpdate((n) => n + 1);
          }
        },
        disabled: !selectedCell,
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Insert Column Left',
        action: () => {
          store.getState().insertColumnLeft();
          forceUpdate((n) => n + 1);
        },
        disabled: !selectedCell,
      },
      {
        label: 'Insert Column Right',
        action: () => {
          store.getState().insertColumnRight();
          forceUpdate((n) => n + 1);
        },
        disabled: !selectedCell,
      },
      {
        label: 'Delete Column',
        action: () => {
          if (selectedCell) {
            store.getState().deleteColumn(selectedCell.col);
            setSelectedCell(null);
            forceUpdate((n) => n + 1);
          }
        },
        disabled: !selectedCell,
      },
    ];
  }, [store, selectedCell]);

  return (
    <div className="spreadsheet-editor" data-theme={theme}>
      <FormulaBar
        cellRef={
          selectedCell
            ? `${columnIndexToLetter(selectedCell.col)}${selectedCell.row + 1}`
            : ''
        }
        value={getSelectedCellRaw()}
        onChange={handleFormulaChange}
        isFormula={isFormula(getSelectedCellRaw())}
      />
      <SpreadsheetToolbar
        onAddRow={handleAddRow}
        onDeleteRow={handleDeleteRow}
        onAddColumn={handleAddColumn}
        onDeleteColumn={handleDeleteColumn}
        onSortAsc={() => handleSort('asc')}
        onSortDesc={() => handleSort('desc')}
        onToggleHeaders={handleToggleHeaders}
        hasSelection={!!selectedCell}
        hasHeaders={data.hasHeaders}
        sortConfig={sortConfig}
      />
      <div
        ref={gridContainerRef}
        className="spreadsheet-grid-container"
        onContextMenu={handleContextMenu}
      >
        <RevoGrid
          columns={columns}
          source={source}
          theme={theme === 'light' ? 'default' : 'darkCompact'}
          rowHeaders={true}
          resize={true}
          autoSizeColumn={false}
          onAfteredit={handleAfterEdit}
          onBeforefocuslost={handleFocusCell}
        />
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems}
            onClose={handleCloseContextMenu}
          />
        )}
      </div>
    </div>
  );
}
