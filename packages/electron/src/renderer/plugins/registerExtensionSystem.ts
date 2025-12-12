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
} from '@nimbalyst/runtime';
import { ExtensionPlatformServiceImpl } from '../services/ExtensionPlatformServiceImpl';
import { initializeExtensionEditorBridge } from '../extensions/ExtensionEditorBridge';
import { initializeExtensionPluginBridge } from '../extensions/ExtensionPluginBridge';

// Track workspace path for MCP tool registration
let currentWorkspacePath: string | null = null;

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

  // Discover and load extensions
  // This will scan the extensions directory and load any valid extensions
  try {
    console.log('[ExtensionSystem] Starting extension initialization...');
    await initializeExtensions();
    console.log('[ExtensionSystem] Extensions initialized');

    // Initialize the bridge to register custom editors from extensions
    console.log('[ExtensionSystem] Initializing editor bridge...');
    initializeExtensionEditorBridge();
    console.log('[ExtensionSystem] Editor bridge initialized');

    // Initialize the plugin bridge to register slash commands, nodes, and transformers
    console.log('[ExtensionSystem] Initializing plugin bridge...');
    initializeExtensionPluginBridge();
    console.log('[ExtensionSystem] Plugin bridge initialized');

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
