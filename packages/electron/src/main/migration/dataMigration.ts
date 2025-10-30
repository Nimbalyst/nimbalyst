import { app } from 'electron';
import { existsSync, readdirSync, statSync, copyFileSync, mkdirSync, renameSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { logger } from '../utils/logger';
import { AnalyticsService } from '../services/analytics/AnalyticsService';

// Helper function to bucket time in milliseconds
function bucketMigrationTime(ms: number): 'fast' | 'medium' | 'slow' {
    if (ms < 1000) return 'fast';  // < 1 second
    if (ms < 5000) return 'medium';  // 1-5 seconds
    return 'slow';  // > 5 seconds
}

// Helper function to bucket record count
function bucketRecordCount(count: number): string {
    if (count === 0) return '0';
    if (count < 10) return '1-9';
    if (count < 50) return '10-49';
    if (count < 100) return '50-99';
    return '100+';
}

/**
 * Migrates user data from old app locations to new location
 * Old paths to check (in order of precedence):
 * 1. ~/Library/Application Support/@preditor/electron/
 * 2. ~/Library/Application Support/@stravu-editor/electron/
 * New: ~/Library/Application Support/@nimbalyst/electron/
 */
export async function migrateUserData(): Promise<boolean> {
    const analytics = AnalyticsService.getInstance();
    const startTime = Date.now();
    let recordCount = 0;
    let hadErrors = false;

    try {
        const platform = process.platform;
        const homeDir = app.getPath('home');

        let oldPaths: string[] = [];
        let newPath: string = app.getPath('userData');

        // Determine old paths based on platform (check Nimbalyst first, then stravu-editor)
        if (platform === 'darwin') {
            // macOS
            oldPaths = [
                join(homeDir, 'Library', 'Application Support', '@preditor', 'electron'),
                join(homeDir, 'Library', 'Application Support', '@stravu-editor', 'electron')
            ];
        } else if (platform === 'win32') {
            // Windows
            oldPaths = [
                join(homeDir, 'AppData', 'Roaming', '@preditor', 'electron'),
                join(homeDir, 'AppData', 'Roaming', '@stravu-editor', 'electron')
            ];
        } else {
            // Linux
            oldPaths = [
                join(homeDir, '.config', '@preditor', 'electron'),
                join(homeDir, '.config', '@stravu-editor', 'electron')
            ];
        }

        // Find the first existing old path
        let oldPath: string | undefined;
        let migrationSource: string | undefined;
        for (const path of oldPaths) {
            if (existsSync(path)) {
                oldPath = path;
                migrationSource = path.includes('@preditor') ? 'preditor' : 'stravu-editor';
                break;
            }
        }
        
        // Check if old directory exists and new directory doesn't have data yet
        if (!oldPath) {
            logger.main.info('No old user data found to migrate');
            return false;
        }
        
        // Check if new directory already has a config file (already migrated or fresh install)
        const newConfigPath = join(newPath, 'config.json');
        if (existsSync(newConfigPath)) {
            logger.main.info('User data already exists in new location, skipping migration');
            return false;
        }
        
        logger.main.info(`Migrating user data from ${migrationSource} (${oldPath}) to ${newPath}`);
        
        // Create new directory if it doesn't exist
        if (!existsSync(newPath)) {
            mkdirSync(newPath, { recursive: true });
        }
        
        // List of important files to migrate
        const filesToMigrate = [
            'config.json',           // Main electron-store config
            'ai-sessions.json',      // AI chat sessions
            'ai-settings.json',      // AI provider settings
            'preferences.json',      // App preferences
            'claude-code-sessions.json',
            'claude-code-settings.json',
            'claude-sessions.json'
        ];
        
        // List of important directories to migrate
        const dirsToMigrate = [
            'history',               // Document history
            'logs',                  // Application logs
            'sessions',              // Session data
            'pglite-db'              // PGLite database
        ];
        
        // Migrate files
        for (const file of filesToMigrate) {
            const oldFilePath = join(oldPath, file);
            const newFilePath = join(newPath, file);

            if (existsSync(oldFilePath)) {
                try {
                    copyFileSync(oldFilePath, newFilePath);
                    recordCount++;
                    logger.main.info(`Migrated file: ${file}`);
                } catch (error) {
                    hadErrors = true;
                    logger.main.error(`Failed to migrate file ${file}:`, error);
                }
            }
        }
        
        // Migrate directories
        for (const dir of dirsToMigrate) {
            const oldDirPath = join(oldPath, dir);
            const newDirPath = join(newPath, dir);

            if (existsSync(oldDirPath) && statSync(oldDirPath).isDirectory()) {
                try {
                    copyDirectory(oldDirPath, newDirPath);
                    // Count files in directory
                    const filesInDir = readdirSync(oldDirPath).length;
                    recordCount += filesInDir;
                    logger.main.info(`Migrated directory: ${dir}`);
                } catch (error) {
                    hadErrors = true;
                    logger.main.error(`Failed to migrate directory ${dir}:`, error);
                }
            }
        }
        
        // Update debug log filename references in migrated files
        try {
            if (existsSync(newConfigPath)) {
                const configContent = readFileSync(newConfigPath, 'utf8');
                let updatedContent = configContent.replace(/stravu-editor-debug\.log/g, 'nimbalyst-debug.log');
                updatedContent = updatedContent.replace(/preditor-debug\.log/g, 'nimbalyst-debug.log');
                writeFileSync(newConfigPath, updatedContent);
            }
        } catch (error) {
            logger.main.error('Failed to update debug log references:', error);
        }

        // Create a migration marker file
        const migrationMarker = join(newPath, `.migrated-from-${migrationSource}`);
        writeFileSync(migrationMarker, new Date().toISOString());

        logger.main.info('User data migration completed successfully');

        // Track successful migration
        const migrationTime = Date.now() - startTime;
        analytics.sendEvent('history_migration_completed', {
            recordCount: bucketRecordCount(recordCount),
            migrationTime: bucketMigrationTime(migrationTime),
            hadErrors
        });

        return true;

    } catch (error) {
        hadErrors = true;
        logger.main.error('Failed to migrate user data:', error);

        // Track failed migration
        const migrationTime = Date.now() - startTime;
        analytics.sendEvent('history_migration_completed', {
            recordCount: bucketRecordCount(recordCount),
            migrationTime: bucketMigrationTime(migrationTime),
            hadErrors: true
        });

        return false;
    }
}

/**
 * Recursively copy a directory
 */
function copyDirectory(source: string, destination: string): void {
    // Create destination directory if it doesn't exist
    if (!existsSync(destination)) {
        mkdirSync(destination, { recursive: true });
    }
    
    // Read all items in source directory
    const items = readdirSync(source);
    
    for (const item of items) {
        const sourcePath = join(source, item);
        const destPath = join(destination, item);
        
        const stat = statSync(sourcePath);
        
        if (stat.isDirectory()) {
            // Recursively copy subdirectory
            copyDirectory(sourcePath, destPath);
        } else {
            // Copy file
            copyFileSync(sourcePath, destPath);
        }
    }
}

/**
 * Clean up old user data after successful migration
 * This should only be called after confirming the migration was successful
 */
export function cleanupOldUserData(): void {
    try {
        const platform = process.platform;
        const homeDir = app.getPath('home');

        let oldPaths: string[];

        // Determine old paths based on platform
        if (platform === 'darwin') {
            oldPaths = [
                join(homeDir, 'Library', 'Application Support', '@preditor'),
                join(homeDir, 'Library', 'Application Support', '@stravu-editor')
            ];
        } else if (platform === 'win32') {
            oldPaths = [
                join(homeDir, 'AppData', 'Roaming', '@preditor'),
                join(homeDir, 'AppData', 'Roaming', '@stravu-editor')
            ];
        } else {
            oldPaths = [
                join(homeDir, '.config', '@preditor'),
                join(homeDir, '.config', '@stravu-editor')
            ];
        }

        // Check if migration marker exists in new location
        const newPath = app.getPath('userData');
        const migrationMarkers = [
            join(newPath, '.migrated-from-preditor'),
            join(newPath, '.migrated-from-stravu-editor')
        ];

        const hasMigrationMarker = migrationMarkers.some(marker => existsSync(marker));
        if (!hasMigrationMarker) {
            logger.main.info('Migration marker not found, skipping cleanup');
            return;
        }

        // Rename old directories to backup instead of deleting
        for (const oldPath of oldPaths) {
            if (existsSync(oldPath)) {
                const backupPath = `${oldPath}.backup-${Date.now()}`;
                renameSync(oldPath, backupPath);
                logger.main.info(`Moved old user data to backup: ${backupPath}`);
            }
        }

    } catch (error) {
        logger.main.error('Failed to cleanup old user data:', error);
    }
}