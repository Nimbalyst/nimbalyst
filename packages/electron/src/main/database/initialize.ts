/**
 * Database Initialization Module
 * Handles PGLite database setup and migration on app startup
 */

import { app } from 'electron';
import path from 'path';
import { database } from './PGLiteDatabaseWorker';
import { logger } from '../utils/logger';
import type { SessionStore } from '@nimbalyst/runtime';
import { repositoryManager } from '../services/RepositoryManager';
import { DatabaseBackupService } from '../services/database/DatabaseBackupService';

// Backup service instance
let backupService: DatabaseBackupService | null = null;
let periodicBackupTimer: NodeJS.Timeout | null = null;
const BACKUP_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Initialize the database system
 * Should be called when the app is ready
 */
export async function initializeDatabase(): Promise<SessionStore> {
  if (repositoryManager.isInitialized()) {
    return repositoryManager.getSessionStore();
  }
  logger.main.info('[Database] Initializing PGLite database system...');

  try {
    // Get database path
    const userDataPath = process.env.PLAYWRIGHT === '1'
      ? path.join(app.getPath('temp'), 'nimbalyst-test-db')
      : app.getPath('userData');
    const dbPath = path.join(userDataPath, 'pglite-db');

    // Initialize backup service
    backupService = new DatabaseBackupService(dbPath, database);
    await backupService.initialize();
    logger.main.info('[Database] Backup service initialized');

    // Set backup service on database instance
    database.setBackupService(backupService);

    // Initialize PGLite database
    await database.initialize();
    logger.main.info('[Database] PGLite initialized successfully');

    // Initialize all repositories
    await repositoryManager.initialize();
    const sessionStore = repositoryManager.getSessionStore();
    logger.main.info('[Database] All repositories initialized');

    // Get database stats
    const stats = await database.getStats();
    logger.main.info('[Database] Database stats:', stats);

    // Start periodic backup timer (only in production, not in tests)
    if (process.env.PLAYWRIGHT !== '1') {
      periodicBackupTimer = setInterval(async () => {
        logger.main.info('[Database] Running periodic backup...');
        const result = await database.createBackup();
        if (result.success) {
          logger.main.info('[Database] Periodic backup completed successfully');
        } else {
          logger.main.warn('[Database] Periodic backup failed:', result.error);
        }
      }, BACKUP_INTERVAL_MS);

      logger.main.info(`[Database] Periodic backup enabled (every ${BACKUP_INTERVAL_MS / (60 * 60 * 1000)} hours)`);
    }

    // Note: Database backup on quit is handled in main/index.ts before-quit handler
    // This ensures it integrates properly with the quit sequence and force-quit timer

    logger.main.info('[Database] Database system ready');

    return sessionStore;
  } catch (error) {
    logger.main.error('[Database] Failed to initialize database:', error);
    // Don't throw in production - fall back to electron-store
    if (process.env.NODE_ENV === 'development') {
      throw error;
    }
    throw error;
  }
}

export function getRuntimeSessionStore(): SessionStore | null {
  return repositoryManager.isInitialized() ? repositoryManager.getSessionStore() : null;
}

/**
 * Get database instance (for other modules)
 */
export function getDatabase() {
  return database;
}

// Export database directly for protocol server
export { database };
