/**
 * Types for the CSV Spreadsheet extension
 */

/**
 * Metadata stored in CSV comment header
 */
export interface CSVMetadata {
  hasHeaders: boolean;
}

/**
 * Represents a single cell value
 * Can be a raw value or a formula (starting with =)
 */
export type CellValue = string | number | null;

/**
 * A cell with both the raw value/formula and computed display value
 */
export interface Cell {
  /** The raw value or formula (formulas start with =) */
  raw: string;
  /** The computed display value (for formulas, this is the result) */
  computed: CellValue;
  /** Error message if formula evaluation failed */
  error?: string;
}

/**
 * Represents a row of cells
 */
export type Row = Cell[];

/**
 * The entire spreadsheet data structure
 */
export interface SpreadsheetData {
  /** Array of rows, each row is an array of cells */
  rows: Row[];
  /** Number of columns */
  columnCount: number;
  /** Column headers (if first row is header) */
  headers?: string[];
  /** Whether the first row should be treated as headers */
  hasHeaders: boolean;
}

/**
 * Column definition for RevoGrid
 */
export interface ColumnDefinition {
  prop: string;
  name: string;
  size?: number;
  sortable?: boolean;
  readonly?: boolean;
}

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc' | null;

/**
 * Sort configuration for a column
 */
export interface SortConfig {
  columnIndex: number;
  direction: SortDirection;
}

/**
 * Clipboard data for copy/paste operations
 */
export interface ClipboardData {
  /** The copied cell value */
  value: string;
  /** Source cell position */
  sourceRow: number;
  sourceCol: number;
  /** Whether this was a cut operation */
  isCut: boolean;
}

/**
 * Spreadsheet store state
 */
export interface SpreadsheetState {
  /** The spreadsheet data */
  data: SpreadsheetData;
  /** Currently selected cell */
  selectedCell: { row: number; col: number } | null;
  /** Whether the data has been modified */
  isDirty: boolean;
  /** Current sort configuration */
  sortConfig: SortConfig | null;
  /** File path (for formula references) */
  filePath: string;
  /** Original file delimiter (comma or tab) */
  delimiter: ',' | '\t';
  /** Internal clipboard for cut/copy/paste */
  clipboard: ClipboardData | null;
}

/**
 * Spreadsheet store actions
 */
export interface SpreadsheetActions {
  /** Load data from CSV content */
  loadFromCSV: (content: string, filePath: string) => void;
  /** Get CSV content for saving */
  toCSV: () => string;
  /** Update a cell value */
  updateCell: (row: number, col: number, value: string) => void;
  /** Select a cell */
  selectCell: (row: number, col: number) => void;
  /** Add a row at the specified index (or at end if not specified) */
  addRow: (index?: number) => void;
  /** Delete a row */
  deleteRow: (index: number) => void;
  /** Add a column at the specified index (or at end if not specified) */
  addColumn: (index?: number) => void;
  /** Delete a column */
  deleteColumn: (index: number) => void;
  /** Sort by column */
  sortByColumn: (columnIndex: number, direction: SortDirection) => void;
  /** Toggle header row designation */
  toggleHeaders: () => void;
  /** Copy selected cell to clipboard */
  copyCell: () => void;
  /** Cut selected cell to clipboard */
  cutCell: () => void;
  /** Paste from clipboard to selected cell */
  pasteCell: () => void;
  /** Clear selected cell contents */
  clearCell: () => void;
  /** Insert row above selected cell */
  insertRowAbove: () => void;
  /** Insert row below selected cell */
  insertRowBelow: () => void;
  /** Insert column to left of selected cell */
  insertColumnLeft: () => void;
  /** Insert column to right of selected cell */
  insertColumnRight: () => void;
  /** Mark as clean (after save) */
  markClean: () => void;
  /** Set dirty callbacks */
  setCallbacks: (callbacks: { onDirtyChange?: (isDirty: boolean) => void }) => void;
}

/**
 * Combined store type
 */
export type SpreadsheetStore = SpreadsheetState & SpreadsheetActions;

/**
 * Props for custom editor components (from Nimbalyst extension system)
 */
export interface CustomEditorProps {
  filePath: string;
  fileName: string;
  initialContent: string;
  theme: 'light' | 'dark' | 'crystal-dark';
  isActive: boolean;
  workspaceId?: string;
  onContentChange?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  onGetContentReady?: (getContentFn: () => string) => void;
  onReloadContent?: (callback: (newContent: string) => void) => void;
  onViewHistory?: () => void;
  onRenameDocument?: () => void;
}

/**
 * Cell reference (for formulas)
 */
export interface CellReference {
  col: number;
  row: number;
}

/**
 * Range reference (for formulas like SUM(A1:B5))
 */
export interface RangeReference {
  start: CellReference;
  end: CellReference;
}
