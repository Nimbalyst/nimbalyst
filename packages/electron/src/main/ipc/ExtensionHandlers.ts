/**
 * IPC handlers for extension-related operations.
 *
 * Provides handlers for:
 * - Getting the extensions directory
 * - Reading extension files
 * - Loading extension modules
 * - Directory listing
 */

import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';
import { minimatch } from 'minimatch';
import {
  getExtensionSettings,
  getExtensionEnabled,
  setExtensionEnabled,
  getExtensionConfiguration,
  setExtensionConfiguration,
  setExtensionConfigurationBulk,
  getWorkspaceExtensionConfiguration,
  setWorkspaceExtensionConfiguration,
  setWorkspaceExtensionConfigurationBulk,
} from '../utils/store';

/**
 * Get the path to the extensions directory.
 * Creates it if it doesn't exist.
 * In Playwright tests, uses a temp directory to avoid touching production extensions.
 */
async function getExtensionsDirectory(): Promise<string> {
  // Use test-specific path for Playwright tests to avoid conflicts
  const userDataPath = process.env.PLAYWRIGHT === '1'
    ? path.join(app.getPath('temp'), 'nimbalyst-test-extensions')
    : app.getPath('userData');
  const extensionsPath = path.join(userDataPath, 'extensions');

  try {
    await fs.mkdir(extensionsPath, { recursive: true });
  } catch (error) {
    // Directory already exists or other error
    logger.main.debug('[ExtensionHandlers] Extensions directory:', extensionsPath);
  }

  return extensionsPath;
}

/**
 * Register IPC handlers for extension operations.
 */
export function registerExtensionHandlers(): void {
  // Get the extensions directory path
  ipcMain.handle('extensions:get-directory', async () => {
    try {
      return await getExtensionsDirectory();
    } catch (error) {
      logger.main.error('[ExtensionHandlers] Failed to get extensions directory:', error);
      throw error;
    }
  });

  // List subdirectories in a directory
  // Note: This also follows symlinks to directories
  ipcMain.handle('extensions:list-directories', async (_event, dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const directories: string[] = [];

      for (const entry of entries) {
        // Check if it's a directory or a symlink to a directory
        if (entry.isDirectory()) {
          directories.push(entry.name);
        } else if (entry.isSymbolicLink()) {
          // For symlinks, check if the target is a directory
          try {
            const targetPath = path.join(dirPath, entry.name);
            const stat = await fs.stat(targetPath); // stat follows symlinks
            if (stat.isDirectory()) {
              directories.push(entry.name);
            }
          } catch {
            // Symlink target doesn't exist, skip
          }
        }
      }

      logger.main.debug('[ExtensionHandlers] Found directories:', directories);
      return directories;
    } catch (error) {
      logger.main.debug('[ExtensionHandlers] Failed to list directories:', error);
      return [];
    }
  });

  // Read a file as text
  ipcMain.handle('extensions:read-file', async (_event, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      logger.main.error(`[ExtensionHandlers] Failed to read file ${filePath}:`, error);
      throw error;
    }
  });

  // Write content to a file
  ipcMain.handle('extensions:write-file', async (_event, filePath: string, content: string) => {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      logger.main.error(`[ExtensionHandlers] Failed to write file ${filePath}:`, error);
      throw error;
    }
  });

  // Check if a file exists
  ipcMain.handle('extensions:file-exists', async (_event, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // Find files matching a glob pattern
  ipcMain.handle(
    'extensions:find-files',
    async (_event, dirPath: string, pattern: string) => {
      const matches: string[] = [];

      async function scanDirectory(dir: string): Promise<void> {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(dirPath, fullPath);

            if (entry.isDirectory()) {
              // Skip hidden directories and node_modules
              if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                await scanDirectory(fullPath);
              }
            } else {
              // Check if file matches the pattern
              if (minimatch(relativePath, pattern) || minimatch(entry.name, pattern)) {
                matches.push(fullPath);
              }
            }
          }
        } catch (error) {
          // Ignore permission errors
        }
      }

      try {
        await scanDirectory(dirPath);
        return matches;
      } catch (error) {
        logger.main.error('[ExtensionHandlers] Failed to find files:', error);
        return [];
      }
    }
  );

  // Resolve a path relative to an extension
  ipcMain.handle(
    'extensions:resolve-path',
    (_event, extensionPath: string, relativePath: string) => {
      return path.resolve(extensionPath, relativePath);
    }
  );

  // Get list of installed extensions (for settings UI)
  ipcMain.handle('extensions:list-installed', async () => {
    try {
      const extensionsDir = await getExtensionsDirectory();
      const subdirs = await fs.readdir(extensionsDir, { withFileTypes: true });
      const extensions: Array<{
        id: string;
        path: string;
        manifest: unknown;
      }> = [];

      for (const subdir of subdirs) {
        if (!subdir.isDirectory()) continue;

        const extensionPath = path.join(extensionsDir, subdir.name);
        const manifestPath = path.join(extensionPath, 'manifest.json');

        try {
          const manifestContent = await fs.readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(manifestContent);
          extensions.push({
            id: manifest.id || subdir.name,
            path: extensionPath,
            manifest,
          });
        } catch {
          // Skip directories without valid manifest
        }
      }

      return extensions;
    } catch (error) {
      logger.main.error('[ExtensionHandlers] Failed to list installed extensions:', error);
      return [];
    }
  });

  // Get all extension settings
  ipcMain.handle('extensions:get-all-settings', async () => {
    try {
      return getExtensionSettings();
    } catch (error) {
      logger.main.error('[ExtensionHandlers] Failed to get extension settings:', error);
      return {};
    }
  });

  // Get enabled state for a specific extension
  ipcMain.handle('extensions:get-enabled', async (_event, extensionId: string) => {
    try {
      return getExtensionEnabled(extensionId);
    } catch (error) {
      logger.main.error(`[ExtensionHandlers] Failed to get enabled state for ${extensionId}:`, error);
      return true; // Default to enabled
    }
  });

  // Set enabled state for a specific extension
  ipcMain.handle('extensions:set-enabled', async (_event, extensionId: string, enabled: boolean) => {
    try {
      setExtensionEnabled(extensionId, enabled);
      logger.main.info(`[ExtensionHandlers] Extension ${extensionId} ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true };
    } catch (error) {
      logger.main.error(`[ExtensionHandlers] Failed to set enabled state for ${extensionId}:`, error);
      return { success: false, error: String(error) };
    }
  });

  // Get configuration for a specific extension (scope-aware)
  // scope: 'user' for global config, 'workspace' for project-specific config
  ipcMain.handle('extensions:get-config', async (_event, extensionId: string, scope?: 'user' | 'workspace', workspacePath?: string) => {
    try {
      if (scope === 'workspace' && workspacePath) {
        return getWorkspaceExtensionConfiguration(workspacePath, extensionId);
      }
      return getExtensionConfiguration(extensionId);
    } catch (error) {
      logger.main.error(`[ExtensionHandlers] Failed to get config for ${extensionId}:`, error);
      return {};
    }
  });

  // Set a single configuration value for an extension (scope-aware)
  ipcMain.handle('extensions:set-config', async (_event, extensionId: string, key: string, value: unknown, scope?: 'user' | 'workspace', workspacePath?: string) => {
    try {
      if (scope === 'workspace' && workspacePath) {
        setWorkspaceExtensionConfiguration(workspacePath, extensionId, key, value);
      } else {
        setExtensionConfiguration(extensionId, key, value);
      }
      logger.main.info(`[ExtensionHandlers] Set config ${key} for ${extensionId} (scope: ${scope ?? 'user'})`);
      return { success: true };
    } catch (error) {
      logger.main.error(`[ExtensionHandlers] Failed to set config for ${extensionId}:`, error);
      return { success: false, error: String(error) };
    }
  });

  // Set all configuration values for an extension (scope-aware)
  ipcMain.handle('extensions:set-config-bulk', async (_event, extensionId: string, configuration: Record<string, unknown>, scope?: 'user' | 'workspace', workspacePath?: string) => {
    try {
      if (scope === 'workspace' && workspacePath) {
        setWorkspaceExtensionConfigurationBulk(workspacePath, extensionId, configuration);
      } else {
        setExtensionConfigurationBulk(extensionId, configuration);
      }
      logger.main.info(`[ExtensionHandlers] Set bulk config for ${extensionId} (scope: ${scope ?? 'user'})`);
      return { success: true };
    } catch (error) {
      logger.main.error(`[ExtensionHandlers] Failed to set bulk config for ${extensionId}:`, error);
      return { success: false, error: String(error) };
    }
  });

  logger.main.info('[ExtensionHandlers] Extension handlers registered');
}
