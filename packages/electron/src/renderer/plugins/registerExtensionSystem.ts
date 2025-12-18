/**
 * Register the Extension System with its Electron-specific platform service.
 *
 * This sets up the ExtensionPlatformService implementation that provides
 * the Electron-specific functionality for loading extensions, and
 * initializes the extension loader.
 */

import {
  setExtensionPlatformService,
  initializeExtensions,
  initializeExtensionAIToolsBridge,
  setOnToolsChangedCallback,
  executeExtensionTool,
  setEnabledStateProvider,
  setConfigurationServiceProvider,
  screenshotService,
  getExtensionLoader,
} from '@nimbalyst/runtime';
import { ExtensionPlatformServiceImpl } from '../services/ExtensionPlatformServiceImpl';
import { initializeExtensionEditorBridge } from '../extensions/ExtensionEditorBridge';
import { initializeExtensionPluginBridge } from '../extensions/ExtensionPluginBridge';
import { syncExtensionEditors } from '../extensions/ExtensionEditorBridge';

// Track workspace path for MCP tool registration
let currentWorkspacePath: string | null = null;

// Track if screenshot IPC listener is set up
let screenshotListenerSetup = false;

// Track if extension dev listeners are set up
let extensionDevListenersSetup = false;

/**
 * Set up IPC listener for screenshot capture requests from main process.
 * Uses the generic screenshotService to route requests to the appropriate capability.
 */
function setupScreenshotIPCListener(): void {
  if (screenshotListenerSetup) return;
  screenshotListenerSetup = true;

  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.on) {
    console.warn('[ExtensionSystem] electronAPI.on not available for screenshot listener');
    return;
  }

  electronAPI.on('screenshot:capture', async (data: { requestId: string; filePath: string }) => {
    console.log(`[ExtensionSystem] Screenshot capture request for: ${data.filePath}`);

    try {
      const base64Data = await screenshotService.capture(data.filePath);

      // Send result back to main process
      await electronAPI.invoke('screenshot:result-' + data.requestId, {
        requestId: data.requestId,
        success: true,
        imageBase64: base64Data,
      });
    } catch (error) {
      console.error('[ExtensionSystem] Screenshot capture failed:', error);

      // Send error result back to main process
      await electronAPI.invoke('screenshot:result-' + data.requestId, {
        requestId: data.requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  console.log('[ExtensionSystem] Screenshot IPC listener set up');
}

/**
 * Set up IPC listeners for extension development hot-loading.
 * These receive messages from the main process to reload/unload extensions.
 */
function setupExtensionDevListeners(): void {
  if (extensionDevListenersSetup) return;
  extensionDevListenersSetup = true;

  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.extensions?.onDevReload || !electronAPI?.extensions?.onDevUnload) {
    console.warn('[ExtensionSystem] Extension dev API not available');
    return;
  }

  // Listen for extension reload requests
  electronAPI.extensions.onDevReload(async (data: { extensionId: string; extensionPath: string }) => {
    console.log(`[ExtensionSystem] Received dev-reload request for ${data.extensionId} from ${data.extensionPath}`);

    try {
      const loader = getExtensionLoader();
      const result = await loader.loadExtensionFromPath(data.extensionPath);

      if (result.success) {
        console.log(`[ExtensionSystem] Successfully reloaded extension ${data.extensionId}`);
        // The ExtensionLoader notifies listeners, which triggers syncExtensionEditors
        // But we'll call it explicitly to ensure the bridges are updated
        syncExtensionEditors();
      } else {
        console.error(`[ExtensionSystem] Failed to reload extension ${data.extensionId}: ${result.error}`);
      }
    } catch (error) {
      console.error(`[ExtensionSystem] Error reloading extension ${data.extensionId}:`, error);
    }
  });

  // Listen for extension unload requests
  electronAPI.extensions.onDevUnload(async (data: { extensionId: string }) => {
    console.log(`[ExtensionSystem] Received dev-unload request for ${data.extensionId}`);

    try {
      const loader = getExtensionLoader();
      await loader.unloadExtension(data.extensionId);
      console.log(`[ExtensionSystem] Successfully unloaded extension ${data.extensionId}`);
      // The ExtensionLoader notifies listeners, which triggers syncExtensionEditors
      syncExtensionEditors();
    } catch (error) {
      console.error(`[ExtensionSystem] Error unloading extension ${data.extensionId}:`, error);
    }
  });

  console.log('[ExtensionSystem] Extension dev IPC listeners set up');
}

/**
 * Set the workspace path for extension tool registration.
 * Should be called when workspace changes.
 */
export function setExtensionWorkspacePath(workspacePath: string | null): void {
  currentWorkspacePath = workspacePath;
}

/**
 * Register the Extension System with its platform service.
 * Should be called once during app initialization.
 *
 * This is an async function because extension discovery and loading
 * involves file system operations.
 */
export async function registerExtensionSystem(): Promise<void> {
  // Set up the platform service
  const service = ExtensionPlatformServiceImpl.getInstance();
  setExtensionPlatformService(service);

  // Set up the enabled state provider to query persisted enabled state from main process
  setEnabledStateProvider(async (extensionId: string) => {
    return window.electronAPI.extensions.getEnabled(extensionId);
  });

  // Set up the configuration service provider for extension settings
  setConfigurationServiceProvider({
    get: async (extensionId: string, key: string): Promise<unknown> => {
      const config = await window.electronAPI.extensions.getConfig(extensionId);
      return config[key];
    },
    getAll: async (extensionId: string): Promise<Record<string, unknown>> => {
      return window.electronAPI.extensions.getConfig(extensionId);
    },
    set: async (extensionId: string, key: string, value: unknown, scope?: 'user' | 'workspace'): Promise<void> => {
      await window.electronAPI.extensions.setConfig(extensionId, key, value, scope);
    },
  });

  // Discover and load extensions
  // This will scan the extensions directory and load any valid extensions
  try {
    await initializeExtensions();

    // Initialize the bridge to register custom editors from extensions
    initializeExtensionEditorBridge();

    // Initialize the plugin bridge to register slash commands, nodes, and transformers
    // console.log('[ExtensionSystem] Initializing plugin bridge...');
    initializeExtensionPluginBridge();
    // console.log('[ExtensionSystem] Plugin bridge initialized');

    // Set up IPC listener for screenshot capture requests
    setupScreenshotIPCListener();

    // Set up IPC listeners for extension development hot-loading
    setupExtensionDevListeners();

    // Initialize the AI tools bridge to register extension tools with the tool registry
    initializeExtensionAIToolsBridge();

    // Set up callback to notify main process when extension tools change
    setOnToolsChangedCallback((tools) => {
      if (currentWorkspacePath && window.electronAPI?.registerExtensionTools) {
        console.log(`[ExtensionSystem] Registering ${tools.length} extension tools for workspace: ${currentWorkspacePath}`);
        window.electronAPI.registerExtensionTools(currentWorkspacePath, tools);
      }
    });

    // Set up IPC listener for extension tool execution
    if (window.electronAPI?.onExecuteExtensionTool && window.electronAPI?.sendExtensionToolResult) {
      const sendResult = window.electronAPI.sendExtensionToolResult;
      window.electronAPI.onExecuteExtensionTool(async (data) => {
        const { toolName, args, resultChannel, context } = data;
        console.log(`[ExtensionSystem] Executing extension tool: ${toolName}`);

        try {
          const result = await executeExtensionTool(toolName, args, context);
          sendResult(resultChannel, result);
        } catch (error) {
          console.error(`[ExtensionSystem] Error executing tool ${toolName}:`, error);
          sendResult(resultChannel, {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });
    }
  } catch (error) {
    console.error('[ExtensionSystem] Failed to initialize extensions:', error);
    // Don't throw - extensions failing shouldn't prevent the app from starting
  }
}
