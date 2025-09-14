/**
 * Database Initialization Module
 * Handles PGLite database setup and migration on app startup
 */

import { app } from 'electron';
import { database } from './PGLiteDatabaseWorker';
import { migrationService } from './PGLiteMigration';
import { logger } from '../utils/logger';
import { enablePGLite } from '../utils/store';

/**
 * Initialize the database system
 * Should be called when the app is ready
 */
export async function initializeDatabase(): Promise<void> {
  logger.main.info('[Database] Initializing PGLite database system...');

  try {
    // Initialize PGLite database
    await database.initialize();
    logger.main.info('[Database] PGLite initialized successfully');

    // Enable PGLite in the store utilities
    enablePGLite();

    // Check if migration is needed
    if (!migrationService.isMigrated()) {
      logger.main.info('[Database] Starting data migration from electron-store to PGLite...');
      await migrationService.migrate();
      logger.main.info('[Database] Data migration completed');
    } else {
      const status = migrationService.getStatus();
      logger.main.info('[Database] Data already migrated', {
        migratedAt: new Date(status.migratedAt!).toISOString(),
        version: status.version
      });
    }

    // Get database stats
    const stats = await database.getStats();
    logger.main.info('[Database] Database stats:', stats);

    // Set up cleanup on app quit
    app.on('before-quit', async () => {
      logger.main.info('[Database] Closing database connection...');
      await database.close();
    });

    logger.main.info('[Database] Database system ready');
  } catch (error) {
    logger.main.error('[Database] Failed to initialize database:', error);
    // Don't throw in production - fall back to electron-store
    if (process.env.NODE_ENV === 'development') {
      throw error;
    }
  }
}

/**
 * Get database instance (for other modules)
 */
export function getDatabase() {
  return database;
}

// Export database directly for protocol server
export { database };

/**
 * Get migration status
 */
export function getMigrationStatus() {
  return migrationService.getStatus();
}