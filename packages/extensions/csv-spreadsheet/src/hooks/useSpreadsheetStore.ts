/**
 * Zustand store for spreadsheet state management
 */

import { create } from 'zustand';
import type { SpreadsheetStore, SpreadsheetData, Cell, SortDirection } from '../types';
import { parseCSV, serializeToCSV, createCell } from '../utils/csvParser';
import { recalculateFormulas, isFormula, evaluateFormula } from '../utils/formulaEngine';

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
  };
}

/**
 * Store API type - zustand's create() returns a hook with getState/setState/subscribe
 */
export type SpreadsheetStoreApi = ReturnType<typeof createSpreadsheetStore>;

/**
 * Create a spreadsheet store instance
 * Uses zustand's create() which returns a hook with store API methods
 */
export function createSpreadsheetStore() {
  let onDirtyChange: ((isDirty: boolean) => void) | undefined;

  const useStore = create<SpreadsheetStore>((set, get) => ({
    // Initial state
    data: createEmptySpreadsheet(),
    selectedCell: null,
    isDirty: false,
    sortConfig: null,
    filePath: '',
    delimiter: ',',

    // Load from CSV content
    loadFromCSV: (content: string, filePath: string) => {
      const { data, delimiter } = parseCSV(content);
      const recalculated = recalculateFormulas(data);

      set({
        data: recalculated,
        filePath,
        delimiter,
        isDirty: false,
        selectedCell: null,
        sortConfig: null,
      });
    },

    // Serialize to CSV
    toCSV: () => {
      const state = get();
      return serializeToCSV(state.data, state.delimiter);
    },

    // Update a cell
    updateCell: (row: number, col: number, value: string) => {
      const state = get();
      const newData = { ...state.data };
      newData.rows = [...newData.rows];
      newData.rows[row] = [...newData.rows[row]];

      // Create the cell
      const cell = createCell(value);

      // If it's a formula, evaluate it
      if (isFormula(value)) {
        const { value: computed, error } = evaluateFormula(value, newData, row, col);
        cell.computed = computed;
        cell.error = error;
      }

      newData.rows[row][col] = cell;

      // Recalculate all formulas (since this cell might be referenced)
      const recalculated = recalculateFormulas(newData);

      set({
        data: recalculated,
        isDirty: true,
      });

      onDirtyChange?.(true);
    },

    // Select a cell
    selectCell: (row: number, col: number) => {
      set({ selectedCell: { row, col } });
    },

    // Add a row
    addRow: (index?: number) => {
      const state = get();
      const newData = { ...state.data };
      newData.rows = [...newData.rows];

      const newRow: Cell[] = [];
      for (let c = 0; c < newData.columnCount; c++) {
        newRow.push({ raw: '', computed: '' });
      }

      if (index !== undefined && index >= 0 && index <= newData.rows.length) {
        newData.rows.splice(index, 0, newRow);
      } else {
        newData.rows.push(newRow);
      }

      set({
        data: newData,
        isDirty: true,
      });

      onDirtyChange?.(true);
    },

    // Delete a row
    deleteRow: (index: number) => {
      const state = get();
      if (state.data.rows.length <= 1) return; // Keep at least one row

      const newData = { ...state.data };
      newData.rows = [...newData.rows];
      newData.rows.splice(index, 1);

      // Recalculate formulas (row references may have changed)
      const recalculated = recalculateFormulas(newData);

      set({
        data: recalculated,
        isDirty: true,
      });

      onDirtyChange?.(true);
    },

    // Add a column
    addColumn: (index?: number) => {
      const state = get();
      const newData = { ...state.data };
      newData.rows = newData.rows.map(row => {
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

      set({
        data: newData,
        isDirty: true,
      });

      onDirtyChange?.(true);
    },

    // Delete a column
    deleteColumn: (index: number) => {
      const state = get();
      if (state.data.columnCount <= 1) return; // Keep at least one column

      const newData = { ...state.data };
      newData.rows = newData.rows.map(row => {
        const newRow = [...row];
        newRow.splice(index, 1);
        return newRow;
      });

      newData.columnCount = newData.rows[0]?.length || 1;

      // Recalculate formulas (column references may have changed)
      const recalculated = recalculateFormulas(newData);

      set({
        data: recalculated,
        isDirty: true,
      });

      onDirtyChange?.(true);
    },

    // Sort by column
    sortByColumn: (columnIndex: number, direction: SortDirection) => {
      const state = get();

      if (direction === null) {
        set({ sortConfig: null });
        return;
      }

      const newData = { ...state.data };

      // If first row is headers, don't include it in sort
      const headerRow = newData.hasHeaders ? newData.rows[0] : null;
      const dataRows = newData.hasHeaders ? newData.rows.slice(1) : newData.rows;

      // Sort the data rows
      const sortedRows = [...dataRows].sort((a, b) => {
        const aVal = a[columnIndex]?.computed;
        const bVal = b[columnIndex]?.computed;

        // Handle nulls
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return direction === 'asc' ? -1 : 1;
        if (bVal === null) return direction === 'asc' ? 1 : -1;

        // Compare numbers
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return direction === 'asc' ? aVal - bVal : bVal - aVal;
        }

        // Compare strings
        const aStr = String(aVal);
        const bStr = String(bVal);
        const result = aStr.localeCompare(bStr);
        return direction === 'asc' ? result : -result;
      });

      newData.rows = headerRow ? [headerRow, ...sortedRows] : sortedRows;

      set({
        data: newData,
        sortConfig: { columnIndex, direction },
        isDirty: true,
      });

      onDirtyChange?.(true);
    },

    // Mark as clean
    markClean: () => {
      set({ isDirty: false });
    },

    // Set callbacks
    setCallbacks: (callbacks) => {
      onDirtyChange = callbacks.onDirtyChange;
    },
  }));

  // Return the store hook which has getState, setState, subscribe methods
  return useStore;
}
