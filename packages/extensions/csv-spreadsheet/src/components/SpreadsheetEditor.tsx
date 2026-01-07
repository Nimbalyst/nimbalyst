/**
 * SpreadsheetEditor Component
 *
 * The main editor component for CSV files. Integrates with Nimbalyst's
 * custom editor system and provides a spreadsheet-like editing experience.
 *
 * Architecture:
 * - RevoGrid is the single source of truth for cell data
 * - useSpreadsheetMetadata manages only metadata (headers, frozen cols, formats)
 * - UndoRedoPlugin handles undo/redo via RevoGrid events
 * - gridOperations provides centralized cell operations
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { RevoGrid, type RevoGridCustomEvent, type ColumnRegular } from '@revolist/react-datagrid';
import type { RevoGridElement } from '../revogrid-types';
import type { EditorHostProps, NormalizedSelectionRange, ColumnFormat } from '../types';
import { useSpreadsheetMetadata } from '../hooks/useSpreadsheetMetadata';
import { createGridOperations, type GridOperations } from '../utils/gridOperations';
import { UndoRedoPlugin } from '../plugins/UndoRedoPlugin';
import { columnIndexToLetter, columnLetterToIndex, generateColumnHeaders, parseCSV } from '../utils/csvParser';
import { isFormula } from '../utils/formulaEngine';
import { getColumnTypeName } from '../utils/formatters';
import { FormulaBar, type FormulaBarHandle } from './FormulaBar';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { ColumnFormatDialog } from './ColumnFormatDialog';
import { registerEditorStore, unregisterEditorStore } from '../aiTools';
import { SheetsTextEditor } from '../editors/SheetsTextEditor';

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
 * Get CSS class for column alignment based on format type
 */
function getColumnAlignmentClass(format: ColumnFormat | undefined): string {
  if (!format) return '';
  switch (format.type) {
    case 'number':
    case 'currency':
    case 'percentage':
      return 'cell-align-right';
    case 'date':
      return 'cell-align-center';
    case 'text':
    default:
      return '';
  }
}

/**
 * Generate column definitions for RevoGrid
 */
function generateColumns(
  columnCount: number,
  frozenColumnCount: number = 0,
  columnFormats: Record<number, ColumnFormat> = {}
): ColumnRegular[] {
  const columnHeaders = generateColumnHeaders(columnCount);

  return columnHeaders.map((letter, index) => {
    const format = columnFormats[index];
    const alignClass = getColumnAlignmentClass(format);

    return {
      prop: letter,
      name: letter,
      size: 120,
      editor: 'sheets',
      ...(index < frozenColumnCount ? { pin: 'colPinStart' as const } : {}),
      ...(alignClass ? { cellProperties: () => ({ class: { [alignClass]: true } }) } : {}),
    };
  });
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

export function SpreadsheetEditor({ host }: EditorHostProps) {
  const { filePath, theme, isActive } = host;

  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);

  // Metadata hook (manages headers, frozen cols, formats - NOT cell data)
  const spreadsheetMeta = useSpreadsheetMetadata('', filePath, {
    onDirtyChange: host.setDirty,
  });

  // Refs
  const editorRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const revoGridRef = useRef<RevoGridElement | null>(null);
  const formulaBarRef = useRef<FormulaBarHandle>(null);
  const undoPluginRef = useRef<UndoRedoPlugin | null>(null);
  const gridOpsRef = useRef<GridOperations | null>(null);
  const hasLoadedRef = useRef(false);

  // Selection state (refs to avoid re-renders)
  const selectedCellRef = useRef<{ row: number; col: number } | null>(null);
  const selectionRangeRef = useRef<NormalizedSelectionRange | null>(null);

  // Grid source state (set once on load, updated on external changes)
  const [gridSource, setGridSource] = useState<Record<string, string | number>[]>([]);
  const [gridPinnedTop, setGridPinnedTop] = useState<Record<string, string | number>[]>([]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    isRowHeader: boolean;
    rowIndex: number | null;
    isColumnHeader: boolean;
    colIndex: number | null;
  } | null>(null);

  // Header drag selection state
  const [headerDrag, setHeaderDrag] = useState<{
    type: 'row' | 'column';
    startIndex: number;
    currentIndex: number;
  } | null>(null);
  const headerDragRef = useRef(headerDrag);
  headerDragRef.current = headerDrag;

  // Column format dialog state
  const [formatDialogColumn, setFormatDialogColumn] = useState<number | null>(null);

  // Stable editors object
  const editors = useMemo(() => ({ sheets: SheetsTextEditor }), []);

  // Display dimensions
  const displayColumnCount = spreadsheetMeta.metadata.columnCount + DISPLAY_BUFFER_COLS;
  const frozenColumnCount = spreadsheetMeta.metadata.frozenColumnCount;
  const columnFormats = spreadsheetMeta.metadata.columnFormats;
  const headerRowCount = spreadsheetMeta.metadata.headerRowCount;

  // Memoized column definitions
  const columns = useMemo(
    () => generateColumns(displayColumnCount, frozenColumnCount, columnFormats),
    [displayColumnCount, frozenColumnCount, columnFormats]
  );

  // Theme for RevoGrid
  const gridTheme = useMemo(
    () => (theme === 'light' ? 'default' : 'darkCompact') as 'default' | 'darkCompact',
    [theme]
  );

  // Initialize grid operations when grid is ready
  useEffect(() => {
    if (!revoGridRef.current) return;

    let plugin: UndoRedoPlugin | null = null;

    // Create undo plugin (get providers asynchronously)
    revoGridRef.current.getProviders().then((providers) => {
      if (!revoGridRef.current) return;
      plugin = new UndoRedoPlugin(revoGridRef.current, providers || {} as any, {
        onStateChange: () => {
          // Could update UI here if needed
        },
      });
      undoPluginRef.current = plugin;
    });

    // Create grid operations - use undoPluginRef instead of local plugin
    const gridOps = createGridOperations(revoGridRef, {
      getHeaderRowCount: () => spreadsheetMeta.metadata.headerRowCount,
      getColumnCount: () => spreadsheetMeta.metadata.columnCount,
      getDelimiter: () => spreadsheetMeta.delimiter,
      getColumnFormats: () => spreadsheetMeta.metadata.columnFormats,
      getFrozenColumnCount: () => spreadsheetMeta.metadata.frozenColumnCount,
      onDirty: () => host.setDirty(true),
      undoPlugin: undoPluginRef.current,
    });
    gridOpsRef.current = gridOps;

    return () => {
      if (plugin) {
        plugin.destroy();
      }
      undoPluginRef.current = null;
      gridOpsRef.current = null;
    };
  }, [revoGridRef.current, spreadsheetMeta.metadata, spreadsheetMeta.delimiter, host]);

  // Load content on mount
  useEffect(() => {
    if (hasLoadedRef.current) return;

    let mounted = true;

    host.loadContent()
      .then((content) => {
        if (!mounted) return;
        hasLoadedRef.current = true;

        // Parse content and set grid data
        const { data } = parseCSV(content);
        const gridData = convertToGridSource(data.rows, data.headerRowCount);

        setGridSource(gridData.source);
        setGridPinnedTop(gridData.pinnedTop);

        // Update metadata
        spreadsheetMeta.loadFromCSV(content);
        spreadsheetMeta.markClean();
        setIsLoading(false);
      })
      .catch((error) => {
        if (!mounted) return;
        hasLoadedRef.current = true;
        console.error('[CSV] Failed to load content:', error);
        setLoadError(error);
        setIsLoading(false);
      });

    return () => { mounted = false; };
  }, [host]);

  // Subscribe to file change notifications
  useEffect(() => {
    return host.onFileChanged((newContent) => {
      // Check if this is just an echo of our own save
      if (spreadsheetMeta.contentMatchesDisk(newContent)) {
        console.log('[CSV] File change notification ignored - disk content unchanged');
        return;
      }

      // External change detected - reload
      console.log('[CSV] External file change detected, reloading');
      const gridData = spreadsheetMeta.loadFromCSV(newContent);
      setGridSource(gridData.source);
      setGridPinnedTop(gridData.pinnedTop);
      spreadsheetMeta.markClean();
    });
  }, [host, spreadsheetMeta]);

  // Subscribe to save requests
  useEffect(() => {
    return host.onSaveRequested(async () => {
      try {
        const gridOps = gridOpsRef.current;
        if (!gridOps) {
          console.warn('[CSV] Grid operations not available for save');
          return;
        }

        // Generate CSV from RevoGrid's current data
        const content = await gridOps.toCSV();

        // Update disk content and mark clean BEFORE saving to prevent
        // file watcher from seeing isDirty=true when it fires after the write
        spreadsheetMeta.updateDiskContent(content);
        spreadsheetMeta.markClean();
        host.setDirty(false);

        // Now save the content
        await host.saveContent(content);
        console.log('[CSV] Saved');
      } catch (error) {
        console.error('[CSV] Save failed:', error);
        // If save fails, mark dirty again
        spreadsheetMeta.markDirty();
        host.setDirty(true);
      }
    });
  }, [host, spreadsheetMeta]);

  // Register for AI tool access
  useEffect(() => {
    // Create a compatibility layer for AI tools
    const compatStore = {
      data: {
        rows: [], // Would need to read from grid
        columnCount: spreadsheetMeta.metadata.columnCount,
        headerRowCount: spreadsheetMeta.metadata.headerRowCount,
        hasHeaders: spreadsheetMeta.metadata.hasHeaders,
        frozenColumnCount: spreadsheetMeta.metadata.frozenColumnCount,
        columnFormats: spreadsheetMeta.metadata.columnFormats,
      },
      isDirty: spreadsheetMeta.isDirty,
      delimiter: spreadsheetMeta.delimiter,
      // Note: AI tools integration would need updates to work with new architecture
    };
    registerEditorStore(filePath, compatStore as any);
    return () => unregisterEditorStore(filePath);
  }, [filePath, spreadsheetMeta]);

  /**
   * Convert parsed CSV rows to RevoGrid source format
   */
  function convertToGridSource(
    rows: { raw: string; computed: string | number | null; error?: string }[][],
    headerRowCount: number
  ): { source: Record<string, string | number>[]; pinnedTop: Record<string, string | number>[] } {
    const columnCount = rows[0]?.length ?? 0;

    // Pinned (header) rows
    const pinnedTop: Record<string, string | number>[] = [];
    for (let rowIndex = 0; rowIndex < headerRowCount && rowIndex < rows.length; rowIndex++) {
      const rowData: Record<string, string | number> = {};
      const row = rows[rowIndex];
      for (let c = 0; c < columnCount + DISPLAY_BUFFER_COLS; c++) {
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
      pinnedTop.push(rowData);
    }

    // Regular (data) rows
    const dataRows = rows.slice(headerRowCount);
    const source: Record<string, string | number>[] = [];

    for (let rowIndex = 0; rowIndex < dataRows.length + DISPLAY_BUFFER_ROWS; rowIndex++) {
      const rowData: Record<string, string | number> = {};
      const row = dataRows[rowIndex];
      for (let c = 0; c < columnCount + DISPLAY_BUFFER_COLS; c++) {
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
      source.push(rowData);
    }

    return { source, pinnedTop };
  }

  /**
   * Translate row index from RevoGrid to logical row index
   */
  const translateRowIndex = useCallback((gridRowIndex: number, isPinned: boolean): number => {
    if (isPinned) {
      return gridRowIndex;
    }
    return gridRowIndex + headerRowCount;
  }, [headerRowCount]);

  /**
   * Update selection refs and formula bar
   */
  const updateSelection = useCallback(async (
    cell: { row: number; col: number } | null,
    range: NormalizedSelectionRange | null
  ) => {
    selectedCellRef.current = cell;
    selectionRangeRef.current = range;

    if (cell && formulaBarRef.current) {
      // Read value from RevoGrid
      const gridOps = gridOpsRef.current;
      if (gridOps) {
        const value = await gridOps.getCellRawValue(cell.row, cell.col);
        const cellRef = range ? formatSelectionRef(range) : '';
        formulaBarRef.current.update(cellRef, value, isFormula(value));
      }
    } else if (formulaBarRef.current) {
      formulaBarRef.current.update('', '', false);
    }
  }, []);

  // Handle after edit - just mark dirty, RevoGrid owns the data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleAfterEdit = useCallback(
    (event: RevoGridCustomEvent<any>) => {
      if (!event.detail) return;
      host.setDirty(true);
    },
    [host]
  );

  // Handle cell focus (selection)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleFocusCell = useCallback(
    (event: RevoGridCustomEvent<any>) => {
      if (!event.detail) return;
      const { rowIndex, colIndex, type } = event.detail;

      const isPinned = type === 'rowPinStart';
      const actualRowIndex = translateRowIndex(rowIndex, isPinned);

      const newCell = { row: actualRowIndex, col: colIndex };
      const newRange = normalizeRange(actualRowIndex, colIndex, actualRowIndex, colIndex);

      updateSelection(newCell, newRange);
    },
    [translateRowIndex, updateSelection]
  );

  // Handle cell click as backup for selection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleCellClick = useCallback(
    (event: RevoGridCustomEvent<any>) => {
      if (!event.detail) return;
      const { row, col, type } = event.detail;

      const isPinned = type === 'rowPinStart';
      const actualRow = translateRowIndex(row, isPinned);

      updateSelection({ row: actualRow, col }, normalizeRange(actualRow, col, actualRow, col));
    },
    [translateRowIndex, updateSelection]
  );

  // Handle range selection
  const handleSetRange = useCallback(
    (event: RevoGridCustomEvent<{
      type: string;
      area?: { x: number; y: number; x1: number; y1: number };
      x?: number; y?: number; x1?: number; y1?: number;
    } | null>) => {
      if (!event.detail) return;

      const x = event.detail.area?.x ?? event.detail.x;
      const y = event.detail.area?.y ?? event.detail.y;
      const x1 = event.detail.area?.x1 ?? event.detail.x1;
      const y1 = event.detail.area?.y1 ?? event.detail.y1;

      if (x === undefined || y === undefined || x1 === undefined || y1 === undefined) return;

      const isPinned = event.detail.type === 'rowPinStart';
      const actualY = translateRowIndex(y, isPinned);
      const actualY1 = translateRowIndex(y1, isPinned);

      const newRange = normalizeRange(actualY, x, actualY1, x1);
      updateSelection({ row: actualY, col: x }, newRange);
    },
    [translateRowIndex, updateSelection]
  );

  // Handle formula bar input
  const handleFormulaChange = useCallback(
    async (value: string) => {
      const cell = selectedCellRef.current;
      const gridOps = gridOpsRef.current;
      if (cell && gridOps) {
        await gridOps.updateCell(cell.row, cell.col, value);
      }
    },
    []
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    async (event: React.KeyboardEvent) => {
      if (!isActive) return;

      const editor = editorRef.current;
      if (!editor || !editor.contains(document.activeElement)) return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;
      const gridOps = gridOpsRef.current;
      const undoPlugin = undoPluginRef.current;

      if (cmdOrCtrl && !event.altKey) {
        switch (event.key.toLowerCase()) {
          case 'z':
            event.preventDefault();
            if (event.shiftKey) {
              undoPlugin?.redo();
            } else {
              undoPlugin?.undo();
            }
            return;
          case 'y':
            if (!isMac) {
              event.preventDefault();
              undoPlugin?.redo();
              return;
            }
            break;
          case 'c':
            if (!event.shiftKey && selectionRangeRef.current && gridOps) {
              event.preventDefault();
              await gridOps.copySelection(selectionRangeRef.current);
            }
            return;
          case 'x':
            if (!event.shiftKey && selectionRangeRef.current && gridOps) {
              event.preventDefault();
              await gridOps.cutSelection(selectionRangeRef.current);
            }
            return;
          case 'v':
            if (!event.shiftKey && selectedCellRef.current && gridOps) {
              event.preventDefault();
              const cell = selectedCellRef.current;
              try {
                const text = await navigator.clipboard.readText();
                if (text) {
                  await gridOps.pasteFromText(cell.row, cell.col, text);
                }
              } catch {
                // Clipboard access denied
              }
            }
            return;
          case 'a':
            if (!event.shiftKey) {
              event.preventDefault();
              // Select all would need to get total row count from grid
              updateSelection(
                { row: 0, col: 0 },
                normalizeRange(0, 0, 100, spreadsheetMeta.metadata.columnCount - 1)
              );
            }
            return;
        }
      }

      // Delete/Backspace clears selection
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const activeElement = document.activeElement;
        const isEditing = activeElement?.tagName === 'INPUT' ||
                          activeElement?.getAttribute('contenteditable') === 'true';
        const range = selectionRangeRef.current;
        if (!isEditing && range && gridOps) {
          event.preventDefault();
          await gridOps.clearCells(range);
        }
      }

      // Escape clears selection
      if (event.key === 'Escape') {
        updateSelection(null, null);
      }
    },
    [isActive, updateSelection, spreadsheetMeta.metadata.columnCount]
  );

  // Context menu handler
  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const container = gridContainerRef.current;
    if (!container) return;

    const target = event.target as HTMLElement;
    const rect = container.getBoundingClientRect();

    // Check for column header click
    const columnHeader = target.closest('revogr-header [data-rgcol]') as HTMLElement | null;
    if (columnHeader) {
      const isRowHeaderArea = columnHeader.closest('.rowHeaders');
      if (isRowHeaderArea) return;

      const headerText = columnHeader.textContent?.trim() || '';
      const colIndex = columnLetterToIndex(headerText);
      if (colIndex >= 0) {
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

    // Check for row header click
    const rowHeader = target.closest('[data-rgrow]:not([data-rgcol])') as HTMLElement | null;
    if (rowHeader) {
      const rowIndex = parseInt(rowHeader.dataset.rgrow || '', 10);
      if (!isNaN(rowIndex)) {
        updateSelection({ row: rowIndex, col: 0 }, normalizeRange(rowIndex, 0, rowIndex, spreadsheetMeta.metadata.columnCount - 1));
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

    // Cell click
    const cell = target.closest('[data-rgrow][data-rgcol]') as HTMLElement | null;
    if (cell) {
      const rowIndex = parseInt(cell.dataset.rgrow || '', 10);
      const colIndex = parseInt(cell.dataset.rgcol || '', 10);

      if (!isNaN(rowIndex) && !isNaN(colIndex)) {
        const range = selectionRangeRef.current;
        const isInSelection = range &&
          rowIndex >= range.startRow && rowIndex <= range.endRow &&
          colIndex >= range.startCol && colIndex <= range.endCol;

        if (!isInSelection) {
          updateSelection({ row: rowIndex, col: colIndex }, normalizeRange(rowIndex, colIndex, rowIndex, colIndex));
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
  }, [spreadsheetMeta.metadata.columnCount, updateSelection]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Helper to get column index from header element
  const getColumnIndexFromHeader = useCallback((target: HTMLElement): number | null => {
    const headerCell = target.closest('[data-rgcol]') as HTMLElement | null;
    if (headerCell && headerCell.closest('revogr-header')) {
      const colIndex = parseInt(headerCell.dataset.rgcol || '', 10);
      if (!isNaN(colIndex)) return colIndex;
    }
    return null;
  }, []);

  // Helper to get row index from header element
  const getRowIndexFromHeader = useCallback((target: HTMLElement): number | null => {
    const cell = target.closest('[data-rgrow]') as HTMLElement | null;
    if (!cell) return null;

    const isInRowHeaders = !!cell.closest('.rowHeaders');
    if (!isInRowHeaders) return null;

    const gridRowIndex = parseInt(cell.dataset.rgrow || '', 10);
    if (isNaN(gridRowIndex)) return null;

    const viewport = cell.closest('revogr-viewport-scroll');
    const slot = viewport?.getAttribute('slot');
    const dataContainer = cell.closest('revogr-data');
    const dataType = dataContainer?.getAttribute('type');
    const isPinned = slot?.includes('rowPinStart') || dataType === 'rowPinStart';

    return isPinned ? gridRowIndex : gridRowIndex + headerRowCount;
  }, [headerRowCount]);

  // Selection helpers
  const selectColumn = useCallback((colIndex: number) => {
    const totalRows = 100; // Would need to get from grid
    updateSelection({ row: 0, col: colIndex }, normalizeRange(0, colIndex, totalRows - 1, colIndex));
    revoGridRef.current?.setCellsFocus(
      { x: colIndex, y: 0 },
      { x: colIndex, y: totalRows - 1 - headerRowCount }
    );
  }, [headerRowCount, updateSelection]);

  const selectColumnRange = useCallback((startCol: number, endCol: number) => {
    const totalRows = 100;
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    updateSelection({ row: 0, col: minCol }, normalizeRange(0, minCol, totalRows - 1, maxCol));
    revoGridRef.current?.setCellsFocus(
      { x: minCol, y: 0 },
      { x: maxCol, y: totalRows - 1 - headerRowCount }
    );
  }, [headerRowCount, updateSelection]);

  const selectRow = useCallback((rowIndex: number) => {
    const totalCols = spreadsheetMeta.metadata.columnCount;
    updateSelection({ row: rowIndex, col: 0 }, normalizeRange(rowIndex, 0, rowIndex, totalCols - 1));

    if (rowIndex < headerRowCount) {
      revoGridRef.current?.setCellsFocus(
        { x: 0, y: rowIndex },
        { x: totalCols - 1, y: rowIndex },
        undefined,
        'rowPinStart'
      );
    } else {
      const gridRowIndex = rowIndex - headerRowCount;
      revoGridRef.current?.setCellsFocus(
        { x: 0, y: gridRowIndex },
        { x: totalCols - 1, y: gridRowIndex }
      );
    }
  }, [spreadsheetMeta.metadata.columnCount, headerRowCount, updateSelection]);

  const selectRowRange = useCallback((startRow: number, endRow: number) => {
    const totalCols = spreadsheetMeta.metadata.columnCount;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    updateSelection({ row: minRow, col: 0 }, normalizeRange(minRow, 0, maxRow, totalCols - 1));

    if (maxRow < headerRowCount) {
      revoGridRef.current?.setCellsFocus(
        { x: 0, y: minRow },
        { x: totalCols - 1, y: maxRow },
        undefined,
        'rowPinStart'
      );
    } else if (minRow >= headerRowCount) {
      const gridMinRow = minRow - headerRowCount;
      const gridMaxRow = maxRow - headerRowCount;
      revoGridRef.current?.setCellsFocus(
        { x: 0, y: gridMinRow },
        { x: totalCols - 1, y: gridMaxRow }
      );
    }
  }, [spreadsheetMeta.metadata.columnCount, headerRowCount, updateSelection]);

  // Header mouse handlers
  const handleHeaderMouseDown = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;

    const colIndex = getColumnIndexFromHeader(target);
    if (colIndex !== null) {
      event.preventDefault();
      selectColumn(colIndex);
      setHeaderDrag({ type: 'column', startIndex: colIndex, currentIndex: colIndex });
      return;
    }

    const rowIndex = getRowIndexFromHeader(target);
    if (rowIndex !== null) {
      event.preventDefault();
      selectRow(rowIndex);
      setHeaderDrag({ type: 'row', startIndex: rowIndex, currentIndex: rowIndex });
      return;
    }
  }, [getColumnIndexFromHeader, getRowIndexFromHeader, selectColumn, selectRow]);

  // Header drag effect
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

  // Context menu items
  const getRowHeaderContextMenuItems = useCallback((rowIndex: number): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    const gridOps = gridOpsRef.current;

    const isCurrentlyHeader = rowIndex < headerRowCount;
    const isTopRowOrAdjacentToHeader = rowIndex === 0 || rowIndex === headerRowCount;

    if (isCurrentlyHeader) {
      if (rowIndex === headerRowCount - 1) {
        items.push({
          label: 'Remove Header Row',
          action: () => spreadsheetMeta.setHeaderRowCount(headerRowCount - 1),
        });
      }
      if (headerRowCount > 1) {
        items.push({
          label: 'Remove All Header Rows',
          action: () => spreadsheetMeta.setHeaderRowCount(0),
        });
      }
    } else {
      if (isTopRowOrAdjacentToHeader) {
        items.push({
          label: 'Set as Header Row',
          action: () => spreadsheetMeta.setHeaderRowCount(rowIndex + 1),
        });
      } else {
        items.push({
          label: `Set Rows 1-${rowIndex + 1} as Headers`,
          action: () => spreadsheetMeta.setHeaderRowCount(rowIndex + 1),
        });
      }
    }

    items.push({ label: '', action: () => {}, separator: true });

    items.push({
      label: 'Insert Row Above',
      action: () => {
        gridOps?.addRow(rowIndex);
        if (rowIndex < headerRowCount) {
          spreadsheetMeta.setHeaderRowCount(headerRowCount + 1);
        }
      },
    });

    items.push({
      label: 'Insert Row Below',
      action: () => gridOps?.addRow(rowIndex + 1),
    });

    items.push({
      label: 'Delete Row',
      action: () => {
        gridOps?.deleteRow(rowIndex);
        if (rowIndex < headerRowCount) {
          spreadsheetMeta.setHeaderRowCount(Math.max(0, headerRowCount - 1));
        }
        updateSelection(null, null);
      },
    });

    return items;
  }, [spreadsheetMeta, headerRowCount, updateSelection]);

  const getColumnHeaderContextMenuItems = useCallback((colIndex: number): ContextMenuItem[] => {
    const colLetter = columnIndexToLetter(colIndex);
    const currentFrozenCount = frozenColumnCount;
    const isCurrentlyFrozen = colIndex < currentFrozenCount;
    const isAtFrozenBoundary = colIndex === 0 || colIndex === currentFrozenCount;
    const currentFormat = columnFormats[colIndex];
    const formatTypeName = currentFormat ? getColumnTypeName(currentFormat.type) : 'Text';
    const gridOps = gridOpsRef.current;

    const items: ContextMenuItem[] = [
      {
        label: `Format Column (${formatTypeName})...`,
        action: () => {
          setContextMenu(null);
          setFormatDialogColumn(colIndex);
        },
      },
      { label: '', action: () => {}, separator: true },
      {
        label: `Sort ${colLetter} A -> Z`,
        action: () => {
          gridOps?.sortByColumn(colIndex, 'asc');
          spreadsheetMeta.setSortConfig({ columnIndex: colIndex, direction: 'asc' });
        },
      },
      {
        label: `Sort ${colLetter} Z -> A`,
        action: () => {
          gridOps?.sortByColumn(colIndex, 'desc');
          spreadsheetMeta.setSortConfig({ columnIndex: colIndex, direction: 'desc' });
        },
      },
      { label: '', action: () => {}, separator: true },
    ];

    if (isCurrentlyFrozen) {
      if (colIndex === currentFrozenCount - 1) {
        items.push({
          label: 'Unfreeze Column',
          action: () => spreadsheetMeta.setFrozenColumnCount(currentFrozenCount - 1),
        });
      }
      if (currentFrozenCount > 1) {
        items.push({
          label: 'Unfreeze All Columns',
          action: () => spreadsheetMeta.setFrozenColumnCount(0),
        });
      }
    } else {
      if (isAtFrozenBoundary) {
        items.push({
          label: 'Freeze Column',
          action: () => spreadsheetMeta.setFrozenColumnCount(colIndex + 1),
        });
      } else {
        items.push({
          label: `Freeze Columns A-${colLetter}`,
          action: () => spreadsheetMeta.setFrozenColumnCount(colIndex + 1),
        });
      }
    }

    items.push({ label: '', action: () => {}, separator: true });

    items.push({
      label: 'Insert Column Left',
      action: () => {
        gridOps?.addColumn(colIndex);
        if (colIndex < currentFrozenCount) {
          spreadsheetMeta.setFrozenColumnCount(currentFrozenCount + 1);
        }
      },
    });
    items.push({
      label: 'Insert Column Right',
      action: () => gridOps?.addColumn(colIndex + 1),
    });
    items.push({
      label: 'Delete Column',
      action: () => {
        gridOps?.deleteColumn(colIndex);
        if (colIndex < currentFrozenCount) {
          spreadsheetMeta.setFrozenColumnCount(Math.max(0, currentFrozenCount - 1));
        }
        updateSelection(null, null);
      },
    });

    return items;
  }, [spreadsheetMeta, frozenColumnCount, columnFormats, updateSelection]);

  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    const cell = selectedCellRef.current;
    const range = selectionRangeRef.current;
    const hasSelection = !!cell;
    const gridOps = gridOpsRef.current;
    const cellCount = range
      ? (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1)
      : 0;
    const hasMultipleSelected = cellCount > 1;

    return [
      {
        label: hasMultipleSelected ? `Cut (${cellCount} cells)` : 'Cut',
        action: () => {
          if (range && gridOps) gridOps.cutSelection(range);
        },
        disabled: !hasSelection,
      },
      {
        label: hasMultipleSelected ? `Copy (${cellCount} cells)` : 'Copy',
        action: () => {
          if (range && gridOps) gridOps.copySelection(range);
        },
        disabled: !hasSelection,
      },
      {
        label: 'Paste',
        action: () => {
          if (cell && gridOps) {
            navigator.clipboard.readText().then(text => {
              if (text) {
                gridOps.pasteFromText(cell.row, cell.col, text);
              }
            }).catch(() => {});
          }
        },
        disabled: !hasSelection,
      },
      {
        label: hasMultipleSelected ? `Clear (${cellCount} cells)` : 'Clear',
        action: () => {
          if (range && gridOps) gridOps.clearCells(range);
        },
        disabled: !hasSelection,
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Insert Row Above',
        action: () => {
          if (cell && gridOps) gridOps.addRow(cell.row);
        },
        disabled: !hasSelection,
      },
      {
        label: 'Insert Row Below',
        action: () => {
          if (cell && gridOps) gridOps.addRow(cell.row + 1);
        },
        disabled: !hasSelection,
      },
      {
        label: 'Delete Row',
        action: () => {
          if (cell && gridOps) {
            gridOps.deleteRow(cell.row);
            updateSelection(null, null);
          }
        },
        disabled: !hasSelection,
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Insert Column Left',
        action: () => {
          if (cell && gridOps) gridOps.addColumn(cell.col);
        },
        disabled: !hasSelection,
      },
      {
        label: 'Insert Column Right',
        action: () => {
          if (cell && gridOps) gridOps.addColumn(cell.col + 1);
        },
        disabled: !hasSelection,
      },
      {
        label: 'Delete Column',
        action: () => {
          if (cell && gridOps) {
            gridOps.deleteColumn(cell.col);
            updateSelection(null, null);
          }
        },
        disabled: !hasSelection,
      },
    ];
  }, [updateSelection]);

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

  // Render loading state
  if (isLoading) {
    return (
      <div className="spreadsheet-editor" data-theme={theme}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-secondary)',
        }}>
          Loading spreadsheet...
        </div>
      </div>
    );
  }

  // Render error state
  if (loadError) {
    return (
      <div className="spreadsheet-editor" data-theme={theme}>
        <div style={{
          padding: '20px',
          color: 'var(--text-primary)',
          backgroundColor: 'var(--surface-primary)',
        }}>
          <h3 style={{ color: 'var(--text-primary)' }}>Error Loading Spreadsheet</h3>
          <p style={{ color: 'var(--text-secondary)' }}>{loadError.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={editorRef}
      className="spreadsheet-editor"
      data-theme={theme}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="spreadsheet-toolbar">
        <FormulaBar
          ref={formulaBarRef}
          onChange={handleFormulaChange}
        />
        {host.supportsSourceMode && (
          <button
            className="source-mode-button"
            onClick={() => host.toggleSourceMode?.()}
            title="View raw CSV source"
          >
            View Source
          </button>
        )}
      </div>
      <div
        ref={gridContainerRef}
        className="spreadsheet-grid-container"
        tabIndex={0}
        {...(!isActive ? { inert: '' } : {})}
        data-is-active={isActive}
        onContextMenu={handleContextMenu}
        onMouseDown={handleHeaderMouseDown}
      >
        <RevoGrid
          ref={revoGridRef}
          columns={columns}
          source={gridSource}
          pinnedTopSource={gridPinnedTop}
          theme={gridTheme}
          rowHeaders={true}
          resize={true}
          autoSizeColumn={false}
          range={true}
          applyOnClose={true}
          editors={editors}
          rowClass="_rowClass"
          onAfteredit={handleAfterEdit}
          onAfterfocus={handleFocusCell}
          onSetrange={handleSetRange as any}
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

      <ColumnFormatDialog
        isOpen={formatDialogColumn !== null}
        columnIndex={formatDialogColumn ?? 0}
        columnLetter={formatDialogColumn !== null ? columnIndexToLetter(formatDialogColumn) : ''}
        currentFormat={formatDialogColumn !== null ? columnFormats[formatDialogColumn] : undefined}
        onSave={(format) => {
          if (formatDialogColumn !== null) {
            spreadsheetMeta.setColumnFormat(formatDialogColumn, format);
          }
        }}
        onClose={() => setFormatDialogColumn(null)}
      />
    </div>
  );
}
