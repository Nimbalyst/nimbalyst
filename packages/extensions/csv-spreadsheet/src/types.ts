/**
 * Types for the CSV Spreadsheet extension
 */

/**
 * Metadata stored in CSV comment header
 */
export interface CSVMetadata {
  hasHeaders: boolean;
  headerRowCount?: number;
  frozenColumnCount?: number;
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
  /** Column headers (if first row is header) - deprecated, kept for compatibility */
  headers?: string[];
  /** Whether the first row should be treated as headers - deprecated, use headerRowCount */
  hasHeaders: boolean;
  /** Number of header rows (0 = no headers, 1+ = that many rows are headers) */
  headerRowCount: number;
  /** Number of frozen/pinned columns on the left (0 = no frozen columns) */
  frozenColumnCount: number;
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
 * Selection range for multi-cell selection
 */
export interface SelectionRange {
  /** Starting cell (where selection began) */
  start: CellReference;
  /** Ending cell (where selection ends) */
  end: CellReference;
}

/**
 * Normalized selection range (start is always top-left, end is always bottom-right)
 */
export interface NormalizedSelectionRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

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
