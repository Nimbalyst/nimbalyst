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
 * When headerRowCount > 0, returns only the data rows (non-header rows)
 */
function toGridSource(
  rows: { raw: string; computed: string | number | null; error?: string }[][],
  columnCount: number,
  headerRowCount: number,
  displayColumnCount: number
): Record<string, string | number>[] {
  // Start from after header rows
  const dataRows = rows.slice(headerRowCount);
  const displayRowCount = dataRows.length + DISPLAY_BUFFER_ROWS;
  const result: Record<string, string | number>[] = [];

  for (let rowIndex = 0; rowIndex < displayRowCount; rowIndex++) {
    const rowData: Record<string, string | number> = {};
    const row = dataRows[rowIndex];

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
    result.push(rowData);
  }

  return result;
}

/**
 * Convert header rows to pinned top source format for RevoGrid
 */
function toPinnedTopSource(
  rows: { raw: string; computed: string | number | null; error?: string }[][],
  headerRowCount: number,
  displayColumnCount: number
): Record<string, string | number>[] {
  if (headerRowCount === 0) return [];

  const result: Record<string, string | number>[] = [];

  for (let rowIndex = 0; rowIndex < headerRowCount; rowIndex++) {
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
    rowData._rowClass = 'header-row';
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
  isActive,
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

  // Ref for the editor container (defined early for use in effects)
  const editorRef = useRef<HTMLDivElement>(null);

  // Selection state (owned locally, updated from RevoGrid events)
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [selectionRange, setSelectionRange] = useState<NormalizedSelectionRange | null>(null);

  // Refs for capture handlers (updated immediately, not waiting for React re-render)
  const selectedCellRef = useRef(selectedCell);
  const selectionRangeRef = useRef(selectionRange);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    isRowHeader: boolean;
    rowIndex: number | null;
    isColumnHeader: boolean;
    colIndex: number | null;
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

  // Selector for detecting dialogs/overlays
  const DIALOG_SELECTOR = '[role="dialog"], .quick-open-modal, .command-palette, [class*="modal"], [class*="overlay"]:not(.spreadsheet-editor *)';

  // Synchronous check for dialogs - used in keyboard handlers
  const isDialogOpen = useCallback(() => {
    return !!document.querySelector(DIALOG_SELECTOR);
  }, []);

  // Track whether a dialog/overlay is open to prevent RevoGrid from stealing focus (for inert attribute)
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    // Watch for dialogs/overlays appearing in the DOM
    const checkForDialogs = () => {
      const hasDialog = !!document.querySelector(DIALOG_SELECTOR);
      setDialogOpen(hasDialog);
    };

    // Use MutationObserver to detect when dialogs are added/removed
    const observer = new MutationObserver(checkForDialogs);
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial check
    checkForDialogs();

    return () => observer.disconnect();
  }, []);

  // Block keyboard events from reaching RevoGrid when a dialog is open
  // This uses a capture-phase listener on document to intercept events
  // BEFORE they reach RevoGrid, using synchronous dialog detection
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const blockKeyboardWhenDialogOpen = (event: KeyboardEvent) => {
      // Check synchronously if a dialog is open
      if (!document.querySelector(DIALOG_SELECTOR)) {
        return; // No dialog, let event through
      }

      // If the event target is within the spreadsheet editor, stop it
      const target = event.target as HTMLElement | null;
      if (target && editor.contains(target)) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    // Capture phase on document to intercept before RevoGrid
    document.addEventListener('keydown', blockKeyboardWhenDialogOpen, true);
    document.addEventListener('keypress', blockKeyboardWhenDialogOpen, true);
    document.addEventListener('keyup', blockKeyboardWhenDialogOpen, true);

    return () => {
      document.removeEventListener('keydown', blockKeyboardWhenDialogOpen, true);
      document.removeEventListener('keypress', blockKeyboardWhenDialogOpen, true);
      document.removeEventListener('keyup', blockKeyboardWhenDialogOpen, true);
    };
  }, []);

  // Display dimensions (data + buffer)
  const displayColumnCount = spreadsheet.data.columnCount + DISPLAY_BUFFER_COLS;

  // Memoized grid data
  const columns = useMemo(
    () => generateColumns(displayColumnCount),
    [displayColumnCount]
  );

  const headerRowCount = spreadsheet.data.headerRowCount || 0;

  const source = useMemo(
    () => toGridSource(spreadsheet.data.rows, spreadsheet.data.columnCount, headerRowCount, displayColumnCount),
    [spreadsheet.data.rows, spreadsheet.data.columnCount, headerRowCount, displayColumnCount]
  );

  const pinnedTopSource = useMemo(
    () => toPinnedTopSource(spreadsheet.data.rows, headerRowCount, displayColumnCount),
    [spreadsheet.data.rows, headerRowCount, displayColumnCount]
  );

  /**
   * Translate a row index from RevoGrid to the actual row index in our data.
   * RevoGrid uses separate indices for pinned rows vs regular rows.
   * - Rows in pinnedTopSource have indices 0 to headerRowCount-1 (in pinned context)
   * - Rows in source have indices 0 to N (but map to headerRowCount to headerRowCount+N in our data)
   */
  const translateRowIndex = useCallback((gridRowIndex: number, isPinned: boolean): number => {
    if (isPinned) {
      // Pinned rows map directly to header rows (0 to headerRowCount-1)
      return gridRowIndex;
    }
    // Regular rows need to be offset by the header row count
    return gridRowIndex + headerRowCount;
  }, [headerRowCount]);

  // Handle before edit - inject raw value for formulas
  const handleBeforeEdit = useCallback(
    (event: RevoGridCustomEvent<{
      rowIndex?: number;
      colIndex?: number;
      prop?: string;
      val?: unknown;
      model?: Record<string, unknown>;
      type?: string;
    } | null>) => {
      if (!event.detail) return;

      const { rowIndex, prop, type } = event.detail;
      if (rowIndex === undefined || prop === undefined) return;

      // Determine if this is a pinned row edit
      const isPinned = type === 'rowPinStart';
      const actualRowIndex = translateRowIndex(rowIndex, isPinned);

      const colIndex = columnIndexToLetter(0) === prop ? 0 :
        generateColumnHeaders(displayColumnCount).indexOf(prop);

      if (colIndex < 0) return;

      // Get the raw value (formula) from our data
      const cell = spreadsheet.data.rows[actualRowIndex]?.[colIndex];
      if (cell && cell.raw !== cell.computed) {
        // Override the edit value with the raw formula
        if (event.detail.model) {
          event.detail.model[prop] = cell.raw;
        }
      }
    },
    [spreadsheet.data.rows, displayColumnCount, translateRowIndex]
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
      type?: string;
    } | null>) => {
      if (!event.detail) return;

      const detail = event.detail;
      const rowIndex = detail.rowIndex;
      const prop = detail.prop;
      const value = detail.val ?? detail.value;
      const type = detail.type;

      if (rowIndex === undefined || prop === undefined) return;

      // Determine if this is a pinned row edit
      const isPinned = type === 'rowPinStart';
      const actualRowIndex = translateRowIndex(rowIndex, isPinned);

      // Use display column count to find columns in the buffer zone
      const colIndex = columnIndexToLetter(0) === prop ? 0 :
        generateColumnHeaders(displayColumnCount).indexOf(prop);

      if (colIndex >= 0) {
        spreadsheet.updateCell(actualRowIndex, colIndex, String(value ?? ''));
      }
    },
    [spreadsheet, displayColumnCount, translateRowIndex]
  );

  // Handle cell focus (selection)
  const handleFocusCell = useCallback(
    (event: RevoGridCustomEvent<{ rowIndex: number; colIndex: number; type?: string } | null>) => {
      console.log('[CSV] handleFocusCell event:', event.detail);
      if (!event.detail) return;
      const { rowIndex, colIndex, type } = event.detail;

      // Translate row index based on whether it's from pinned rows
      const isPinned = type === 'rowPinStart';
      const actualRowIndex = translateRowIndex(rowIndex, isPinned);

      const newCell = { row: actualRowIndex, col: colIndex };
      const newRange = normalizeRange(actualRowIndex, colIndex, actualRowIndex, colIndex);

      console.log('[CSV] Setting selectedCell to:', newCell);
      setSelectedCell(newCell);
      setSelectionRange(newRange);

      // Update refs immediately
      selectedCellRef.current = newCell;
      selectionRangeRef.current = newRange;
    },
    [translateRowIndex]
  );

  // Handle cell click as backup for selection
  const handleCellClick = useCallback(
    (event: RevoGridCustomEvent<{ row: number; col: number; type?: string } | null>) => {
      console.log('[CSV] handleCellClick event:', event.detail);
      if (!event.detail) return;
      const { row, col, type } = event.detail;

      // Translate row index based on whether it's from pinned rows
      const isPinned = type === 'rowPinStart';
      const actualRow = translateRowIndex(row, isPinned);

      console.log('[CSV] Setting selectedCell from click to:', { row: actualRow, col });
      setSelectedCell({ row: actualRow, col });
      setSelectionRange(normalizeRange(actualRow, col, actualRow, col));
    },
    [translateRowIndex]
  );

  // Handle range selection from RevoGrid
  const handleSetRange = useCallback(
    (event: RevoGridCustomEvent<{
      type: string;
      area?: { x: number; y: number; x1: number; y1: number };
      x?: number; y?: number; x1?: number; y1?: number;
    } | null>) => {
      console.log('[CSV] handleSetRange event:', event.detail);
      if (!event.detail) return;

      // RevoGrid sometimes puts coords in area, sometimes directly on detail
      const x = event.detail.area?.x ?? event.detail.x;
      const y = event.detail.area?.y ?? event.detail.y;
      const x1 = event.detail.area?.x1 ?? event.detail.x1;
      const y1 = event.detail.area?.y1 ?? event.detail.y1;

      if (x === undefined || y === undefined || x1 === undefined || y1 === undefined) return;

      // Determine if the selection is in pinned rows
      // Range selections in RevoGrid don't cross pinned/unpinned boundaries typically
      const isPinned = event.detail.type === 'rowPinStart';
      const actualY = translateRowIndex(y, isPinned);
      const actualY1 = translateRowIndex(y1, isPinned);

      const newRange = normalizeRange(actualY, x, actualY1, x1);
      console.log('[CSV] Setting selection from range:', newRange);

      setSelectedCell({ row: actualY, col: x });
      setSelectionRange(newRange);

      // Update refs immediately so capture handlers have fresh values
      selectedCellRef.current = { row: actualY, col: x };
      selectionRangeRef.current = newRange;
    },
    [translateRowIndex]
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

  // Intercept RevoGrid's built-in sorting to use our sort logic
  const handleBeforeSorting = useCallback(
    (event: RevoGridCustomEvent<{
      column?: { prop?: string };
      order?: 'asc' | 'desc';
    } | null>) => {
      // Prevent RevoGrid's default sorting
      event.preventDefault();

      if (!event.detail) return;

      const { column, order } = event.detail;
      if (!column?.prop || !order) return;

      // Find the column index from the prop (column letter)
      const colIndex = generateColumnHeaders(displayColumnCount).indexOf(column.prop);
      if (colIndex >= 0) {
        console.log(`[CSV] Column header sort: column ${column.prop} (index ${colIndex}), direction ${order}`);
        spreadsheet.sortByColumn(colIndex, order);
      }
    },
    [spreadsheet, displayColumnCount]
  );

  // Context menu handler
  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const container = gridContainerRef.current;
    if (!container) return;

    const target = event.target as HTMLElement;
    const rect = container.getBoundingClientRect();

    // Check if clicking on a column header
    // RevoGrid column headers are in revogr-header elements with data-rgcol attribute
    const columnHeader = target.closest('revogr-header [data-rgcol]') as HTMLElement | null;
    if (columnHeader) {
      const colIndex = parseInt(columnHeader.dataset.rgcol || '', 10);
      if (!isNaN(colIndex)) {
        setContextMenu({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          isRowHeader: false,
          rowIndex: null,
          isColumnHeader: true,
          colIndex,
        });
        return;
      }
    }

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
          isColumnHeader: false,
          colIndex: null,
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
      isColumnHeader: false,
      colIndex: null,
    });
  }, [spreadsheet.data.columnCount, selectionRange]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Capture listener for Cmd+S and Cmd+V to intercept before RevoGrid
  // Only handles keys when focus is within the spreadsheet editor
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const handleCapture = (event: KeyboardEvent) => {
      // Don't handle if a dialog is open or editor is inactive
      // Use synchronous isDialogOpen() check instead of dialogOpen state
      // because state updates are async and can miss the first keystroke
      if (isDialogOpen() || !isActive) {
        return;
      }

      // Only handle events that originated within this editor
      const target = event.target as HTMLElement | null;
      const isTargetInEditor = target && editor.contains(target);

      // Also check active element for safety
      const activeEl = document.activeElement as HTMLElement | null;
      const isActiveInEditor = activeEl && editor.contains(activeEl);

      // Ignore if the event didn't originate from this editor
      if (!isTargetInEditor && !isActiveInEditor) {
        return;
      }

      // Check if focus is on an input/textarea (could be editing a cell in RevoGrid, which is fine)
      // But if it's an input outside of RevoGrid's cell editing, ignore
      const isNonGridInput = (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA') &&
        !activeEl?.closest('revo-grid');

      if (isNonGridInput) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      if (!cmdOrCtrl) return;

      const key = event.key.toLowerCase();

      // Handle Cmd+S - dispatch to window for app save handler
      if (key === 's') {
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

      // Handle Cmd+C - copy
      const currentSelection = selectionRangeRef.current;
      if (key === 'c' && currentSelection) {
        event.preventDefault();
        event.stopPropagation();
        spreadsheet.copySelection(currentSelection);
        return;
      }

      // Handle Cmd+X - cut
      if (key === 'x' && currentSelection) {
        event.preventDefault();
        event.stopPropagation();
        spreadsheet.cutSelection(currentSelection);
        return;
      }

      // Handle Cmd+V - paste from system clipboard
      const currentCell = selectedCellRef.current;
      if (key === 'v') {
        event.preventDefault();
        event.stopPropagation();

        if (!currentCell) {
          return;
        }

        navigator.clipboard.readText().then(text => {
          if (text) {
            spreadsheet.pasteFromText(currentCell.row, currentCell.col, text);
          }
        }).catch(() => {
          // Clipboard access denied - nothing to do
        });
        return;
      }

      // Handle Cmd+Z - undo
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        spreadsheet.undo();
        return;
      }

      // Handle Cmd+Shift+Z - redo
      if (key === 'z' && event.shiftKey) {
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
  }, [spreadsheet, isActive, isDialogOpen]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Don't handle keys if not active
      if (!isActive) return;

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
              navigator.clipboard.readText().then(text => {
                if (text) {
                  spreadsheet.pasteFromText(selectedCell.row, selectedCell.col, text);
                }
              }).catch(() => {
                // Clipboard access denied - nothing to do
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
    [spreadsheet, selectedCell, selectionRange, isActive]
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

  // Build column header context menu items
  const getColumnHeaderContextMenuItems = useCallback((colIndex: number): ContextMenuItem[] => {
    const colLetter = columnIndexToLetter(colIndex);
    return [
      {
        label: `Sort ${colLetter} A → Z`,
        action: () => {
          console.log(`[CSV] Context menu sort: column ${colLetter} (index ${colIndex}), direction asc`);
          spreadsheet.sortByColumn(colIndex, 'asc');
        },
      },
      {
        label: `Sort ${colLetter} Z → A`,
        action: () => {
          console.log(`[CSV] Context menu sort: column ${colLetter} (index ${colIndex}), direction desc`);
          spreadsheet.sortByColumn(colIndex, 'desc');
        },
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Insert Column Left',
        action: () => spreadsheet.addColumn(colIndex),
      },
      {
        label: 'Insert Column Right',
        action: () => spreadsheet.addColumn(colIndex + 1),
      },
      {
        label: 'Delete Column',
        action: () => {
          spreadsheet.deleteColumn(colIndex);
          setSelectedCell(null);
          setSelectionRange(null);
        },
        disabled: spreadsheet.data.columnCount <= 1,
      },
    ];
  }, [spreadsheet]);

  // Build context menu items
  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
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
          if (selectedCell) {
            navigator.clipboard.readText().then(text => {
              if (text) {
                spreadsheet.pasteFromText(selectedCell.row, selectedCell.col, text);
              }
            }).catch(() => {
              // Clipboard access denied
            });
          }
        },
        disabled: !hasSelection,
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
    if (contextMenu.isColumnHeader && contextMenu.colIndex !== null) {
      return getColumnHeaderContextMenuItems(contextMenu.colIndex);
    }
    if (contextMenu.isRowHeader && contextMenu.rowIndex !== null) {
      return getRowHeaderContextMenuItems(contextMenu.rowIndex);
    }
    return getContextMenuItems();
  }, [contextMenu, getContextMenuItems, getRowHeaderContextMenuItems, getColumnHeaderContextMenuItems]);

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
      <div
        ref={gridContainerRef}
        className="spreadsheet-grid-container"
        // Use inert attribute to completely disable focus/interaction when dialog is open
        {...(dialogOpen ? { inert: '' } : {})}
        style={!isActive ? { pointerEvents: 'none' } : undefined}
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
          pinnedTopSource={pinnedTopSource}
          theme={theme === 'light' ? 'default' : 'darkCompact'}
          rowHeaders={true}
          resize={true}
          autoSizeColumn={false}
          range={true}
          rowClass="_rowClass"
          onBeforeeditstart={handleBeforeEdit}
          onAfteredit={handleAfterEdit}
          onAfterfocus={handleFocusCell}
          onSetrange={handleSetRange}
          onBeforecellfocus={handleCellClick}
          onBeforesorting={handleBeforeSorting}
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
