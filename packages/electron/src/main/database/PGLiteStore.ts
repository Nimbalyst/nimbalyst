/**
 * PGLite Store Service
 * Provides electron-store compatible interface backed by PGLite
 */

import { database } from './PGLiteDatabaseWorker';
import { logger } from '../utils/logger';

export class PGLiteStore {
  private cache: Map<string, any> = new Map();

  /**
   * Get a value from the store
   */
  async get(key: string, defaultValue?: any): Promise<any> {
    try {
      // Check cache first
      if (this.cache.has(key)) {
        return this.cache.get(key);
      }

      // Handle different key types
      if (key === 'theme') {
        const result = await database.query<{ theme: string }>(
          'SELECT theme FROM app_settings WHERE id = $1',
          ['default']
        );
        const value = result.rows[0]?.theme || defaultValue || 'system';
        this.cache.set(key, value);
        return value;
      }

      // Sidebar width is now per-workspace, stored in workspace_state
      // This is kept for backward compatibility but should be deprecated
      if (key === 'sidebarWidth') {
        return defaultValue || 240;
      }

      if (key === 'recentWorkspaces' || key === 'recent.workspaces' || key === 'recentProjects' || key === 'recent.projects') {
        const result = await database.query<{ recent_workspaces: any }>(
          'SELECT recent_workspaces FROM app_settings WHERE id = $1',
          ['default']
        );
        // PGLite returns JSONB as parsed objects, not strings
        const value = result.rows[0]?.recent_workspaces || defaultValue || [];
        this.cache.set(key, value);
        return value;
      }

      // Recent documents are now per-workspace, stored in workspace_state
      if (key === 'recent.documents') {
        // This should be accessed via workspaceState:path instead
        return defaultValue || [];
      }

      if (key === 'aiProviders') {
        const result = await database.query<{ ai_providers: any }>(
          'SELECT ai_providers FROM app_settings WHERE id = $1',
          ['default']
        );
        const value = result.rows[0]?.ai_providers || defaultValue || {};
        this.cache.set(key, value);
        return value;
      }

      if (key === 'globalEditorSettings') {
        const result = await database.query<{ global_editor_settings: any }>(
          'SELECT global_editor_settings FROM app_settings WHERE id = $1',
          ['default']
        );
        const value = result.rows[0]?.global_editor_settings || defaultValue || {};
        this.cache.set(key, value);
        return value;
      }

      if (key === 'keyboardShortcuts') {
        const result = await database.query<{ keyboard_shortcuts: any }>(
          'SELECT keyboard_shortcuts FROM app_settings WHERE id = $1',
          ['default']
        );
        const value = result.rows[0]?.keyboard_shortcuts || defaultValue || {};
        this.cache.set(key, value);
        return value;
      }

      // For workspace-specific keys (e.g., "workspaceState:/path/to/workspace")
      if (key.startsWith('workspaceState:') || key.startsWith('projectState:')) {
        const workspacePath = key.startsWith('workspaceState:') ? key.substring('workspaceState:'.length) : key.substring('projectState:'.length);
        const result = await database.query<any>(
          'SELECT * FROM workspace_state WHERE workspace_path = $1',
          [workspacePath]
        );

        if (result.rows[0]) {
          const row = result.rows[0];

          const value = {
            workspacePath: row.workspace_path,
            lastOpened: row.last_opened,
            windowState: row.window_state,
            uiState: row.ui_state,
            documents: row.documents,
            fileTree: row.file_tree,
            aiChat: row.ai_chat,
            editorSettings: row.editor_settings,
            preferences: row.preferences,
            metadata: {
              version: row.version,
              createdAt: row.created_at,
              updatedAt: row.updated_at
            }
          };
          this.cache.set(key, value);
          return value;
        }

        // logger.store.info(`[PGLiteStore DEBUG] No data found, returning default: ${JSON.stringify(defaultValue || {})}`);
        return defaultValue || {};
      }

      // For window state
      if (key === 'sessionState') {
        const result = await database.query<any>(
          'SELECT windows, focused_window_id FROM session_state WHERE id = $1',
          ['current']
        );
        if (result.rows[0]) {
          const value = {
            windows: result.rows[0].windows,
            focusedWindowId: result.rows[0].focused_window_id
          };
          this.cache.set(key, value);
          return value;
        }
        return defaultValue || { windows: [] };
      }

      // For AI sessions by workspace
      if (key === 'sessionsByWorkspace' || key === 'sessionsByProject') {
        const result = await database.query<any>(
          'SELECT workspace_id, id, title, provider, model, messages, created_at, updated_at FROM ai_sessions ORDER BY updated_at DESC'
        );

        const sessionsByWorkspace: Record<string, any[]> = {};
        for (const row of result.rows) {
          if (!sessionsByWorkspace[row.workspace_id]) {
            sessionsByWorkspace[row.workspace_id] = [];
          }
          sessionsByWorkspace[row.workspace_id].push({
            id: row.id,
            title: row.title,
            provider: row.provider,
            model: row.model,
            messages: row.messages,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          });
        }
        this.cache.set(key, sessionsByWorkspace);
        return sessionsByWorkspace;
      }

      if (key === 'currentSessionByWorkspace' || key === 'currentSessionByProject') {
        // This is typically stored in memory or derived from sessions
        // Return empty object as default
        return defaultValue || {};
      }

      // AI chat state is now per-workspace, stored in workspace_state
      if (key === 'aiChatState') {
        // This should be accessed via workspaceState:path instead
        return defaultValue || { collapsed: false, width: 350 };
      }

      // Default: try to get from app_settings as generic JSON
      logger.store.warn(`Unknown key: ${key}, returning default value`);
      return defaultValue;

    } catch (error) {
      logger.store.error(`Failed to get key ${key}:`, error);
      return defaultValue;
    }
  }

  /**
   * Set a value in the store
   */
  async set(key: string, value: any): Promise<void> {
    try {
      // Update cache
      this.cache.set(key, value);

      // Handle different key types
      if (key === 'theme') {
        await database.query(
          'UPDATE app_settings SET theme = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [value, 'default']
        );
        return;
      }

      // Sidebar width is now per-workspace
      if (key === 'sidebarWidth') {
        // Should be set via workspaceState:path instead
        return;
      }

      if (key === 'recentWorkspaces' || key === 'recent.workspaces' || key === 'recentProjects' || key === 'recent.projects') {
        await database.query(
          'UPDATE app_settings SET recent_workspaces = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [value, 'default']  // PGLite JSONB handles serialization
        );
        return;
      }

      // Recent documents are now per-workspace
      if (key === 'recent.documents') {
        // Should be set via workspaceState:path instead
        return;
      }

      if (key === 'aiProviders') {
        await database.query(
          'UPDATE app_settings SET ai_providers = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [value, 'default']  // PGLite JSONB handles serialization
        );
        return;
      }

      if (key === 'globalEditorSettings') {
        await database.query(
          'UPDATE app_settings SET global_editor_settings = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [value, 'default']  // PGLite JSONB handles serialization
        );
        return;
      }

      if (key === 'keyboardShortcuts') {
        await database.query(
          'UPDATE app_settings SET keyboard_shortcuts = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [value, 'default']  // PGLite JSONB handles serialization
        );
        return;
      }

      // For workspace-specific state
      if (key.startsWith('workspaceState:') || key.startsWith('projectState:')) {
        const workspacePath = key.startsWith('workspaceState:') ? key.substring('workspaceState:'.length) : key.substring('projectState:'.length);
        logger.store.debug(`[PGLiteStore DEBUG] Setting workspace state for ${workspacePath}`);
        // logger.store.info(`[PGLiteStore DEBUG] Value structure:`, Object.keys(value));
        // logger.store.info(`[PGLiteStore DEBUG] Documents:`, JSON.stringify(value.documents));

        await database.query(
          `INSERT INTO workspace_state (
             workspace_path, last_opened, window_state, ui_state, documents,
             file_tree, ai_chat, editor_settings, preferences,
             version, updated_at
           )
           VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
           ON CONFLICT (workspace_path) DO UPDATE SET
             last_opened = CURRENT_TIMESTAMP,
             window_state = $2,
             ui_state = $3,
             documents = $4,
             file_tree = $5,
             ai_chat = $6,
             editor_settings = $7,
             preferences = $8,
             version = $9,
             updated_at = CURRENT_TIMESTAMP`,
          [
            workspacePath,
            value.windowState || {width: 1200, height: 800},  // PGLite JSONB handles serialization
            value.uiState || {sidebarWidth: 240, sidebarCollapsed: false, aiChatWidth: 350, aiChatCollapsed: false},  // PGLite JSONB
            value.documents || {recentDocuments: [], openTabs: [], activeTabId: null, tabOrder: []},  // PGLite JSONB
            value.fileTree || {expandedFolders: [], scrollPosition: 0},  // PGLite JSONB
            value.aiChat || {sessionHistory: []},  // PGLite JSONB
            value.editorSettings || null,  // PGLite JSONB handles null and objects
            value.preferences || {autoSave: true, autoSaveInterval: 30000},  // PGLite JSONB
            value.metadata?.version || '1.0.0'
          ]
        );
        return;
      }

      // For session state
      if (key === 'sessionState') {
        await database.query(
          `UPDATE session_state SET
             windows = $1,
             focused_window_id = $2,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = 'current'`,
          [
            value.windows || [],  // PGLite JSONB handles serialization
            value.focusedWindowId || null
          ]
        );
        return;
      }

      // For AI sessions by workspace - this is more complex as it involves multiple rows
      if (key === 'sessionsByWorkspace' || key === 'sessionsByProject') {
        // This would need special handling to sync with ai_sessions table
        // For now, log a warning
        logger.store.warn('Direct update of sessionsByWorkspace not implemented - use SessionManager methods');
        return;
      }

      // AI chat state is now per-workspace
      if (key === 'aiChatState') {
        // Should be set via workspaceState:path instead
        return;
      }

      logger.store.warn(`Unknown key for set: ${key}`);

    } catch (error) {
      logger.store.error(`Failed to set key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Delete a key from the store
   */
  async delete(key: string): Promise<void> {
    this.cache.delete(key);

    if (key.startsWith('workspaceState:') || key.startsWith('projectState:')) {
      const workspacePath = key.startsWith('workspaceState:') ? key.substring('workspaceState:'.length) : key.substring('projectState:'.length);
      await database.query(
        'DELETE FROM workspace_state WHERE workspace_path = $1',
        [workspacePath]
      );
    }
    // Add other delete cases as needed
  }

  /**
   * Check if a key exists
   */
  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== undefined;
  }

  /**
   * Clear all data (careful!)
   */
  async clear(): Promise<void> {
    this.cache.clear();
    // Don't actually clear the database - too dangerous
    logger.store.warn('Clear called but not implemented for safety');
  }

  /**
   * Get the store size (not really applicable for PGLite)
   */
  get size(): number {
    return this.cache.size;
  }
}

// Export singleton instance
export const pgliteStore = new PGLiteStore();
