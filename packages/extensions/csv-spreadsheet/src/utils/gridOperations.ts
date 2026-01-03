/**
 * Grid operations utility module
 *
 * Provides centralized functions for all RevoGrid data operations.
 * All operations work directly with RevoGrid as the single source of truth.
 */

import type { HTMLRevoGridElement, DimensionRows } from '@revolist/revogrid';
import type { NormalizedSelectionRange, ColumnFormat, CSVMetadata } from '../types';
import { columnIndexToLetter, serializeMetadata } from './csvParser';
import { isFormula, evaluateFormula } from './formulaEngine';
import type { UndoRedoPlugin } from '../plugins/UndoRedoPlugin';

export interface GridOperationsOptions {
  getHeaderRowCount: () => number;
  getColumnCount: () => number;
  getDelimiter: () => ',' | '\t';
  getColumnFormats: () => Record<number, ColumnFormat>;
  getFrozenColumnCount: () => number;
  onDirty: () => void;
  undoPlugin?: UndoRedoPlugin | null;
}

export interface GridOperations {
  // Cell operations
  updateCell: (row: number, col: number, value: string) => Promise<void>;
  clearCells: (range: NormalizedSelectionRange) => Promise<void>;
  getCellValue: (row: number, col: number) => Promise<string | number | null>;
  getCellRawValue: (row: number, col: number) => Promise<string>;

  // Row operations
  addRow: (index?: number) => Promise<void>;
  deleteRow: (index: number) => Promise<void>;

  // Column operations
  addColumn: (index?: number) => Promise<void>;
  deleteColumn: (index: number) => Promise<void>;

  // Clipboard operations
  copySelection: (range: NormalizedSelectionRange) => Promise<void>;
  cutSelection: (range: NormalizedSelectionRange) => Promise<void>;
  pasteFromText: (row: number, col: number, text: string) => Promise<void>;

  // Serialization
  toCSV: () => Promise<string>;
  getData: () => Promise<{ source: Record<string, unknown>[]; pinnedTop: Record<string, unknown>[] }>;

  // Sorting
  sortByColumn: (columnIndex: number, direction: 'asc' | 'desc' | null) => Promise<void>;
}

/**
 * Create grid operations bound to a specific grid element
 */
export function createGridOperations(
  gridRef: React.RefObject<HTMLRevoGridElement>,
  options: GridOperationsOptions
): GridOperations {
  const {
    getHeaderRowCount,
    getColumnCount,
    getDelimiter,
    getColumnFormats,
    getFrozenColumnCount,
    onDirty,
    undoPlugin,
  } = options;

  /**
   * Translate logical row index to RevoGrid row index and type
   */
  function translateRowIndex(logicalRow: number): { gridRow: number; rowType: DimensionRows } {
    const headerRowCount = getHeaderRowCount();
    if (logicalRow < headerRowCount) {
      return { gridRow: logicalRow, rowType: 'rowPinStart' };
    }
    return { gridRow: logicalRow - headerRowCount, rowType: 'rgRow' };
  }

  /**
   * Update a single cell value
   */
  const updateCell = async (row: number, col: number, value: string): Promise<void> => {
    const grid = gridRef.current;
    if (!grid) throw new Error('Grid not available');

    const { gridRow, rowType } = translateRowIndex(row);
    const prop = columnIndexToLetter(col);

    // Get old value for undo tracking
    const source = await grid.getSource(rowType);
    const oldValue = source?.[gridRow]?.[prop] ?? '';

    // Handle formulas
    let displayValue: string | number = value;
    if (isFormula(value)) {
      // For formulas, we need to evaluate them
      // Store raw formula and display computed result
      const data = await getAllGridData(grid, getHeaderRowCount());
      const { value: computed, error } = evaluateFormula(value, data, row, col);
      displayValue = error ? error : (computed ?? value);
    }

    // Update the cell
    await grid.setDataAt({
      row: gridRow,
      col,
      val: displayValue,
      rowType,
      colType: 'rgCol',
    });

    // Record for undo
    if (undoPlugin && oldValue !== displayValue) {
      undoPlugin.recordManualChange([{
        rowIndex: gridRow,
        colIndex: col,
        prop,
        oldValue,
        newValue: displayValue,
        rowType,
      }]);
    }

    onDirty();
  };

  /**
   * Clear all cells in a selection range
   */
  const clearCells = async (range: NormalizedSelectionRange): Promise<void> => {
    const grid = gridRef.current;
    if (!grid) throw new Error('Grid not available');

    const headerRowCount = getHeaderRowCount();
    const changes: Array<{
      rowIndex: number;
      colIndex: number;
      prop: string;
      oldValue: unknown;
      newValue: unknown;
      rowType: DimensionRows;
    }> = [];

    // Get current data for undo tracking
    const [source, pinnedTop] = await Promise.all([
      grid.getSource('rgRow'),
      grid.getSource('rowPinStart'),
    ]);

    const promises: Promise<void | undefined>[] = [];

    for (let r = range.startRow; r <= range.endRow; r++) {
      for (let c = range.startCol; c <= range.endCol; c++) {
        const { gridRow, rowType } = translateRowIndex(r);
        const prop = columnIndexToLetter(c);

        // Get old value
        const dataSource = rowType === 'rowPinStart' ? pinnedTop : source;
        const oldValue = dataSource?.[gridRow]?.[prop] ?? '';

        if (oldValue !== '') {
          changes.push({
            rowIndex: gridRow,
            colIndex: c,
            prop,
            oldValue,
            newValue: '',
            rowType,
          });
        }

        promises.push(grid.setDataAt({
          row: gridRow,
          col: c,
          val: '',
          rowType,
          colType: 'rgCol',
        }));
      }
    }

    await Promise.all(promises);

    // Record for undo
    if (undoPlugin && changes.length > 0) {
      undoPlugin.recordManualChange(changes);
    }

    onDirty();
  };

  /**
   * Get the display value of a cell
   */
  const getCellValue = async (row: number, col: number): Promise<string | number | null> => {
    const grid = gridRef.current;
    if (!grid) return null;

    const { gridRow, rowType } = translateRowIndex(row);
    const source = await grid.getSource(rowType);
    const prop = columnIndexToLetter(col);

    return source?.[gridRow]?.[prop] ?? null;
  };

  /**
   * Get the raw value of a cell (for formulas, returns the formula text)
   */
  const getCellRawValue = async (row: number, col: number): Promise<string> => {
    const grid = gridRef.current;
    if (!grid) return '';

    const { gridRow, rowType } = translateRowIndex(row);
    const source = await grid.getSource(rowType);
    const prop = columnIndexToLetter(col);

    // Check for raw value property (used for formulas)
    const rawProp = `_raw_${prop}`;
    const rawValue = source?.[gridRow]?.[rawProp];
    if (rawValue !== undefined) {
      return String(rawValue);
    }

    return String(source?.[gridRow]?.[prop] ?? '');
  };

  /**
   * Add a new row at the specified index
   */
  const addRow = async (index?: number): Promise<void> => {
    const grid = gridRef.current;
    if (!grid) throw new Error('Grid not available');

    // For now, we'll need to get all data, add row, and set it back
    // This is a limitation of RevoGrid's API
    const [source, pinnedTop] = await Promise.all([
      grid.getSource('rgRow'),
      grid.getSource('rowPinStart'),
    ]);

    const headerRowCount = getHeaderRowCount();
    const columnCount = getColumnCount();

    // Create empty row
    const newRow: Record<string, string> = {};
    for (let c = 0; c < columnCount; c++) {
      newRow[columnIndexToLetter(c)] = '';
    }

    const insertIndex = index ?? (headerRowCount + (source?.length ?? 0));

    if (insertIndex < headerRowCount) {
      // Insert into pinned (header) rows
      const newPinned = [...(pinnedTop || [])];
      newPinned.splice(insertIndex, 0, newRow);
      grid.pinnedTopSource = newPinned;
    } else {
      // Insert into regular rows
      const dataIndex = insertIndex - headerRowCount;
      const newSource = [...(source || [])];
      newSource.splice(dataIndex, 0, newRow);
      grid.source = newSource;
    }

    onDirty();
  };

  /**
   * Delete a row at the specified index
   */
  const deleteRow = async (index: number): Promise<void> => {
    const grid = gridRef.current;
    if (!grid) throw new Error('Grid not available');

    const [source, pinnedTop] = await Promise.all([
      grid.getSource('rgRow'),
      grid.getSource('rowPinStart'),
    ]);

    const headerRowCount = getHeaderRowCount();
    const totalRows = headerRowCount + (source?.length ?? 0);

    // Don't allow deleting the last row
    if (totalRows <= 1) return;

    if (index < headerRowCount) {
      // Delete from pinned rows
      const newPinned = [...(pinnedTop || [])];
      newPinned.splice(index, 1);
      grid.pinnedTopSource = newPinned;
    } else {
      // Delete from regular rows
      const dataIndex = index - headerRowCount;
      const newSource = [...(source || [])];
      newSource.splice(dataIndex, 1);
      grid.source = newSource;
    }

    onDirty();
  };

  /**
   * Add a new column at the specified index
   */
  const addColumn = async (index?: number): Promise<void> => {
    const grid = gridRef.current;
    if (!grid) throw new Error('Grid not available');

    // Column operations require rebuilding the column definition
    // and shifting cell data. This is complex and may need to be
    // handled at a higher level.
    // For now, mark dirty and rely on React state for column changes
    onDirty();
  };

  /**
   * Delete a column at the specified index
   */
  const deleteColumn = async (index: number): Promise<void> => {
    const grid = gridRef.current;
    if (!grid) throw new Error('Grid not available');

    // Similar to addColumn, this is complex
    onDirty();
  };

  /**
   * Copy selection to clipboard
   */
  const copySelection = async (range: NormalizedSelectionRange): Promise<void> => {
    const grid = gridRef.current;
    if (!grid) return;

    const [source, pinnedTop] = await Promise.all([
      grid.getSource('rgRow'),
      grid.getSource('rowPinStart'),
    ]);

    const headerRowCount = getHeaderRowCount();
    const values: string[][] = [];

    for (let r = range.startRow; r <= range.endRow; r++) {
      const row: string[] = [];
      for (let c = range.startCol; c <= range.endCol; c++) {
        const { gridRow, rowType } = translateRowIndex(r);
        const prop = columnIndexToLetter(c);
        const dataSource = rowType === 'rowPinStart' ? pinnedTop : source;
        const value = dataSource?.[gridRow]?.[prop] ?? '';
        row.push(String(value));
      }
      values.push(row);
    }

    const text = values.map(row => row.join('\t')).join('\n');
    await navigator.clipboard.writeText(text);
  };

  /**
   * Cut selection (copy + clear)
   */
  const cutSelection = async (range: NormalizedSelectionRange): Promise<void> => {
    await copySelection(range);
    await clearCells(range);
  };

  /**
   * Paste text at the specified position
   */
  const pasteFromText = async (targetRow: number, targetCol: number, text: string): Promise<void> => {
    const grid = gridRef.current;
    if (!grid) throw new Error('Grid not available');

    // Parse the pasted text (tab and newline delimited)
    const lines = text.split(/\r?\n/);
    const values = lines
      .filter(line => line.length > 0)
      .map(line => line.split('\t'));

    if (values.length === 0) return;

    const headerRowCount = getHeaderRowCount();
    const changes: Array<{
      rowIndex: number;
      colIndex: number;
      prop: string;
      oldValue: unknown;
      newValue: unknown;
      rowType: DimensionRows;
    }> = [];

    // Get current data for undo tracking
    const [source, pinnedTop] = await Promise.all([
      grid.getSource('rgRow'),
      grid.getSource('rowPinStart'),
    ]);

    const promises: Promise<void | undefined>[] = [];

    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const destRow = targetRow + r;
        const destCol = targetCol + c;
        const { gridRow, rowType } = translateRowIndex(destRow);
        const prop = columnIndexToLetter(destCol);
        const value = values[r][c];

        // Get old value
        const dataSource = rowType === 'rowPinStart' ? pinnedTop : source;
        const oldValue = dataSource?.[gridRow]?.[prop] ?? '';

        if (oldValue !== value) {
          changes.push({
            rowIndex: gridRow,
            colIndex: destCol,
            prop,
            oldValue,
            newValue: value,
            rowType,
          });
        }

        promises.push(grid.setDataAt({
          row: gridRow,
          col: destCol,
          val: value,
          rowType,
          colType: 'rgCol',
        }));
      }
    }

    await Promise.all(promises);

    // Record for undo
    if (undoPlugin && changes.length > 0) {
      undoPlugin.recordManualChange(changes);
    }

    onDirty();
  };

  /**
   * Get all grid data for formula evaluation
   */
  async function getAllGridData(
    grid: HTMLRevoGridElement,
    headerRowCount: number
  ): Promise<{ rows: Array<{ raw: string; computed: string | number | null }[]> }> {
    const [source, pinnedTop] = await Promise.all([
      grid.getSource('rgRow'),
      grid.getSource('rowPinStart'),
    ]);

    const rows: Array<{ raw: string; computed: string | number | null }[]> = [];

    // Add pinned (header) rows first
    if (pinnedTop) {
      for (const rowData of pinnedTop) {
        const row: { raw: string; computed: string | number | null }[] = [];
        const keys = Object.keys(rowData).filter(k => !k.startsWith('_'));
        for (const key of keys) {
          const value = rowData[key];
          row.push({
            raw: String(value ?? ''),
            computed: value ?? null,
          });
        }
        rows.push(row);
      }
    }

    // Add regular rows
    if (source) {
      for (const rowData of source) {
        const row: { raw: string; computed: string | number | null }[] = [];
        const keys = Object.keys(rowData).filter(k => !k.startsWith('_'));
        for (const key of keys) {
          const value = rowData[key];
          row.push({
            raw: String(value ?? ''),
            computed: value ?? null,
          });
        }
        rows.push(row);
      }
    }

    return { rows };
  }

  /**
   * Serialize grid data to CSV
   */
  const toCSV = async (): Promise<string> => {
    const grid = gridRef.current;
    if (!grid) throw new Error('Grid not available');

    const [source, pinnedTop] = await Promise.all([
      grid.getSource('rgRow'),
      grid.getSource('rowPinStart'),
    ]);

    const headerRowCount = getHeaderRowCount();
    const columnCount = getColumnCount();
    const delimiter = getDelimiter();
    const columnFormats = getColumnFormats();
    const frozenColumnCount = getFrozenColumnCount();

    const csvRows: string[] = [];

    // Helper to format a cell value for CSV
    function formatCell(value: unknown): string {
      const str = String(value ?? '');
      if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    // Add pinned (header) rows first
    if (pinnedTop) {
      for (let rowIdx = 0; rowIdx < headerRowCount && rowIdx < pinnedTop.length; rowIdx++) {
        const rowData = pinnedTop[rowIdx];
        const cells: string[] = [];
        for (let colIdx = 0; colIdx < columnCount; colIdx++) {
          const prop = columnIndexToLetter(colIdx);
          const value = rowData[prop];
          cells.push(formatCell(value));
        }
        csvRows.push(cells.join(delimiter));
      }
    }

    // Add regular rows
    if (source) {
      for (let rowIdx = 0; rowIdx < source.length; rowIdx++) {
        const rowData = source[rowIdx];

        // Skip trailing empty rows
        let hasData = false;
        const cells: string[] = [];
        for (let colIdx = 0; colIdx < columnCount; colIdx++) {
          const prop = columnIndexToLetter(colIdx);
          const value = rowData[prop];
          const cellValue = String(value ?? '');
          if (cellValue) hasData = true;
          cells.push(formatCell(value));
        }

        // Only include if row has data or is within original data bounds
        if (hasData) {
          csvRows.push(cells.join(delimiter));
        }
      }
    }

    // Trim trailing empty rows
    while (csvRows.length > 0 && csvRows[csvRows.length - 1].split(delimiter).every(c => c === '')) {
      csvRows.pop();
    }

    // Ensure at least one row
    if (csvRows.length === 0) {
      csvRows.push('');
    }

    // Build metadata
    const hasColumnFormats = Object.keys(columnFormats).length > 0;
    const metadata: CSVMetadata = {
      hasHeaders: headerRowCount > 0,
      headerRowCount,
      frozenColumnCount,
      ...(hasColumnFormats ? { columnFormats } : {}),
    };

    return `${serializeMetadata(metadata)}\n${csvRows.join('\n')}`;
  };

  /**
   * Get raw grid data
   */
  const getData = async (): Promise<{ source: Record<string, unknown>[]; pinnedTop: Record<string, unknown>[] }> => {
    const grid = gridRef.current;
    if (!grid) return { source: [], pinnedTop: [] };

    const [source, pinnedTop] = await Promise.all([
      grid.getSource('rgRow'),
      grid.getSource('rowPinStart'),
    ]);

    return {
      source: source || [],
      pinnedTop: pinnedTop || [],
    };
  };

  /**
   * Sort by column
   */
  const sortByColumn = async (columnIndex: number, direction: 'asc' | 'desc' | null): Promise<void> => {
    const grid = gridRef.current;
    if (!grid) throw new Error('Grid not available');

    if (direction === null) {
      // Clear sort - would need to restore original order
      // For now, just return
      return;
    }

    const source = await grid.getSource('rgRow');
    if (!source) return;

    const prop = columnIndexToLetter(columnIndex);

    // Sort the source array
    const sorted = [...source].sort((a, b) => {
      const aVal = a[prop];
      const bVal = b[prop];

      // Handle empty values
      const aEmpty = aVal === null || aVal === undefined || aVal === '';
      const bEmpty = bVal === null || bVal === undefined || bVal === '';

      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return direction === 'asc' ? 1 : -1;
      if (bEmpty) return direction === 'asc' ? -1 : 1;

      // Numeric comparison
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      }

      // String comparison
      const result = String(aVal).localeCompare(String(bVal));
      return direction === 'asc' ? result : -result;
    });

    grid.source = sorted;
    onDirty();
  };

  return {
    updateCell,
    clearCells,
    getCellValue,
    getCellRawValue,
    addRow,
    deleteRow,
    addColumn,
    deleteColumn,
    copySelection,
    cutSelection,
    pasteFromText,
    toCSV,
    getData,
    sortByColumn,
  };
}
