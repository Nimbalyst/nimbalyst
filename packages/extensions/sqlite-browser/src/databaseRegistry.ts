/**
 * Database Registry
 *
 * Maintains a registry of active database connections that can be accessed by AI tools.
 * This allows the AI to query and interact with databases that users have opened in the panel.
 */

import type { Database } from 'sql.js';

interface DatabaseEntry {
  db: Database;
  name: string;
  tables: string[];
}

// Map of panel instance ID to database entry
const databaseRegistry = new Map<string, DatabaseEntry>();

/**
 * Register a database connection
 */
export function registerDatabase(panelId: string, db: Database, name: string, tables: string[]) {
  databaseRegistry.set(panelId, { db, name, tables });
}

/**
 * Unregister a database connection
 */
export function unregisterDatabase(panelId: string) {
  const entry = databaseRegistry.get(panelId);
  if (entry) {
    // Don't close the database here - let the panel handle that
    databaseRegistry.delete(panelId);
  }
}

/**
 * Get the active database (returns the most recently registered one)
 */
export function getActiveDatabase(): DatabaseEntry | undefined {
  // For now, just return the first one
  // In the future, we could track which panel is active
  const entries = Array.from(databaseRegistry.values());
  return entries.length > 0 ? entries[entries.length - 1] : undefined;
}

/**
 * Get database by panel ID
 */
export function getDatabaseByPanelId(panelId: string): DatabaseEntry | undefined {
  return databaseRegistry.get(panelId);
}

/**
 * Check if any database is loaded
 */
export function hasActiveDatabase(): boolean {
  return databaseRegistry.size > 0;
}

/**
 * Get all registered databases
 */
export function getAllDatabases(): Array<{ panelId: string; name: string; tables: string[] }> {
  return Array.from(databaseRegistry.entries()).map(([panelId, entry]) => ({
    panelId,
    name: entry.name,
    tables: entry.tables,
  }));
}
