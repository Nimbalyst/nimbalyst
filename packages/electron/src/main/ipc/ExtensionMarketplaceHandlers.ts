/**
 * IPC handlers for the extension marketplace.
 *
 * Provides handlers for:
 * - Fetching the extension registry (mock for now, later from GitHub/Cloudflare)
 * - Installing extensions from the marketplace
 * - Installing extensions from GitHub URLs
 * - Uninstalling marketplace extensions
 * - Checking for updates
 * - Auto-updating extensions silently
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import { safeHandle } from '../utils/ipcRegistry';
import { getUserExtensionsDirectory, initializeExtensionFileTypes } from './ExtensionHandlers';
import {
  getMarketplaceInstalls,
  getMarketplaceInstall,
  addMarketplaceInstall,
  removeMarketplaceInstall,
  updateMarketplaceInstall,
  type MarketplaceInstallRecord,
} from '../utils/store';

// Import mock registry data
import mockRegistry from '../data/extensionRegistry.json';

// Registry cache
let registryCache: RegistryData | null = null;
let registryCacheTimestamp = 0;
const REGISTRY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// TODO: Replace with real registry URL when available
// const REGISTRY_URL = 'https://raw.githubusercontent.com/nimbalyst/extension-registry/main/registry.json';

export interface RegistryExtension {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  categories: string[];
  tags: string[];
  icon: string;
  screenshots: Array<{ src: string; alt: string }>;
  downloads: number;
  featured: boolean;
  permissions: string[];
  minimumAppVersion: string;
  downloadUrl: string;
  checksum: string;
  repositoryUrl: string;
  changelog: string;
}

export interface RegistryCategory {
  id: string;
  name: string;
  icon: string;
}

export interface RegistryData {
  schemaVersion: number;
  generatedAt: string;
  extensions: RegistryExtension[];
  categories: RegistryCategory[];
}

interface InstallResult {
  success: boolean;
  error?: string;
  extensionId?: string;
}

/**
 * Fetch registry data. Currently returns mock data.
 * Later: HTTPS GET from GitHub with caching.
 */
async function fetchRegistry(): Promise<RegistryData> {
  const now = Date.now();
  if (registryCache && (now - registryCacheTimestamp) < REGISTRY_CACHE_TTL_MS) {
    return registryCache;
  }

  // For now, use mock data. Later: fetch from REGISTRY_URL
  registryCache = mockRegistry as RegistryData;
  registryCacheTimestamp = now;
  return registryCache;
}

/**
 * Execute a git command safely.
 */
function execGit(args: string[], options?: { cwd?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd: options?.cwd,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git command failed (code ${code}): ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Recursively copy a directory.
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      // Skip .git directories
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Install an extension from a download URL (.nimext zip file).
 */
async function installFromUrl(
  extensionId: string,
  downloadUrl: string,
  checksum: string,
  version: string,
): Promise<InstallResult> {
  const extensionsDir = await getUserExtensionsDirectory();
  const installPath = path.join(extensionsDir, extensionId);

  try {
    logger.main.info(`[ExtMarketplace] Installing extension: ${extensionId} v${version}`);

    // If download URL is empty (mock data), return error
    if (!downloadUrl) {
      return { success: false, error: 'No download URL available (mock registry)' };
    }

    // TODO: Implement actual download and zip extraction when we have real .nimext files
    // For now, this is a placeholder for the full flow:
    // 1. Download .nimext file to temp dir
    // 2. Verify SHA256 checksum
    // 3. Extract zip to installPath
    // 4. Verify manifest.json exists
    // 5. Clean up temp file

    return { success: false, error: 'Download-based installation not yet implemented (mock registry)' };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.main.error(`[ExtMarketplace] Failed to install ${extensionId}:`, err);

    // Clean up partial installation
    try {
      await fs.rm(installPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * Install an extension from a GitHub repository URL.
 */
async function installFromGitHub(githubUrl: string): Promise<InstallResult> {
  const extensionsDir = await getUserExtensionsDirectory();

  // Parse GitHub URL
  const match = githubUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+))?(?:\/?$)/);
  if (!match) {
    return { success: false, error: `Invalid GitHub URL: ${githubUrl}` };
  }

  const [, repo, subdir] = match;
  const repoName = repo.split('/')[1];
  const tempDir = path.join(extensionsDir, `.tmp-${Date.now()}`);

  try {
    logger.main.info(`[ExtMarketplace] Installing from GitHub: ${githubUrl}`);

    // Clone the repository
    if (subdir) {
      // Sparse checkout for subdirectory
      await execGit(['clone', '--depth', '1', '--filter=blob:none', '--sparse', `https://github.com/${repo}.git`, tempDir]);
      await execGit(['sparse-checkout', 'set', subdir], { cwd: tempDir });
    } else {
      await execGit(['clone', '--depth', '1', `https://github.com/${repo}.git`, tempDir]);
    }

    // Find manifest.json
    const sourceDir = subdir ? path.join(tempDir, subdir) : tempDir;
    const manifestPath = path.join(sourceDir, 'manifest.json');

    let manifestContent: string;
    try {
      manifestContent = await fs.readFile(manifestPath, 'utf-8');
    } catch {
      return { success: false, error: 'No manifest.json found in repository. Is this a Nimbalyst extension?' };
    }

    let manifest: { id?: string; name?: string; version?: string };
    try {
      manifest = JSON.parse(manifestContent);
    } catch {
      return { success: false, error: 'Invalid manifest.json - could not parse JSON' };
    }

    if (!manifest.id) {
      return { success: false, error: 'manifest.json missing required "id" field' };
    }

    const extensionId = manifest.id;
    const installPath = path.join(extensionsDir, extensionId);

    // Check if already installed
    try {
      await fs.access(installPath);
      // Remove existing installation
      await fs.rm(installPath, { recursive: true, force: true });
    } catch {
      // Not installed yet, that's fine
    }

    // Copy to extensions directory (excluding .git and node_modules)
    await copyDirectory(sourceDir, installPath);

    // Check if there's a dist/ directory; if not, check if there's a package.json and build
    const distPath = path.join(installPath, 'dist');
    try {
      await fs.access(distPath);
    } catch {
      // No dist directory - check if there's a package.json to build
      const pkgJsonPath = path.join(installPath, 'package.json');
      try {
        await fs.access(pkgJsonPath);
        logger.main.info(`[ExtMarketplace] Extension needs building - run 'npm install && npm run build' in ${installPath}`);
        // We don't auto-build here because it could be slow and error-prone.
        // The user can use the extension dev tools to build it.
      } catch {
        // No package.json either - extension might be pre-built or not need building
      }
    }

    // Track the install
    addMarketplaceInstall({
      extensionId,
      version: manifest.version || '0.0.0',
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      downloadUrl: '',
      checksum: '',
      source: 'github-url',
      githubUrl,
    });

    // Re-register file types
    await initializeExtensionFileTypes();

    // Notify renderer to reload extensions
    notifyExtensionsChanged();

    logger.main.info(`[ExtMarketplace] Successfully installed ${extensionId} from GitHub`);
    return { success: true, extensionId };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.main.error(`[ExtMarketplace] Failed to install from GitHub:`, err);
    return { success: false, error: errorMsg };
  } finally {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Uninstall a marketplace-installed extension.
 */
async function uninstallExtension(extensionId: string): Promise<InstallResult> {
  const extensionsDir = await getUserExtensionsDirectory();
  const installPath = path.join(extensionsDir, extensionId);

  try {
    logger.main.info(`[ExtMarketplace] Uninstalling extension: ${extensionId}`);

    // Verify it's a marketplace install
    const record = getMarketplaceInstall(extensionId);
    if (!record) {
      return { success: false, error: `Extension ${extensionId} was not installed via marketplace` };
    }

    // Remove the extension directory
    try {
      await fs.rm(installPath, { recursive: true, force: true });
    } catch (err) {
      logger.main.warn(`[ExtMarketplace] Could not remove extension directory: ${err}`);
    }

    // Remove from tracking
    removeMarketplaceInstall(extensionId);

    // Re-register file types
    await initializeExtensionFileTypes();

    // Notify renderer
    notifyExtensionsChanged();

    logger.main.info(`[ExtMarketplace] Successfully uninstalled ${extensionId}`);
    return { success: true, extensionId };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.main.error(`[ExtMarketplace] Failed to uninstall ${extensionId}:`, err);
    return { success: false, error: errorMsg };
  }
}

/**
 * Check for available updates by comparing installed versions against registry.
 */
async function checkForUpdates(): Promise<Array<{ extensionId: string; currentVersion: string; availableVersion: string }>> {
  const registry = await fetchRegistry();
  const installs = getMarketplaceInstalls();
  const updates: Array<{ extensionId: string; currentVersion: string; availableVersion: string }> = [];

  for (const [extensionId, record] of Object.entries(installs)) {
    const registryEntry = registry.extensions.find(e => e.id === extensionId);
    if (registryEntry && registryEntry.version !== record.version) {
      // Simple string comparison for now. Could use semver later.
      updates.push({
        extensionId,
        currentVersion: record.version,
        availableVersion: registryEntry.version,
      });
    }
  }

  return updates;
}

/**
 * Send IPC event to all renderer windows that extensions have changed.
 */
function notifyExtensionsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('extensions:list-changed');
    }
  }
}

/**
 * Register all marketplace IPC handlers.
 */
export function registerExtensionMarketplaceHandlers(): void {
  // Fetch registry
  safeHandle('extension-marketplace:fetch-registry', async () => {
    try {
      const data = await fetchRegistry();
      return { success: true, data };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.main.error('[ExtMarketplace] Failed to fetch registry:', error);
      return { success: false, error: message };
    }
  });

  // Get marketplace-installed extensions
  safeHandle('extension-marketplace:get-installed', async () => {
    try {
      const installs = getMarketplaceInstalls();
      return { success: true, data: installs };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  });

  // Install from marketplace (download URL)
  safeHandle('extension-marketplace:install', async (_event, extensionId: string, downloadUrl: string, checksum: string, version: string) => {
    if (!extensionId) {
      return { success: false, error: 'Extension ID is required' };
    }
    return await installFromUrl(extensionId, downloadUrl, checksum, version);
  });

  // Install from GitHub URL
  safeHandle('extension-marketplace:install-from-github', async (_event, githubUrl: string) => {
    if (!githubUrl) {
      return { success: false, error: 'GitHub URL is required' };
    }
    return await installFromGitHub(githubUrl);
  });

  // Uninstall extension
  safeHandle('extension-marketplace:uninstall', async (_event, extensionId: string) => {
    if (!extensionId) {
      return { success: false, error: 'Extension ID is required' };
    }
    return await uninstallExtension(extensionId);
  });

  // Check for updates
  safeHandle('extension-marketplace:check-updates', async () => {
    try {
      const updates = await checkForUpdates();
      return { success: true, data: updates };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  });

  // Auto-update: silently update all extensions with available updates
  safeHandle('extension-marketplace:auto-update', async () => {
    try {
      const updates = await checkForUpdates();
      if (updates.length === 0) {
        return { success: true, data: { updated: [] } };
      }

      const registry = await fetchRegistry();
      const updated: Array<{ extensionId: string; fromVersion: string; toVersion: string }> = [];

      for (const update of updates) {
        const registryEntry = registry.extensions.find(e => e.id === update.extensionId);
        if (!registryEntry || !registryEntry.downloadUrl) continue;

        const result = await installFromUrl(
          update.extensionId,
          registryEntry.downloadUrl,
          registryEntry.checksum,
          registryEntry.version,
        );

        if (result.success) {
          updated.push({
            extensionId: update.extensionId,
            fromVersion: update.currentVersion,
            toVersion: update.availableVersion,
          });
        }
      }

      if (updated.length > 0) {
        logger.main.info(`[ExtMarketplace] Auto-updated ${updated.length} extensions`);
      }

      return { success: true, data: { updated } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.main.error('[ExtMarketplace] Auto-update failed:', error);
      return { success: false, error: message };
    }
  });

  // Clear cache
  safeHandle('extension-marketplace:clear-cache', async () => {
    registryCache = null;
    registryCacheTimestamp = 0;
    return { success: true };
  });
}
