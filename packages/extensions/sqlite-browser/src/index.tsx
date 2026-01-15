/**
 * SQLite Browser Extension
 *
 * A panel extension for browsing and querying SQLite databases.
 * This extension demonstrates the Extension Panels system with AI integration.
 */

import { SQLiteBrowserPanel } from './SQLiteBrowserPanel';
import { aiTools as sqliteAITools } from './aiTools';

/**
 * Extension activation
 */
export async function activate() {
  console.log('[SQLite Browser] Extension activated');
}

/**
 * Extension deactivation
 */
export async function deactivate() {
  console.log('[SQLite Browser] Extension deactivated');
}

/**
 * Panel exports - keyed by panel ID from manifest.json
 */
export const panels = {
  browser: {
    component: SQLiteBrowserPanel,
  },
};

/**
 * AI tools exported by this extension
 * These enable Claude to query and analyze SQLite databases.
 */
export const aiTools = sqliteAITools;
