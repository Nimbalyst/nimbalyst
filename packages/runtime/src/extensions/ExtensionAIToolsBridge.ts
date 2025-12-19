/**
 * Extension AI Tools Bridge
 *
 * Bridges extension-provided AI tools with the runtime's ToolRegistry
 * and exposes them to the MCP server in the main process.
 *
 * When extensions load, their AI tools are:
 * 1. Registered with the local tool registry (for non-Claude-Code providers)
 * 2. Exposed to the main process MCP server via IPC (for Claude Code)
 */

import { toolRegistry, type ToolDefinition } from '../ai/tools';
import { editorRegistry } from '../ai/EditorRegistry';
import { getExtensionLoader } from './ExtensionLoader';
import type { ExtensionAITool, AIToolContext, LoadedExtension } from './types';

// Track which tools were registered by which extension
const extensionToolsMap = new Map<string, string[]>();

// Store tool handlers by namespaced name (for executing tools from MCP calls)
const toolHandlers = new Map<string, {
  tool: ExtensionAITool;
  extension: LoadedExtension;
}>();

/**
 * MCP tool definition format (serializable, no handler)
 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  extensionId: string;
  scope: 'global' | 'editor';
  editorFilePatterns?: string[];
}

// Callback for notifying about tool changes (set by renderer)
let onToolsChangedCallback: ((tools: MCPToolDefinition[]) => void) | null = null;

/**
 * Set the callback to be called when extension tools change.
 * Used by the renderer to notify the main process via IPC.
 */
export function setOnToolsChangedCallback(callback: (tools: MCPToolDefinition[]) => void): void {
  onToolsChangedCallback = callback;
  // Immediately notify with current tools
  notifyToolsChanged();
}

/**
 * Notify that tools have changed
 */
function notifyToolsChanged(): void {
  if (!onToolsChangedCallback) return;
  const tools = getMCPToolDefinitions();
  onToolsChangedCallback(tools);
}

/**
 * Get all extension tools in MCP format (serializable)
 */
export function getMCPToolDefinitions(): MCPToolDefinition[] {
  const loader = getExtensionLoader();
  if (!loader) return [];

  const tools: MCPToolDefinition[] = [];

  for (const extension of loader.getLoadedExtensions()) {
    if (!extension.enabled) continue;

    const extensionTools = extension.module.aiTools || [];
    const customEditors = extension.manifest.contributions?.customEditors || [];

    // Get file patterns from custom editors for this extension
    const extensionFilePatterns = customEditors.flatMap(e => e.filePatterns);

    for (const tool of extensionTools) {
      // Namespace the tool name
      const namespacedName = tool.name.includes('.')
        ? tool.name
        : `${extension.manifest.id.split('.').pop()}.${tool.name}`;

      // Determine file patterns for editor-scoped tools
      const scope = tool.scope || 'editor';
      const editorFilePatterns = scope === 'editor'
        ? (tool.editorFilePatterns || extensionFilePatterns)
        : undefined;

      // Support both 'parameters' and 'inputSchema' field names
      // Also handle missing schema gracefully
      const schema = tool.parameters || (tool as any).inputSchema || { type: 'object', properties: {} };

      tools.push({
        name: namespacedName,
        description: tool.description,
        inputSchema: {
          type: 'object',
          properties: schema.properties || {},
          required: schema.required,
        },
        extensionId: extension.manifest.id,
        scope,
        editorFilePatterns,
      });
    }
  }

  return tools;
}

/**
 * Execute an extension tool by name.
 * Called when the MCP server receives a tool call from Claude Code.
 */
export async function executeExtensionTool(
  toolName: string,
  args: Record<string, unknown>,
  context: { workspacePath?: string; activeFilePath?: string }
): Promise<{ success: boolean; message?: string; data?: unknown; error?: string }> {
  const handler = toolHandlers.get(toolName);
  if (!handler) {
    return {
      success: false,
      error: `Extension tool not found: ${toolName}`,
    };
  }

  try {
    const aiContext: AIToolContext = {
      workspacePath: context.workspacePath,
      activeFilePath: context.activeFilePath,
      extensionContext: handler.extension.context,
    };

    const result = await handler.tool.handler(args, aiContext);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error executing extension tool',
    };
  }
}

/**
 * Convert an ExtensionAITool to a ToolDefinition compatible with the runtime registry
 */
function convertExtensionTool(
  extensionId: string,
  tool: ExtensionAITool,
  extension: LoadedExtension
): ToolDefinition {
  // Namespace the tool name with extension ID to avoid conflicts
  const namespacedName = tool.name.includes('.')
    ? tool.name
    : `${extensionId.split('.').pop()}.${tool.name}`;

  // Support both 'parameters' and 'inputSchema' field names
  // Also handle missing schema gracefully
  const schema = tool.parameters || (tool as any).inputSchema || { type: 'object', properties: {} };

  return {
    name: namespacedName,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: schema.properties || {},
      required: schema.required,
    },
    source: 'runtime',
    handler: async (args: Record<string, unknown>) => {
      // Create the AI tool context with active file path from editor registry
      const context: AIToolContext = {
        workspacePath: undefined,
        activeFilePath: editorRegistry.getActiveFilePath() ?? undefined,
        extensionContext: extension.context,
      };

      // Call the extension's tool handler
      const result = await tool.handler(args, context);
      return result;
    },
  };
}

/**
 * Register AI tools from a loaded extension
 */
export function registerExtensionTools(extension: LoadedExtension): void {
  const { manifest, module } = extension;

  // console.info(
  //   `[ExtensionAIToolsBridge] Checking extension ${manifest.id} for AI tools:`,
  //   module.aiTools?.length ?? 0,
  //   'tools found'
  // );

  if (!module.aiTools || module.aiTools.length === 0) {
    return;
  }

  const registeredTools: string[] = [];

  for (const tool of module.aiTools) {
    try {
      const toolDef = convertExtensionTool(manifest.id, tool, extension);
      toolRegistry.register(toolDef);
      registeredTools.push(toolDef.name);

      // Store handler for MCP execution
      toolHandlers.set(toolDef.name, { tool, extension });

      // console.info(
      //   `[ExtensionAIToolsBridge] Registered tool: ${toolDef.name} from ${manifest.name}`
      // );
    } catch (error) {
      console.error(
        `[ExtensionAIToolsBridge] Failed to register tool ${tool.name} from ${manifest.id}:`,
        error
      );
    }
  }

  if (registeredTools.length > 0) {
    extensionToolsMap.set(manifest.id, registeredTools);
    // Notify about tool changes for MCP
    notifyToolsChanged();
  }
}

/**
 * Unregister AI tools from an extension
 */
export function unregisterExtensionTools(extensionId: string): void {
  const tools = extensionToolsMap.get(extensionId);
  if (!tools) return;

  for (const toolName of tools) {
    toolRegistry.unregister(toolName);
    toolHandlers.delete(toolName);
    // console.info(`[ExtensionAIToolsBridge] Unregistered tool: ${toolName}`);
  }

  extensionToolsMap.delete(extensionId);
  // Notify about tool changes for MCP
  notifyToolsChanged();
}

/**
 * Initialize the AI tools bridge.
 * Call this after extensions are loaded to register all their tools.
 */
export function initializeExtensionAIToolsBridge(): void {
  const loader = getExtensionLoader();
  if (!loader) {
    console.warn('[ExtensionAIToolsBridge] No extension loader available');
    return;
  }

  // Register tools from already-loaded extensions
  const loadedExtensions = loader.getLoadedExtensions();
  for (const extension of loadedExtensions) {
    registerExtensionTools(extension);
  }

  // Listen for future extension loads/unloads
  loader.subscribe(() => {
    // Get current extensions and sync tools
    const currentExtensions = loader.getLoadedExtensions();
    const currentIds = new Set(currentExtensions.map((e) => e.manifest.id));

    // Unregister tools from removed extensions
    for (const extensionId of extensionToolsMap.keys()) {
      if (!currentIds.has(extensionId)) {
        unregisterExtensionTools(extensionId);
      }
    }

    // Register tools from new extensions
    for (const extension of currentExtensions) {
      if (!extensionToolsMap.has(extension.manifest.id)) {
        registerExtensionTools(extension);
      }
    }
  });

  console.info('[ExtensionAIToolsBridge] Initialized');
}

/**
 * Get all tools registered by extensions
 */
export function getExtensionTools(): ToolDefinition[] {
  const allToolNames = new Set<string>();
  for (const tools of extensionToolsMap.values()) {
    tools.forEach((name) => allToolNames.add(name));
  }

  return Array.from(allToolNames)
    .map((name) => toolRegistry.get(name))
    .filter((t): t is ToolDefinition => t !== undefined);
}
