/**
 * Theme IPC Handlers
 *
 * Handles theme discovery, installation, validation, and management.
 */

import { ThemeLoader } from '@nimbalyst/runtime/themes/ThemeLoader';
import type {
  Theme,
  ThemeManifest,
  ThemeValidationResult,
} from '@nimbalyst/extension-sdk';
import { safeHandle } from '../utils/ipcRegistry';
import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';

/**
 * Platform service implementation for Electron.
 */
class ElectronThemePlatformService {
  async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf-8');
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async isDirectory(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async readDirectory(dirPath: string): Promise<string[]> {
    return await fs.readdir(dirPath);
  }

  async getFileSize(filePath: string): Promise<number> {
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  joinPath(...segments: string[]): string {
    return path.join(...segments);
  }

  getExtension(filePath: string): string {
    return path.extname(filePath);
  }

  getBaseName(filePath: string): string {
    return path.basename(filePath);
  }
}

// Initialize theme loader
const platformService = new ElectronThemePlatformService();
const themeLoader = new ThemeLoader(platformService);

// Track if handlers are registered
let handlersRegistered = false;

/**
 * Get the user themes directory path.
 * Creates the directory if it doesn't exist.
 */
async function getUserThemesDir(): Promise<string> {
  const userDataPath = app.getPath('userData');
  const themesDir = path.join(userDataPath, 'themes');

  // Ensure directory exists
  try {
    await fs.mkdir(themesDir, { recursive: true });
  } catch (err) {
    console.error('Failed to create themes directory:', err);
  }

  return themesDir;
}

/**
 * Get the built-in themes directory path.
 */
function getBuiltInThemesDir(): string {
  // Built-in themes are in the runtime package
  // In development: packages/runtime/src/themes/builtin
  // In production: app.asar/node_modules/@nimbalyst/runtime/dist/themes/builtin
  const appPath = app.getAppPath();
  const isDev = !app.isPackaged;

  if (isDev) {
    // Development: appPath is packages/electron, so go up one level to packages/
    // then into runtime/src/themes/builtin
    return path.join(appPath, '..', 'runtime', 'src', 'themes', 'builtin');
  } else {
    // Production: Themes are bundled with runtime package
    return path.join(appPath, 'node_modules', '@nimbalyst', 'runtime', 'dist', 'themes', 'builtin');
  }
}

export async function registerThemeHandlers() {
  if (handlersRegistered) {
    console.log('[ThemeHandlers] Handlers already registered, skipping');
    return;
  }

  // Discover themes on startup
  const userThemesDir = await getUserThemesDir();
  const builtInThemesDir = getBuiltInThemesDir();

  console.log('[ThemeHandlers] User themes directory:', userThemesDir);
  console.log('[ThemeHandlers] Built-in themes directory:', builtInThemesDir);

  const userThemes = await themeLoader.discoverThemes(userThemesDir);
  const builtInThemes = await themeLoader.discoverThemes(builtInThemesDir);

  console.log('[ThemeHandlers] Discovered', userThemes.length, 'user themes');
  console.log('[ThemeHandlers] Discovered', builtInThemes.length, 'built-in themes');

  // List all discovered themes
  safeHandle('theme:list', async () => {
    const discovered = themeLoader.getDiscoveredThemes();
    return discovered.map(d => d.manifest);
  });

  // Get a specific theme by ID
  safeHandle('theme:get', async (event, themeId: string) => {
    const result = await themeLoader.loadTheme(themeId);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.theme;
  });

  // Validate a theme directory
  safeHandle('theme:validate', async (event, themePath: string) => {
    try {
      // Read manifest
      const manifestPath = path.join(themePath, 'theme.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent) as ThemeManifest;

      // Validate
      return await themeLoader.validateTheme(themePath, manifest);
    } catch (err) {
      return {
        valid: false,
        errors: [`Failed to validate theme: ${err}`],
        warnings: [],
      } as ThemeValidationResult;
    }
  });

  // Install a theme from a directory or .nimtheme file
  safeHandle('theme:install', async (event, sourcePath: string, overwrite = false) => {
    const userThemesDir = await getUserThemesDir();

    try {
      // Check if source is a .nimtheme file (zip)
      const ext = path.extname(sourcePath);
      if (ext === '.nimtheme') {
        // TODO: Extract zip to temporary directory
        // For now, just throw an error
        throw new Error('.nimtheme installation not yet implemented');
      }

      // Source is a directory
      const manifestPath = path.join(sourcePath, 'theme.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent) as ThemeManifest;

      // Validate theme
      const validation = await themeLoader.validateTheme(sourcePath, manifest);
      if (!validation.valid) {
        throw new Error(`Theme validation failed: ${validation.errors.join(', ')}`);
      }

      // Check if theme already exists
      const targetPath = path.join(userThemesDir, manifest.id);
      const exists = await platformService.exists(targetPath);
      if (exists && !overwrite) {
        throw new Error(`Theme '${manifest.id}' already exists. Use overwrite option to replace.`);
      }

      // Copy theme directory
      await fs.cp(sourcePath, targetPath, { recursive: true });

      // Reload themes
      await themeLoader.reload(userThemesDir);

      // Load the newly installed theme
      const result = await themeLoader.loadTheme(manifest.id);
      if (!result.success) {
        throw new Error(result.error);
      }

      return {
        success: true,
        theme: result.theme,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Uninstall a theme
  safeHandle('theme:uninstall', async (event, themeId: string) => {
    const userThemesDir = await getUserThemesDir();

    try {
      // Find theme
      const discovered = themeLoader.getDiscoveredThemes();
      const theme = discovered.find(t => t.id === themeId);

      if (!theme) {
        throw new Error(`Theme '${themeId}' not found`);
      }

      // Check if theme is in user directory (can't uninstall built-in themes)
      if (!theme.path.startsWith(userThemesDir)) {
        throw new Error(`Cannot uninstall built-in theme '${themeId}'`);
      }

      // Delete theme directory
      await fs.rm(theme.path, { recursive: true, force: true });

      // Reload themes
      await themeLoader.reload(userThemesDir);

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Reload themes (rescan directories)
  safeHandle('theme:reload', async () => {
    const userThemesDir = await getUserThemesDir();
    const builtInThemesDir = getBuiltInThemesDir();

    await themeLoader.reload(userThemesDir);
    await themeLoader.discoverThemes(builtInThemesDir);

    return { success: true };
  });

  handlersRegistered = true;
  console.log('[ThemeHandlers] Handlers registered successfully');
}
