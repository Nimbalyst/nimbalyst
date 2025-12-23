/**
 * Hook for spreadsheet data management with undo/redo support
 * Replaces the Zustand store with a simpler approach using use-undoable
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import useUndoable from 'use-undoable';
import type { SpreadsheetData, Cell, SortDirection, SortConfig, NormalizedSelectionRange } from '../types';
import { parseCSV, serializeToCSV, createCell } from '../utils/csvParser';
import { recalculateFormulas, isFormula, evaluateFormula } from '../utils/formulaEngine';

/**
 * Normalize a selection range so start is top-left and end is bottom-right
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

/**
 * Trim trailing empty rows and columns from data for saving
 */
function trimEmptyRowsAndColumns(data: SpreadsheetData): SpreadsheetData {
  const rows = [...data.rows];

  // Find last non-empty row
  let lastNonEmptyRow = rows.length - 1;
  while (lastNonEmptyRow >= 0 && rows[lastNonEmptyRow].every(cell => cell.raw === '')) {
    lastNonEmptyRow--;
  }

  // Keep at least one row
  const trimmedRows = rows.slice(0, Math.max(1, lastNonEmptyRow + 1));

  // Find last non-empty column
  let lastNonEmptyCol = data.columnCount - 1;
  while (lastNonEmptyCol >= 0) {
    const colHasData = trimmedRows.some(row => row[lastNonEmptyCol]?.raw !== '');
    if (colHasData) break;
    lastNonEmptyCol--;
  }

  // Keep at least one column
  const newColumnCount = Math.max(1, lastNonEmptyCol + 1);

  // Trim columns from each row
  const finalRows = trimmedRows.map(row => row.slice(0, newColumnCount));

  return {
    ...data,
    rows: finalRows,
    columnCount: newColumnCount,
  };
}

/**
 * Create an empty spreadsheet with default dimensions
 */
function createEmptySpreadsheet(): SpreadsheetData {
  const rows: Cell[][] = [];
  const columnCount = 5;
  const rowCount = 10;

  for (let r = 0; r < rowCount; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < columnCount; c++) {
      row.push({ raw: '', computed: '' });
    }
    rows.push(row);
  }

  return {
    rows,
    columnCount,
    hasHeaders: false,
    headerRowCount: 0,
  };
}

export interface UseSpreadsheetDataOptions {
  onDirtyChange?: (isDirty: boolean) => void;
  onContentChange?: () => void;
}

export interface UseSpreadsheetDataResult {
  // Data
  data: SpreadsheetData;
  isDirty: boolean;
  delimiter: ',' | '\t';

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Data mutations
  updateCell: (row: number, col: number, value: string) => void;
  addRow: (index?: number) => void;
  deleteRow: (index: number) => void;
  addColumn: (index?: number) => void;
  deleteColumn: (index: number) => void;
  sortByColumn: (columnIndex: number, direction: SortDirection) => void;
  setHeaderRowCount: (count: number) => void;
  toggleHeaders: () => void;

  // Clipboard (uses system clipboard)
  copySelection: (selection: NormalizedSelectionRange) => void;
  cutSelection: (selection: NormalizedSelectionRange) => void;
  pasteFromText: (row: number, col: number, text: string) => void;
  clearCells: (selection: NormalizedSelectionRange) => void;

  // Serialization
  toCSV: () => string;
  loadFromCSV: (content: string) => void;
  markClean: () => void;

  // Sort state
  sortConfig: SortConfig | null;
}

export function useSpreadsheetData(
  initialContent: string,
  filePath: string,
  options: UseSpreadsheetDataOptions = {}
): UseSpreadsheetDataResult {
  const { onDirtyChange, onContentChange } = options;

  // Parse initial content and evaluate formulas
  const initialParse = useRef(() => {
    const parsed = parseCSV(initialContent || '');
    // Evaluate formulas on the initial data
    const dataWithFormulas = recalculateFormulas(parsed.data);
    return { ...parsed, data: dataWithFormulas };
  });
  const parsedData = useRef(initialParse.current());
  const [delimiter, setDelimiter] = useState<',' | '\t'>(parsedData.current.delimiter);

  // Main data state with undo/redo
  const [data, setData, { undo, redo, canUndo, canRedo, reset }] = useUndoable<SpreadsheetData>(
    initialContent ? parsedData.current.data : createEmptySpreadsheet()
  );

  // Non-undoable state
  const [isDirty, setIsDirty] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);

  // Track dirty state changes and notify of content changes
  const markDirty = useCallback(() => {
    console.log('[CSV markDirty] Called, isDirty:', isDirty, 'has onContentChange:', !!onContentChange);
    if (!isDirty) {
      setIsDirty(true);
      onDirtyChange?.(true);
    }
    // Always notify of content change for autosave
    console.log('[CSV markDirty] Calling onContentChange');
    onContentChange?.();
  }, [isDirty, onDirtyChange, onContentChange]);

  // Update a cell (expands data if editing beyond current bounds)
  const updateCell = useCallback((row: number, col: number, value: string) => {
    console.log('[CSV updateCell] Called with row:', row, 'col:', col, 'value:', JSON.stringify(value));
    setData(prev => {
      const newData = { ...prev };

      // Expand rows if needed
      const neededRows = row + 1;
      if (neededRows > prev.rows.length) {
        newData.rows = [...prev.rows];
        for (let r = prev.rows.length; r < neededRows; r++) {
          const newRow: Cell[] = [];
          for (let c = 0; c < prev.columnCount; c++) {
            newRow.push({ raw: '', computed: '' });
          }
          newData.rows.push(newRow);
        }
      } else {
        newData.rows = [...prev.rows];
      }

      // Expand columns if needed
      const neededCols = col + 1;
      if (neededCols > prev.columnCount) {
        newData.columnCount = neededCols;
        newData.rows = newData.rows.map(r => {
          const newRow = [...r];
          for (let c = r.length; c < neededCols; c++) {
            newRow.push({ raw: '', computed: '' });
          }
          return newRow;
        });
      }

      // Now update the specific cell
      newData.rows[row] = [...newData.rows[row]];
      const cell = createCell(value);
      if (isFormula(value)) {
        const { value: computed, error } = evaluateFormula(value, newData, row, col);
        cell.computed = computed;
        cell.error = error;
      }
      newData.rows[row][col] = cell;

      // Update headers array if editing header row
      if (row === 0 && newData.hasHeaders) {
        newData.headers = newData.rows[0].map(c => c.raw);
      }

      return recalculateFormulas(newData);
    });
    markDirty();
  }, [setData, markDirty]);

  // Add a row
  const addRow = useCallback((index?: number) => {
    setData(prev => {
      const newData = { ...prev };
      newData.rows = [...prev.rows];

      const newRow: Cell[] = [];
      for (let c = 0; c < newData.columnCount; c++) {
        newRow.push({ raw: '', computed: '' });
      }

      if (index !== undefined && index >= 0 && index <= newData.rows.length) {
        newData.rows.splice(index, 0, newRow);
      } else {
        newData.rows.push(newRow);
      }

      return newData;
    });
    markDirty();
  }, [setData, markDirty]);

  // Delete a row
  const deleteRow = useCallback((index: number) => {
    setData(prev => {
      if (prev.rows.length <= 1) return prev;

      const newData = { ...prev };
      newData.rows = [...prev.rows];
      newData.rows.splice(index, 1);

      return recalculateFormulas(newData);
    });
    markDirty();
  }, [setData, markDirty]);

  // Add a column
  const addColumn = useCallback((index?: number) => {
    setData(prev => {
      const newData = { ...prev };
      newData.rows = prev.rows.map(row => {
        const newRow = [...row];
        const newCell: Cell = { raw: '', computed: '' };

        if (index !== undefined && index >= 0 && index <= newRow.length) {
          newRow.splice(index, 0, newCell);
        } else {
          newRow.push(newCell);
        }

        return newRow;
      });
      newData.columnCount = newData.rows[0]?.length || 1;

      return newData;
    });
    markDirty();
  }, [setData, markDirty]);

  // Delete a column
  const deleteColumn = useCallback((index: number) => {
    setData(prev => {
      if (prev.columnCount <= 1) return prev;

      const newData = { ...prev };
      newData.rows = prev.rows.map(row => {
        const newRow = [...row];
        newRow.splice(index, 1);
        return newRow;
      });
      newData.columnCount = newData.rows[0]?.length || 1;

      return recalculateFormulas(newData);
    });
    markDirty();
  }, [setData, markDirty]);

  // Sort by column
  const sortByColumn = useCallback((columnIndex: number, direction: SortDirection) => {
    if (direction === null) {
      setSortConfig(null);
      return;
    }

    setData(prev => {
      const newData = { ...prev };
      const headerRowCount = newData.headerRowCount || 0;

      const headerRows = headerRowCount > 0 ? newData.rows.slice(0, headerRowCount) : [];
      const dataRows = headerRowCount > 0 ? newData.rows.slice(headerRowCount) : newData.rows;

      // Helper to check if a row is empty (all cells are empty strings)
      const isRowEmpty = (row: Cell[]): boolean => {
        return row.every(cell => cell.raw === '' && (cell.computed === '' || cell.computed === null));
      };

      // Separate non-empty rows from empty rows
      const nonEmptyRows = dataRows.filter(row => !isRowEmpty(row));
      const emptyRows = dataRows.filter(row => isRowEmpty(row));

      console.log(`[CSV sortByColumn] Sorting ${nonEmptyRows.length} non-empty rows, keeping ${emptyRows.length} empty rows at end`);

      // Only sort the non-empty rows
      const sortedNonEmptyRows = [...nonEmptyRows].sort((a, b) => {
        const aVal = a[columnIndex]?.computed;
        const bVal = b[columnIndex]?.computed;

        // Handle empty values within non-empty rows
        const aEmpty = aVal === null || aVal === undefined || aVal === '';
        const bEmpty = bVal === null || bVal === undefined || bVal === '';

        if (aEmpty && bEmpty) return 0;
        if (aEmpty) return direction === 'asc' ? 1 : -1; // Empty values go to end in asc, start in desc
        if (bEmpty) return direction === 'asc' ? -1 : 1;

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        }

        const result = String(aVal).localeCompare(String(bVal));
        return direction === 'asc' ? result : -result;
      });

      // Combine: header rows + sorted non-empty rows + empty rows at the end
      newData.rows = [...headerRows, ...sortedNonEmptyRows, ...emptyRows];
      return newData;
    });

    setSortConfig({ columnIndex, direction });
    markDirty();
  }, [setData, markDirty]);

  // Set header row count
  const setHeaderRowCount = useCallback((count: number) => {
    setData(prev => {
      const newData = { ...prev };
      const maxRows = newData.rows.length;
      const safeCount = Math.max(0, Math.min(count, maxRows));

      newData.headerRowCount = safeCount;
      newData.hasHeaders = safeCount > 0;

      if (safeCount > 0 && newData.rows.length > 0) {
        newData.headers = newData.rows[0].map(cell => cell.raw);
      } else {
        newData.headers = undefined;
      }

      return newData;
    });
    markDirty();
  }, [setData, markDirty]);

  // Toggle headers (legacy)
  const toggleHeaders = useCallback(() => {
    setData(prev => {
      const newData = { ...prev };
      const newCount = newData.headerRowCount > 0 ? 0 : 1;
      newData.headerRowCount = newCount;
      newData.hasHeaders = newCount > 0;

      if (newData.hasHeaders && newData.rows.length > 0) {
        newData.headers = newData.rows[0].map(cell => cell.raw);
      } else {
        newData.headers = undefined;
      }

      return newData;
    });
    markDirty();
  }, [setData, markDirty]);

  // Clear cells in selection
  const clearCells = useCallback((selection: NormalizedSelectionRange) => {
    setData(prev => {
      const newData = { ...prev };
      newData.rows = prev.rows.map(row => [...row]);

      for (let r = selection.startRow; r <= selection.endRow; r++) {
        for (let c = selection.startCol; c <= selection.endCol; c++) {
          if (r < newData.rows.length && c < newData.columnCount) {
            newData.rows[r][c] = { raw: '', computed: '' };
          }
        }
      }

      return recalculateFormulas(newData);
    });
    markDirty();
  }, [setData, markDirty]);

  // Copy selection to system clipboard
  const copySelection = useCallback((selection: NormalizedSelectionRange) => {
    console.log('[CSV copySelection] Called with selection:', selection);
    const values: string[][] = [];
    for (let r = selection.startRow; r <= selection.endRow; r++) {
      const row: string[] = [];
      for (let c = selection.startCol; c <= selection.endCol; c++) {
        const cell = data.rows[r]?.[c];
        row.push(cell?.raw || '');
      }
      values.push(row);
    }

    console.log('[CSV copySelection] Copied values:', JSON.stringify(values));

    // Copy to system clipboard as tab-delimited text
    const text = values.map(row => row.join('\t')).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      console.log('[CSV copySelection] Wrote to system clipboard:', text.length, 'chars');
    }).catch(err => {
      console.log('[CSV copySelection] Failed to write to system clipboard:', err);
    });
  }, [data.rows]);

  // Cut selection - copy to clipboard and clear cells immediately
  const cutSelection = useCallback((selection: NormalizedSelectionRange) => {
    console.log('[CSV cutSelection] Called with selection:', selection);

    // First copy the values
    const values: string[][] = [];
    for (let r = selection.startRow; r <= selection.endRow; r++) {
      const row: string[] = [];
      for (let c = selection.startCol; c <= selection.endCol; c++) {
        const cell = data.rows[r]?.[c];
        row.push(cell?.raw || '');
      }
      values.push(row);
    }

    // Copy to system clipboard
    const text = values.map(row => row.join('\t')).join('\n');
    navigator.clipboard.writeText(text).catch(err => {
      console.log('[CSV cutSelection] Failed to write to system clipboard:', err);
    });

    // Clear the cells
    clearCells(selection);
  }, [data.rows, clearCells]);

  // Paste from text (system clipboard) - parses tab/newline delimited text
  const pasteFromText = useCallback((targetRow: number, targetCol: number, text: string) => {
    console.log('[CSV pasteFromText] Called with targetRow:', targetRow, 'targetCol:', targetCol);
    console.log('[CSV pasteFromText] Text length:', text.length);
    console.log('[CSV pasteFromText] Raw text:', JSON.stringify(text));

    // Parse text as tab-delimited rows (Excel/Sheets format)
    const lines = text.split(/\r?\n/);
    console.log('[CSV pasteFromText] Lines:', lines.length);

    const values = lines
      .filter(line => line.length > 0) // Skip empty lines
      .map(line => line.split('\t'));

    console.log('[CSV pasteFromText] Parsed values:', values.length, 'rows, first row cols:', values[0]?.length);
    console.log('[CSV pasteFromText] First few values:', JSON.stringify(values.slice(0, 3)));

    if (values.length === 0) {
      console.log('[CSV pasteFromText] No values to paste, returning');
      return;
    }

    setData(prev => {
      const newData = { ...prev };

      // Calculate needed dimensions
      const neededRows = targetRow + values.length;
      const neededCols = targetCol + Math.max(...values.map(row => row.length));

      // Expand rows if needed
      if (neededRows > prev.rows.length) {
        newData.rows = [...prev.rows];
        for (let r = prev.rows.length; r < neededRows; r++) {
          const newRow: Cell[] = [];
          for (let c = 0; c < Math.max(prev.columnCount, neededCols); c++) {
            newRow.push({ raw: '', computed: '' });
          }
          newData.rows.push(newRow);
        }
      } else {
        newData.rows = prev.rows.map(row => [...row]);
      }

      // Expand columns if needed
      if (neededCols > prev.columnCount) {
        newData.columnCount = neededCols;
        newData.rows = newData.rows.map(r => {
          const newRow = [...r];
          for (let c = r.length; c < neededCols; c++) {
            newRow.push({ raw: '', computed: '' });
          }
          return newRow;
        });
      }

      // Paste values
      for (let r = 0; r < values.length; r++) {
        const destRow = targetRow + r;

        for (let c = 0; c < values[r].length; c++) {
          const destCol = targetCol + c;

          const value = values[r][c];
          const cell = createCell(value);
          if (isFormula(value)) {
            const { value: computed, error } = evaluateFormula(value, newData, destRow, destCol);
            cell.computed = computed;
            cell.error = error;
          }
          newData.rows[destRow][destCol] = cell;
        }
      }

      console.log('[CSV pasteFromText] After paste, data has', newData.rows.length, 'rows,', newData.columnCount, 'cols');
      return recalculateFormulas(newData);
    });

    console.log('[CSV pasteFromText] Calling markDirty');
    markDirty();
  }, [setData, markDirty]);

  // Serialize to CSV (trims empty trailing rows/columns)
  const toCSV = useCallback(() => {
    const trimmedData = trimEmptyRowsAndColumns(data);
    return serializeToCSV(trimmedData, delimiter);
  }, [data, delimiter]);

  // Load from CSV
  const loadFromCSV = useCallback((content: string) => {
    const parsed = parseCSV(content);
    setDelimiter(parsed.delimiter);
    reset(parsed.data);
    setIsDirty(false);
    setSortConfig(null);
  }, [reset]);

  // Mark clean
  const markClean = useCallback(() => {
    setIsDirty(false);
    onDirtyChange?.(false);
  }, [onDirtyChange]);

  return {
    data,
    isDirty,
    delimiter,

    undo,
    redo,
    canUndo,
    canRedo,

    updateCell,
    addRow,
    deleteRow,
    addColumn,
    deleteColumn,
    sortByColumn,
    setHeaderRowCount,
    toggleHeaders,

    copySelection,
    cutSelection,
    pasteFromText,
    clearCells,

    toCSV,
    loadFromCSV,
    markClean,

    sortConfig,
  };
}
