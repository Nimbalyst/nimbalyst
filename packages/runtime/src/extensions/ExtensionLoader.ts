/**
 * Extension Loader
 *
 * Platform-agnostic extension loading system for Nimbalyst.
 * Handles discovery, loading, and lifecycle management of extensions.
 *
 * The loader uses an ExtensionPlatformService for platform-specific
 * operations like file access and module loading, making it work
 * identically on Electron and Capacitor.
 */

import type { ComponentType } from 'react';
import type {
  ExtensionManifest,
  ExtensionModule,
  LoadedExtension,
  ExtensionLoadResult,
  DiscoveredExtension,
  ExtensionContext,
  ExtensionServices,
  ExtensionConfigurationService,
  Disposable,
  CustomEditorContribution,
  ExtensionAITool,
  NewFileMenuContribution,
  SlashCommandContribution,
  ClaudePluginContribution,
} from './types';
import { getExtensionPlatformService } from './ExtensionPlatformService';

const MANIFEST_FILENAME = 'manifest.json';

/**
 * Validates an extension manifest
 */
function validateManifest(
  manifest: unknown,
  path: string
): ExtensionManifest | { error: string } {
  if (!manifest || typeof manifest !== 'object') {
    return { error: `Invalid manifest at ${path}: not an object` };
  }

  const m = manifest as Record<string, unknown>;

  if (typeof m.id !== 'string' || !m.id) {
    return { error: `Invalid manifest at ${path}: missing or invalid 'id'` };
  }

  if (typeof m.name !== 'string' || !m.name) {
    return { error: `Invalid manifest at ${path}: missing or invalid 'name'` };
  }

  if (typeof m.version !== 'string' || !m.version) {
    return {
      error: `Invalid manifest at ${path}: missing or invalid 'version'`,
    };
  }

  if (typeof m.main !== 'string' || !m.main) {
    return { error: `Invalid manifest at ${path}: missing or invalid 'main'` };
  }

  return manifest as ExtensionManifest;
}

/**
 * Creates an ExtensionContext for an extension
 */
function createExtensionContext(
  manifest: ExtensionManifest,
  extensionPath: string
): ExtensionContext {
  const platformService = getExtensionPlatformService();

  const subscriptions: Disposable[] = [];

  const services: ExtensionServices = {
    filesystem: {
      readFile: (path: string) => platformService.readFile(path),
      writeFile: (path: string, content: string) =>
        platformService.writeFile(path, content),
      fileExists: (path: string) => platformService.fileExists(path),
      findFiles: async (pattern: string) => {
        const extensionsDir = await platformService.getExtensionsDirectory();
        // Find files in the workspace, not the extension directory
        // This is a simplified version - full implementation would need workspace path
        return platformService.findFiles(extensionsDir, pattern);
      },
    },
    ui: {
      showInfo: (message: string) => {
        console.info(`[${manifest.name}] ${message}`);
      },
      showWarning: (message: string) => {
        console.warn(`[${manifest.name}] ${message}`);
      },
      showError: (message: string) => {
        console.error(`[${manifest.name}] ${message}`);
      },
    },
  };

  // Add AI service if extension has ai permission
  if (manifest.permissions?.ai) {
    services.ai = {
      registerTool: (tool: ExtensionAITool): Disposable => {
        // Tools are registered through the ExtensionLoader's getAITools
        // This is a placeholder for the registration mechanism
        console.log(`[${manifest.name}] Registered AI tool: ${tool.name}`);
        return {
          dispose: () => {
            console.log(
              `[${manifest.name}] Unregistered AI tool: ${tool.name}`
            );
          },
        };
      },
      registerContextProvider: (provider): Disposable => {
        console.log(
          `[${manifest.name}] Registered context provider: ${provider.id}`
        );
        return {
          dispose: () => {
            console.log(
              `[${manifest.name}] Unregistered context provider: ${provider.id}`
            );
          },
        };
      },
    };
  }

  // Add configuration service if extension has configuration contribution
  if (manifest.contributions?.configuration && configurationServiceProvider) {
    // Cache for synchronous access
    let configCache: Record<string, unknown> = {};
    let configLoaded = false;

    // Load config asynchronously
    configurationServiceProvider.getAll(manifest.id).then(config => {
      configCache = config;
      configLoaded = true;
    }).catch(err => {
      console.warn(`[${manifest.name}] Failed to load configuration:`, err);
    });

    services.configuration = {
      get: <T>(key: string, defaultValue?: T): T => {
        // Return cached value or default from schema
        if (key in configCache) {
          return configCache[key] as T;
        }
        // Check for default in schema
        const prop = manifest.contributions?.configuration?.properties[key];
        if (prop?.default !== undefined) {
          return prop.default as T;
        }
        return defaultValue as T;
      },
      update: async (key: string, value: unknown, scope?: 'user' | 'workspace'): Promise<void> => {
        if (!configurationServiceProvider) {
          throw new Error('Configuration service not available');
        }
        await configurationServiceProvider.set(manifest.id, key, value, scope);
        // Update cache
        configCache[key] = value;
      },
      getAll: (): Record<string, unknown> => {
        // Merge defaults with cached values
        const result: Record<string, unknown> = {};
        const props = manifest.contributions?.configuration?.properties ?? {};
        for (const [key, prop] of Object.entries(props)) {
          result[key] = configCache[key] ?? prop.default;
        }
        return result;
      },
    };
  }

  return {
    manifest,
    extensionPath,
    services,
    subscriptions,
  };
}

/**
 * Extension Loader class
 *
 * Manages discovery, loading, and lifecycle of extensions.
 */
export class ExtensionLoader {
  private loadedExtensions = new Map<string, LoadedExtension>();
  private listeners = new Set<() => void>();

  /**
   * Discover all extensions in both user and built-in extensions directories
   */
  async discoverExtensions(): Promise<DiscoveredExtension[]> {
    const platformService = getExtensionPlatformService();
    const extensionsDirs = await platformService.getAllExtensionsDirectories();

    const discovered: DiscoveredExtension[] = [];
    const seenIds = new Set<string>();

    for (const extensionsDir of extensionsDirs) {
      try {
        const subdirs = await platformService.listDirectories(extensionsDir);

        for (const subdir of subdirs) {
          const extensionPath = platformService.resolvePath(extensionsDir, subdir);
          const manifestPath = platformService.resolvePath(
            extensionPath,
            MANIFEST_FILENAME
          );

          try {
            const exists = await platformService.fileExists(manifestPath);
            if (!exists) {
              console.warn(
                `[ExtensionLoader] No manifest.json in ${subdir}, skipping`
              );
              continue;
            }

            const manifestContent = await platformService.readFile(manifestPath);
            const manifestJson = JSON.parse(manifestContent);
            const validationResult = validateManifest(manifestJson, manifestPath);

            if ('error' in validationResult) {
              console.error(
                `[ExtensionLoader] ${validationResult.error}, skipping`
              );
              continue;
            }

            // Skip if we've already seen this extension ID (user extensions take priority)
            if (seenIds.has(validationResult.id)) {
              console.info(
                `[ExtensionLoader] Skipping duplicate extension ${validationResult.id} at ${extensionPath}`
              );
              continue;
            }
            seenIds.add(validationResult.id);

            // Check if extension should be visible for the current release channel
            const isVisible = await platformService.isExtensionVisibleForChannel(
              validationResult.requiredReleaseChannel
            );
            if (!isVisible) {
              console.info(
                `[ExtensionLoader] Skipping extension ${validationResult.id} (requires ${validationResult.requiredReleaseChannel} channel)`
              );
              continue;
            }

            discovered.push({
              path: extensionPath,
              manifest: validationResult,
            });
          } catch (error) {
            console.error(
              `[ExtensionLoader] Failed to read manifest from ${subdir}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(
          `[ExtensionLoader] Failed to list extensions directory ${extensionsDir}:`,
          error
        );
      }
    }

    return discovered;
  }

  /**
   * Load an extension from a discovered extension
   */
  async loadExtension(
    discovered: DiscoveredExtension
  ): Promise<ExtensionLoadResult> {
    const { path: extensionPath, manifest } = discovered;

    // Check if already loaded
    if (this.loadedExtensions.has(manifest.id)) {
      return {
        success: false,
        error: `Extension ${manifest.id} is already loaded`,
      };
    }

    const platformService = getExtensionPlatformService();

    try {
      // Load the main module
      const mainPath = platformService.resolvePath(extensionPath, manifest.main);
      const exists = await platformService.fileExists(mainPath);

      if (!exists) {
        return {
          success: false,
          error: `Main module not found at ${mainPath}`,
          manifestPath: extensionPath,
        };
      }

      const module = await platformService.loadModule(mainPath);

      // Load and inject styles if specified
      let disposeStyles: (() => void) | undefined;
      if (manifest.styles) {
        const stylesPath = platformService.resolvePath(
          extensionPath,
          manifest.styles
        );
        const stylesExist = await platformService.fileExists(stylesPath);

        if (stylesExist) {
          const css = await platformService.readFile(stylesPath);
          disposeStyles = platformService.injectStyles(css);
        }
      }

      // Create context
      const context = createExtensionContext(manifest, extensionPath);

      // Create loaded extension object
      const loaded: LoadedExtension = {
        manifest,
        module,
        context,
        disposeStyles,
        enabled: true,
        dispose: async () => {
          await this.unloadExtension(manifest.id);
        },
      };

      // Activate the extension
      if (module.activate) {
        try {
          await module.activate(context);
        } catch (error) {
          // Clean up styles if activation fails
          disposeStyles?.();
          return {
            success: false,
            error: `Extension ${manifest.id} activation failed: ${error}`,
            manifestPath: extensionPath,
          };
        }
      }

      // Store the loaded extension
      this.loadedExtensions.set(manifest.id, loaded);
      this.notifyListeners();

      console.info(
        `[ExtensionLoader] Loaded extension: ${manifest.name} v${manifest.version}`
      );

      return { success: true, extension: loaded };
    } catch (error) {
      return {
        success: false,
        error: `Failed to load extension ${manifest.id}: ${error}`,
        manifestPath: extensionPath,
      };
    }
  }

  /**
   * Unload an extension by ID
   */
  async unloadExtension(extensionId: string): Promise<void> {
    const loaded = this.loadedExtensions.get(extensionId);
    if (!loaded) {
      console.warn(
        `[ExtensionLoader] Cannot unload ${extensionId}: not loaded`
      );
      return;
    }

    try {
      // Call deactivate if it exists
      if (loaded.module.deactivate) {
        await loaded.module.deactivate();
      }

      // Dispose all subscriptions
      for (const subscription of loaded.context.subscriptions) {
        try {
          subscription.dispose();
        } catch (error) {
          console.error(
            `[ExtensionLoader] Error disposing subscription for ${extensionId}:`,
            error
          );
        }
      }

      // Remove injected styles
      loaded.disposeStyles?.();

      // Remove from loaded extensions
      this.loadedExtensions.delete(extensionId);
      this.notifyListeners();

      console.info(
        `[ExtensionLoader] Unloaded extension: ${loaded.manifest.name}`
      );
    } catch (error) {
      console.error(
        `[ExtensionLoader] Error unloading extension ${extensionId}:`,
        error
      );
    }
  }

  /**
   * Enable a loaded extension
   */
  enableExtension(extensionId: string): void {
    const loaded = this.loadedExtensions.get(extensionId);
    if (loaded) {
      loaded.enabled = true;
      this.notifyListeners();
    }
  }

  /**
   * Disable a loaded extension without unloading it
   */
  disableExtension(extensionId: string): void {
    const loaded = this.loadedExtensions.get(extensionId);
    if (loaded) {
      loaded.enabled = false;
      this.notifyListeners();
    }
  }

  /**
   * Get all loaded extensions
   */
  getLoadedExtensions(): LoadedExtension[] {
    return Array.from(this.loadedExtensions.values());
  }

  /**
   * Get a loaded extension by ID
   */
  getExtension(extensionId: string): LoadedExtension | undefined {
    return this.loadedExtensions.get(extensionId);
  }

  /**
   * Get all custom editor contributions from loaded extensions
   */
  getCustomEditors(): Array<{
    extensionId: string;
    contribution: CustomEditorContribution;
    component: React.ComponentType<unknown>;
  }> {
    const editors: Array<{
      extensionId: string;
      contribution: CustomEditorContribution;
      component: React.ComponentType<unknown>;
    }> = [];

    for (const loaded of this.loadedExtensions.values()) {
      if (!loaded.enabled) continue;

      const contributions = loaded.manifest.contributions?.customEditors || [];
      const components = loaded.module.components || {};

      for (const contribution of contributions) {
        const component = components[contribution.component];
        if (component) {
          editors.push({
            extensionId: loaded.manifest.id,
            contribution,
            component: component as React.ComponentType<unknown>,
          });
        } else {
          console.warn(
            `[ExtensionLoader] Extension ${loaded.manifest.id} declares custom editor component '${contribution.component}' but does not export it`
          );
        }
      }
    }

    return editors;
  }

  /**
   * Get all AI tools from loaded extensions
   */
  getAITools(): Array<{
    extensionId: string;
    tool: ExtensionAITool;
  }> {
    const tools: Array<{
      extensionId: string;
      tool: ExtensionAITool;
    }> = [];

    for (const loaded of this.loadedExtensions.values()) {
      if (!loaded.enabled) continue;

      const extensionTools = loaded.module.aiTools || [];
      for (const tool of extensionTools) {
        tools.push({
          extensionId: loaded.manifest.id,
          tool,
        });
      }
    }

    return tools;
  }

  /**
   * Get all new file menu contributions from loaded extensions
   */
  getNewFileMenuContributions(): Array<{
    extensionId: string;
    contribution: NewFileMenuContribution;
  }> {
    const contributions: Array<{
      extensionId: string;
      contribution: NewFileMenuContribution;
    }> = [];

    for (const loaded of this.loadedExtensions.values()) {
      if (!loaded.enabled) continue;

      const menuItems = loaded.manifest.contributions?.newFileMenu || [];
      for (const item of menuItems) {
        contributions.push({
          extensionId: loaded.manifest.id,
          contribution: item,
        });
      }
    }

    return contributions;
  }

  /**
   * Get all slash command contributions from loaded extensions
   */
  getSlashCommands(): Array<{
    extensionId: string;
    contribution: SlashCommandContribution;
    handler: () => void;
  }> {
    const commands: Array<{
      extensionId: string;
      contribution: SlashCommandContribution;
      handler: () => void;
    }> = [];

    for (const loaded of this.loadedExtensions.values()) {
      if (!loaded.enabled) continue;

      const contributions = loaded.manifest.contributions?.slashCommands || [];
      const handlers = loaded.module.slashCommandHandlers || {};

      for (const contribution of contributions) {
        const handler = contribution.handler in handlers ? handlers[contribution.handler] : undefined;
        if (handler !== undefined) {
          commands.push({
            extensionId: loaded.manifest.id,
            contribution,
            handler,
          });
        } else {
          console.warn(
            `[ExtensionLoader] Extension ${loaded.manifest.id} declares slash command '${contribution.id}' with handler '${contribution.handler}' but does not export it`
          );
        }
      }
    }

    return commands;
  }

  /**
   * Get all Lexical node contributions from loaded extensions
   */
  getNodes(): Array<{
    extensionId: string;
    nodeName: string;
    nodeClass: unknown; // Klass<LexicalNode>
  }> {
    const nodes: Array<{
      extensionId: string;
      nodeName: string;
      nodeClass: unknown;
    }> = [];

    for (const loaded of this.loadedExtensions.values()) {
      if (!loaded.enabled) continue;

      const nodeNames = loaded.manifest.contributions?.nodes || [];
      const nodeClasses = loaded.module.nodes || {};

      for (const nodeName of nodeNames) {
        const nodeClass = nodeClasses[nodeName];
        if (nodeClass) {
          nodes.push({
            extensionId: loaded.manifest.id,
            nodeName,
            nodeClass,
          });
        } else {
          console.warn(
            `[ExtensionLoader] Extension ${loaded.manifest.id} declares node '${nodeName}' but does not export it`
          );
        }
      }
    }

    return nodes;
  }

  /**
   * Get all markdown transformer contributions from loaded extensions
   */
  getTransformers(): Array<{
    extensionId: string;
    transformerName: string;
    transformer: unknown; // Transformer from @lexical/markdown
  }> {
    const transformers: Array<{
      extensionId: string;
      transformerName: string;
      transformer: unknown;
    }> = [];

    for (const loaded of this.loadedExtensions.values()) {
      if (!loaded.enabled) continue;

      const transformerNames = loaded.manifest.contributions?.transformers || [];
      const transformerObjects = loaded.module.transformers || {};

      for (const transformerName of transformerNames) {
        const transformer = transformerObjects[transformerName];
        if (transformer) {
          transformers.push({
            extensionId: loaded.manifest.id,
            transformerName,
            transformer,
          });
        } else {
          console.warn(
            `[ExtensionLoader] Extension ${loaded.manifest.id} declares transformer '${transformerName}' but does not export it`
          );
        }
      }
    }

    return transformers;
  }

  /**
   * Get all host component contributions from loaded extensions
   */
  getHostComponents(): Array<{
    extensionId: string;
    componentName: string;
    component: ComponentType;
  }> {
    const components: Array<{
      extensionId: string;
      componentName: string;
      component: ComponentType;
    }> = [];

    for (const loaded of this.loadedExtensions.values()) {
      if (!loaded.enabled) continue;

      const componentNames = loaded.manifest.contributions?.hostComponents || [];
      const hostComponents = loaded.module.hostComponents || {};

      for (const componentName of componentNames) {
        const component = hostComponents[componentName];
        if (component) {
          components.push({
            extensionId: loaded.manifest.id,
            componentName,
            component,
          });
        } else {
          console.warn(
            `[ExtensionLoader] Extension ${loaded.manifest.id} declares host component '${componentName}' but does not export it`
          );
        }
      }
    }

    return components;
  }

  /**
   * Get all Claude Agent SDK plugin contributions from loaded extensions.
   * Returns the absolute paths to plugin directories for use with the SDK.
   */
  getClaudePlugins(): Array<{
    extensionId: string;
    contribution: ClaudePluginContribution;
    pluginPath: string;
    enabled: boolean;
  }> {
    const plugins: Array<{
      extensionId: string;
      contribution: ClaudePluginContribution;
      pluginPath: string;
      enabled: boolean;
    }> = [];

    const platformService = getExtensionPlatformService();

    for (const loaded of this.loadedExtensions.values()) {
      // Only include plugins from enabled extensions
      if (!loaded.enabled) continue;

      const claudePlugin = loaded.manifest.contributions?.claudePlugin;
      if (!claudePlugin) continue;

      // Resolve the absolute path to the plugin directory
      const pluginPath = platformService.resolvePath(
        loaded.context.extensionPath,
        claudePlugin.path
      );

      plugins.push({
        extensionId: loaded.manifest.id,
        contribution: claudePlugin,
        pluginPath,
        // Plugin is enabled if extension is enabled and plugin is enabled by default
        // (or if there's no explicit setting, default to the contribution's enabledByDefault)
        enabled: claudePlugin.enabledByDefault !== false,
      });
    }

    return plugins;
  }

  /**
   * Get Claude plugin paths formatted for the Claude Agent SDK.
   * Only returns plugins that are both from enabled extensions and have their
   * plugin feature enabled.
   */
  getClaudePluginPaths(): Array<{ type: 'local'; path: string }> {
    return this.getClaudePlugins()
      .filter(plugin => plugin.enabled)
      .map(plugin => ({
        type: 'local' as const,
        path: plugin.pluginPath,
      }));
  }

  /**
   * Find a custom editor for a given file extension
   */
  findEditorForExtension(fileExtension: string): {
    extensionId: string;
    contribution: CustomEditorContribution;
    component: React.ComponentType<unknown>;
  } | undefined {
    const editors = this.getCustomEditors();

    for (const editor of editors) {
      for (const pattern of editor.contribution.filePatterns) {
        // Simple glob matching - pattern like "*.datamodel"
        if (pattern.startsWith('*.')) {
          const extPattern = pattern.slice(1).toLowerCase(); // ".datamodel"
          if (fileExtension.toLowerCase() === extPattern) {
            return editor;
          }
        }
        // Exact match
        if (pattern.toLowerCase() === fileExtension.toLowerCase()) {
          return editor;
        }
      }
    }

    return undefined;
  }

  /**
   * Subscribe to extension changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[ExtensionLoader] Error in listener:', error);
      }
    }
  }

  /**
   * Unload all extensions
   */
  async unloadAll(): Promise<void> {
    const extensionIds = Array.from(this.loadedExtensions.keys());
    for (const id of extensionIds) {
      await this.unloadExtension(id);
    }
  }

  /**
   * Load an extension from a specific path.
   * This is used for development hot-loading where the extension
   * may not be in the standard extensions directory.
   *
   * If the extension is already loaded, it will be unloaded first.
   */
  async loadExtensionFromPath(extensionPath: string): Promise<ExtensionLoadResult> {
    const platformService = getExtensionPlatformService();

    try {
      // Read and validate manifest
      const manifestPath = platformService.resolvePath(extensionPath, 'manifest.json');
      const exists = await platformService.fileExists(manifestPath);

      if (!exists) {
        return {
          success: false,
          error: `No manifest.json found at ${extensionPath}`,
          manifestPath: extensionPath,
        };
      }

      const manifestContent = await platformService.readFile(manifestPath);
      const manifestJson = JSON.parse(manifestContent);
      const validationResult = validateManifest(manifestJson, manifestPath);

      if ('error' in validationResult) {
        return {
          success: false,
          error: validationResult.error,
          manifestPath: extensionPath,
        };
      }

      const manifest = validationResult;

      // If already loaded, unload first
      if (this.loadedExtensions.has(manifest.id)) {
        console.info(`[ExtensionLoader] Unloading existing extension ${manifest.id} before reload`);
        await this.unloadExtension(manifest.id);
      }

      // Create discovered extension object and load
      const discovered: DiscoveredExtension = {
        path: extensionPath,
        manifest,
      };

      return await this.loadExtension(discovered);
    } catch (error) {
      return {
        success: false,
        error: `Failed to load extension from ${extensionPath}: ${error}`,
        manifestPath: extensionPath,
      };
    }
  }

  /**
   * Reload an extension by ID.
   * The extension must already be loaded (so we know its path).
   * Unloads and reloads the extension from its original path.
   */
  async reloadExtension(extensionId: string): Promise<ExtensionLoadResult> {
    const loaded = this.loadedExtensions.get(extensionId);
    if (!loaded) {
      return {
        success: false,
        error: `Extension ${extensionId} is not loaded`,
      };
    }

    const extensionPath = loaded.context.extensionPath;
    console.info(`[ExtensionLoader] Reloading extension ${extensionId} from ${extensionPath}`);

    return await this.loadExtensionFromPath(extensionPath);
  }
}

// ============================================================================
// Global Instance
// ============================================================================

let extensionLoader: ExtensionLoader | null = null;

/**
 * Callback to query persisted enabled state for extensions.
 * Allows platform-specific persistence (Electron store, etc.)
 */
let enabledStateProvider: ((extensionId: string) => Promise<boolean>) | null = null;

/**
 * Configuration service provider interface.
 * Allows platform-specific persistence (Electron store, etc.)
 */
export interface ConfigurationServiceProvider {
  get(extensionId: string, key: string): Promise<unknown>;
  getAll(extensionId: string): Promise<Record<string, unknown>>;
  set(extensionId: string, key: string, value: unknown, scope?: 'user' | 'workspace'): Promise<void>;
}

let configurationServiceProvider: ConfigurationServiceProvider | null = null;

/**
 * Set a callback that will be called to get the persisted enabled state
 * for each extension when it's loaded. This allows the platform layer
 * (Electron, Capacitor) to provide persistence.
 */
export function setEnabledStateProvider(
  provider: (extensionId: string) => Promise<boolean>
): void {
  enabledStateProvider = provider;
}

/**
 * Set the configuration service provider that handles reading/writing
 * extension configuration values. This allows the platform layer
 * (Electron, Capacitor) to provide persistence.
 */
export function setConfigurationServiceProvider(
  provider: ConfigurationServiceProvider
): void {
  configurationServiceProvider = provider;
}

/**
 * Get the global ExtensionLoader instance.
 * Creates one if it doesn't exist.
 */
export function getExtensionLoader(): ExtensionLoader {
  if (!extensionLoader) {
    extensionLoader = new ExtensionLoader();
  }
  return extensionLoader;
}

/**
 * Initialize extensions by discovering and loading all enabled extensions.
 * Should be called during app startup after platform service is set.
 *
 * Uses the enabledStateProvider (if set) to check persisted enabled state
 * for each extension.
 */
export async function initializeExtensions(): Promise<void> {
  const loader = getExtensionLoader();

  // console.info('[ExtensionLoader] Discovering extensions...');
  const discovered = await loader.discoverExtensions();
  // console.info(`[ExtensionLoader] Found ${discovered.length} extension(s)`);

  for (const ext of discovered) {
    // Check persisted enabled state
    let shouldLoad = true;
    if (enabledStateProvider) {
      try {
        shouldLoad = await enabledStateProvider(ext.manifest.id);
      } catch (error) {
        console.warn(
          `[ExtensionLoader] Failed to check enabled state for ${ext.manifest.id}, defaulting to enabled:`,
          error
        );
        shouldLoad = true;
      }
    }

    if (!shouldLoad) {
      console.info(
        `[ExtensionLoader] Skipping disabled extension: ${ext.manifest.name}`
      );
      continue;
    }

    console.info(
      `[ExtensionLoader] Loading ${ext.manifest.name} v${ext.manifest.version}...`
    );
    const result = await loader.loadExtension(ext);
    if (!result.success) {
      console.error(`[ExtensionLoader] Failed to load ${ext.manifest.id}:`, result.error);
    }
  }

  console.info(
    `[ExtensionLoader] Loaded ${loader.getLoadedExtensions().length} extension(s)`
  );
}
