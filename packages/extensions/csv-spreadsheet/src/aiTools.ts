/**
 * AI Tools for CSV Spreadsheet Extension
 *
 * Provides AI-accessible tools for data analysis and manipulation.
 * Note: AI tools are NOT being implemented per user request.
 * This file contains only the store registration needed by SpreadsheetEditor.
 */

import type { SpreadsheetStoreApi } from './hooks/useSpreadsheetStore';

// Store registry for AI tool access (keyed by file path)
const editorStores = new Map<string, SpreadsheetStoreApi>();

/**
 * Register an editor store for AI tool access
 */
export function registerEditorStore(filePath: string, store: SpreadsheetStoreApi): void {
  editorStores.set(filePath, store);
}

/**
 * Unregister an editor store
 */
export function unregisterEditorStore(filePath: string): void {
  editorStores.delete(filePath);
}

/**
 * Get an editor store by file path
 */
export function getEditorStore(filePath: string): SpreadsheetStoreApi | undefined {
  return editorStores.get(filePath);
}
