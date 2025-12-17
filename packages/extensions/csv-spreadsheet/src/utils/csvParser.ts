/**
 * CSV parsing and serialization utilities using Papa Parse
 */

import Papa from 'papaparse';
import type { SpreadsheetData, Cell } from '../types';

/**
 * Detect the delimiter used in a CSV file
 */
export function detectDelimiter(content: string): ',' | '\t' {
  const firstLine = content.split('\n')[0] || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

/**
 * Parse CSV content into SpreadsheetData
 */
export function parseCSV(content: string): { data: SpreadsheetData; delimiter: ',' | '\t' } {
  const delimiter = detectDelimiter(content);

  const result = Papa.parse<string[]>(content, {
    delimiter,
    skipEmptyLines: false,
    header: false,
  });

  if (result.errors.length > 0) {
    console.warn('[CSV] Parse warnings:', result.errors);
  }

  const rawRows = result.data as string[][];

  // Filter out completely empty trailing rows
  while (rawRows.length > 0 && rawRows[rawRows.length - 1].every(cell => cell === '')) {
    rawRows.pop();
  }

  // Ensure we have at least one row
  if (rawRows.length === 0) {
    rawRows.push(['']);
  }

  // Find the maximum column count
  const columnCount = Math.max(...rawRows.map(row => row.length), 1);

  // Normalize all rows to have the same number of columns
  const normalizedRows = rawRows.map(row => {
    while (row.length < columnCount) {
      row.push('');
    }
    return row;
  });

  // Convert to Cell format
  const rows = normalizedRows.map(row =>
    row.map(value => createCell(value))
  );

  // Check if first row looks like headers (non-numeric, non-empty strings)
  const hasHeaders = rows.length > 1 &&
    rows[0].every(cell =>
      cell.raw !== '' && isNaN(parseFloat(cell.raw))
    );

  return {
    data: {
      rows,
      columnCount,
      headers: hasHeaders ? rows[0].map(cell => cell.raw) : undefined,
      hasHeaders,
    },
    delimiter,
  };
}

/**
 * Create a Cell from a raw string value
 */
export function createCell(value: string): Cell {
  const trimmed = value.trim();

  // Check if it's a formula
  if (trimmed.startsWith('=')) {
    return {
      raw: trimmed,
      computed: null, // Will be computed by formula engine
    };
  }

  // Check if it's a number
  const num = parseFloat(trimmed);
  if (!isNaN(num) && trimmed !== '') {
    return {
      raw: trimmed,
      computed: num,
    };
  }

  // Otherwise it's a string
  return {
    raw: value,
    computed: value,
  };
}

/**
 * Serialize SpreadsheetData back to CSV format
 */
export function serializeToCSV(data: SpreadsheetData, delimiter: ',' | '\t' = ','): string {
  const rows = data.rows.map(row =>
    row.map(cell => {
      // Always save the raw value (including formulas)
      const value = cell.raw;

      // Quote the value if it contains the delimiter, quotes, or newlines
      if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
        return `"${value.replace(/"/g, '""')}"`;
      }

      return value;
    })
  );

  return rows.map(row => row.join(delimiter)).join('\n');
}

/**
 * Convert column index to letter (0 = A, 1 = B, ..., 25 = Z, 26 = AA, etc.)
 */
export function columnIndexToLetter(index: number): string {
  let letter = '';
  let n = index;

  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }

  return letter;
}

/**
 * Convert column letter to index (A = 0, B = 1, ..., Z = 25, AA = 26, etc.)
 */
export function columnLetterToIndex(letter: string): number {
  let index = 0;
  const upper = letter.toUpperCase();

  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }

  return index - 1;
}

/**
 * Parse a cell reference like "A1" into column and row indices
 */
export function parseCellReference(ref: string): { col: number; row: number } | null {
  const match = ref.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;

  const col = columnLetterToIndex(match[1]);
  const row = parseInt(match[2], 10) - 1; // Convert to 0-indexed

  return { col, row };
}

/**
 * Parse a range reference like "A1:B5"
 */
export function parseRangeReference(ref: string): { start: { col: number; row: number }; end: { col: number; row: number } } | null {
  const parts = ref.split(':');
  if (parts.length !== 2) return null;

  const start = parseCellReference(parts[0]);
  const end = parseCellReference(parts[1]);

  if (!start || !end) return null;

  return { start, end };
}

/**
 * Generate column headers (A, B, C, ..., Z, AA, AB, etc.)
 */
export function generateColumnHeaders(count: number): string[] {
  return Array.from({ length: count }, (_, i) => columnIndexToLetter(i));
}
