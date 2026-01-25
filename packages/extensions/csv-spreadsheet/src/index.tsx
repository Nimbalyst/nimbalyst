/**
 * CSV Spreadsheet Extension Entry Point
 *
 * Registers the SpreadsheetEditor as a custom editor for CSV files.
 */

import { SpreadsheetEditor } from './components/SpreadsheetEditor';
import './revogrid-theme.css';

// Export the editor component for the extension system
export { SpreadsheetEditor };

/**
 * Extension activation
 * Called when the extension is loaded
 */
export async function activate() {
  console.log('[CSV Spreadsheet] Extension activated');
}

/**
 * Extension deactivation
 * Called when the extension is unloaded
 */
export async function deactivate() {
  console.log('[CSV Spreadsheet] Extension deactivated');
}

/**
 * Components exported by this extension
 * These are referenced in the manifest.json by component name
 */
export const components = {
  SpreadsheetEditor,
};
