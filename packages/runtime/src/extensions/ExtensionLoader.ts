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
  PanelContribution,
  SettingsPanelContribution,
  LoadedPanel,
  PanelHostProps,
  PanelGutterButtonProps,
  SettingsPanelProps,
} from './types';
import { getExtensionPlatformService } from './ExtensionPlatformService';

const MANIFEST_FILENAME = 'manifest.json';

/**
 * Validation result with detailed error information
 */
interface ManifestValidationResult {
  error: string;
  suggestion?: string;
  field?: string;
}

/**
 * Validates an extension manifest with detailed error messages and suggestions
 */
function validateManifest(
  manifest: unknown,
  path: string
): ExtensionManifest | ManifestValidationResult {
  if (!manifest || typeof manifest !== 'object') {
    return {
      error: `Invalid manifest at ${path}: not an object`,
      suggestion: 'Ensure the manifest.json file contains a valid JSON object.',
    };
  }

  const m = manifest as Record<string, unknown>;
  const errors: ManifestValidationResult[] = [];

  // Validate required fields
  if (typeof m.id !== 'string' || !m.id) {
    errors.push({
      error: `Missing or invalid 'id'`,
      field: 'id',
      suggestion: 'Add a unique identifier, e.g., "id": "com.example.my-extension"',
    });
  } else {
    // Validate ID format
    const idPattern = /^[a-zA-Z][a-zA-Z0-9._-]*[a-zA-Z0-9]$/;
    if (!idPattern.test(m.id as string)) {
      errors.push({
        error: `Invalid 'id' format: "${m.id}"`,
        field: 'id',
        suggestion: 'ID should start with a letter, contain only letters, numbers, dots, hyphens, and underscores. Example: "com.example.my-extension"',
      });
    }
  }

  if (typeof m.name !== 'string' || !m.name) {
    errors.push({
      error: `Missing or invalid 'name'`,
      field: 'name',
      suggestion: 'Add a display name, e.g., "name": "My Extension"',
    });
  }

  if (typeof m.version !== 'string' || !m.version) {
    errors.push({
      error: `Missing or invalid 'version'`,
      field: 'version',
      suggestion: 'Add a semantic version, e.g., "version": "1.0.0"',
    });
  } else {
    // Validate semver format
    const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
    if (!semverPattern.test(m.version as string)) {
      errors.push({
        error: `Invalid 'version' format: "${m.version}"`,
        field: 'version',
        suggestion: 'Use semantic versioning format: "major.minor.patch", e.g., "1.0.0"',
      });
    }
  }

  // Check if extension only contributes a Claude plugin (no runtime code)
  // All other contribution types require runtime JavaScript code
  const contributions = m.contributions as Record<string, unknown> | undefined;
  const onlyClaudePlugin = contributions?.claudePlugin &&
    !contributions?.customEditors &&
    !contributions?.documentHeaders &&
    !contributions?.aiTools &&
    !contributions?.slashCommands &&
    !contributions?.nodes &&
    !contributions?.transformers &&
    !contributions?.hostComponents &&
    !contributions?.panels &&
    !contributions?.settingsPanel &&
    !contributions?.newFileMenu &&
    !contributions?.configuration;

  // Main is required unless the extension only contributes a Claude plugin
  if (!onlyClaudePlugin) {
    if (typeof m.main !== 'string' || !m.main) {
      errors.push({
        error: `Missing or invalid 'main'`,
        field: 'main',
        suggestion: 'Add the entry point path, e.g., "main": "dist/index.js"',
      });
    } else if (!(m.main as string).endsWith('.js') && !(m.main as string).endsWith('.mjs')) {
      errors.push({
        error: `Invalid 'main' format: "${m.main}" should end with .js or .mjs`,
        field: 'main',
        suggestion: 'The main entry point should be a JavaScript file, e.g., "main": "dist/index.js"',
      });
    }
  }

  // Validate optional apiVersion
  if (m.apiVersion !== undefined && typeof m.apiVersion !== 'string') {
    errors.push({
      error: `Invalid 'apiVersion' - should be a string`,
      field: 'apiVersion',
      suggestion: 'Use a string version, e.g., "apiVersion": "1.0"',
    });
  }

  // Validate contributions if present
  if (m.contributions !== undefined) {
    if (typeof m.contributions !== 'object' || m.contributions === null) {
      errors.push({
        error: `Invalid 'contributions' - should be an object`,
        field: 'contributions',
        suggestion: 'Contributions should be an object with customEditors, aiTools, etc.',
      });
    } else {
      const contributions = m.contributions as Record<string, unknown>;

      // Validate customEditors
      if (contributions.customEditors !== undefined) {
        if (!Array.isArray(contributions.customEditors)) {
          errors.push({
            error: `Invalid 'contributions.customEditors' - should be an array`,
            field: 'contributions.customEditors',
            suggestion: 'customEditors should be an array of custom editor contributions',
          });
        } else {
          contributions.customEditors.forEach((editor, index) => {
            if (!editor.filePatterns || !Array.isArray(editor.filePatterns)) {
              errors.push({
                error: `customEditors[${index}] missing 'filePatterns' array`,
                field: `contributions.customEditors[${index}].filePatterns`,
                suggestion: 'Add file patterns, e.g., "filePatterns": ["*.myext"]',
              });
            }
            if (!editor.component || typeof editor.component !== 'string') {
              errors.push({
                error: `customEditors[${index}] missing 'component' name`,
                field: `contributions.customEditors[${index}].component`,
                suggestion: 'Add component name that matches an export, e.g., "component": "MyEditor"',
              });
            }
          });
        }
      }

      // Validate documentHeaders
      if (contributions.documentHeaders !== undefined) {
        if (!Array.isArray(contributions.documentHeaders)) {
          errors.push({
            error: `Invalid 'contributions.documentHeaders' - should be an array`,
            field: 'contributions.documentHeaders',
            suggestion: 'documentHeaders should be an array of document header contributions',
          });
        } else {
          contributions.documentHeaders.forEach((header: Record<string, unknown>, index: number) => {
            if (!header.id || typeof header.id !== 'string') {
              errors.push({
                error: `documentHeaders[${index}] missing 'id' string`,
                field: `contributions.documentHeaders[${index}].id`,
                suggestion: 'Add a unique identifier, e.g., "id": "my-header"',
              });
            }
            if (!header.filePatterns || !Array.isArray(header.filePatterns)) {
              errors.push({
                error: `documentHeaders[${index}] missing 'filePatterns' array`,
                field: `contributions.documentHeaders[${index}].filePatterns`,
                suggestion: 'Add file patterns, e.g., "filePatterns": ["*.astro"]',
              });
            }
            if (!header.component || typeof header.component !== 'string') {
              errors.push({
                error: `documentHeaders[${index}] missing 'component' name`,
                field: `contributions.documentHeaders[${index}].component`,
                suggestion: 'Add component name that matches an export, e.g., "component": "MyHeader"',
              });
            }
          });
        }
      }

      // Validate aiTools
      if (contributions.aiTools !== undefined) {
        if (!Array.isArray(contributions.aiTools)) {
          errors.push({
            error: `Invalid 'contributions.aiTools' - should be an array`,
            field: 'contributions.aiTools',
            suggestion: 'aiTools should be an array listing AI tool names exported by the module',
          });
        }
      }
    }
  }

  // Validate permissions if present
  if (m.permissions !== undefined) {
    if (typeof m.permissions !== 'object' || m.permissions === null) {
      errors.push({
        error: `Invalid 'permissions' - should be an object`,
        field: 'permissions',
        suggestion: 'Permissions should be an object, e.g., { "ai": true, "filesystem": true }',
      });
    }
  }

  // Return first error if any (with all context for logging)
  if (errors.length > 0) {
    const firstError = errors[0];
    const errorLines = [
      `Invalid manifest at ${path}:`,
      `  ${firstError.error}`,
    ];
    if (firstError.suggestion) {
      errorLines.push(`  Suggestion: ${firstError.suggestion}`);
    }
    if (errors.length > 1) {
      errorLines.push(`  (and ${errors.length - 1} more issue${errors.length > 2 ? 's' : ''})`);
    }

    console.error(`[ExtensionLoader] Manifest validation failed:\n${errorLines.join('\n')}`);

    return {
      error: errorLines.join('\n'),
      field: firstError.field,
      suggestion: firstError.suggestion,
    };
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

  // Cache workspace path for resolving relative paths
  let cachedWorkspacePath: string | null = null;
  async function getWorkspacePath(): Promise<string | null> {
    if (cachedWorkspacePath) return cachedWorkspacePath;
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.getInitialState) {
      const state = await electronAPI.getInitialState();
      if (state?.workspacePath) {
        cachedWorkspacePath = state.workspacePath;
        return cachedWorkspacePath;
      }
    }
    return null;
  }

  // Resolve a path: if it's absolute, use as-is; if relative, prepend workspace path
  async function resolvePath(filePath: string): Promise<string> {
    // Absolute paths on macOS/Linux start with /, on Windows with C:\ etc.
    if (filePath.startsWith('/') || /^[a-zA-Z]:/.test(filePath)) {
      return filePath;
    }
    const wp = await getWorkspacePath();
    if (wp) {
      return `${wp}/${filePath}`;
    }
    return filePath;
  }

  const services: ExtensionServices = {
    filesystem: {
      readFile: async (p: string) => platformService.readFile(await resolvePath(p)),
      writeFile: async (p: string, content: string) =>
        platformService.writeFile(await resolvePath(p), content),
      fileExists: async (p: string) => platformService.fileExists(await resolvePath(p)),
      findFiles: async (pattern: string) => {
        const wp = await getWorkspacePath();
        if (wp) {
          return platformService.findFiles(wp, pattern);
        }
        // Fallback to extensions directory if workspace path unavailable
        const extensionsDir = await platformService.getExtensionsDirectory();
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
      sendPrompt: async (options: {
        prompt: string;
        sessionName?: string;
        provider?: 'claude-code' | 'claude' | 'openai';
        model?: string;
      }): Promise<{ sessionId: string; response: string }> => {
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI) {
          throw new Error('electronAPI not available for sendPrompt');
        }
        return electronAPI.invoke('extensions:ai-send-prompt', options);
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

  // Create the base context
  const context: ExtensionContext = {
    manifest,
    extensionPath,
    services,
    subscriptions,
  };

  // Wrap context with API compatibility checking in development mode
  // This helps extension developers catch incorrect API usage early
  if (process.env.NODE_ENV !== 'production') {
    return createAPICompatibilityProxy(context, manifest.id);
  }

  return context;
}

/**
 * Creates a proxy that warns when extensions access non-existent API properties.
 * This helps catch incorrect API usage during development.
 */
function createAPICompatibilityProxy(
  context: ExtensionContext,
  extensionId: string
): ExtensionContext {
  const knownProperties = new Set([
    'manifest',
    'extensionPath',
    'services',
    'subscriptions',
  ]);

  // Common mistakes that extension developers make
  const apiMigrations: Record<string, string> = {
    'registerAITool': 'context.services.ai.registerTool()',
    'registerContextProvider': 'context.services.ai.registerContextProvider()',
    'readFile': 'context.services.filesystem.readFile()',
    'writeFile': 'context.services.filesystem.writeFile()',
    'showError': 'context.services.ui.showError()',
    'showWarning': 'context.services.ui.showWarning()',
    'showInfo': 'context.services.ui.showInfo()',
    'filePath': 'context.activeFilePath (in tool context, not ExtensionContext)',
    'workspace': 'context.workspacePath (in tool context, not ExtensionContext)',
  };

  return new Proxy(context, {
    get(target, prop: string) {
      // Allow known properties
      if (knownProperties.has(prop) || typeof prop === 'symbol') {
        return (target as any)[prop];
      }

      // Check for common mistakes
      if (apiMigrations[prop]) {
        console.warn(
          `[API Compatibility] Extension "${extensionId}" accessed "${prop}" on context.\n` +
          `  This property does not exist. Did you mean: ${apiMigrations[prop]}\n` +
          `  The extension API has changed - please update your extension.`
        );
      } else if (!(prop in target)) {
        console.warn(
          `[API Compatibility] Extension "${extensionId}" accessed unknown property "${prop}" on ExtensionContext.\n` +
          `  Available properties: ${Array.from(knownProperties).join(', ')}\n` +
          `  This may indicate the extension is using an outdated or incorrect API.`
        );
      }

      return (target as any)[prop];
    },
  });
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
              // console.info(
              //   `[ExtensionLoader] Skipping duplicate extension ${validationResult.id} at ${extensionPath}`
              // );
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

    // Check if extension only contributes a Claude plugin (no runtime code)
    // All other contribution types require runtime JavaScript code
    const contributions = manifest.contributions;
    const isClaudePluginOnly = contributions?.claudePlugin &&
      !contributions?.customEditors &&
      !contributions?.documentHeaders &&
      !contributions?.aiTools &&
      !contributions?.slashCommands &&
      !contributions?.nodes &&
      !contributions?.transformers &&
      !contributions?.hostComponents &&
      !contributions?.panels &&
      !contributions?.settingsPanel &&
      !contributions?.newFileMenu &&
      !contributions?.configuration &&
      !manifest.main;

    try {
      let module: ExtensionModule;

      if (isClaudePluginOnly) {
        // Claude plugin-only extensions don't have runtime code
        // Create a stub module for them
        console.info(
          `[ExtensionLoader] Extension ${manifest.id} is Claude plugin-only, skipping module load`
        );
        module = {};
      } else {
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

        module = await platformService.loadModule(mainPath);
      }

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

      // console.info(
      //   `[ExtensionLoader] Loaded extension: ${manifest.name} v${manifest.version}`
      // );

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
   * Get all panel contributions from loaded extensions.
   * Panels are non-file-based UIs like database browsers, dashboards, etc.
   */
  getPanels(): LoadedPanel[] {
    const panels: LoadedPanel[] = [];

    for (const loaded of this.loadedExtensions.values()) {
      if (!loaded.enabled) continue;

      const contributions = loaded.manifest.contributions?.panels || [];
      const panelExports = loaded.module.panels || {};

      for (const contribution of contributions) {
        const panelExport = panelExports[contribution.id];
        if (panelExport && panelExport.component) {
          panels.push({
            id: `${loaded.manifest.id}.${contribution.id}`,
            extensionId: loaded.manifest.id,
            contribution,
            component: panelExport.component as ComponentType<PanelHostProps>,
            gutterButton: panelExport.gutterButton as ComponentType<PanelGutterButtonProps> | undefined,
            settingsComponent: panelExport.settingsComponent as ComponentType<PanelHostProps> | undefined,
          });
        } else {
          console.warn(
            `[ExtensionLoader] Extension ${loaded.manifest.id} declares panel '${contribution.id}' but does not export it or missing component`
          );
        }
      }
    }

    // Sort by order (lower first)
    panels.sort((a, b) => (a.contribution.order ?? 100) - (b.contribution.order ?? 100));

    return panels;
  }

  /**
   * Get all settings panel contributions from loaded extensions.
   * These appear in the Settings screen under the "Extensions" section.
   */
  getSettingsPanels(): Array<{
    extensionId: string;
    contribution: SettingsPanelContribution;
    component: ComponentType<SettingsPanelProps>;
  }> {
    const panels: Array<{
      extensionId: string;
      contribution: SettingsPanelContribution;
      component: ComponentType<SettingsPanelProps>;
    }> = [];

    for (const loaded of this.loadedExtensions.values()) {
      if (!loaded.enabled) continue;

      const contribution = loaded.manifest.contributions?.settingsPanel;
      if (!contribution) continue;

      const settingsPanelExports = loaded.module.settingsPanel || {};
      const component = settingsPanelExports[contribution.component];

      if (component) {
        panels.push({
          extensionId: loaded.manifest.id,
          contribution,
          component: component as ComponentType<SettingsPanelProps>,
        });
      } else {
        console.warn(
          `[ExtensionLoader] Extension ${loaded.manifest.id} declares settings panel '${contribution.component}' but does not export it`
        );
      }
    }

    // Sort by order (lower first)
    panels.sort((a, b) => (a.contribution.order ?? 100) - (b.contribution.order ?? 100));

    return panels;
  }

  /**
   * Find a panel by its full ID (extensionId.panelId).
   */
  findPanelById(panelId: string): LoadedPanel | undefined {
    return this.getPanels().find(p => p.id === panelId);
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
 *
 * @param extensionId - The extension ID to check
 * @param defaultEnabled - The manifest's defaultEnabled value (undefined means true)
 * @returns Whether the extension should be enabled
 */
let enabledStateProvider: ((extensionId: string, defaultEnabled?: boolean) => Promise<boolean>) | null = null;

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
 *
 * @param provider - Function that takes extensionId and defaultEnabled, returns whether to enable
 */
export function setEnabledStateProvider(
  provider: (extensionId: string, defaultEnabled?: boolean) => Promise<boolean>
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

// Track initialization state to prevent double-initialization from React StrictMode
let extensionsInitialized = false;
let extensionsInitializing: Promise<void> | null = null;

/**
 * Initialize extensions by discovering and loading all enabled extensions.
 * Should be called during app startup after platform service is set.
 *
 * Uses the enabledStateProvider (if set) to check persisted enabled state
 * for each extension.
 *
 * This function is idempotent - calling it multiple times will only initialize once.
 * If called while initialization is in progress, returns the existing promise.
 */
export async function initializeExtensions(): Promise<void> {
  // Return immediately if already initialized
  if (extensionsInitialized) {
    console.info('[ExtensionLoader] Extensions already initialized, skipping');
    return;
  }

  // Return existing promise if initialization is in progress
  if (extensionsInitializing) {
    console.info('[ExtensionLoader] Extension initialization already in progress, waiting...');
    return extensionsInitializing;
  }

  // Start initialization
  extensionsInitializing = (async () => {
    try {
      const loader = getExtensionLoader();

      console.info('[ExtensionLoader] Discovering extensions...');
      const discovered = await loader.discoverExtensions();
      console.info(`[ExtensionLoader] Found ${discovered.length} extension(s):`, discovered.map(d => d.manifest.id));

      for (const ext of discovered) {
        // Check persisted enabled state, passing manifest's defaultEnabled
        let shouldLoad = true;
        if (enabledStateProvider) {
          try {
            shouldLoad = await enabledStateProvider(ext.manifest.id, ext.manifest.defaultEnabled);
          } catch (error) {
            console.warn(
              `[ExtensionLoader] Failed to check enabled state for ${ext.manifest.id}, defaulting to enabled:`,
              error
            );
            shouldLoad = ext.manifest.defaultEnabled !== false;
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

      // console.info(
      //   `[ExtensionLoader] Loaded ${loader.getLoadedExtensions().length} extension(s)`
      // );

      extensionsInitialized = true;
    } finally {
      extensionsInitializing = null;
    }
  })();

  return extensionsInitializing;
}

/**
 * Reset extension initialization state.
 * Only use for testing or when extensions need to be completely reloaded.
 */
export function resetExtensionInitialization(): void {
  extensionsInitialized = false;
  extensionsInitializing = null;
}
