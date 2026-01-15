/**
 * IPC handlers for extension-related operations.
 *
 * Provides handlers for:
 * - Getting the extensions directory
 * - Reading extension files
 * - Loading extension modules
 * - Directory listing
 */

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';
import { safeHandle, safeOn } from '../utils/ipcRegistry';
import { minimatch } from 'minimatch';
import {
  getExtensionSettings,
  getExtensionEnabled,
  setExtensionEnabled,
  getClaudePluginEnabled,
  setClaudePluginEnabled,
  getExtensionConfiguration,
  setExtensionConfiguration,
  setExtensionConfigurationBulk,
  getWorkspaceExtensionConfiguration,
  setWorkspaceExtensionConfiguration,
  setWorkspaceExtensionConfigurationBulk,
  getReleaseChannel,
} from '../utils/store';
import { registerFileExtension, clearRegisteredExtensions } from '../extensions/RegisteredFileTypes';
import type { ReleaseChannel } from '../utils/store';

/**
 * Check if an extension should be visible for the current release channel.
 * Extensions with requiredReleaseChannel: 'alpha' are only visible to alpha users.
 * Extensions without this field or with 'stable' are visible to everyone.
 */
function isExtensionVisibleForChannel(
  manifest: { requiredReleaseChannel?: ReleaseChannel },
  currentChannel: ReleaseChannel
): boolean {
  const requiredChannel = manifest.requiredReleaseChannel;

  // No requirement or 'stable' requirement = visible to everyone
  if (!requiredChannel || requiredChannel === 'stable') {
    return true;
  }

  // 'alpha' requirement = only visible to alpha users
  if (requiredChannel === 'alpha') {
    return currentChannel === 'alpha';
  }

  // Unknown channel requirement = default to visible (fail open)
  return true;
}

/**
 * Initialize extension file type registry.
 * Should be called during app startup to ensure file types are registered
 * before any file operations occur.
 */
export async function initializeExtensionFileTypes(): Promise<void> {
  try {
    logger.main.info('[ExtensionHandlers] Initializing extension file types...');
    clearRegisteredExtensions();

    const extensionDirs = await getAllExtensionDirectories();
    const currentChannel = getReleaseChannel();

    for (const extensionsDir of extensionDirs) {
      let subdirs;
      try {
        subdirs = await fs.readdir(extensionsDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const subdir of subdirs) {
        let isDir = subdir.isDirectory();
        if (!isDir && subdir.isSymbolicLink()) {
          try {
            const targetPath = path.join(extensionsDir, subdir.name);
            const stat = await fs.stat(targetPath);
            isDir = stat.isDirectory();
          } catch {
            continue;
          }
        }
        if (!isDir) continue;

        const extensionPath = path.join(extensionsDir, subdir.name);
        const manifestPath = path.join(extensionPath, 'manifest.json');

        try {
          const manifestContent = await fs.readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(manifestContent);

          // Skip extensions that require a different release channel
          if (!isExtensionVisibleForChannel(manifest, currentChannel)) {
            logger.main.debug(`[ExtensionHandlers] Skipping extension ${manifest.id} (requires ${manifest.requiredReleaseChannel} channel)`);
            continue;
          }

          // Register file patterns from customEditors
          if (manifest.contributions?.customEditors) {
            for (const editor of manifest.contributions.customEditors) {
              if (editor.filePatterns) {
                for (const pattern of editor.filePatterns) {
                  if (pattern.startsWith('*.')) {
                    const ext = pattern.substring(1);
                    registerFileExtension(ext);
                    logger.main.info(`[ExtensionHandlers] Registered file type: ${ext} (from ${manifest.id})`);
                  }
                }
              }
            }
          }
        } catch {
          // Skip directories without valid manifest
        }
      }
    }

    logger.main.info('[ExtensionHandlers] Extension file types initialized');
  } catch (error) {
    logger.main.error('[ExtensionHandlers] Failed to initialize extension file types:', error);
  }
}

/**
 * Get the path to the user extensions directory.
 * Creates it if it doesn't exist.
 * In Playwright tests, uses a temp directory to avoid touching production extensions.
 */
async function getUserExtensionsDirectory(): Promise<string> {
  // Use test-specific path for Playwright tests to avoid conflicts
  const userDataPath = process.env.PLAYWRIGHT === '1'
    ? path.join(app.getPath('temp'), 'nimbalyst-test-extensions')
    : app.getPath('userData');
  const extensionsPath = path.join(userDataPath, 'extensions');

  try {
    await fs.mkdir(extensionsPath, { recursive: true });
  } catch (error) {
    // Directory already exists or other error
    logger.main.debug('[ExtensionHandlers] User extensions directory:', extensionsPath);
  }

  return extensionsPath;
}

/**
 * Get the path to the built-in extensions directory.
 * Returns null if the directory doesn't exist.
 */
async function getBuiltinExtensionsDirectory(): Promise<string | null> {
  // In production, built-in extensions are in resources/extensions
  // In development, they're in packages/extensions relative to the electron package
  const possiblePaths = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'extensions'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'extensions'),
      ]
    : [
        // Development: relative to __dirname (out/main/chunks in vite build)
        // Go up 4 levels to packages/, then into extensions/
        path.join(__dirname, '..', '..', '..', '..', 'extensions'),
        // Fallback: if __dirname is out/main (no chunks)
        path.join(__dirname, '..', '..', '..', 'extensions'),
        path.join(__dirname, '..', '..', 'resources', 'extensions'),
      ];

  for (const possiblePath of possiblePaths) {
    try {
      await fs.access(possiblePath);
      logger.main.debug('[ExtensionHandlers] Built-in extensions directory:', possiblePath);
      return possiblePath;
    } catch {
      // Path doesn't exist, try next
    }
  }

  logger.main.debug('[ExtensionHandlers] No built-in extensions directory found');
  return null;
}

/**
 * Get all extension directories (both user and built-in).
 */
async function getAllExtensionDirectories(): Promise<string[]> {
  const dirs: string[] = [];

  // Always include user extensions directory
  dirs.push(await getUserExtensionsDirectory());

  // Include built-in extensions if available
  const builtinDir = await getBuiltinExtensionsDirectory();
  if (builtinDir) {
    dirs.push(builtinDir);
  }

  return dirs;
}

/**
 * Return type for extension plugin commands
 */
export interface ExtensionPluginCommand {
  extensionId: string;
  extensionName: string;
  pluginName: string;
  pluginNamespace: string;
  commandName: string;
  description: string;
}

/**
 * Get Claude plugin commands from all enabled extensions.
 * Exported for use by SlashCommandHandlers.
 */
export async function getExtensionPluginCommands(): Promise<ExtensionPluginCommand[]> {
  try {
    const commands: ExtensionPluginCommand[] = [];
    const seenExtensionIds = new Set<string>();
    const currentChannel = getReleaseChannel();

    // Scan all extension directories
    const extensionDirs = await getAllExtensionDirectories();

    for (const extensionsDir of extensionDirs) {
      let subdirs;
      try {
        subdirs = await fs.readdir(extensionsDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const subdir of subdirs) {
        let isDir = subdir.isDirectory();
        if (!isDir && subdir.isSymbolicLink()) {
          try {
            const targetPath = path.join(extensionsDir, subdir.name);
            const stat = await fs.stat(targetPath);
            isDir = stat.isDirectory();
          } catch {
            continue;
          }
        }
        if (!isDir) continue;

        const extensionPath = path.join(extensionsDir, subdir.name);
        const manifestPath = path.join(extensionPath, 'manifest.json');

        try {
          const manifestContent = await fs.readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(manifestContent);
          const extensionId = manifest.id || subdir.name;

          // Skip if we've already seen this extension
          if (seenExtensionIds.has(extensionId)) {
            continue;
          }
          seenExtensionIds.add(extensionId);

          // Skip extensions that require a different release channel
          if (!isExtensionVisibleForChannel(manifest, currentChannel)) {
            continue;
          }

          // Check if extension is enabled
          if (!getExtensionEnabled(extensionId)) {
            continue;
          }

          // Check if extension has a Claude plugin
          const claudePlugin = manifest.contributions?.claudePlugin;
          if (!claudePlugin) {
            continue;
          }

          // Check if the plugin is enabled
          const storedPluginEnabled = getClaudePluginEnabled(extensionId);
          const pluginEnabled = storedPluginEnabled ?? claudePlugin.enabledByDefault ?? true;
          if (!pluginEnabled) {
            continue;
          }

          // Try to read the plugin.json to get the actual plugin name for namespacing
          let pluginNamespace = extensionId; // Default to extension ID
          const pluginJsonPath = path.join(extensionPath, claudePlugin.path, '.claude-plugin', 'plugin.json');
          try {
            const pluginJsonContent = await fs.readFile(pluginJsonPath, 'utf-8');
            const pluginJson = JSON.parse(pluginJsonContent);
            if (pluginJson.name) {
              pluginNamespace = pluginJson.name;
            }
          } catch {
            // plugin.json not found or invalid, use extension ID
          }

          // Add commands from the plugin
          if (claudePlugin.commands && Array.isArray(claudePlugin.commands)) {
            for (const cmd of claudePlugin.commands) {
              commands.push({
                extensionId,
                extensionName: manifest.name || extensionId,
                pluginName: claudePlugin.displayName || 'Claude Plugin',
                pluginNamespace, // The namespace used in slash commands (e.g., "datamodellm" for "/datamodellm:datamodel")
                commandName: cmd.name,
                description: cmd.description || '',
              });
            }
          }
        } catch {
          // Skip directories without valid manifest
        }
      }
    }

    return commands;
  } catch (error) {
    logger.main.error('[ExtensionHandlers] Failed to get Claude plugin commands:', error);
    return [];
  }
}

/**
 * Scan a single extension directory for Claude plugins.
 */
async function scanDirectoryForClaudePlugins(
  extensionsDir: string,
  plugins: Array<{ type: 'local'; path: string }>,
  seenExtensionIds: Set<string>,
  currentChannel: ReleaseChannel
): Promise<void> {
  let subdirs;
  try {
    subdirs = await fs.readdir(extensionsDir, { withFileTypes: true });
  } catch {
    // Directory doesn't exist or can't be read
    return;
  }

  for (const subdir of subdirs) {
    // Handle both directories and symlinks to directories
    let isDir = subdir.isDirectory();
    if (!isDir && subdir.isSymbolicLink()) {
      try {
        const targetPath = path.join(extensionsDir, subdir.name);
        const stat = await fs.stat(targetPath);
        isDir = stat.isDirectory();
      } catch {
        // Symlink target doesn't exist
        continue;
      }
    }
    if (!isDir) continue;

    const extensionPath = path.join(extensionsDir, subdir.name);
    const manifestPath = path.join(extensionPath, 'manifest.json');

    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      // Check if extension is enabled
      const extensionId = manifest.id || subdir.name;

      // Skip if we've already seen this extension (user extensions take priority)
      if (seenExtensionIds.has(extensionId)) {
        continue;
      }
      seenExtensionIds.add(extensionId);

      // Skip extensions that require a different release channel
      if (!isExtensionVisibleForChannel(manifest, currentChannel)) {
        logger.main.debug(`[ExtensionHandlers] Skipping extension ${extensionId} (requires ${manifest.requiredReleaseChannel} channel)`);
        continue;
      }

      const isEnabled = getExtensionEnabled(extensionId);
      if (!isEnabled) {
        logger.main.debug(`[ExtensionHandlers] Skipping disabled extension: ${extensionId}`);
        continue;
      }

      // Check if extension has a Claude plugin contribution
      const claudePlugin = manifest.contributions?.claudePlugin;
      if (!claudePlugin?.path) {
        continue;
      }

      // Check if the plugin is enabled
      // Priority: stored setting > manifest enabledByDefault > true
      const storedPluginEnabled = getClaudePluginEnabled(extensionId);
      const pluginEnabled = storedPluginEnabled ?? claudePlugin.enabledByDefault ?? true;
      if (!pluginEnabled) {
        logger.main.debug(`[ExtensionHandlers] Skipping disabled Claude plugin from: ${extensionId}`);
        continue;
      }

      // Resolve the absolute path to the plugin directory
      const pluginPath = path.resolve(extensionPath, claudePlugin.path);

      // Verify the plugin path exists
      try {
        await fs.access(pluginPath);
        plugins.push({
          type: 'local' as const,
          path: pluginPath,
        });
        // logger.main.info(`[ExtensionHandlers] Found Claude plugin: ${extensionId} at ${pluginPath}`);
      } catch {
        logger.main.warn(`[ExtensionHandlers] Claude plugin path not found: ${pluginPath}`);
      }
    } catch {
      // Skip directories without valid manifest
    }
  }
}

/**
 * Structure of the Claude Code CLI installed plugins file (~/.claude/plugins/installed_plugins.json)
 */
interface ClaudeCliInstalledPlugins {
  version: number;
  plugins: Record<string, Array<{
    scope: 'user' | 'project';
    projectPath?: string;  // Only present for project-scoped plugins
    installPath: string;
    version: string;
    installedAt: string;
    lastUpdated: string;
  }>>;
}

/**
 * Get Claude CLI plugins installed via the /plugin command.
 * Reads from ~/.claude/plugins/installed_plugins.json
 *
 * @param workspacePath - If provided, includes project-scoped plugins for this workspace
 */
async function getClaudeCliPluginPaths(workspacePath?: string): Promise<Array<{ type: 'local'; path: string }>> {
  const plugins: Array<{ type: 'local'; path: string }> = [];

  try {
    const os = await import('os');
    const installedPluginsPath = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');

    let content: string;
    try {
      content = await fs.readFile(installedPluginsPath, 'utf-8');
    } catch {
      // File doesn't exist - no CLI plugins installed
      return [];
    }

    let installedPlugins: ClaudeCliInstalledPlugins;
    try {
      installedPlugins = JSON.parse(content);
    } catch (parseError) {
      logger.main.error(`[ExtensionHandlers] Failed to parse CLI plugins JSON at ${installedPluginsPath}:`, parseError);
      return [];
    }

    // Normalize workspace path for comparison if provided
    const normalizedWorkspacePath = workspacePath ? path.resolve(workspacePath) : undefined;

    for (const [pluginKey, installations] of Object.entries(installedPlugins.plugins)) {
      for (const installation of installations) {
        // Include user-scoped plugins always
        if (installation.scope === 'user') {
          try {
            await fs.access(installation.installPath);
            plugins.push({
              type: 'local' as const,
              path: installation.installPath,
            });
            logger.main.debug(`[ExtensionHandlers] Found CLI plugin (user): ${pluginKey} at ${installation.installPath}`);
          } catch {
            logger.main.warn(`[ExtensionHandlers] CLI plugin path not found: ${installation.installPath}`);
          }
        }
        // Include project-scoped plugins only if workspace matches
        else if (installation.scope === 'project' && normalizedWorkspacePath && installation.projectPath) {
          const normalizedProjectPath = path.resolve(installation.projectPath);
          if (normalizedWorkspacePath === normalizedProjectPath || normalizedWorkspacePath.startsWith(normalizedProjectPath + path.sep)) {
            try {
              await fs.access(installation.installPath);
              plugins.push({
                type: 'local' as const,
                path: installation.installPath,
              });
              logger.main.debug(`[ExtensionHandlers] Found CLI plugin (project): ${pluginKey} at ${installation.installPath}`);
            } catch {
              logger.main.warn(`[ExtensionHandlers] CLI plugin path not found: ${installation.installPath}`);
            }
          }
        }
      }
    }
  } catch (error) {
    logger.main.error('[ExtensionHandlers] Failed to read CLI plugins:', error);
  }

  return plugins;
}

/**
 * Get Claude Agent SDK plugin paths from enabled extensions and CLI-installed plugins.
 * This is a main-process-native implementation that directly reads extension manifests
 * without requiring the renderer-process ExtensionLoader.
 *
 * Scans:
 * 1. User extensions directory
 * 2. Built-in extensions directory
 * 3. Claude CLI plugins (~/.claude/plugins/)
 *
 * User extensions take priority over built-in extensions with the same ID.
 *
 * @param workspacePath - If provided, includes project-scoped CLI plugins for this workspace
 * @returns Paths in the format expected by the Claude Agent SDK: { type: 'local', path: string }
 */
export async function getClaudePluginPaths(workspacePath?: string): Promise<Array<{ type: 'local'; path: string }>> {
  try {
    const plugins: Array<{ type: 'local'; path: string }> = [];
    const seenExtensionIds = new Set<string>();
    const currentChannel = getReleaseChannel();

    // Scan all extension directories (user first, then built-in)
    const extensionDirs = await getAllExtensionDirectories();
    for (const extensionsDir of extensionDirs) {
      await scanDirectoryForClaudePlugins(extensionsDir, plugins, seenExtensionIds, currentChannel);
    }

    // Also scan CLI-installed plugins
    const cliPlugins = await getClaudeCliPluginPaths(workspacePath);
    plugins.push(...cliPlugins);

    // Deduplicate by resolved path (in case same plugin is both an extension and CLI-installed)
    const seenPaths = new Set<string>();
    const deduplicatedPlugins: Array<{ type: 'local'; path: string }> = [];
    for (const plugin of plugins) {
      const resolvedPath = path.resolve(plugin.path);
      if (!seenPaths.has(resolvedPath)) {
        seenPaths.add(resolvedPath);
        deduplicatedPlugins.push(plugin);
      } else {
        logger.main.debug(`[ExtensionHandlers] Skipping duplicate plugin: ${plugin.path}`);
      }
    }

    return deduplicatedPlugins;
  } catch (error) {
    logger.main.error('[ExtensionHandlers] Failed to get Claude plugin paths:', error);
    return [];
  }
}

/**
 * Register IPC handlers for extension operations.
 */
export function registerExtensionHandlers(): void {
  // Get the user extensions directory path (for installing new extensions)
  safeHandle('extensions:get-directory', async () => {
    try {
      return await getUserExtensionsDirectory();
    } catch (error) {
      logger.main.error('[ExtensionHandlers] Failed to get extensions directory:', error);
      throw error;
    }
  });

  // Get all extension directories (user + built-in)
  // Used by the renderer's ExtensionLoader to discover all extensions
  safeHandle('extensions:get-all-directories', async () => {
    try {
      return await getAllExtensionDirectories();
    } catch (error) {
      logger.main.error('[ExtensionHandlers] Failed to get all extensions directories:', error);
      throw error;
    }
  });

  // List subdirectories in a directory
  // Note: This also follows symlinks to directories
  safeHandle('extensions:list-directories', async (_event, dirPath: string) => {
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
  safeHandle('extensions:read-file', async (_event, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      logger.main.error(`[ExtensionHandlers] Failed to read file ${filePath}:`, error);
      throw error;
    }
  });

  // Write content to a file
  safeHandle('extensions:write-file', async (_event, filePath: string, content: string) => {
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
  safeHandle('extensions:file-exists', async (_event, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      // Log the error details to help debug intermittent file access issues
      logger.main.debug(`[ExtensionHandlers] File not found: ${filePath}`, error);
      return false;
    }
  });

  // Check if an extension should be visible based on its required release channel
  safeHandle('extensions:is-visible-for-channel', (_event, requiredChannel: string | undefined) => {
    const currentChannel = getReleaseChannel();
    return isExtensionVisibleForChannel({ requiredReleaseChannel: requiredChannel as ReleaseChannel | undefined }, currentChannel);
  });

  // Find files matching a glob pattern
  safeHandle(
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
  safeHandle(
    'extensions:resolve-path',
    (_event, extensionPath: string, relativePath: string) => {
      return path.resolve(extensionPath, relativePath);
    }
  );

  // Get list of installed extensions (for settings UI)
  // Scans both user extensions and built-in extensions directories.
  // User extensions take priority over built-in extensions with the same ID.
  // Extensions with requiredReleaseChannel are filtered based on user's release channel.
  safeHandle('extensions:list-installed', async () => {
    try {
      const extensions: Array<{
        id: string;
        path: string;
        manifest: unknown;
        isBuiltin: boolean;
      }> = [];
      const seenExtensionIds = new Set<string>();
      const currentChannel = getReleaseChannel();

      // Clear previously registered file types
      clearRegisteredExtensions();

      // Scan all extension directories (user first, then built-in)
      const extensionDirs = await getAllExtensionDirectories();

      for (let i = 0; i < extensionDirs.length; i++) {
        const extensionsDir = extensionDirs[i];
        const isBuiltinDir = i > 0; // First directory is user extensions

        let subdirs;
        try {
          subdirs = await fs.readdir(extensionsDir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const subdir of subdirs) {
          // Handle both directories and symlinks to directories
          let isDir = subdir.isDirectory();
          if (!isDir && subdir.isSymbolicLink()) {
            try {
              const targetPath = path.join(extensionsDir, subdir.name);
              const stat = await fs.stat(targetPath);
              isDir = stat.isDirectory();
            } catch {
              continue;
            }
          }
          if (!isDir) continue;

          const extensionPath = path.join(extensionsDir, subdir.name);
          const manifestPath = path.join(extensionPath, 'manifest.json');

          try {
            const manifestContent = await fs.readFile(manifestPath, 'utf-8');
            const manifest = JSON.parse(manifestContent);
            const extensionId = manifest.id || subdir.name;

            // Skip if we've already seen this extension (user extensions take priority)
            if (seenExtensionIds.has(extensionId)) {
              continue;
            }
            seenExtensionIds.add(extensionId);

            // Skip extensions that require a different release channel
            if (!isExtensionVisibleForChannel(manifest, currentChannel)) {
              logger.main.debug(`[ExtensionHandlers] Skipping extension ${extensionId} from list (requires ${manifest.requiredReleaseChannel} channel)`);
              continue;
            }

            // Register file patterns from customEditors
            if (manifest.contributions?.customEditors) {
              for (const editor of manifest.contributions.customEditors) {
                if (editor.filePatterns) {
                  for (const pattern of editor.filePatterns) {
                    // Extract extension from pattern like "*.pdf"
                    if (pattern.startsWith('*.')) {
                      const ext = pattern.substring(1); // Remove the *
                      registerFileExtension(ext);
                      logger.main.debug(`[ExtensionHandlers] Registered file type: ${ext} (from ${extensionId})`);
                    }
                  }
                }
              }
            }

            extensions.push({
              id: extensionId,
              path: extensionPath,
              manifest,
              isBuiltin: isBuiltinDir,
            });
          } catch {
            // Skip directories without valid manifest
          }
        }
      }

      return extensions;
    } catch (error) {
      logger.main.error('[ExtensionHandlers] Failed to list installed extensions:', error);
      return [];
    }
  });

  // Get Claude plugin commands from all enabled extensions
  // Used to populate slash command suggestions in the UI
  safeHandle('extensions:get-claude-plugin-commands', async () => {
    return await getExtensionPluginCommands();
  });

  // Get all extension settings
  safeHandle('extensions:get-all-settings', async () => {
    try {
      return getExtensionSettings();
    } catch (error) {
      logger.main.error('[ExtensionHandlers] Failed to get extension settings:', error);
      return {};
    }
  });

  // Get enabled state for a specific extension
  // defaultEnabled comes from the extension's manifest and is used for first-time discovery
  safeHandle('extensions:get-enabled', async (_event, extensionId: string, defaultEnabled?: boolean) => {
    try {
      return getExtensionEnabled(extensionId, defaultEnabled);
    } catch (error) {
      logger.main.error(`[ExtensionHandlers] Failed to get enabled state for ${extensionId}:`, error);
      return defaultEnabled !== false; // Respect manifest default on error
    }
  });

  // Set enabled state for a specific extension
  safeHandle('extensions:set-enabled', async (_event, extensionId: string, enabled: boolean) => {
    try {
      setExtensionEnabled(extensionId, enabled);
      logger.main.info(`[ExtensionHandlers] Extension ${extensionId} ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true };
    } catch (error) {
      logger.main.error(`[ExtensionHandlers] Failed to set enabled state for ${extensionId}:`, error);
      return { success: false, error: String(error) };
    }
  });

  // Set Claude plugin enabled state for a specific extension
  safeHandle('extensions:set-claude-plugin-enabled', async (_event, extensionId: string, enabled: boolean) => {
    try {
      setClaudePluginEnabled(extensionId, enabled);
      logger.main.info(`[ExtensionHandlers] Claude plugin for ${extensionId} ${enabled ? 'enabled' : 'disabled'}`);
      return { success: true };
    } catch (error) {
      logger.main.error(`[ExtensionHandlers] Failed to set Claude plugin state for ${extensionId}:`, error);
      return { success: false, error: String(error) };
    }
  });

  // Get configuration for a specific extension (scope-aware)
  // scope: 'user' for global config, 'workspace' for project-specific config
  safeHandle('extensions:get-config', async (_event, extensionId: string, scope?: 'user' | 'workspace', workspacePath?: string) => {
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
  safeHandle('extensions:set-config', async (_event, extensionId: string, key: string, value: unknown, scope?: 'user' | 'workspace', workspacePath?: string) => {
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
  safeHandle('extensions:set-config-bulk', async (_event, extensionId: string, configuration: Record<string, unknown>, scope?: 'user' | 'workspace', workspacePath?: string) => {
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

  // ============================================================================
  // Extension Development Kit (EDK) - Hot-loading handlers
  // ============================================================================

  // Install an extension from a specific path (for development)
  // This creates a symlink in the user extensions directory pointing to the dev extension
  safeHandle('extensions:dev-install', async (_event, extensionPath: string) => {
    try {
      const normalizedPath = path.resolve(extensionPath);
      const manifestPath = path.join(normalizedPath, 'manifest.json');

      // Verify manifest exists
      try {
        await fs.access(manifestPath);
      } catch {
        return { success: false, error: `No manifest.json found at ${normalizedPath}` };
      }

      // Read manifest to get extension ID
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);
      const extensionId = manifest.id;

      if (!extensionId) {
        return { success: false, error: 'manifest.json missing required "id" field' };
      }

      // Create symlink in user extensions directory
      const userExtDir = await getUserExtensionsDirectory();
      const symlinkPath = path.join(userExtDir, path.basename(normalizedPath));

      // Remove existing symlink if present
      try {
        const stat = await fs.lstat(symlinkPath);
        if (stat.isSymbolicLink() || stat.isDirectory()) {
          await fs.rm(symlinkPath, { recursive: true, force: true });
        }
      } catch {
        // Doesn't exist, that's fine
      }

      // Create symlink
      await fs.symlink(normalizedPath, symlinkPath, 'junction');
      logger.main.info(`[ExtensionHandlers] Created dev extension symlink: ${symlinkPath} -> ${normalizedPath}`);

      return { success: true, extensionId, symlinkPath };
    } catch (error) {
      logger.main.error('[ExtensionHandlers] Failed to install dev extension:', error);
      return { success: false, error: String(error) };
    }
  });

  // Uninstall a dev extension (remove symlink and notify renderers)
  safeHandle('extensions:dev-uninstall', async (_event, extensionId: string) => {
    try {
      const userExtDir = await getUserExtensionsDirectory();

      // Find the extension directory (could be a symlink)
      const entries = await fs.readdir(userExtDir, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(userExtDir, entry.name);

        // Check if this entry matches the extension ID
        const manifestPath = path.join(entryPath, 'manifest.json');
        try {
          const manifestContent = await fs.readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(manifestContent);

          if (manifest.id === extensionId) {
            // Found it - remove the symlink/directory
            await fs.rm(entryPath, { recursive: true, force: true });
            logger.main.info(`[ExtensionHandlers] Removed dev extension: ${extensionId} at ${entryPath}`);
            return { success: true };
          }
        } catch {
          // Not a valid extension directory, skip
        }
      }

      return { success: false, error: `Extension ${extensionId} not found in user extensions` };
    } catch (error) {
      logger.main.error('[ExtensionHandlers] Failed to uninstall dev extension:', error);
      return { success: false, error: String(error) };
    }
  });

  // Notify all renderer processes to reload an extension
  // The renderers will unload the old version and load the new one
  safeHandle('extensions:dev-reload', async (_event, extensionId: string, extensionPath: string) => {
    try {
      const { BrowserWindow } = await import('electron');
      const windows = BrowserWindow.getAllWindows();

      logger.main.info(`[ExtensionHandlers] Broadcasting extension reload: ${extensionId} from ${extensionPath}`);

      // Broadcast reload message to all renderer windows
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('extension:dev-reload', { extensionId, extensionPath });
        }
      }

      return { success: true };
    } catch (error) {
      logger.main.error('[ExtensionHandlers] Failed to broadcast extension reload:', error);
      return { success: false, error: String(error) };
    }
  });

  // Notify all renderer processes to unload an extension
  safeHandle('extensions:dev-unload', async (_event, extensionId: string) => {
    try {
      const { BrowserWindow } = await import('electron');
      const windows = BrowserWindow.getAllWindows();

      logger.main.info(`[ExtensionHandlers] Broadcasting extension unload: ${extensionId}`);

      // Broadcast unload message to all renderer windows
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('extension:dev-unload', { extensionId });
        }
      }

      return { success: true };
    } catch (error) {
      logger.main.error('[ExtensionHandlers] Failed to broadcast extension unload:', error);
      return { success: false, error: String(error) };
    }
  });

  logger.main.info('[ExtensionHandlers] Extension handlers registered');
}
