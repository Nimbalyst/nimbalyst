/**
 * SpreadsheetEditor Component
 *
 * The main editor component for CSV files. Integrates with Nimbalyst's
 * custom editor system and provides a spreadsheet-like editing experience.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { RevoGrid, type RevoGridCustomEvent, type ColumnRegular } from '@revolist/react-datagrid';
import type { CustomEditorProps, NormalizedSelectionRange } from '../types';
import { useSpreadsheetData } from '../hooks/useSpreadsheetData';
import { columnIndexToLetter, generateColumnHeaders } from '../utils/csvParser';
import { isFormula } from '../utils/formulaEngine';
import { SpreadsheetToolbar } from './SpreadsheetToolbar';
import { FormulaBar } from './FormulaBar';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { registerEditorStore, unregisterEditorStore } from '../aiTools';

// Buffer of extra empty rows/columns to show beyond actual data
const DISPLAY_BUFFER_ROWS = 20;
const DISPLAY_BUFFER_COLS = 20;

/**
 * Format a selection range as a cell reference string (e.g., "A1" or "A1:C5")
 */
function formatSelectionRef(selection: NormalizedSelectionRange | null): string {
  if (!selection) return '';

  const startRef = `${columnIndexToLetter(selection.startCol)}${selection.startRow + 1}`;

  if (selection.startRow === selection.endRow && selection.startCol === selection.endCol) {
    return startRef;
  }

  const endRef = `${columnIndexToLetter(selection.endCol)}${selection.endRow + 1}`;
  return `${startRef}:${endRef}`;
}

/**
 * Convert spreadsheet data to RevoGrid source format with display buffer
 */
function toGridSource(
  rows: { raw: string; computed: string | number | null; error?: string }[][],
  columnCount: number,
  headerRowCount: number,
  displayColumnCount: number
): Record<string, string | number>[] {
  const displayRowCount = rows.length + DISPLAY_BUFFER_ROWS;
  const result: Record<string, string | number>[] = [];

  for (let rowIndex = 0; rowIndex < displayRowCount; rowIndex++) {
    const rowData: Record<string, string | number> = {};
    const row = rows[rowIndex];

    for (let c = 0; c < displayColumnCount; c++) {
      const colKey = columnIndexToLetter(c);
      const cell = row?.[c];

      if (cell?.error) {
        rowData[colKey] = cell.error;
      } else if (cell?.computed !== null && cell?.computed !== undefined) {
        rowData[colKey] = cell.computed;
      } else {
        rowData[colKey] = cell?.raw || '';
      }
    }
    if (rowIndex < headerRowCount) {
      rowData._rowClass = 'header-row';
    }
    result.push(rowData);
  }

  return result;
}

/**
 * Generate column definitions for RevoGrid
 */
function generateColumns(columnCount: number): ColumnRegular[] {
  const columnHeaders = generateColumnHeaders(columnCount);

  return columnHeaders.map((letter) => ({
    prop: letter,
    name: letter,
    size: 120,
    sortable: true,
  }));
}

/**
 * Normalize selection range
 */
function normalizeRange(
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): NormalizedSelectionRange {
  return {
    startRow: Math.min(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endRow: Math.max(startRow, endRow),
    endCol: Math.max(startCol, endCol),
  };
}

export function SpreadsheetEditor({
  filePath,
  initialContent,
  theme,
  onContentChange,
  onDirtyChange,
  onGetContentReady,
  onReloadContent,
}: CustomEditorProps) {
  // Main data hook with undo/redo
  const spreadsheet = useSpreadsheetData(initialContent, filePath, {
    onDirtyChange,
    onContentChange,
  });

  // Selection state (owned locally, updated from RevoGrid events)
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [selectionRange, setSelectionRange] = useState<NormalizedSelectionRange | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    isRowHeader: boolean;
    rowIndex: number | null;
  } | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Register getContent function for saving
  const getContent = useCallback(() => {
    return spreadsheet.toCSV();
  }, [spreadsheet]);

  useEffect(() => {
    onGetContentReady?.(getContent);
  }, [getContent, onGetContentReady]);

  // Register store for AI tool access
  useEffect(() => {
    registerEditorStore(filePath, spreadsheet);
    return () => {
      unregisterEditorStore(filePath);
    };
  }, [filePath, spreadsheet]);

  // Handle external content reload
  const handleReloadContent = useCallback(
    (newContent: string) => {
      spreadsheet.loadFromCSV(newContent);
      spreadsheet.markClean();
      setSelectedCell(null);
      setSelectionRange(null);
    },
    [spreadsheet]
  );

  useEffect(() => {
    onReloadContent?.(handleReloadContent);
  }, [onReloadContent, handleReloadContent]);

  // Display dimensions (data + buffer)
  const displayColumnCount = spreadsheet.data.columnCount + DISPLAY_BUFFER_COLS;

  // Memoized grid data
  const columns = useMemo(
    () => generateColumns(displayColumnCount),
    [displayColumnCount]
  );

  const source = useMemo(
    () => toGridSource(spreadsheet.data.rows, spreadsheet.data.columnCount, spreadsheet.data.headerRowCount || 0, displayColumnCount),
    [spreadsheet.data.rows, spreadsheet.data.columnCount, spreadsheet.data.headerRowCount, displayColumnCount]
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

      const detail = event.detail;
      const rowIndex = detail.rowIndex;
      const prop = detail.prop;
      const value = detail.val ?? detail.value;

      if (rowIndex === undefined || prop === undefined) return;

      // Use display column count to find columns in the buffer zone
      const colIndex = columnIndexToLetter(0) === prop ? 0 :
        generateColumnHeaders(displayColumnCount).indexOf(prop);

      if (colIndex >= 0) {
        spreadsheet.updateCell(rowIndex, colIndex, String(value ?? ''));
      }
    },
    [spreadsheet, displayColumnCount]
  );

  // Handle cell focus (selection)
  const handleFocusCell = useCallback(
    (event: RevoGridCustomEvent<{ rowIndex: number; colIndex: number } | null>) => {
      console.log('[CSV] handleFocusCell event:', event.detail);
      if (!event.detail) return;
      const { rowIndex, colIndex } = event.detail;

      console.log('[CSV] Setting selectedCell to:', { row: rowIndex, col: colIndex });
      setSelectedCell({ row: rowIndex, col: colIndex });
      setSelectionRange(normalizeRange(rowIndex, colIndex, rowIndex, colIndex));
    },
    []
  );

  // Handle cell click as backup for selection
  const handleCellClick = useCallback(
    (event: RevoGridCustomEvent<{ row: number; col: number } | null>) => {
      console.log('[CSV] handleCellClick event:', event.detail);
      if (!event.detail) return;
      const { row, col } = event.detail;

      console.log('[CSV] Setting selectedCell from click to:', { row, col });
      setSelectedCell({ row, col });
      setSelectionRange(normalizeRange(row, col, row, col));
    },
    []
  );

  // Handle range selection from RevoGrid
  const handleSetRange = useCallback(
    (event: RevoGridCustomEvent<{
      type: string;
      area?: { x: number; y: number; x1: number; y1: number };
    } | null>) => {
      console.log('[CSV] handleSetRange event:', event.detail);
      if (!event.detail?.area) return;
      const { x, y, x1, y1 } = event.detail.area;

      console.log('[CSV] Setting selectedCell from range to:', { row: y, col: x });
      setSelectedCell({ row: y, col: x });
      setSelectionRange(normalizeRange(y, x, y1, x1));
    },
    []
  );

  // Get raw value for formula bar
  const getSelectedCellRaw = useCallback((): string => {
    if (!selectedCell) return '';
    const cell = spreadsheet.data.rows[selectedCell.row]?.[selectedCell.col];
    return cell?.raw || '';
  }, [selectedCell, spreadsheet.data.rows]);

  // Handle formula bar input
  const handleFormulaChange = useCallback(
    (value: string) => {
      if (selectedCell) {
        spreadsheet.updateCell(selectedCell.row, selectedCell.col, value);
      }
    },
    [selectedCell, spreadsheet]
  );

  // Toolbar actions
  const handleAddRow = useCallback(() => {
    const insertIndex = selectedCell ? selectedCell.row + 1 : undefined;
    spreadsheet.addRow(insertIndex);
  }, [spreadsheet, selectedCell]);

  const handleDeleteRow = useCallback(() => {
    if (selectedCell) {
      spreadsheet.deleteRow(selectedCell.row);
      setSelectedCell(null);
      setSelectionRange(null);
    }
  }, [spreadsheet, selectedCell]);

  const handleAddColumn = useCallback(() => {
    const insertIndex = selectedCell ? selectedCell.col + 1 : undefined;
    spreadsheet.addColumn(insertIndex);
  }, [spreadsheet, selectedCell]);

  const handleDeleteColumn = useCallback(() => {
    if (selectedCell) {
      spreadsheet.deleteColumn(selectedCell.col);
      setSelectedCell(null);
      setSelectionRange(null);
    }
  }, [spreadsheet, selectedCell]);

  const handleSort = useCallback(
    (direction: 'asc' | 'desc') => {
      if (selectedCell) {
        spreadsheet.sortByColumn(selectedCell.col, direction);
      }
    },
    [spreadsheet, selectedCell]
  );

  const handleToggleHeaders = useCallback(() => {
    spreadsheet.toggleHeaders();
  }, [spreadsheet]);

  // Context menu handler
  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const container = gridContainerRef.current;
    if (!container) return;

    const target = event.target as HTMLElement;
    const rect = container.getBoundingClientRect();

    // Check if clicking on a row header
    const rowHeader = target.closest('[data-rgrow]:not([data-rgcol])') as HTMLElement | null;
    if (rowHeader) {
      const rowIndex = parseInt(rowHeader.dataset.rgrow || '', 10);
      if (!isNaN(rowIndex)) {
        setSelectedCell({ row: rowIndex, col: 0 });
        setSelectionRange(normalizeRange(rowIndex, 0, rowIndex, spreadsheet.data.columnCount - 1));
        setContextMenu({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          isRowHeader: true,
          rowIndex,
        });
        return;
      }
    }

    // Try to get the cell from the click target
    const cell = target.closest('[data-rgrow][data-rgcol]') as HTMLElement | null;

    if (cell) {
      const rowIndex = parseInt(cell.dataset.rgrow || '', 10);
      const colIndex = parseInt(cell.dataset.rgcol || '', 10);

      if (!isNaN(rowIndex) && !isNaN(colIndex)) {
        const isInSelection = selectionRange &&
          rowIndex >= selectionRange.startRow && rowIndex <= selectionRange.endRow &&
          colIndex >= selectionRange.startCol && colIndex <= selectionRange.endCol;

        if (!isInSelection) {
          setSelectedCell({ row: rowIndex, col: colIndex });
          setSelectionRange(normalizeRange(rowIndex, colIndex, rowIndex, colIndex));
        }
      }
    }

    setContextMenu({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      isRowHeader: false,
      rowIndex: null,
    });
  }, [spreadsheet.data.columnCount, selectionRange]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Ref for the editor container
  const editorRef = useRef<HTMLDivElement>(null);

  // Use a ref to track selected cell for the global handler
  const selectedCellRef = useRef(selectedCell);
  useEffect(() => {
    selectedCellRef.current = selectedCell;
  }, [selectedCell]);

  // Capture listener for Cmd+S and Cmd+V to intercept before RevoGrid
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const handleCapture = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      if (!cmdOrCtrl) return;

      const key = event.key.toLowerCase();
      console.log('[CSV] Capture keydown:', key, 'meta:', event.metaKey, 'ctrl:', event.ctrlKey, 'selectedCell:', selectedCellRef.current);

      // Handle Cmd+S - dispatch to window for app save handler
      if (key === 's') {
        console.log('[CSV] Cmd+S captured, dispatching to window');
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 's',
          code: 'KeyS',
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          bubbles: true,
        }));
        return;
      }

      // Handle Cmd+V - paste from system clipboard
      const currentCell = selectedCellRef.current;
      if (key === 'v') {
        console.log('[CSV] Cmd+V captured, selectedCell:', currentCell);
        event.preventDefault();
        event.stopPropagation();

        if (!currentCell) {
          console.log('[CSV] No cell selected, cannot paste');
          return;
        }

        navigator.clipboard.readText().then(text => {
          console.log('[CSV] System clipboard text:', text ? `"${text.substring(0, 100)}..."` : '(empty)');
          if (text) {
            console.log('[CSV] Calling pasteFromText');
            spreadsheet.pasteFromText(currentCell.row, currentCell.col, text);
          } else {
            console.log('[CSV] Calling pasteAtCell (internal clipboard)');
            spreadsheet.pasteAtCell(currentCell.row, currentCell.col);
          }
        }).catch((err) => {
          console.log('[CSV] Clipboard access denied:', err);
          spreadsheet.pasteAtCell(currentCell.row, currentCell.col);
        });
        return;
      }

      // Handle Cmd+Z - undo
      if (key === 'z' && !event.shiftKey) {
        console.log('[CSV] Cmd+Z captured, calling undo');
        event.preventDefault();
        event.stopPropagation();
        spreadsheet.undo();
        return;
      }

      // Handle Cmd+Shift+Z - redo
      if (key === 'z' && event.shiftKey) {
        console.log('[CSV] Cmd+Shift+Z captured, calling redo');
        event.preventDefault();
        event.stopPropagation();
        spreadsheet.redo();
        return;
      }
    };

    // Add to editor container in capture phase to intercept before RevoGrid
    editor.addEventListener('keydown', handleCapture, true);
    return () => {
      editor.removeEventListener('keydown', handleCapture, true);
    };
  }, [spreadsheet]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      if (cmdOrCtrl && !event.altKey) {
        switch (event.key.toLowerCase()) {
          case 'z':
            event.preventDefault();
            if (event.shiftKey) {
              spreadsheet.redo();
            } else {
              spreadsheet.undo();
            }
            return;
          case 'y':
            // Ctrl+Y for redo (Windows style)
            if (!isMac) {
              event.preventDefault();
              spreadsheet.redo();
              return;
            }
            break;
          case 'c':
            if (!event.shiftKey && selectionRange) {
              event.preventDefault();
              spreadsheet.copySelection(selectionRange);
            }
            return;
          case 'x':
            if (!event.shiftKey && selectionRange) {
              event.preventDefault();
              spreadsheet.cutSelection(selectionRange);
            }
            return;
          case 'v':
            if (!event.shiftKey && selectedCell) {
              event.preventDefault();
              console.log('[CSV] Paste triggered, selectedCell:', selectedCell);
              // Try system clipboard first, fall back to internal clipboard
              navigator.clipboard.readText().then(text => {
                console.log('[CSV] System clipboard text:', text ? `"${text.substring(0, 100)}..."` : '(empty)');
                if (text) {
                  console.log('[CSV] Calling pasteFromText');
                  spreadsheet.pasteFromText(selectedCell.row, selectedCell.col, text);
                } else {
                  console.log('[CSV] Calling pasteAtCell (internal clipboard)');
                  spreadsheet.pasteAtCell(selectedCell.row, selectedCell.col);
                }
              }).catch((err) => {
                console.log('[CSV] Clipboard access denied:', err);
                // Clipboard access denied, use internal clipboard
                spreadsheet.pasteAtCell(selectedCell.row, selectedCell.col);
              });
            }
            return;
          case 'a':
            if (!event.shiftKey) {
              event.preventDefault();
              setSelectionRange(normalizeRange(
                0, 0,
                spreadsheet.data.rows.length - 1,
                spreadsheet.data.columnCount - 1
              ));
              setSelectedCell({ row: 0, col: 0 });
            }
            return;
        }
      }

      // Delete/Backspace clears selection
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const activeElement = document.activeElement;
        const isEditing = activeElement?.tagName === 'INPUT' ||
                          activeElement?.getAttribute('contenteditable') === 'true';
        if (!isEditing && selectionRange) {
          event.preventDefault();
          spreadsheet.clearCells(selectionRange);
        }
      }

      // Escape clears selection
      if (event.key === 'Escape') {
        setSelectedCell(null);
        setSelectionRange(null);
      }
    },
    [spreadsheet, selectedCell, selectionRange]
  );

  // Build row header context menu items
  const getRowHeaderContextMenuItems = useCallback((rowIndex: number): ContextMenuItem[] => {
    const headerRowCount = spreadsheet.data.headerRowCount || 0;
    const isCurrentlyHeader = rowIndex < headerRowCount;
    const isTopRowOrAdjacentToHeader = rowIndex === 0 || rowIndex === headerRowCount;

    const items: ContextMenuItem[] = [];

    if (isCurrentlyHeader) {
      if (rowIndex === headerRowCount - 1) {
        items.push({
          label: 'Remove Header Row',
          action: () => spreadsheet.setHeaderRowCount(headerRowCount - 1),
        });
      }
      if (headerRowCount > 1) {
        items.push({
          label: 'Remove All Header Rows',
          action: () => spreadsheet.setHeaderRowCount(0),
        });
      }
    } else {
      if (isTopRowOrAdjacentToHeader) {
        items.push({
          label: 'Set as Header Row',
          action: () => spreadsheet.setHeaderRowCount(rowIndex + 1),
        });
      } else {
        items.push({
          label: `Set Rows 1-${rowIndex + 1} as Headers`,
          action: () => spreadsheet.setHeaderRowCount(rowIndex + 1),
        });
      }
    }

    items.push({ label: '', action: () => {}, separator: true });

    items.push({
      label: 'Insert Row Above',
      action: () => {
        spreadsheet.addRow(rowIndex);
        if (rowIndex < headerRowCount) {
          spreadsheet.setHeaderRowCount(headerRowCount + 1);
        }
      },
    });

    items.push({
      label: 'Insert Row Below',
      action: () => spreadsheet.addRow(rowIndex + 1),
    });

    items.push({
      label: 'Delete Row',
      action: () => {
        spreadsheet.deleteRow(rowIndex);
        if (rowIndex < headerRowCount) {
          spreadsheet.setHeaderRowCount(Math.max(0, headerRowCount - 1));
        }
        setSelectedCell(null);
        setSelectionRange(null);
      },
      disabled: spreadsheet.data.rows.length <= 1,
    });

    return items;
  }, [spreadsheet]);

  // Build context menu items
  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    const hasClipboard = !!spreadsheet.clipboard;
    const hasSelection = !!selectedCell;
    const cellCount = selectionRange
      ? (selectionRange.endRow - selectionRange.startRow + 1) * (selectionRange.endCol - selectionRange.startCol + 1)
      : 0;
    const hasMultipleSelected = cellCount > 1;

    return [
      {
        label: hasMultipleSelected ? `Cut (${cellCount} cells)` : 'Cut',
        action: () => {
          if (selectionRange) spreadsheet.cutSelection(selectionRange);
        },
        disabled: !hasSelection,
      },
      {
        label: hasMultipleSelected ? `Copy (${cellCount} cells)` : 'Copy',
        action: () => {
          if (selectionRange) spreadsheet.copySelection(selectionRange);
        },
        disabled: !hasSelection,
      },
      {
        label: 'Paste',
        action: () => {
          if (selectedCell) spreadsheet.pasteAtCell(selectedCell.row, selectedCell.col);
        },
        disabled: !hasSelection || !hasClipboard,
      },
      {
        label: hasMultipleSelected ? `Clear (${cellCount} cells)` : 'Clear',
        action: () => {
          if (selectionRange) spreadsheet.clearCells(selectionRange);
        },
        disabled: !hasSelection,
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Insert Row Above',
        action: () => {
          if (selectedCell) spreadsheet.addRow(selectedCell.row);
        },
        disabled: !hasSelection,
      },
      {
        label: 'Insert Row Below',
        action: () => {
          if (selectedCell) spreadsheet.addRow(selectedCell.row + 1);
        },
        disabled: !hasSelection,
      },
      {
        label: 'Delete Row',
        action: () => {
          if (selectedCell) {
            spreadsheet.deleteRow(selectedCell.row);
            setSelectedCell(null);
            setSelectionRange(null);
          }
        },
        disabled: !hasSelection,
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Insert Column Left',
        action: () => {
          if (selectedCell) spreadsheet.addColumn(selectedCell.col);
        },
        disabled: !hasSelection,
      },
      {
        label: 'Insert Column Right',
        action: () => {
          if (selectedCell) spreadsheet.addColumn(selectedCell.col + 1);
        },
        disabled: !hasSelection,
      },
      {
        label: 'Delete Column',
        action: () => {
          if (selectedCell) {
            spreadsheet.deleteColumn(selectedCell.col);
            setSelectedCell(null);
            setSelectionRange(null);
          }
        },
        disabled: !hasSelection,
      },
    ];
  }, [spreadsheet, selectedCell, selectionRange]);

  // Get fresh menu items when context menu opens
  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return [];
    if (contextMenu.isRowHeader && contextMenu.rowIndex !== null) {
      return getRowHeaderContextMenuItems(contextMenu.rowIndex);
    }
    return getContextMenuItems();
  }, [contextMenu, getContextMenuItems, getRowHeaderContextMenuItems]);

  return (
    <div
      ref={editorRef}
      className="spreadsheet-editor"
      data-theme={theme}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <FormulaBar
        cellRef={formatSelectionRef(selectionRange)}
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
        hasHeaders={spreadsheet.data.hasHeaders}
        sortConfig={spreadsheet.sortConfig}
        canUndo={spreadsheet.canUndo}
        canRedo={spreadsheet.canRedo}
        onUndo={spreadsheet.undo}
        onRedo={spreadsheet.redo}
      />
      <div
        ref={gridContainerRef}
        className="spreadsheet-grid-container"
        onContextMenu={handleContextMenu}
        onClick={(e) => {
          // Fallback: extract cell from click target
          const target = e.target as HTMLElement;
          const cell = target.closest('[data-rgrow][data-rgcol]') as HTMLElement | null;
          if (cell) {
            const rowIndex = parseInt(cell.dataset.rgrow || '', 10);
            const colIndex = parseInt(cell.dataset.rgcol || '', 10);
            if (!isNaN(rowIndex) && !isNaN(colIndex)) {
              console.log('[CSV] Click fallback setting selectedCell to:', { row: rowIndex, col: colIndex });
              setSelectedCell({ row: rowIndex, col: colIndex });
              setSelectionRange(normalizeRange(rowIndex, colIndex, rowIndex, colIndex));
            }
          }
        }}
      >
        <RevoGrid
          columns={columns}
          source={source}
          theme={theme === 'light' ? 'default' : 'darkCompact'}
          rowHeaders={true}
          resize={true}
          autoSizeColumn={false}
          range={true}
          rowClass="_rowClass"
          onAfteredit={handleAfterEdit}
          onAfterfocus={handleFocusCell}
          onSetrange={handleSetRange}
          onBeforecellfocus={handleCellClick}
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
