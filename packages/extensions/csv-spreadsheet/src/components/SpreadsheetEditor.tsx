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
 * @param columnCount Total number of columns to generate
 * @param frozenColumnCount Number of columns to pin on the left (frozen)
 */
function generateColumns(columnCount: number, frozenColumnCount: number = 0): ColumnRegular[] {
  const columnHeaders = generateColumnHeaders(columnCount);

  return columnHeaders.map((letter, index) => ({
    prop: letter,
    name: letter,
    size: 120,
    // Pin columns that are within the frozen count
    ...(index < frozenColumnCount ? { pin: 'colPinStart' as const } : {}),
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

  // Track timestamp of last blocked Cmd+key - used to block edit mode and input events
  const lastCmdKeyBlockedRef = useRef(0);

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
  const revoGridRef = useRef<HTMLRevoGridElement | null>(null);

  // Header drag selection state
  const [headerDrag, setHeaderDrag] = useState<{
    type: 'row' | 'column';
    startIndex: number;
    currentIndex: number;
  } | null>(null);
  const headerDragRef = useRef(headerDrag);
  headerDragRef.current = headerDrag;

  // Register getContent function for saving
  // When this is called, the host is about to save our content to disk
  // We update our disk content tracker so we can ignore the subsequent file watcher notification
  const getContent = useCallback(() => {
    const content = spreadsheet.toCSV();
    // Update our record of what will be on disk after this save
    spreadsheet.updateDiskContent(content);
    return content;
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

  // Handle notification of external file change (e.g., when AI agent edits the file)
  // We compare against BOTH the last known disk content AND the current editor content
  // This prevents clobbering user edits when file watcher fires after our own save
  // OR when another tab of the same file saves
  const handleReloadContent = useCallback(
    (newContent: string) => {
      try {
        // Check 1: Compare against what we last knew was on disk
        if (spreadsheet.contentMatchesDisk(newContent)) {
          console.log(`[CSV] File change notification ignored - disk content unchanged`);
          return;
        }

        // Check 2: Compare against our CURRENT content (serialized)
        // This catches the case where another tab saved the same file - if our current
        // content matches what's now on disk, we don't need to reload
        const currentContent = spreadsheet.toCSV();
        if (currentContent === newContent) {
          console.log(`[CSV] File change notification ignored - matches current content`);
          // Update our disk reference since we now know this is what's on disk
          spreadsheet.updateDiskContent(newContent);
          return;
        }

        // Content is actually different - this is a real external change (e.g., AI edit)
        console.log(`[CSV] External file change detected, reloading (${newContent.length} bytes)`);
        spreadsheet.loadFromCSV(newContent);
        spreadsheet.markClean();
        setSelectedCell(null);
        setSelectionRange(null);
        console.log('[CSV] Content reload complete');
      } catch (error) {
        console.error('[CSV] Failed to reload content:', error);
        // Don't throw - the editor should remain functional even if reload fails
      }
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

  // Frozen column count (columns pinned on the left)
  const frozenColumnCount = spreadsheet.data.frozenColumnCount || 0;

  // Memoized grid data
  const columns = useMemo(
    () => generateColumns(displayColumnCount, frozenColumnCount),
    [displayColumnCount, frozenColumnCount]
  );

  const headerRowCount = spreadsheet.data.headerRowCount || 0;

  const source = useMemo(
    () => {
      const result = toGridSource(spreadsheet.data.rows, spreadsheet.data.columnCount, headerRowCount, displayColumnCount);
      console.log('[CSV source] Recomputed, row 9:', result[9 - headerRowCount]?.A, result[9 - headerRowCount]?.B);
      return result;
    },
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

  // Handle before edit - inject raw value for formulas and BLOCK edit if Cmd is held
  const handleBeforeEdit = useCallback(
    (event: RevoGridCustomEvent<{
      rowIndex?: number;
      colIndex?: number;
      prop?: string;
      val?: unknown;
      model?: Record<string, unknown>;
      type?: string;
    } | null>) => {
      // CRITICAL: Block edit mode if triggered within 100ms of a Cmd+key press
      // This prevents RevoGrid from opening edit mode when user presses Cmd+F, Cmd+K, etc.
      const timeSinceBlock = Date.now() - lastCmdKeyBlockedRef.current;
      if (timeSinceBlock < 100) {
        event.preventDefault();
        return;
      }

      if (!event.detail) return;

      const { rowIndex, prop, type } = event.detail;
      if (rowIndex === undefined || prop === undefined) return;

      // Determine if this is a pinned row edit
      const isPinned = type === 'rowPinStart';
      const actualRowIndex = translateRowIndex(rowIndex, isPinned);

      const colIndex = columnIndexToLetter(0) === prop ? 0 :
        generateColumnHeaders(displayColumnCount).indexOf(prop);

      if (colIndex < 0) return;

      // Get the raw value from our data - this ensures the edit starts with our current value
      const cell = spreadsheet.data.rows[actualRowIndex]?.[colIndex];
      const ourValue = cell?.raw ?? '';
      const modelValue = event.detail.model?.[prop];

      console.log('[CSV handleBeforeEdit] row:', actualRowIndex, 'col:', colIndex, 'ourValue:', ourValue, 'modelValue:', modelValue);

      // ALWAYS sync the model with our data to prevent stale values
      if (event.detail.model && modelValue !== ourValue) {
        console.log('[CSV handleBeforeEdit] FIXING stale model value');
        event.detail.model[prop] = ourValue;
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

      console.log('[CSV handleAfterEdit] rowIndex:', rowIndex, 'prop:', prop, 'value:', value, 'model:', detail.model);

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
      if (!event.detail) return;
      const { rowIndex, colIndex, type } = event.detail;

      // Translate row index based on whether it's from pinned rows
      const isPinned = type === 'rowPinStart';
      const actualRowIndex = translateRowIndex(rowIndex, isPinned);

      const newCell = { row: actualRowIndex, col: colIndex };
      const newRange = normalizeRange(actualRowIndex, colIndex, actualRowIndex, colIndex);

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
      if (!event.detail) return;
      const { row, col, type } = event.detail;

      // Translate row index based on whether it's from pinned rows
      const isPinned = type === 'rowPinStart';
      const actualRow = translateRowIndex(row, isPinned);

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

  // Helper to get column index from a column header element
  const getColumnIndexFromHeader = useCallback((target: HTMLElement): number | null => {
    // Column headers have data-rgcol attribute
    const headerCell = target.closest('[data-rgcol]') as HTMLElement | null;
    if (headerCell && headerCell.closest('revogr-header')) {
      const colIndex = parseInt(headerCell.dataset.rgcol || '', 10);
      if (!isNaN(colIndex)) return colIndex;
    }
    return null;
  }, []);

  // Helper to get row index from a row header element
  // Returns the DATA row index (not grid row index), accounting for header rows
  const getRowIndexFromHeader = useCallback((target: HTMLElement): number | null => {
    // Find the cell with data-rgrow attribute
    const cell = target.closest('[data-rgrow]') as HTMLElement | null;
    if (!cell) return null;

    // Must be in row headers area (either regular or pinned)
    const isInRowHeaders = !!cell.closest('.rowHeaders');
    if (!isInRowHeaders) return null;

    const gridRowIndex = parseInt(cell.dataset.rgrow || '', 10);
    if (isNaN(gridRowIndex)) return null;

    // Check if this is a pinned row (header rows) by looking for various indicators
    // The pinned rows container may have different structures depending on RevoGrid version
    const viewport = cell.closest('revogr-viewport-scroll');
    const slot = viewport?.getAttribute('slot');
    const dataContainer = cell.closest('revogr-data');
    const dataType = dataContainer?.getAttribute('type');
    const isPinned = slot?.includes('rowPinStart') || dataType === 'rowPinStart';

    // Debug logging - uncomment if needed
    // console.log('[CSV] getRowIndexFromHeader:', {
    //   gridRowIndex,
    //   isPinned,
    //   slot,
    //   dataType,
    //   cellClasses: cell.className,
    // });

    // Translate grid index to data index
    if (isPinned) {
      return gridRowIndex; // Pinned rows map directly
    } else {
      return gridRowIndex + headerRowCount; // Regular rows are offset
    }
  }, [headerRowCount]);

  // Handle column header selection
  const selectColumn = useCallback((colIndex: number) => {
    const totalRows = spreadsheet.data.rows.length;
    setSelectedCell({ row: 0, col: colIndex });
    setSelectionRange(normalizeRange(0, colIndex, totalRows - 1, colIndex));
    selectedCellRef.current = { row: 0, col: colIndex };
    selectionRangeRef.current = normalizeRange(0, colIndex, totalRows - 1, colIndex);
    // Update RevoGrid's visual selection
    revoGridRef.current?.setCellsFocus(
      { x: colIndex, y: 0 },
      { x: colIndex, y: totalRows - 1 - headerRowCount }
    );
  }, [spreadsheet.data.rows.length, headerRowCount]);

  // Handle column range selection
  const selectColumnRange = useCallback((startCol: number, endCol: number) => {
    const totalRows = spreadsheet.data.rows.length;
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    setSelectedCell({ row: 0, col: minCol });
    setSelectionRange(normalizeRange(0, minCol, totalRows - 1, maxCol));
    selectedCellRef.current = { row: 0, col: minCol };
    selectionRangeRef.current = normalizeRange(0, minCol, totalRows - 1, maxCol);
    // Update RevoGrid's visual selection
    revoGridRef.current?.setCellsFocus(
      { x: minCol, y: 0 },
      { x: maxCol, y: totalRows - 1 - headerRowCount }
    );
  }, [spreadsheet.data.rows.length, headerRowCount]);

  // Handle row header selection
  const selectRow = useCallback((rowIndex: number) => {
    const totalCols = spreadsheet.data.columnCount;
    setSelectedCell({ row: rowIndex, col: 0 });
    setSelectionRange(normalizeRange(rowIndex, 0, rowIndex, totalCols - 1));
    selectedCellRef.current = { row: rowIndex, col: 0 };
    selectionRangeRef.current = normalizeRange(rowIndex, 0, rowIndex, totalCols - 1);

    // Update RevoGrid's visual selection
    if (rowIndex < headerRowCount) {
      // Pinned row - use rowPinStart type
      revoGridRef.current?.setCellsFocus(
        { x: 0, y: rowIndex },
        { x: totalCols - 1, y: rowIndex },
        undefined, // colType
        'rowPinStart' // rowType
      );
    } else {
      // Regular row - adjust index for header offset
      const gridRowIndex = rowIndex - headerRowCount;
      revoGridRef.current?.setCellsFocus(
        { x: 0, y: gridRowIndex },
        { x: totalCols - 1, y: gridRowIndex }
      );
    }
  }, [spreadsheet.data.columnCount, headerRowCount]);

  // Handle row range selection
  const selectRowRange = useCallback((startRow: number, endRow: number) => {
    const totalCols = spreadsheet.data.columnCount;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    setSelectedCell({ row: minRow, col: 0 });
    setSelectionRange(normalizeRange(minRow, 0, maxRow, totalCols - 1));
    selectedCellRef.current = { row: minRow, col: 0 };
    selectionRangeRef.current = normalizeRange(minRow, 0, maxRow, totalCols - 1);

    // Update RevoGrid's visual selection
    // Handle cases: all pinned, all regular, or mixed
    if (maxRow < headerRowCount) {
      // All rows are pinned
      revoGridRef.current?.setCellsFocus(
        { x: 0, y: minRow },
        { x: totalCols - 1, y: maxRow },
        undefined,
        'rowPinStart'
      );
    } else if (minRow >= headerRowCount) {
      // All rows are regular (not pinned)
      const gridMinRow = minRow - headerRowCount;
      const gridMaxRow = maxRow - headerRowCount;
      revoGridRef.current?.setCellsFocus(
        { x: 0, y: gridMinRow },
        { x: totalCols - 1, y: gridMaxRow }
      );
    } else {
      // Mixed: some pinned, some regular
      // RevoGrid doesn't support cross-type selection in one call, so we select both parts
      // Select pinned rows first
      revoGridRef.current?.setCellsFocus(
        { x: 0, y: minRow },
        { x: totalCols - 1, y: headerRowCount - 1 },
        undefined,
        'rowPinStart'
      );
      // Then select regular rows (this may override the pinned selection visually,
      // but our internal selectionRange tracks the full range for copy/paste)
      const gridMaxRow = maxRow - headerRowCount;
      revoGridRef.current?.setCellsFocus(
        { x: 0, y: 0 },
        { x: totalCols - 1, y: gridMaxRow }
      );
    }
  }, [spreadsheet.data.columnCount, headerRowCount]);

  // Handle mousedown on grid container for header selection
  const handleHeaderMouseDown = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;

    // Check for column header click
    const colIndex = getColumnIndexFromHeader(target);
    if (colIndex !== null) {
      event.preventDefault();
      selectColumn(colIndex);
      setHeaderDrag({ type: 'column', startIndex: colIndex, currentIndex: colIndex });
      return;
    }

    // Check for row header click
    const rowIndex = getRowIndexFromHeader(target);
    if (rowIndex !== null) {
      event.preventDefault();
      selectRow(rowIndex);
      setHeaderDrag({ type: 'row', startIndex: rowIndex, currentIndex: rowIndex });
      return;
    }
  }, [getColumnIndexFromHeader, getRowIndexFromHeader, selectColumn, selectRow]);

  // Handle mousemove for header drag selection
  useEffect(() => {
    if (!headerDrag) return;

    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const drag = headerDragRef.current;
      if (!drag) return;

      if (drag.type === 'column') {
        const colIndex = getColumnIndexFromHeader(target);
        if (colIndex !== null && colIndex !== drag.currentIndex) {
          setHeaderDrag({ ...drag, currentIndex: colIndex });
          selectColumnRange(drag.startIndex, colIndex);
        }
      } else if (drag.type === 'row') {
        const rowIndex = getRowIndexFromHeader(target);
        if (rowIndex !== null && rowIndex !== drag.currentIndex) {
          setHeaderDrag({ ...drag, currentIndex: rowIndex });
          selectRowRange(drag.startIndex, rowIndex);
        }
      }
    };

    const handleMouseUp = () => {
      setHeaderDrag(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [headerDrag, getColumnIndexFromHeader, getRowIndexFromHeader, selectColumnRange, selectRowRange]);

  // Capture listener for Cmd+S and Cmd+V to intercept before RevoGrid
  // Only handles keys when focus is within the spreadsheet editor
  // We add listeners at DOCUMENT level in capture phase to intercept before ANY element
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const handleKeydownCapture = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      // Don't handle if a dialog is open or editor is inactive
      // Use synchronous isDialogOpen() check instead of dialogOpen state
      // because state updates are async and can miss the first keystroke
      if (isDialogOpen() || !isActive) {
        return;
      }

      // Check active element
      const activeEl = document.activeElement as HTMLElement | null;

      // If focus is on an input/textarea OUTSIDE of our editor entirely, skip
      // (e.g., AI chat input, other tab's editor)
      const isExternalInput = (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA') &&
        !editor.contains(activeEl);

      if (isExternalInput) {
        return;
      }

      if (!cmdOrCtrl) return;

      const key = event.key.toLowerCase();

      // Handle Cmd+S - dispatch to window for app save handler
      if (key === 's') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 's',
          code: 'KeyS',
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          bubbles: true,
        }));
        return;
      }

      // Handle Cmd+C - copy (let browser handle in edit mode for partial cell selection)
      const currentSelection = selectionRangeRef.current;
      const isEditingCell = activeEl?.tagName === 'INPUT' && activeEl?.closest('revo-grid');
      if (key === 'c' && currentSelection && !isEditingCell) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        spreadsheet.copySelection(currentSelection);
        return;
      }

      // Handle Cmd+X - cut (let browser handle in edit mode for partial cell selection)
      if (key === 'x' && currentSelection && !isEditingCell) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        spreadsheet.cutSelection(currentSelection);
        return;
      }

      // Handle Cmd+V - paste from system clipboard (let browser handle in edit mode)
      const currentCell = selectedCellRef.current;
      if (key === 'v' && !isEditingCell) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

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
        event.stopImmediatePropagation();
        spreadsheet.undo();
        return;
      }

      // Handle Cmd+Shift+Z - redo
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        spreadsheet.redo();
        return;
      }

      // Record timestamp of Cmd+key for beforeeditstart and beforeinput handlers
      // We DON'T block the keydown itself - let it propagate to Electron menus
      // Instead, we block RevoGrid from entering edit mode via onBeforeeditstart
      // BUT: Don't block when already editing a cell - allow Cmd+A, Cmd+C, etc. to work
      if (!isEditingCell) {
        lastCmdKeyBlockedRef.current = Date.now();
      }
    };

    // Block ALL beforeinput events that immediately follow a Cmd+key press
    // Use a timestamp to track when we last blocked a Cmd+key - block inputs within 100ms
    const handleBeforeInput = (event: InputEvent) => {
      // Only care about inputs inside the spreadsheet
      const target = event.target as HTMLElement;
      if (!editor.contains(target)) return;

      const timeSinceBlock = Date.now() - lastCmdKeyBlockedRef.current;

      // Block ANY text input within 100ms of blocking a Cmd+key
      // This catches the case where RevoGrid opens edit mode on Cmd+key
      if (timeSinceBlock < 100 && event.inputType === 'insertText') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    // Add to DOCUMENT in capture phase to intercept BEFORE RevoGrid's internal input handlers
    // This is necessary because RevoGrid's edit input elements have their own keydown handlers
    document.addEventListener('keydown', handleKeydownCapture, true);
    document.addEventListener('beforeinput', handleBeforeInput, true);
    return () => {
      document.removeEventListener('keydown', handleKeydownCapture, true);
      document.removeEventListener('beforeinput', handleBeforeInput, true);
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
          // Force RevoGrid to refresh after clearing cells
          // Use setTimeout to ensure React has rendered the new source
          setTimeout(() => {
            revoGridRef.current?.refresh('all');
          }, 0);
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
    const currentFrozenCount = spreadsheet.data.frozenColumnCount || 0;
    const isCurrentlyFrozen = colIndex < currentFrozenCount;
    const isAtFrozenBoundary = colIndex === 0 || colIndex === currentFrozenCount;

    const items: ContextMenuItem[] = [
      {
        label: `Sort ${colLetter} A → Z`,
        action: () => spreadsheet.sortByColumn(colIndex, 'asc'),
      },
      {
        label: `Sort ${colLetter} Z → A`,
        action: () => spreadsheet.sortByColumn(colIndex, 'desc'),
      },
      { label: '', action: () => {}, separator: true },
    ];

    // Freeze/Unfreeze column options
    if (isCurrentlyFrozen) {
      if (colIndex === currentFrozenCount - 1) {
        items.push({
          label: 'Unfreeze Column',
          action: () => spreadsheet.setFrozenColumnCount(currentFrozenCount - 1),
        });
      }
      if (currentFrozenCount > 1) {
        items.push({
          label: 'Unfreeze All Columns',
          action: () => spreadsheet.setFrozenColumnCount(0),
        });
      }
    } else {
      if (isAtFrozenBoundary) {
        items.push({
          label: 'Freeze Column',
          action: () => spreadsheet.setFrozenColumnCount(colIndex + 1),
        });
      } else {
        items.push({
          label: `Freeze Columns A-${colLetter}`,
          action: () => spreadsheet.setFrozenColumnCount(colIndex + 1),
        });
      }
    }

    items.push({ label: '', action: () => {}, separator: true });

    items.push({
      label: 'Insert Column Left',
      action: () => {
        spreadsheet.addColumn(colIndex);
        // Adjust frozen count if inserting before frozen columns
        if (colIndex < currentFrozenCount) {
          spreadsheet.setFrozenColumnCount(currentFrozenCount + 1);
        }
      },
    });
    items.push({
      label: 'Insert Column Right',
      action: () => spreadsheet.addColumn(colIndex + 1),
    });
    items.push({
      label: 'Delete Column',
      action: () => {
        spreadsheet.deleteColumn(colIndex);
        // Adjust frozen count if deleting a frozen column
        if (colIndex < currentFrozenCount) {
          spreadsheet.setFrozenColumnCount(Math.max(0, currentFrozenCount - 1));
        }
        setSelectedCell(null);
        setSelectionRange(null);
      },
      disabled: spreadsheet.data.columnCount <= 1,
    });

    return items;
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
        onMouseDown={handleHeaderMouseDown}
        onClick={(e) => {
          // Fallback: extract cell from click target
          const target = e.target as HTMLElement;
          const cell = target.closest('[data-rgrow][data-rgcol]') as HTMLElement | null;
          if (cell) {
            const rowIndex = parseInt(cell.dataset.rgrow || '', 10);
            const colIndex = parseInt(cell.dataset.rgcol || '', 10);
            if (!isNaN(rowIndex) && !isNaN(colIndex)) {
              setSelectedCell({ row: rowIndex, col: colIndex });
              setSelectionRange(normalizeRange(rowIndex, colIndex, rowIndex, colIndex));
            }
          }
        }}
      >
        <RevoGrid
          ref={(el) => { revoGridRef.current = el as unknown as HTMLRevoGridElement; }}
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
