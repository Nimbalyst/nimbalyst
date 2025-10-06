import { app } from 'electron';
import { existsSync, readdirSync, statSync, copyFileSync, mkdirSync, renameSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { logger } from '../utils/logger';

/**
 * Migrates user data from old app location to new location
 * Old: ~/Library/Application Support/@stravu-editor/electron/
 * New: ~/Library/Application Support/Preditor/
 */
export async function migrateUserData(): Promise<boolean> {
    try {
        const platform = process.platform;
        const homeDir = app.getPath('home');
        
        let oldPath: string;
        let newPath: string = app.getPath('userData');
        
        // Determine old path based on platform
        if (platform === 'darwin') {
            // macOS
            oldPath = join(homeDir, 'Library', 'Application Support', '@stravu-editor', 'electron');
        } else if (platform === 'win32') {
            // Windows
            oldPath = join(homeDir, 'AppData', 'Roaming', '@stravu-editor', 'electron');
        } else {
            // Linux
            oldPath = join(homeDir, '.config', '@stravu-editor', 'electron');
        }
        
        // Check if old directory exists and new directory doesn't have data yet
        if (!existsSync(oldPath)) {
            logger.main.info('No old user data found to migrate');
            return false;
        }
        
        // Check if new directory already has a config file (already migrated or fresh install)
        const newConfigPath = join(newPath, 'config.json');
        if (existsSync(newConfigPath)) {
            logger.main.info('User data already exists in new location, skipping migration');
            return false;
        }
        
        logger.main.info(`Migrating user data from ${oldPath} to ${newPath}`);
        
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
            'sessions'               // Session data
        ];
        
        // Migrate files
        for (const file of filesToMigrate) {
            const oldFilePath = join(oldPath, file);
            const newFilePath = join(newPath, file);
            
            if (existsSync(oldFilePath)) {
                try {
                    copyFileSync(oldFilePath, newFilePath);
                    logger.main.info(`Migrated file: ${file}`);
                } catch (error) {
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
                    logger.main.info(`Migrated directory: ${dir}`);
                } catch (error) {
                    logger.main.error(`Failed to migrate directory ${dir}:`, error);
                }
            }
        }
        
        // Update debug log filename references in migrated files
        try {
            if (existsSync(newConfigPath)) {
                const configContent = readFileSync(newConfigPath, 'utf8');
                const updatedContent = configContent.replace(/stravu-editor-debug\.log/g, 'preditor-debug.log');
                writeFileSync(newConfigPath, updatedContent);
            }
        } catch (error) {
            logger.main.error('Failed to update debug log references:', error);
        }
        
        // Create a migration marker file
        const migrationMarker = join(newPath, '.migrated-from-stravu-editor');
        writeFileSync(migrationMarker, new Date().toISOString());
        
        logger.main.info('User data migration completed successfully');
        return true;
        
    } catch (error) {
        logger.main.error('Failed to migrate user data:', error);
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
        
        let oldPath: string;
        
        // Determine old path based on platform
        if (platform === 'darwin') {
            oldPath = join(homeDir, 'Library', 'Application Support', '@stravu-editor');
        } else if (platform === 'win32') {
            oldPath = join(homeDir, 'AppData', 'Roaming', '@stravu-editor');
        } else {
            oldPath = join(homeDir, '.config', '@stravu-editor');
        }
        
        // Check if migration marker exists in new location
        const newPath = app.getPath('userData');
        const migrationMarker = join(newPath, '.migrated-from-stravu-editor');
        
        if (!existsSync(migrationMarker)) {
            logger.main.info('Migration marker not found, skipping cleanup');
            return;
        }
        
        // Rename old directory to backup instead of deleting
        if (existsSync(oldPath)) {
            const backupPath = `${oldPath}.backup-${Date.now()}`;
            renameSync(oldPath, backupPath);
            logger.main.info(`Moved old user data to backup: ${backupPath}`);
        }
        
    } catch (error) {
        logger.main.error('Failed to cleanup old user data:', error);
    }
}