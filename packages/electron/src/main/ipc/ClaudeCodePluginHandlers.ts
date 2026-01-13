import { safeHandle } from '../utils/ipcRegistry';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import https from 'https';
import { spawn } from 'child_process';

// Marketplace data cache
let marketplaceCache: MarketplaceData | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface MarketplacePlugin {
  name: string;
  description: string;
  author: string;
  homepage?: string;
  source: string;
  category: string;
}

interface MarketplaceData {
  plugins: MarketplacePlugin[];
  categories: string[];
  lastUpdated?: string;
}

interface InstalledPlugin {
  name: string;
  path: string;
  enabled: boolean;
}

// Structure of installed_plugins.json (matches Claude CLI format)
interface InstalledPluginsJson {
  version: number;
  plugins: Record<string, Array<{
    scope: 'user' | 'project';
    projectPath?: string;
    installPath: string;
    version: string;
    installedAt: string;
    lastUpdated: string;
    gitCommitSha?: string;
  }>>;
}

const INSTALLED_PLUGINS_VERSION = 2;

// Author can be a string or an object with name/email
type RawAuthor = string | { name?: string; email?: string };

// Helper to normalize author to a string
function normalizeAuthor(author: RawAuthor | undefined, defaultValue: string): string {
  if (!author) return defaultValue;
  if (typeof author === 'string') return author;
  if (typeof author === 'object' && author.name) return author.name;
  return defaultValue;
}

// Raw marketplace.json structure from GitHub
interface RawMarketplace {
  $schema?: string;
  name?: string;
  description?: string;
  plugins?: Array<{
    name: string;
    description?: string;
    author?: RawAuthor;
    homepage?: string;
    source?: string;
    directory?: string;
    category?: string;
  }>;
  external_plugins?: Array<{
    name: string;
    description?: string;
    author?: RawAuthor;
    homepage?: string;
    source?: string;
    directory?: string;
    category?: string;
  }>;
}

const MARKETPLACE_URL = 'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json';
const MARKETPLACE_REPO = 'anthropics/claude-plugins-official';

/**
 * Normalize source - just pass through for now
 */
function normalizeSource(source: unknown): string {
  if (!source || typeof source !== 'string') return '';
  return source;
}

/**
 * Fetch marketplace data from GitHub
 */
async function fetchMarketplace(): Promise<MarketplaceData> {
  const now = Date.now();
  if (marketplaceCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return marketplaceCache;
  }

  return new Promise((resolve, reject) => {
    https.get(MARKETPLACE_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch marketplace: HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const raw: RawMarketplace = JSON.parse(data);
          const plugins: MarketplacePlugin[] = [];
          const categories = new Set<string>();

          if (raw.plugins && Array.isArray(raw.plugins)) {
            raw.plugins.forEach(p => {
              const category = p.category || 'development';
              categories.add(category);
              plugins.push({
                name: p.name,
                description: p.description || '',
                author: normalizeAuthor(p.author, 'Anthropic'),
                homepage: p.homepage,
                source: normalizeSource(p.source || p.directory),
                category,
              });
            });
          }

          if (raw.external_plugins && Array.isArray(raw.external_plugins)) {
            raw.external_plugins.forEach(p => {
              const category = p.category || 'external';
              categories.add(category);
              plugins.push({
                name: p.name,
                description: p.description || '',
                author: normalizeAuthor(p.author, 'Community'),
                homepage: p.homepage,
                source: normalizeSource(p.source || p.directory),
                category,
              });
            });
          }

          const result: MarketplaceData = {
            plugins,
            categories: Array.from(categories),
            lastUpdated: new Date().toISOString(),
          };

          marketplaceCache = result;
          cacheTimestamp = now;
          resolve(result);
        } catch (err) {
          reject(new Error(`Failed to parse marketplace JSON: ${err}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`Network error fetching marketplace: ${err.message}`));
    });
  });
}

/**
 * Get the Claude Code plugins directory
 */
function getPluginsDirectory(): string {
  return path.join(os.homedir(), '.claude', 'plugins');
}

/**
 * Get the installed_plugins.json path
 */
function getInstalledPluginsJsonPath(): string {
  return path.join(getPluginsDirectory(), 'installed_plugins.json');
}

/**
 * Read the installed_plugins.json file
 */
async function readInstalledPluginsJson(): Promise<InstalledPluginsJson> {
  const jsonPath = getInstalledPluginsJsonPath();
  try {
    const content = await fsPromises.readFile(jsonPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    // File doesn't exist or is invalid, return empty structure
    return { version: INSTALLED_PLUGINS_VERSION, plugins: {} };
  }
}

/**
 * Write the installed_plugins.json file
 */
async function writeInstalledPluginsJson(data: InstalledPluginsJson): Promise<void> {
  const jsonPath = getInstalledPluginsJsonPath();
  const pluginsDir = getPluginsDirectory();

  // Ensure plugins directory exists
  await fsPromises.mkdir(pluginsDir, { recursive: true });

  await fsPromises.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * List installed plugins from installed_plugins.json (user scope only)
 */
async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  const plugins: InstalledPlugin[] = [];

  try {
    const installedJson = await readInstalledPluginsJson();

    for (const [pluginKey, installations] of Object.entries(installedJson.plugins)) {
      // Only include user-scoped plugins
      for (const installation of installations) {
        if (installation.scope === 'user') {
          // Verify the path still exists
          try {
            await fsPromises.access(installation.installPath);
            // Extract plugin name from key (format: pluginName@source)
            const pluginName = pluginKey.split('@')[0];
            plugins.push({
              name: pluginName,
              path: installation.installPath,
              enabled: true,
            });
          } catch {
            logger.main.warn(`[ClaudePlugins] Plugin path not found: ${installation.installPath}`);
          }
        }
      }
    }
  } catch (err) {
    logger.main.error('[ClaudePlugins] Failed to list installed plugins:', err);
  }

  return plugins;
}

/**
 * Download a file from URL to a local path
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const request = (urlToFetch: string) => {
      https.get(urlToFetch, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            request(redirectUrl);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        file.close();
        fs.unlinkSync(destPath);
        reject(err);
      });
    };

    request(url);
  });
}

/**
 * Execute a git command safely using spawn
 */
function execGit(args: string[], options?: { cwd?: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd: options?.cwd,
      stdio: 'pipe',
    });

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git command failed: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Clone a GitHub repository subdirectory using sparse checkout
 */
async function cloneGitHubSubdirectory(
  repo: string,
  subdirectory: string,
  destPath: string
): Promise<void> {
  // Create a temp directory for the clone
  const tempDir = path.join(os.tmpdir(), `claude-plugin-${Date.now()}`);
  let copyCompleted = false;

  try {
    // Clone with sparse checkout
    await execGit([
      'clone',
      '--depth', '1',
      '--filter=blob:none',
      '--sparse',
      `https://github.com/${repo}.git`,
      tempDir
    ]);

    // Set sparse-checkout to the specific directory
    await execGit(['sparse-checkout', 'set', subdirectory], { cwd: tempDir });

    // Move the subdirectory to destination
    const sourcePath = path.join(tempDir, subdirectory);

    // Ensure destination parent exists
    await fsPromises.mkdir(path.dirname(destPath), { recursive: true });

    // Copy the directory
    await copyDirectory(sourcePath, destPath);
    copyCompleted = true;

  } finally {
    // Always clean up temp directory after copy completes or on error
    try {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      logger.main.warn(`[ClaudePlugins] Failed to cleanup temp directory ${tempDir}:`, cleanupErr);
    }
  }
}

/**
 * Recursively copy a directory
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fsPromises.mkdir(dest, { recursive: true });
  const entries = await fsPromises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fsPromises.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Get the git commit SHA for a repo
 */
async function getGitCommitSha(repoPath: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      stdio: 'pipe',
    });

    let stdout = '';
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        resolve('unknown');
      }
    });

    proc.on('error', () => {
      resolve('unknown');
    });
  });
}

/**
 * Install a plugin directly by downloading from GitHub
 */
async function installPlugin(pluginName: string, source: string): Promise<{ success: boolean; error?: string }> {
  // Determine source name and plugin key
  let sourceName = 'claude-plugins-official';
  if (source.startsWith('http') && !source.includes('claude-plugins-official')) {
    const match = source.match(/github\.com\/([^/]+\/[^/]+)/);
    if (match) {
      sourceName = match[1].replace('/', '-');
    }
  }

  const pluginKey = `${pluginName}@${sourceName}`;
  const version = '1.0.0'; // Default version
  const installPath = path.join(getPluginsDirectory(), 'cache', sourceName, pluginName, version);

  try {
    logger.main.info(`[ClaudePlugins] Installing plugin: ${pluginName} from ${source}`);

    // Check if already installed
    const installedJson = await readInstalledPluginsJson();
    if (installedJson.plugins[pluginKey]?.some(e => e.scope === 'user')) {
      return { success: false, error: `Plugin ${pluginName} is already installed` };
    }

    // Clean up any existing directory
    try {
      await fsPromises.rm(installPath, { recursive: true, force: true });
    } catch {
      // Ignore
    }

    // Determine how to download based on source
    let gitCommitSha = 'unknown';

    if (source.startsWith('http')) {
      // External GitHub URL - clone the repo
      const match = source.match(/github\.com\/([^/]+\/[^/]+)(?:\/tree\/[^/]+\/(.+))?/);
      if (match) {
        const [, repo, subdir] = match;
        if (subdir) {
          await cloneGitHubSubdirectory(repo, subdir, installPath);
        } else {
          // Clone entire repo
          await execGit(['clone', '--depth', '1', source, installPath]);
          gitCommitSha = await getGitCommitSha(installPath);
        }
      } else {
        return { success: false, error: `Invalid GitHub URL: ${source}` };
      }
    } else if (source.startsWith('./') || source.startsWith('plugins/')) {
      // Relative path in the official marketplace repo
      const cleanPath = source.replace(/^\.\//, '');
      await cloneGitHubSubdirectory(MARKETPLACE_REPO, cleanPath, installPath);
    } else {
      return { success: false, error: `Unknown source format: ${source}` };
    }

    // Update installed_plugins.json
    const now = new Date().toISOString();

    if (!installedJson.plugins[pluginKey]) {
      installedJson.plugins[pluginKey] = [];
    }

    // Remove any existing user scope entry
    installedJson.plugins[pluginKey] = installedJson.plugins[pluginKey].filter(e => e.scope !== 'user');

    // Add new entry
    installedJson.plugins[pluginKey].push({
      scope: 'user',
      installPath,
      version,
      installedAt: now,
      lastUpdated: now,
      gitCommitSha,
    });

    await writeInstalledPluginsJson(installedJson);

    logger.main.info(`[ClaudePlugins] Successfully installed plugin: ${pluginName} at ${installPath}`);
    return { success: true };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.main.error(`[ClaudePlugins] Failed to install plugin ${pluginName}:`, err);

    // Clean up partial installation
    try {
      await fsPromises.rm(installPath, { recursive: true, force: true });
    } catch (cleanupErr) {
      logger.main.error(`[ClaudePlugins] Failed to cleanup partial installation at ${installPath}:`, cleanupErr);
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * Uninstall a plugin
 */
async function uninstallPlugin(pluginName: string): Promise<{ success: boolean; error?: string }> {
  try {
    logger.main.info(`[ClaudePlugins] Uninstalling plugin: ${pluginName}`);

    const installedJson = await readInstalledPluginsJson();

    // Find the plugin key that matches this plugin name (format: pluginName@source)
    const matchingKey = Object.keys(installedJson.plugins).find(key => key.startsWith(`${pluginName}@`));

    if (!matchingKey) {
      return { success: false, error: `Plugin ${pluginName} is not installed` };
    }

    // Find user-scope installation
    const userInstallation = installedJson.plugins[matchingKey].find(e => e.scope === 'user');
    if (!userInstallation) {
      return { success: false, error: `Plugin ${pluginName} is not installed in user scope` };
    }

    // Remove the plugin directory
    try {
      await fsPromises.rm(userInstallation.installPath, { recursive: true, force: true });
    } catch (err) {
      logger.main.warn(`[ClaudePlugins] Could not remove plugin directory: ${err}`);
    }

    // Update installed_plugins.json
    installedJson.plugins[matchingKey] = installedJson.plugins[matchingKey].filter(e => e.scope !== 'user');

    // Remove plugin entry if no installations left
    if (installedJson.plugins[matchingKey].length === 0) {
      delete installedJson.plugins[matchingKey];
    }

    await writeInstalledPluginsJson(installedJson);

    logger.main.info(`[ClaudePlugins] Successfully uninstalled plugin: ${pluginName}`);
    return { success: true };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.main.error(`[ClaudePlugins] Failed to uninstall plugin ${pluginName}:`, err);
    return { success: false, error: errorMsg };
  }
}

export function registerClaudeCodePluginHandlers() {
  // Fetch marketplace data
  safeHandle('claude-plugin:fetch-marketplace', async () => {
    try {
      const data = await fetchMarketplace();
      return { success: true, data };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.main.error('[ClaudePlugins] Failed to fetch marketplace:', error);
      return { success: false, error: message };
    }
  });

  // List installed plugins
  safeHandle('claude-plugin:list-installed', async () => {
    try {
      const plugins = await listInstalledPlugins();
      return { success: true, data: plugins };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.main.error('[ClaudePlugins] Failed to list installed plugins:', error);
      return { success: false, error: message };
    }
  });

  // Install a plugin
  safeHandle('claude-plugin:install', async (_event, pluginName: string, source: string) => {
    if (!pluginName) {
      return { success: false, error: 'Plugin name is required' };
    }
    if (!source) {
      return { success: false, error: 'Plugin source is required' };
    }
    return await installPlugin(pluginName, source);
  });

  // Uninstall a plugin
  safeHandle('claude-plugin:uninstall', async (_event, pluginName: string) => {
    if (!pluginName) {
      return { success: false, error: 'Plugin name is required' };
    }
    return await uninstallPlugin(pluginName);
  });

  // Clear marketplace cache
  safeHandle('claude-plugin:clear-cache', async () => {
    marketplaceCache = null;
    cacheTimestamp = 0;
    return { success: true };
  });

  logger.main.info('[ClaudePlugins] IPC handlers registered');
}
