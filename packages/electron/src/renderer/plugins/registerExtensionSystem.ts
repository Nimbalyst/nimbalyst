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

// Track if editor screenshot listener is set up
let editorScreenshotListenerSetup = false;

// Track if extension status listener is set up
let extensionStatusListenerSetup = false;

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
 * Set up IPC listener for editor screenshot capture requests.
 * Captures screenshots of any editor content (not just mockups).
 */
function setupEditorScreenshotListener(): void {
  if (editorScreenshotListenerSetup) return;
  editorScreenshotListenerSetup = true;

  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.on) {
    console.warn('[ExtensionSystem] electronAPI.on not available for editor screenshot listener');
    return;
  }

  electronAPI.on('editor:capture-screenshot', async (data: { requestId: string; filePath?: string; selector?: string }) => {
    console.log(`[ExtensionSystem] Editor screenshot capture request:`, data);

    try {
      // Find the editor element to capture
      let targetElement: HTMLElement | null = null;

      if (data.selector) {
        // Capture specific element if selector provided
        targetElement = document.querySelector(data.selector);
        if (!targetElement) {
          throw new Error(`Element not found for selector: ${data.selector}`);
        }
      } else {
        // Find the active editor container
        // Try to find the multi-editor-instance that's active
        targetElement = document.querySelector('.multi-editor-instance.active .editor-content');

        // Fallback to the main editor area
        if (!targetElement) {
          targetElement = document.querySelector('.multi-editor-instance.active');
        }

        // Fallback to the tab editor content area
        if (!targetElement) {
          targetElement = document.querySelector('.tab-editor-content');
        }

        // Last resort - find any visible editor
        if (!targetElement) {
          targetElement = document.querySelector('.editor');
        }
      }

      if (!targetElement) {
        throw new Error('No editor element found to capture');
      }

      // Dynamically import html2canvas
      const html2canvas = (await import('html2canvas')).default;

      // Capture the element
      const canvas = await html2canvas(targetElement, {
        backgroundColor: null,
        scale: 2, // Higher resolution
        useCORS: true,
        allowTaint: true,
        logging: false,
        windowWidth: targetElement.scrollWidth,
        windowHeight: targetElement.scrollHeight,
      });

      // Validate canvas dimensions
      if (canvas.width === 0 || canvas.height === 0) {
        throw new Error(`Canvas has zero dimensions (${canvas.width}x${canvas.height}). The editor element may not be visible or rendered.`);
      }

      // Convert to base64
      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.split(',')[1];

      // Validate that we got actual image data
      if (!base64Data || base64Data.length === 0) {
        throw new Error('Canvas produced empty image data. This may indicate a rendering issue with the editor element.');
      }

      console.log(`[ExtensionSystem] Editor screenshot captured successfully (${canvas.width}x${canvas.height}, ${base64Data.length} bytes)`);

      // Send result back to main process - use send since main uses ipcMain.once
      electronAPI.send(data.requestId, {
        success: true,
        imageBase64: base64Data,
        mimeType: 'image/png'
      });
    } catch (error) {
      console.error('[ExtensionSystem] Editor screenshot capture failed:', error);

      // Send error result back to main process - use send since main uses ipcMain.once
      electronAPI.send(data.requestId, {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  console.log('[ExtensionSystem] Editor screenshot IPC listener set up');
}

/**
 * Set up IPC listener for extension status queries.
 * Returns information about loaded extensions including their contributions.
 */
function setupExtensionStatusListener(): void {
  if (extensionStatusListenerSetup) return;
  extensionStatusListenerSetup = true;

  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.on) {
    console.warn('[ExtensionSystem] electronAPI.on not available for extension status listener');
    return;
  }

  electronAPI.on('extension:get-status', async (data: { extensionId: string; responseChannel: string }) => {
    console.log(`[ExtensionSystem] Extension status query for: ${data.extensionId}`);

    try {
      const loader = getExtensionLoader();
      const extension = loader.getExtension(data.extensionId);

      if (!extension) {
        // Extension not found - use send instead of invoke since main uses ipcMain.once
        electronAPI.send(data.responseChannel, {
          error: 'Extension not found',
          status: 'not_installed'
        });
        return;
      }

      // Get extension manifest for contributions info
      const manifest = extension.manifest;
      const contributions = {
        customEditors: manifest.contributions?.customEditors || [],
        aiTools: manifest.contributions?.aiTools || [],
        newFileMenu: manifest.contributions?.newFileMenu || [],
      };

      // Extension is loaded if we found it
      const status = extension.enabled ? 'loaded' : 'disabled';

      // Use send instead of invoke since main uses ipcMain.once
      electronAPI.send(data.responseChannel, {
        status,
        contributions,
        manifest: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
        }
      });
    } catch (error) {
      console.error('[ExtensionSystem] Extension status query failed:', error);

      electronAPI.send(data.responseChannel, {
        error: error instanceof Error ? error.message : String(error),
        status: 'error'
      });
    }
  });

  console.log('[ExtensionSystem] Extension status IPC listener set up');
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

    // Set up IPC listener for editor screenshot capture requests
    setupEditorScreenshotListener();

    // Set up IPC listener for extension status queries
    setupExtensionStatusListener();

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
          // Result already includes extensionId, toolName, stack, and errorContext from the bridge
          sendResult(resultChannel, result);
        } catch (error) {
          // This catch handles errors that occur outside the tool handler itself
          // (e.g., in the IPC layer or executeExtensionTool wrapper)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const stack = error instanceof Error ? error.stack : undefined;

          console.error(`[ExtensionSystem] Error executing tool ${toolName}:`, error);

          sendResult(resultChannel, {
            success: false,
            error: errorMessage,
            toolName,
            stack,
            errorContext: {
              layer: 'extension-system-ipc',
              hint: 'Error occurred in the IPC layer before reaching the tool handler.',
            },
          });
        }
      });
    }
  } catch (error) {
    console.error('[ExtensionSystem] Failed to initialize extensions:', error);
    // Don't throw - extensions failing shouldn't prevent the app from starting
  }
}
