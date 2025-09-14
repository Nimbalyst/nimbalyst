/**
 * PGLite Migration Service
 * Migrates data from electron-store JSON files to PGLite database
 */

import Store from 'electron-store';
import { app } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { database } from './PGLiteDatabaseWorker';
import { logger } from '../utils/logger';

export class PGLiteMigration {
  private migrationStore: Store;

  constructor() {
    this.migrationStore = new Store({
      name: 'pglite-migration-status',
      defaults: {
        migrated: false,
        migratedAt: null,
        version: '1.0.0'
      }
    });
  }

  /**
   * Check if migration has been completed
   */
  isMigrated(): boolean {
    return this.migrationStore.get('migrated', false) as boolean;
  }

  /**
   * Run the migration from electron-store to PGLite
   */
  async migrate(): Promise<void> {
    if (this.isMigrated()) {
      logger.main.info('[PGLite Migration] Already migrated, skipping...');
      return;
    }

    logger.main.info('[PGLite Migration] Starting migration from electron-store to PGLite...');

    try {
      // Initialize database if not already done
      if (!database.isInitialized()) {
        await database.initialize();
      }

      // Run migrations in transaction for atomicity
      await database.transaction(async (tx) => {
        await this.migrateAISessions(tx);
        await this.migrateAppSettings(tx);
        await this.migrateProjectStates(tx);
        await this.migrateSessionState(tx);
      });

      // Migrate document history (not in transaction since it calls file system operations)
      await this.migrateDocumentHistory();

      // Mark migration as complete
      this.migrationStore.set('migrated', true);
      this.migrationStore.set('migratedAt', Date.now());

      logger.main.info('[PGLite Migration] Migration completed successfully');
    } catch (error) {
      logger.main.error('[PGLite Migration] Migration failed:', error);
      throw error;
    }
  }

  /**
   * Migrate AI Sessions
   */
  private async migrateAISessions(tx: any): Promise<void> {
    logger.main.info('[PGLite Migration] Migrating AI sessions...');

    try {
      const aiSessionsStore = new Store({ name: 'ai-sessions' });
      const sessionsByProject = aiSessionsStore.get('sessionsByProject', {}) as any;

      let count = 0;
      for (const [projectPath, sessions] of Object.entries(sessionsByProject)) {
        if (!Array.isArray(sessions)) continue;

        for (const session of sessions as any[]) {
          await tx.query(`
            INSERT INTO ai_sessions (
              id, project_id, file_path, provider, model, title,
              messages, document_context, provider_config,
              provider_session_id, draft_input, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
              to_timestamp($12 / 1000.0), to_timestamp($13 / 1000.0))
            ON CONFLICT (id) DO NOTHING
          `, [
            session.id || uuidv4(),
            session.projectPath || projectPath,
            session.documentContext?.filePath || null,
            session.provider || 'claude',
            session.model || null,
            session.title || 'Untitled conversation',
            session.messages || [],  // PGLite JSONB handles serialization
            session.documentContext || null,  // PGLite JSONB handles serialization
            session.providerConfig || null,  // PGLite JSONB handles serialization
            session.providerSessionId || null,
            session.draftInput || null,
            session.timestamp || Date.now(),
            session.timestamp || Date.now()
          ]);
          count++;
        }
      }

      logger.main.info(`[PGLite Migration] Migrated ${count} AI sessions`);
    } catch (error) {
      logger.main.error('[PGLite Migration] Failed to migrate AI sessions:', error);
      throw error;
    }
  }

  /**
   * Migrate App Settings
   */
  private async migrateAppSettings(tx: any): Promise<void> {
    logger.main.info('[PGLite Migration] Migrating app settings...');

    try {
      const configStore = new Store();
      const aiSettingsStore = new Store({ name: 'ai-settings' });

      const theme = configStore.get('theme', 'system');
      const recentProjects = configStore.get('recent.projects', []) as any[];
      const aiProviders = aiSettingsStore.get('providers', {}) as any;
      const keyboardShortcuts = configStore.get('keyboardShortcuts', {}) as any;

      await tx.query(`
        UPDATE app_settings
        SET
          theme = $1,
          recent_projects = $2,
          ai_providers = $3,
          keyboard_shortcuts = $4,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = 'default'
      `, [
        theme,
        recentProjects,  // PGLite JSONB handles serialization automatically
        aiProviders,     // PGLite JSONB handles serialization automatically
        keyboardShortcuts // PGLite JSONB handles serialization automatically
      ]);

      logger.main.info('[PGLite Migration] Migrated app settings');
    } catch (error) {
      logger.main.error('[PGLite Migration] Failed to migrate app settings:', error);
      throw error;
    }
  }

  /**
   * Migrate Project States
   */
  private async migrateProjectStates(tx: any): Promise<void> {
    logger.main.info('[PGLite Migration] Migrating project states...');

    try {
      const configStore = new Store();

      // Get all project-related data from old store
      const projectWindowStates = configStore.get('projectWindowStates', {}) as any;
      const projectRecentFiles = configStore.get('projectRecentFiles', {}) as any;
      const projectTabs = configStore.get('projectTabs', {}) as any;
      const aiChatStates = configStore.get('projectAIChatStates', {}) as any;
      const recentProjects = configStore.get('recent.projects', []) as any[];

      // Debug logging to see what data we found
      logger.main.info('[PGLite Migration DEBUG] projectWindowStates keys:', Object.keys(projectWindowStates));
      logger.main.info('[PGLite Migration DEBUG] projectRecentFiles keys:', Object.keys(projectRecentFiles));
      logger.main.info('[PGLite Migration DEBUG] projectTabs keys:', Object.keys(projectTabs));
      logger.main.info('[PGLite Migration DEBUG] recentProjects length:', recentProjects.length);

      const projectPaths = new Set([
        ...Object.keys(projectWindowStates),
        ...Object.keys(projectRecentFiles),
        ...Object.keys(projectTabs),
        ...Object.keys(aiChatStates),
        ...recentProjects.map((p: any) => p.path)
      ]);

      let count = 0;
      for (const projectPath of projectPaths) {
        logger.main.info(`[PGLite Migration DEBUG] Processing project: ${projectPath}`);

        // Build documents object with recent documents and tabs
        const documents = {
          recentDocuments: projectRecentFiles[projectPath] || [],
          openTabs: projectTabs[projectPath]?.tabs || [],
          activeTabId: projectTabs[projectPath]?.activeTabId || null,
          tabOrder: projectTabs[projectPath]?.tabOrder || []
        };

        logger.main.info(`[PGLite Migration DEBUG] Documents for ${projectPath}: recentDocs=${documents.recentDocuments.length}, tabs=${documents.openTabs.length}`);


        // Build UI state
        const uiState = {
          sidebarWidth: configStore.get('sidebarWidth', 240),
          sidebarCollapsed: false,
          aiChatWidth: aiChatStates[projectPath]?.width || 350,
          aiChatCollapsed: aiChatStates[projectPath]?.collapsed || false
        };

        // Build AI chat state
        const aiChat = {
          currentSessionId: aiChatStates[projectPath]?.sessionId,
          draftInput: aiChatStates[projectPath]?.draftInput,
          sessionHistory: []
        };

        await tx.query(`
          INSERT INTO project_state (
            project_path, last_opened, window_state, ui_state, documents,
            file_tree, ai_chat, editor_settings, preferences,
            version, updated_at
          ) VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
          ON CONFLICT (project_path)
          DO UPDATE SET
            last_opened = CURRENT_TIMESTAMP,
            window_state = EXCLUDED.window_state,
            ui_state = EXCLUDED.ui_state,
            documents = EXCLUDED.documents,
            file_tree = EXCLUDED.file_tree,
            ai_chat = EXCLUDED.ai_chat,
            editor_settings = EXCLUDED.editor_settings,
            preferences = EXCLUDED.preferences,
            version = EXCLUDED.version,
            updated_at = CURRENT_TIMESTAMP
        `, [
          projectPath,
          projectWindowStates[projectPath] || {width: 1200, height: 800},  // PGLite JSONB handles serialization
          uiState,  // PGLite JSONB handles serialization
          documents,  // PGLite JSONB handles serialization
          {expandedFolders: [], scrollPosition: 0},  // PGLite JSONB handles serialization
          aiChat,  // PGLite JSONB handles serialization
          null, // editor_settings - we don't have this in old format
          {autoSave: true, autoSaveInterval: 30000},  // PGLite JSONB handles serialization
          '1.0.0'
        ]);
        count++;
      }

      logger.main.info(`[PGLite Migration] Migrated ${count} project states`);
    } catch (error) {
      logger.main.error('[PGLite Migration] Failed to migrate project states:', error);
      throw error;
    }
  }

  /**
   * Migrate Session State
   */
  private async migrateSessionState(tx: any): Promise<void> {
    logger.main.info('[PGLite Migration] Migrating session state...');

    try {
      const configStore = new Store();
      const sessionState = configStore.get('sessionState') as any;

      logger.main.info('[PGLite Migration DEBUG] Session state from electron-store:', sessionState);

      if (sessionState?.windows?.length > 0) {
        await tx.query(`
          UPDATE session_state
          SET
            windows = $1,
            focused_window_id = $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = 'current'
        `, [
          sessionState.windows,  // PGLite JSONB handles serialization
          null  // focusedWindowId doesn't exist in old format
        ]);

        logger.main.info(`[PGLite Migration] Migrated session state with ${sessionState.windows.length} windows`);
      } else {
        logger.main.info('[PGLite Migration] No session state to migrate - sessionState:', sessionState);
      }
    } catch (error) {
      logger.main.error('[PGLite Migration] Failed to migrate session state:', error);
      throw error;
    }
  }

  /**
   * Migrate Document History
   */
  private async migrateDocumentHistory(): Promise<void> {
    logger.main.info('[PGLite Migration] Migrating document history...');

    try {
      // Import and use the HistoryManager's migration function
      const { historyManager } = await import('../HistoryManager');
      await historyManager.migrateToDatabase();
      logger.main.info('[PGLite Migration] Document history migrated');
    } catch (error) {
      logger.main.error('[PGLite Migration] Failed to migrate document history:', error);
      // Don't throw - history migration is not critical
    }
  }

  /**
   * Get migration status
   */
  getStatus(): { migrated: boolean; migratedAt: number | null; version: string } {
    return {
      migrated: this.migrationStore.get('migrated', false) as boolean,
      migratedAt: this.migrationStore.get('migratedAt', null) as number | null,
      version: this.migrationStore.get('version', '1.0.0') as string
    };
  }

  /**
   * Reset migration (for testing)
   */
  async reset(): Promise<void> {
    this.migrationStore.set('migrated', false);
    this.migrationStore.set('migratedAt', null);
    logger.main.info('[PGLite Migration] Migration status reset');
  }

  /**
   * Force re-migration (for testing)
   */
  async forceMigrate(): Promise<void> {
    await this.reset();
    await this.migrate();
  }
}

// Export singleton instance
export const migrationService = new PGLiteMigration();