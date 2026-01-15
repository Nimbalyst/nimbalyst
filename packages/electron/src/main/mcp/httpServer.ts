import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { BrowserWindow, ipcMain, nativeImage } from 'electron';
import { parse as parseUrl } from 'url';
import { existsSync } from 'fs';
import path, { isAbsolute } from 'path';
import { MockupScreenshotService } from '../services/MockupScreenshotService';
import { isVoiceModeActive, sendToVoiceAgent, getActiveVoiceSessionId, stopVoiceSession } from '../services/voice/VoiceModeService';

/**
 * Compress a base64 image to JPEG if it exceeds 0.28 MB.
 * Uses progressive JPEG quality reduction and image resizing to meet the target size.
 *
 * This is a workaround for a Claude Code bug where large base64 images cause issues.
 * See: https://discord.com/channels/1072196207201501266/1451693213931933846
 *
 * @param base64Data - The base64-encoded image data (without data URL prefix)
 * @param mimeType - The original MIME type of the image
 * @returns Object containing the (possibly compressed) base64 data and updated MIME type
 */
const MAX_IMAGE_SIZE_BYTES = 0.28 * 1024 * 1024; // 0.28 MB
function compressImageIfNeeded(
  base64Data: string,
  mimeType: string
): { data: string; mimeType: string; wasCompressed: boolean } {
  // Calculate actual byte size from base64 (base64 inflates by ~33%)
  const byteSize = Math.floor((base64Data.length * 3) / 4);
  const byteSizeMB = byteSize / 1024 / 1024;
  const maxSizeMB = MAX_IMAGE_SIZE_BYTES / 1024 / 1024;

  console.log(`[MCP Server] Image size check: ${byteSizeMB.toFixed(3)} MB (limit: ${maxSizeMB.toFixed(3)} MB)`);

  if (byteSize <= MAX_IMAGE_SIZE_BYTES) {
    console.log(`[MCP Server] Image under limit, no compression needed`);
    return { data: base64Data, mimeType, wasCompressed: false };
  }

  console.log(`[MCP Server] Image size ${byteSizeMB.toFixed(2)} MB exceeds limit of ${maxSizeMB.toFixed(2)} MB, compressing to JPEG...`);

  try {
    // Create nativeImage from base64 PNG
    const buffer = Buffer.from(base64Data, 'base64');
    console.log(`[MCP Server] Created buffer of ${buffer.length} bytes`);

    const image = nativeImage.createFromBuffer(buffer);

    if (image.isEmpty()) {
      console.warn('[MCP Server] Failed to create image from base64 (image is empty), returning original');
      return { data: base64Data, mimeType, wasCompressed: false };
    }

    const originalSize = image.getSize();
    console.log(`[MCP Server] Image dimensions: ${originalSize.width}x${originalSize.height}`);

    // Quality levels to try
    const qualities = [85, 70, 55, 40, 30, 20];
    // Scale factors to try if quality reduction isn't enough
    const scaleFactors = [1.0, 0.75, 0.5, 0.35, 0.25];

    for (const scale of scaleFactors) {
      // Resize image if scale < 1.0
      let workingImage = image;
      if (scale < 1.0) {
        const newWidth = Math.round(originalSize.width * scale);
        const newHeight = Math.round(originalSize.height * scale);
        console.log(`[MCP Server] Resizing to ${scale * 100}%: ${newWidth}x${newHeight}`);
        workingImage = image.resize({ width: newWidth, height: newHeight, quality: 'better' });
      }

      for (const quality of qualities) {
        const jpegBuffer = workingImage.toJPEG(quality);
        const compressedSize = jpegBuffer.length;
        const compressedSizeMB = compressedSize / 1024 / 1024;

        if (scale === 1.0) {
          console.log(`[MCP Server] JPEG quality ${quality}: ${compressedSizeMB.toFixed(3)} MB`);
        } else {
          console.log(`[MCP Server] Scale ${scale * 100}%, quality ${quality}: ${compressedSizeMB.toFixed(3)} MB`);
        }

        if (compressedSize <= MAX_IMAGE_SIZE_BYTES) {
          const jpegBase64 = jpegBuffer.toString('base64');
          const finalSize = workingImage.getSize();
          console.log(`[MCP Server] SUCCESS: Compressed to ${compressedSizeMB.toFixed(3)} MB (${finalSize.width}x${finalSize.height}, quality ${quality})`);
          return { data: jpegBase64, mimeType: 'image/jpeg', wasCompressed: true };
        }
      }
    }

    // If even smallest scale and lowest quality doesn't fit, use smallest anyway
    const smallestScale = scaleFactors[scaleFactors.length - 1];
    const lowestQuality = qualities[qualities.length - 1];
    const smallWidth = Math.round(originalSize.width * smallestScale);
    const smallHeight = Math.round(originalSize.height * smallestScale);
    const smallestImage = image.resize({ width: smallWidth, height: smallHeight, quality: 'better' });
    const smallestBuffer = smallestImage.toJPEG(lowestQuality);
    const smallestSizeMB = smallestBuffer.length / 1024 / 1024;

    console.log(`[MCP Server] WARNING: Even smallest (${smallWidth}x${smallHeight}, quality ${lowestQuality}) is ${smallestSizeMB.toFixed(3)} MB, exceeds limit but using anyway`);

    return {
      data: smallestBuffer.toString('base64'),
      mimeType: 'image/jpeg',
      wasCompressed: true
    };
  } catch (error) {
    console.error('[MCP Server] Failed to compress image:', error);
    return { data: base64Data, mimeType, wasCompressed: false };
  }
}

// Store document state PER SESSION to avoid cross-window contamination
const documentStateBySession = new Map<string, any>();
let mcpServer: Server | null = null;

// Store active SSE transports by session ID
const activeTransports = new Map<string, SSEServerTransport>();

// Map workspace paths to window IDs for routing
// This is populated when we receive document state updates
const workspaceToWindowMap = new Map<string, number>();

// Extension tools registered from renderer
interface ExtensionToolDefinition {
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
const extensionToolsByWorkspace = new Map<string, ExtensionToolDefinition[]>();

/**
 * Register extension tools from a workspace window
 */
export function registerExtensionTools(workspacePath: string, tools: ExtensionToolDefinition[]) {
  extensionToolsByWorkspace.set(workspacePath, tools);
  console.log(`[MCP Server] Registered ${tools.length} extension tools for workspace: ${workspacePath}`);
  // tools.forEach(t => console.log(`[MCP Server]   - ${t.name} (${t.scope})`));
}

/**
 * Unregister extension tools for a workspace (when window closes)
 */
export function unregisterExtensionTools(workspacePath: string) {
  extensionToolsByWorkspace.delete(workspacePath);
  console.log(`[MCP Server] Unregistered extension tools for workspace: ${workspacePath}`);
}

/**
 * Get available extension tools for a given file path
 * Filters based on scope and file patterns
 */
function getAvailableExtensionTools(workspacePath: string | undefined, filePath: string | undefined): ExtensionToolDefinition[] {
  if (!workspacePath) return [];

  const tools = extensionToolsByWorkspace.get(workspacePath) || [];

  return tools.filter(tool => {
    // Global tools are always available
    if (tool.scope === 'global') return true;

    // Editor-scoped tools require a matching file
    if (!filePath) return false;

    // Check if file matches any pattern
    if (!tool.editorFilePatterns || tool.editorFilePatterns.length === 0) {
      return false;
    }

    const fileExtension = filePath.substring(filePath.lastIndexOf('.'));
    return tool.editorFilePatterns.some(pattern => {
      // Handle "*.ext" patterns
      if (pattern.startsWith('*.')) {
        const patternExt = pattern.substring(1); // ".ext"
        return fileExtension.toLowerCase() === patternExt.toLowerCase();
      }
      // Exact match
      return filePath.toLowerCase().endsWith(pattern.toLowerCase());
    });
  });
}

export function updateDocumentState(state: any, sessionId?: string) {
  if (!sessionId) {
    // console.warn('[MCP Server] No sessionId provided for document state update - using "default"');
    sessionId = 'default';
  }

  // CRITICAL: Workspace path is REQUIRED for routing
  if (!state?.workspacePath) {
    const error = new Error(`[MCP Server] CRITICAL: No workspacePath in document state for session ${sessionId}! Cannot route MCP tools without workspace path. State keys: ${Object.keys(state || {}).join(', ')}`);
    console.error(error.message);
    throw error;
  }

  // filePath is optional - if missing, only global-scoped extension tools will be available
  // This is normal for agent mode sessions without a specific file open
  if (!state?.filePath) {
    console.log(`[MCP Server] No filePath in document state for session ${sessionId} - only global tools will be available`);
  }

  // DEFENSIVE LOGGING: Log exactly what we received
  // console.log(`[MCP Server] Received document state update:`, {
  //   sessionId,
  //   filePath: state.filePath,
  //   workspacePath: state.workspacePath,
  //   stateKeys: Object.keys(state || {})
  // });

  // Store state with sessionId included so handlers can access it from the value
  documentStateBySession.set(sessionId, { ...state, sessionId });
  // console.log(`[MCP Server] Session ${sessionId} associated with workspace: ${state.workspacePath}`);
}

/**
 * Register a workspace path to window mapping
 * This should be called from the main process when document state is updated
 */
export function registerWorkspaceWindow(workspacePath: string, windowId: number) {
  workspaceToWindowMap.set(workspacePath, windowId);
  // console.log(`[MCP Server] Registered workspace ${workspacePath} -> window ${windowId}`);
}

// Store the HTTP server instance
let httpServerInstance: any = null;

/**
 * Find the correct window for a given file path by matching the workspace
 * This is critical for multi-window support - we need to send IPC to the window that has the file open
 *
 * Uses workspace path as the canonical identifier since it's stable across app restarts,
 * unlike windowId which changes every time.
 */
function findWindowForFilePath(filePath: string | undefined): BrowserWindow | null {
  if (!filePath) {
    throw new Error('[MCP Server] CRITICAL: No file path provided to findWindowForFilePath, cannot determine target window');
  }

  // console.log(`[MCP Server] Looking for window with file: ${filePath}`);

  // DEFENSIVE: Log ALL document states in detail
  // const stateDetails = Array.from(documentStateBySession.entries()).map(([id, state]) => ({
  //   sessionId: id,
  //   filePath: state?.filePath,
  //   workspacePath: state?.workspacePath,
  //   hasFilePath: !!state?.filePath,
  //   hasWorkspacePath: !!state?.workspacePath,
  //   filePathMatches: state?.filePath === filePath
  // }));
  // console.log(`[MCP Server] Document states (${stateDetails.length}):`, JSON.stringify(stateDetails, null, 2));

  // First, find which workspace this file belongs to
  let targetWorkspacePath: string | undefined;
  for (const [sessionId, state] of documentStateBySession.entries()) {
    // console.log(`[MCP Server] Checking session ${sessionId}:`, {
    //   stateFilePath: state?.filePath,
    //   targetFilePath: filePath,
    //   matches: state?.filePath === filePath,
    //   hasWorkspacePath: !!state?.workspacePath,
    //   workspacePath: state?.workspacePath
    // });

    if (state?.filePath === filePath) {
      if (!state?.workspacePath) {
        // This should never happen because updateDocumentState throws if workspacePath is missing
        throw new Error(`[MCP Server] CRITICAL: Found matching file ${filePath} but NO WORKSPACE PATH in state! This should be impossible - updateDocumentState should have thrown. State keys: ${Object.keys(state || {}).join(', ')}`);
      }

      targetWorkspacePath = state.workspacePath;
      // console.log(`[MCP Server] File belongs to workspace: ${targetWorkspacePath}`);
      break;
    }
  }

  if (!targetWorkspacePath) {
    const availableSessions = Array.from(documentStateBySession.entries()).map(([id, state]) =>
      `${id}: ${state?.filePath || 'NO FILE'}`
    ).join(', ');
    throw new Error(`[MCP Server] CRITICAL: Could not determine workspace for file: ${filePath}. Available sessions (${documentStateBySession.size}): ${availableSessions}`);
  }

  // Look up the window ID for this workspace path
  const windowId = workspaceToWindowMap.get(targetWorkspacePath);
  if (!windowId) {
    const availableWorkspaces = Array.from(workspaceToWindowMap.entries()).map(([path, id]) =>
      `${path} -> window ${id}`
    ).join(', ');
    throw new Error(`[MCP Server] CRITICAL: No window registered for workspace: ${targetWorkspacePath}. Available workspaces: ${availableWorkspaces || 'NONE'}`);
  }

  // Get the window by ID
  const window = BrowserWindow.fromId(windowId);
  if (!window) {
    // Clean up stale mapping
    workspaceToWindowMap.delete(targetWorkspacePath);
    throw new Error(`[MCP Server] CRITICAL: Window ${windowId} for workspace ${targetWorkspacePath} no longer exists (window was closed)`);
  }

  // console.log(`[MCP Server] Found window ${windowId} for workspace: ${targetWorkspacePath}`);
  return window;
}

/**
 * Remove a window from the workspace mapping when it's closed
 */
export function unregisterWindow(windowId: number) {
  // Find and remove any workspace mappings for this window
  for (const [workspacePath, mappedWindowId] of workspaceToWindowMap.entries()) {
    if (mappedWindowId === windowId) {
      workspaceToWindowMap.delete(workspacePath);
      // console.log(`[MCP Server] Unregistered workspace ${workspacePath} from window ${windowId}`);
    }
  }
}

export function cleanupMcpServer() {
  // Close all active SSE transports
  for (const [sessionId, transport] of activeTransports.entries()) {
    // console.log(`[MCP Server] Closing transport for session ${sessionId}`);
    try {
      // Close the transport
      if (transport.onclose) {
        transport.onclose();
      }
      // Also try to end any underlying response
      const res = (transport as any).res;
      if (res && !res.headersSent) {
        res.end();
      }
    } catch (error) {
      console.error(`[MCP Server] Error closing transport ${sessionId}:`, error);
    }
  }
  activeTransports.clear();

  // Clear the MCP server instance
  if (mcpServer) {
    mcpServer = null;
  }
}

export function shutdownHttpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!httpServerInstance) {
      resolve();
      return;
    }

    // console.log('[MCP Server] Shutting down HTTP server');

    // Track if we've resolved
    let hasResolved = false;
    const safeResolve = () => {
      if (!hasResolved) {
        hasResolved = true;
        resolve();
      }
    };

    try {
      // First cleanup transports
      cleanupMcpServer();
    } catch (error) {
      console.error('[MCP Server] Error cleaning up transports:', error);
    }

    try {
      // Force close all connections
      if (httpServerInstance && typeof httpServerInstance.closeAllConnections === 'function') {
        httpServerInstance.closeAllConnections();
      }
    } catch (error) {
      console.error('[MCP Server] Error closing connections:', error);
    }

    try {
      // Close the server
      if (httpServerInstance && typeof httpServerInstance.close === 'function') {
        httpServerInstance.close((err?: Error) => {
          if (err) {
            console.error('[MCP Server] Error closing HTTP server:', err);
          }
          httpServerInstance = null;
          safeResolve();
        });
      } else {
        httpServerInstance = null;
        safeResolve();
      }
    } catch (error) {
      console.error('[MCP Server] Error in server close:', error);
      httpServerInstance = null;
      safeResolve();
    }

    // More aggressive timeout for production
    const isProduction = process.env.NODE_ENV === 'production';
    const timeout = isProduction ? 300 : 1000;

    // Timeout to ensure we don't hang
    setTimeout(() => {
      if (httpServerInstance) {
        console.log('[MCP Server] Force destroying HTTP server after timeout');
        httpServerInstance = null;
      }
      safeResolve();
    }, timeout);
  });
}

export async function startMcpHttpServer(startPort: number = 3456): Promise<{ httpServer: any; port: number }> {
  // Try to find an available port starting from the given port
  let port = startPort;
  let httpServer: any = null;
  let maxAttempts = 100; // Try up to 100 ports

  while (maxAttempts > 0) {
    try {
      httpServer = await tryCreateServer(port);
      // console.log(`[MCP Server] Successfully started on port ${port}`);
      break;
    } catch (error: any) {
      if (error.code === 'EADDRINUSE') {
        // console.log(`[MCP Server] Port ${port} is in use, trying ${port + 1}...`);
        port++;
        maxAttempts--;
      } else {
        // Some other error, re-throw it
        throw error;
      }
    }
  }

  if (!httpServer) {
    throw new Error(`[MCP Server] Could not find an available port after trying ${100} ports starting from ${startPort}`);
  }

  // Store the instance for cleanup
  httpServerInstance = httpServer;

  return { httpServer, port };
}

async function tryCreateServer(port: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const parsedUrl = parseUrl(req.url || '', true);
    const pathname = parsedUrl.pathname;

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    // Handle SSE GET request to establish connection
    if (pathname === '/mcp' && req.method === 'GET') {
      // console.log('[MCP Server] SSE connection request');

      // Extract workspace path from query parameter (used by capture_mockup_screenshot)
      const workspacePath = parsedUrl.query.workspacePath as string | undefined;
      // console.log('[MCP Server] Connection established with workspacePath:', workspacePath);

      // Create a new MCP server instance for this connection
      const server = new Server(
        {
          name: 'nimbalyst-mcp',
          version: '1.0.0'
        },
        {
          capabilities: {
            tools: {}
          }
        }
      );

      // Register tool handlers
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        // Get current document state to determine which extension tools to show
        const states = Array.from(documentStateBySession.values());
        const currentDocState = states[states.length - 1];
        const currentFilePath = currentDocState?.filePath;

        // Built-in tools exposed via MCP (for Claude Code / agent mode)
        // NOTE: applyDiff and streamContent are intentionally NOT exposed here.
        // They are only available through chat providers via direct IPC, not through
        // Claude Code MCP. This was the original design - see commit af94ef47.
        // The agent should use native Edit/Write tools with file-watcher diff approval.
        const builtInTools: Array<{ name: string; description: string; inputSchema: any }> = [
          {
            name: 'capture_editor_screenshot',
            description: 'Capture a screenshot of any editor view. Works with all file types including custom editors (Excalidraw, CSV, mockups), markdown, code, etc. Use this to visually verify UI, diagrams, or any editor content.',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: {
                  type: 'string',
                  description: 'The absolute path to the file being edited (optional, uses active file if not specified)'
                },
                selector: {
                  type: 'string',
                  description: 'CSS selector to capture a specific element (optional, captures full editor area if not specified)'
                }
              }
            }
          },
          {
            name: 'capture_mockup_screenshot',
            description: 'DEPRECATED: Use capture_editor_screenshot instead. This tool is maintained for backward compatibility only. Captures a screenshot of a .mockup.html file, including user annotations if the file is open.',
            inputSchema: {
              type: 'object',
              properties: {
                file_path: {
                  type: 'string',
                  description: 'The absolute path to the .mockup.html file to capture.'
                }
              },
              required: ['file_path']
            }
          }
        ];

        builtInTools.push({
          name: 'display_to_user',
          description: 'Display visual content inline in the conversation. Use this to show images or charts to the user. Provide an array of items, where each item has a description and exactly one content type: either "image" (for displaying a LOCAL file) or "chart" (for data visualizations). IMPORTANT: For images, you must provide an ABSOLUTE path to a LOCAL file on disk (e.g., "/Users/name/project/image.png"). URLs and relative paths are NOT supported. If a file does not exist, that specific image will show an error while other valid images still display.',
          inputSchema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                description: 'Array of visual items to display. Each item must have a description and exactly one content type (image or chart).',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    description: {
                      type: 'string',
                      description: 'Brief description of what this visual content shows'
                    },
                    image: {
                      type: 'object',
                      description: 'Display a LOCAL image file from disk. Provide this OR chart, not both. The file must exist locally.',
                      properties: {
                        path: {
                          type: 'string',
                          description: 'ABSOLUTE path to a LOCAL image file on disk (e.g., "/Users/name/project/screenshot.png"). URLs and relative paths are NOT supported. The file must exist.'
                        }
                      },
                      required: ['path']
                    },
                    chart: {
                      type: 'object',
                      description: 'Display a data chart. Provide this OR image, not both.',
                      properties: {
                        chartType: {
                          type: 'string',
                          enum: ['bar', 'line', 'pie', 'area', 'scatter'],
                          description: 'The type of chart to render'
                        },
                        data: {
                          type: 'array',
                          items: { type: 'object' },
                          description: 'Array of data objects with keys matching xAxisKey and yAxisKey'
                        },
                        xAxisKey: {
                          type: 'string',
                          description: 'Key in data objects for x-axis labels (or pie chart segment names)'
                        },
                        yAxisKey: {
                          oneOf: [
                            { type: 'string' },
                            { type: 'array', items: { type: 'string' } }
                          ],
                          description: 'Key(s) in data objects for y-axis values. String for single series, array for multi-series'
                        },
                        colors: {
                          type: 'array',
                          items: { type: 'string' },
                          description: 'Optional colors for chart series (hex codes or CSS color names)'
                        },
                        errorBars: {
                          type: 'object',
                          description: 'Optional error bars configuration. Supports bar, line, area, and scatter charts.',
                          properties: {
                            dataKey: {
                              type: 'string',
                              description: 'Key in data objects for the y-axis series to add error bars to (required when yAxisKey is an array)'
                            },
                            errorKey: {
                              type: 'string',
                              description: 'Key in data objects containing error values (symmetric errors)'
                            },
                            errorKeyLower: {
                              type: 'string',
                              description: 'Key in data objects for lower error values (asymmetric errors)'
                            },
                            errorKeyUpper: {
                              type: 'string',
                              description: 'Key in data objects for upper error values (asymmetric errors)'
                            },
                            strokeWidth: {
                              type: 'number',
                              description: 'Width of error bar lines (default: 2)'
                            }
                          }
                        }
                      },
                      required: ['chartType', 'data', 'xAxisKey', 'yAxisKey']
                    }
                  },
                  required: ['description']
                }
              }
            },
            required: ['items']
          }
        });

        // Always add voice_agent_speak tool so it's discoverable
        // The handler will return a non-error response if voice mode is not active
        builtInTools.push({
          name: 'voice_agent_speak',
          description: 'Send a message to the voice agent to be spoken aloud to the user. This tool serves as a communication bridge between the coding agent and the voice agent, enabling the coding agent to provide spoken updates, task completion notifications, or responses to the user during voice mode sessions. Use this when you want to inform the user about progress or results while they are interacting via voice. If voice mode is not active, this tool will return a non-error response indicating voice is unavailable. Keep messages concise and conversational.',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'The message for the voice agent to speak to the user. Be concise and natural. This enables the coding agent to communicate with the user through the voice agent.'
              }
            },
            required: ['message']
          }
        });

        // Add voice_agent_stop tool to allow AI to end voice sessions
        builtInTools.push({
          name: 'voice_agent_stop',
          description: 'Stop the current voice mode session. Use this to end voice interactions when the conversation is complete, when the user requests to stop, or when transitioning away from voice mode. This will disconnect from the voice service and clean up resources. Returns success if a session was stopped, or indicates if no session was active.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        });

        // Get extension tools for the current workspace/file
        const extensionTools = getAvailableExtensionTools(workspacePath, currentFilePath);
        const extensionToolSchemas = extensionTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }));

        if (extensionTools.length > 0) {
          console.log(`[MCP Server] Including ${extensionTools.length} extension tools for file: ${currentFilePath}`);
        }

        const allTools = [...builtInTools, ...extensionToolSchemas];
        // Debug logging - uncomment if needed for troubleshooting tool registration
        // console.log('[MCP Server] Returning tools:', allTools.map(t => t.name).join(', '));
        // console.log('[MCP Server] voice_agent_speak in list?', allTools.some(t => t.name === 'voice_agent_speak'));

        return {
          tools: allTools
        };
      });

      // Tool execution handler
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        // console.log(`[MCP Server] Tool called: ${name}`, args);

        // Strip MCP server prefix if present (Claude Code sends tools as mcp__nimbalyst__toolName)
        const toolName = name.replace(/^mcp__nimbalyst__/, '');
        // console.log(`[MCP Server] Resolved tool name: ${toolName} (original: ${name})`);

        switch (toolName) {
          case 'applyDiff': {
            const typedArgs = args as { filePath?: string; replacements?: any[] } | undefined;
            // Use explicit filePath from args, or fall back to current document state
            let targetFilePath: string | undefined = typedArgs?.filePath;

            if (!targetFilePath) {
              // Get the current document state for file path
              const states = Array.from(documentStateBySession.values());
              const currentDocState = states[states.length - 1];
              targetFilePath = currentDocState?.filePath;
            }

            // Find the correct window for this file
            const targetWindow = findWindowForFilePath(targetFilePath);
            if (targetWindow) {

              // Validate that the file is a markdown file
              if (targetFilePath && !targetFilePath.endsWith('.md')) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `Error: applyDiff can only modify markdown files (.md). Attempted to modify: ${targetFilePath}`
                    }
                  ],
                  isError: true
                };
              }

              // Create a unique channel for the result
              const resultChannel = `mcp-result-${Date.now()}-${Math.random()}`;

              // Set up a one-time listener for the result
              return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                  ipcMain.removeHandler(resultChannel);

                  resolve({
                    content: [
                      {
                        type: 'text',
                        text: 'Timed out while waiting for diff to apply. The operation may still be in progress.'
                      }
                    ],
                    isError: true
                  });
                }, 30000);

                ipcMain.once(resultChannel, (event, result) => {
                  clearTimeout(timeout);

                  const success = result?.success ?? false;
                  const error = result?.error;

                  // Use the targetFilePath we determined earlier
                  const filePath = targetFilePath || 'untitled';

                  resolve({
                    content: [
                      {
                        type: 'text',
                        text: success
                          ? `Successfully applied diff to ${filePath}`
                          : `Failed to apply diff: ${error || 'Unknown error'}`
                      }
                    ],
                    isError: !success
                  });
                });

                // Send the request with the result channel and target file path
                // console.log('[MCP Server] Sending applyDiff to window', targetWindow.id);
                targetWindow.webContents.send('mcp:applyDiff', {
                  replacements: typedArgs?.replacements,
                  resultChannel,
                  targetFilePath: targetFilePath
                });
              });
            }
            return {
              content: [
                {
                  type: 'text',
                  text: 'Error: No window available for target file'
                }
              ],
              isError: true
            };
          }

          case 'streamContent': {
            const typedArgs = args as { filePath?: string; content?: string; position?: string; insertAfter?: string } | undefined;
            // Use explicit filePath from args, or fall back to current document state
            let targetFilePath: string | undefined = typedArgs?.filePath;

            if (!targetFilePath) {
              // Get the current document state for file path
              const states = Array.from(documentStateBySession.values());
              const currentDocState = states[states.length - 1];
              targetFilePath = currentDocState?.filePath;
            }

            // Find the correct window for this file
            const targetWindow = findWindowForFilePath(targetFilePath);
            if (targetWindow) {

              // Generate a unique stream ID
              const streamId = `mcp-stream-${Date.now()}-${Math.random()}`;

              // Create a unique channel for the result
              const resultChannel = `mcp-result-${Date.now()}-${Math.random()}`;

              // Set up a one-time listener for the result
              return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                  ipcMain.removeHandler(resultChannel);

                  resolve({
                    content: [
                      {
                        type: 'text',
                        text: 'Timed out while waiting for content to stream. The operation may still be in progress.'
                      }
                    ],
                    isError: true
                  });
                }, 30000);

                ipcMain.once(resultChannel, (event, result) => {
                  clearTimeout(timeout);

                  const success = result?.success ?? false;
                  const error = result?.error;

                  // Use the targetFilePath we determined earlier
                  const filePath = targetFilePath || 'untitled';

                  resolve({
                    content: [
                      {
                        type: 'text',
                        text: success
                          ? `Successfully streamed content to ${filePath}`
                          : `Failed to stream content: ${error || 'Unknown error'}`
                      }
                    ],
                    isError: !success
                  });
                });

                // Send IPC message to renderer with result channel
                // console.log('[MCP Server] ==========================================');
                // console.log('[MCP Server] Sending mcp:streamContent IPC to renderer');
                // console.log('[MCP Server] Target window ID:', targetWindow.id);
                // console.log('[MCP Server] streamId:', streamId);
                // console.log('[MCP Server] targetFilePath:', targetFilePath);
                // console.log('[MCP Server] position:', typedArgs?.position || 'end');
                // console.log('[MCP Server] content length:', typedArgs?.content?.length);
                // console.log('[MCP Server] content preview:', typedArgs?.content?.substring(0, 100));
                // console.log('[MCP Server] ==========================================');

                targetWindow.webContents.send('mcp:streamContent', {
                  streamId,
                  content: typedArgs?.content,
                  position: typedArgs?.position || 'end',
                  insertAfter: typedArgs?.insertAfter,
                  targetFilePath: targetFilePath,
                  resultChannel
                });

                // console.log('[MCP Server] IPC message sent to window', targetWindow.id);
              });
            }
            return {
              content: [
                {
                  type: 'text',
                  text: 'Error: No window available for target file'
                }
              ],
              isError: true
            };
          }

          case 'capture_mockup_screenshot': {
            const filePath = args?.file_path as string;
            console.log('[MCP Server] capture_mockup_screenshot called with:', { filePath, workspacePath });

            // Validate file path
            if (!filePath || typeof filePath !== 'string') {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Error: file_path is required and must be a string'
                  }
                ],
                isError: true
              };
            }

            // Validate it's a mockup file
            if (!filePath.endsWith('.mockup.html')) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Error: File must be a .mockup.html file. Got: ${filePath}`
                  }
                ],
                isError: true
              };
            }

            try {
              // Get the mockup screenshot service
              const mockupService = MockupScreenshotService.getInstance();

              // Use workspace path from query parameter (captured in closure)
              // If not provided, fall back to document state
              let effectiveWorkspacePath = workspacePath;

              if (!effectiveWorkspacePath) {
                // Try to find workspace from document state as fallback
                for (const state of documentStateBySession.values()) {
                  if (state?.workspacePath) {
                    effectiveWorkspacePath = state.workspacePath;
                    break;
                  }
                }
              }

              // If still no workspace found, return error
              if (!effectiveWorkspacePath) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: 'Error: No workspace context available. Please ensure a workspace is open and the MCP server was connected with a workspace path.'
                    }
                  ],
                  isError: true
                };
              }

              // Call the capture method
              const result = await mockupService.captureScreenshotForMCP(filePath, effectiveWorkspacePath);

              if (!result.success) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `Error capturing screenshot: ${result.error || 'Unknown error'}`
                    }
                  ],
                  isError: true
                };
              }

              // Validate that we actually got image data
              // This prevents the API error: "image cannot be empty"
              if (!result.imageBase64 || result.imageBase64.length === 0) {
                console.error('[MCP Server] Mockup screenshot returned empty base64 data');
                return {
                  content: [
                    {
                      type: 'text',
                      text: 'Error: Screenshot capture returned empty image data. The mockup may not have rendered properly or the capture failed silently.'
                    }
                  ],
                  isError: true
                };
              }

              console.log(`[MCP Server] Captured screenshot for ${filePath}`);

              // Compress image if needed to work around Claude bug with large images
              // See: https://discord.com/channels/1072196207201501266/1451693213931933846
              const compressed = compressImageIfNeeded(
                result.imageBase64,
                result.mimeType || 'image/png'
              );

              const finalSizeBytes = Math.floor((compressed.data.length * 3) / 4);
              console.log(`[MCP Server] Returning image inline in tool call: ${(finalSizeBytes / 1024 / 1024).toFixed(3)} MB, mimeType: ${compressed.mimeType}, wasCompressed: ${compressed.wasCompressed}`);

              // Return the image as base64-encoded content
              return {
                content: [
                  {
                    type: 'image',
                    data: compressed.data,
                    mimeType: compressed.mimeType
                  }
                ],
                isError: false
              };
            } catch (error) {
              console.error('[MCP Server] Failed to capture screenshot:', error);
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';

              return {
                content: [
                  {
                    type: 'text',
                    text: `Error capturing screenshot: ${errorMessage}`
                  }
                ],
                isError: true
              };
            }
          }

          case 'capture_editor_screenshot': {
            let filePath = args?.file_path as string | undefined;
            const selector = args?.selector as string | undefined;

            console.log('[MCP Server] capture_editor_screenshot called with:', { filePath, selector, workspacePath });

            // If no file path provided, try to get the active file from document state
            if (!filePath) {
              const states = Array.from(documentStateBySession.values());
              const currentDocState = states[states.length - 1];
              filePath = currentDocState?.filePath;
            }

            if (!filePath) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Error: No file specified and no active file found. Please specify a file_path or ensure a file is open in the editor.'
                  }
                ],
                isError: true
              };
            }

            try {
              // Find the window that has this file open
              let targetWindow: BrowserWindow | null = null;

              // Find which workspace contains this file path
              // The file's workspace is the longest workspace path that is a prefix of the file path
              let fileWorkspacePath: string | undefined;
              for (const wsPath of workspaceToWindowMap.keys()) {
                if (filePath.startsWith(wsPath + '/') || filePath === wsPath) {
                  if (!fileWorkspacePath || wsPath.length > fileWorkspacePath.length) {
                    fileWorkspacePath = wsPath;
                  }
                }
              }

              if (!fileWorkspacePath) {
                const availableWorkspaces = Array.from(workspaceToWindowMap.keys()).join(', ') || 'none';
                return {
                  content: [
                    {
                      type: 'text',
                      text: `Error: File "${filePath}" does not belong to any open workspace. Available workspaces: ${availableWorkspaces}`
                    }
                  ],
                  isError: true
                };
              }

              const windowId = workspaceToWindowMap.get(fileWorkspacePath);
              if (windowId) {
                targetWindow = BrowserWindow.fromId(windowId);
              }

              if (!targetWindow || targetWindow.isDestroyed()) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `Error: Window for workspace "${fileWorkspacePath}" is no longer available`
                    }
                  ],
                  isError: true
                };
              }

              console.log(`[MCP Server] Routing screenshot request to window ${targetWindow.id} for workspace: ${fileWorkspacePath}`);

              // Generate unique request ID
              const requestId = `editor-screenshot-${Date.now()}-${Math.random().toString(36).substring(7)}`;

              // Create promise for the result
              const result = await new Promise<{ success: boolean; imageBase64?: string; mimeType?: string; error?: string }>((resolve) => {
                // Set timeout
                const timeout = setTimeout(() => {
                  ipcMain.removeAllListeners(requestId);
                  resolve({
                    success: false,
                    error: 'Screenshot capture timed out'
                  });
                }, 10000);

                ipcMain.once(requestId, (_event, captureResult) => {
                  clearTimeout(timeout);
                  resolve(captureResult);
                });

                // Send IPC message to renderer to capture screenshot
                targetWindow!.webContents.send('editor:capture-screenshot', {
                  requestId,
                  filePath,
                  selector
                });
              });

              if (!result.success) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `Error capturing editor screenshot: ${result.error || 'Unknown error'}`
                    }
                  ],
                  isError: true
                };
              }

              // Validate that we actually got image data
              // This prevents the API error: "image cannot be empty"
              if (!result.imageBase64 || result.imageBase64.length === 0) {
                console.error('[MCP Server] Editor screenshot returned empty base64 data');
                return {
                  content: [
                    {
                      type: 'text',
                      text: 'Error: Screenshot capture returned empty image data. The editor element may not have rendered properly or the capture failed silently.'
                    }
                  ],
                  isError: true
                };
              }

              console.log(`[MCP Server] Captured editor screenshot for ${filePath}`);

              // Compress image if needed (reuse mockup compression logic)
              const compressed = compressImageIfNeeded(
                result.imageBase64,
                result.mimeType || 'image/png'
              );

              const finalSizeBytes = Math.floor((compressed.data.length * 3) / 4);
              console.log(`[MCP Server] Returning editor screenshot: ${(finalSizeBytes / 1024 / 1024).toFixed(3)} MB, mimeType: ${compressed.mimeType}, wasCompressed: ${compressed.wasCompressed}`);

              return {
                content: [
                  {
                    type: 'image',
                    data: compressed.data,
                    mimeType: compressed.mimeType
                  }
                ],
                isError: false
              };
            } catch (error) {
              console.error('[MCP Server] Failed to capture editor screenshot:', error);
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';

              return {
                content: [
                  {
                    type: 'text',
                    text: `Error capturing editor screenshot: ${errorMessage}`
                  }
                ],
                isError: true
              };
            }
          }

          case 'display_to_user': {
            // Types for the new array-based schema
            type ImageContent = {
              path: string;
            };

            type ChartContent = {
              chartType: 'bar' | 'line' | 'pie' | 'area' | 'scatter';
              data: Record<string, unknown>[];
              xAxisKey: string;
              yAxisKey: string | string[];
              colors?: string[];
            };

            type DisplayItem = {
              description: string;
              image?: ImageContent;
              chart?: ChartContent;
            };

            type DisplayArgs = {
              items: DisplayItem[];
            };

            const typedArgs = args as DisplayArgs | undefined;

            // Validate items array exists
            if (!typedArgs?.items) {
              return {
                content: [{ type: 'text', text: 'Error: "items" array is required. Provide an array of display items, each with a description and either an "image" or "chart" object.' }],
                isError: true
              };
            }

            if (!Array.isArray(typedArgs.items)) {
              return {
                content: [{ type: 'text', text: 'Error: "items" must be an array of display items.' }],
                isError: true
              };
            }

            if (typedArgs.items.length === 0) {
              return {
                content: [{ type: 'text', text: 'Error: "items" array must contain at least one item.' }],
                isError: true
              };
            }

            // Validate each item
            const validChartTypes = ['bar', 'line', 'pie', 'area', 'scatter'];
            const displayedItems: string[] = [];

            for (let i = 0; i < typedArgs.items.length; i++) {
              const item = typedArgs.items[i];
              const itemPrefix = `items[${i}]`;

              // Validate description
              if (!item.description || typeof item.description !== 'string') {
                return {
                  content: [{ type: 'text', text: `Error: ${itemPrefix} is missing required "description" field.` }],
                  isError: true
                };
              }

              // Check that exactly one content type is provided
              const hasImage = !!item.image;
              const hasChart = !!item.chart;

              if (!hasImage && !hasChart) {
                return {
                  content: [{ type: 'text', text: `Error: ${itemPrefix} must have either an "image" or "chart" object. Description: "${item.description}"` }],
                  isError: true
                };
              }

              if (hasImage && hasChart) {
                return {
                  content: [{ type: 'text', text: `Error: ${itemPrefix} has both "image" and "chart" - provide only one content type per item.` }],
                  isError: true
                };
              }

              // Validate image content
              if (hasImage) {
                if (!item.image!.path || typeof item.image!.path !== 'string') {
                  return {
                    content: [{ type: 'text', text: `Error: ${itemPrefix}.image.path is required and must be a string.` }],
                    isError: true
                  };
                }

                const imagePath = item.image!.path;

                // Check if path looks like a URL (common mistake)
                if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('data:')) {
                  return {
                    content: [{ type: 'text', text: `Error: ${itemPrefix}.image.path must be a LOCAL file path, not a URL. Got: "${imagePath.substring(0, 100)}${imagePath.length > 100 ? '...' : ''}". Download the image to a local file first, then provide the absolute path to that file.` }],
                    isError: true
                  };
                }

                // Validate path is absolute (prevents relative path traversal)
                if (!isAbsolute(imagePath)) {
                  return {
                    content: [{ type: 'text', text: `Error: ${itemPrefix}.image.path must be an ABSOLUTE local file path (e.g., "/Users/name/image.png"), not a relative path. Got: "${imagePath}"` }],
                    isError: true
                  };
                }

                // Normalize and resolve path (prevents path traversal attacks)
                // Note: Using path.resolve() explicitly to avoid shadowing from Promise resolve callbacks
                const normalizedPath = path.resolve(imagePath);

                // Note: We intentionally do NOT check if the file exists here.
                // The widget handles missing files gracefully per-image, showing an error
                // for that specific image while still displaying other valid images.
                // Failing the entire request for one missing file is poor UX.

                displayedItems.push(`image: ${item.description}`);
              }

              // Validate chart content
              if (hasChart) {
                const chart = item.chart!;

                if (!chart.chartType) {
                  return {
                    content: [{ type: 'text', text: `Error: ${itemPrefix}.chart.chartType is required.` }],
                    isError: true
                  };
                }

                if (!validChartTypes.includes(chart.chartType)) {
                  return {
                    content: [{ type: 'text', text: `Error: ${itemPrefix}.chart.chartType must be one of: ${validChartTypes.join(', ')}. Got: "${chart.chartType}"` }],
                    isError: true
                  };
                }

                if (!chart.data || !Array.isArray(chart.data) || chart.data.length === 0) {
                  return {
                    content: [{ type: 'text', text: `Error: ${itemPrefix}.chart.data must be a non-empty array.` }],
                    isError: true
                  };
                }

                if (!chart.xAxisKey || typeof chart.xAxisKey !== 'string') {
                  return {
                    content: [{ type: 'text', text: `Error: ${itemPrefix}.chart.xAxisKey is required.` }],
                    isError: true
                  };
                }

                if (!chart.yAxisKey) {
                  return {
                    content: [{ type: 'text', text: `Error: ${itemPrefix}.chart.yAxisKey is required.` }],
                    isError: true
                  };
                }

                // Validate error bars if provided
                if (chart.errorBars) {
                  const errorBars = chart.errorBars as Record<string, unknown>;

                  // Check that we have either symmetric or asymmetric error data
                  const hasSymmetric = typeof errorBars.errorKey === 'string';
                  const hasAsymmetric = typeof errorBars.errorKeyLower === 'string' && typeof errorBars.errorKeyUpper === 'string';

                  if (!hasSymmetric && !hasAsymmetric) {
                    return {
                      content: [{ type: 'text', text: `Error: ${itemPrefix}.chart.errorBars must have either "errorKey" (for symmetric errors) or both "errorKeyLower" and "errorKeyUpper" (for asymmetric errors).` }],
                      isError: true
                    };
                  }

                  if (hasSymmetric && hasAsymmetric) {
                    return {
                      content: [{ type: 'text', text: `Error: ${itemPrefix}.chart.errorBars cannot have both "errorKey" and "errorKeyLower"/"errorKeyUpper". Use one or the other.` }],
                      isError: true
                    };
                  }

                  // Validate strokeWidth if provided
                  if (errorBars.strokeWidth !== undefined && typeof errorBars.strokeWidth !== 'number') {
                    return {
                      content: [{ type: 'text', text: `Error: ${itemPrefix}.chart.errorBars.strokeWidth must be a number.` }],
                      isError: true
                    };
                  }

                  // Validate dataKey if provided (used for multi-series charts)
                  if (errorBars.dataKey !== undefined && typeof errorBars.dataKey !== 'string') {
                    return {
                      content: [{ type: 'text', text: `Error: ${itemPrefix}.chart.errorBars.dataKey must be a string.` }],
                      isError: true
                    };
                  }

                  // Pie charts don't support error bars
                  if (chart.chartType === 'pie') {
                    return {
                      content: [{ type: 'text', text: `Error: ${itemPrefix}.chart.errorBars is not supported for pie charts.` }],
                      isError: true
                    };
                  }
                }

                displayedItems.push(`${chart.chartType} chart: ${item.description}`);
              }
            }

            console.log(`[MCP Server] display_to_user: ${typedArgs.items.length} item(s)`);

            return {
              content: [{
                type: 'text',
                text: `Displayed ${typedArgs.items.length} item(s):\n${displayedItems.map(d => `- ${d}`).join('\n')}`
              }],
              isError: false
            };
          }

          case 'voice_agent_speak': {
            const message = args?.message as string | undefined;

            if (!message || typeof message !== 'string') {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Error: message parameter is required and must be a string'
                  }
                ],
                isError: true
              };
            }

            // Get the active voice session directly - works regardless of document state
            const activeVoiceSessionId = getActiveVoiceSessionId();

            if (!activeVoiceSessionId) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Voice mode is not currently active. The message cannot be spoken aloud. You can still respond to the user via text in the normal way.'
                  }
                ],
                isError: false // Not a hard error - just means voice mode isn't active
              };
            }

            // Debug logging - uncomment if needed for troubleshooting voice message routing
            // console.log('[MCP Server] voice_agent_speak - sending to active voice session:', { sessionId: activeVoiceSessionId });

            // Attempt to send message to voice agent
            const success = sendToVoiceAgent(activeVoiceSessionId, message);
            // console.log('[MCP Server] voice_agent_speak - send result:', { sessionId: activeVoiceSessionId, success, message: message.substring(0, 50) });

            if (!success) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Failed to send message to voice agent. The voice connection may have been lost or disconnected. You can still respond to the user via text in the normal way.`
                  }
                ],
                isError: false // Not a hard error - voice agent just isn't reachable
              };
            }

            return {
              content: [
                {
                  type: 'text',
                  text: `Message queued for voice agent: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`
                }
              ],
              isError: false
            };
          }

          case 'voice_agent_stop': {
            // Stop the active voice session
            const wasActive = stopVoiceSession();

            if (wasActive) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Voice mode session has been stopped successfully.'
                  }
                ],
                isError: false
              };
            } else {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'No active voice mode session to stop.'
                  }
                ],
                isError: false // Not a hard error - just means no session was active
              };
            }
          }

          default: {
            // Check if this is an extension tool
            const extensionTools = getAvailableExtensionTools(workspacePath, (() => {
              const states = Array.from(documentStateBySession.values());
              const currentDocState = states[states.length - 1];
              return currentDocState?.filePath;
            })());

            const extensionTool = extensionTools.find(t => t.name === toolName);
            if (!extensionTool) {
              throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
            }

            // Execute extension tool via IPC to renderer
            console.log(`[MCP Server] Executing extension tool: ${toolName}`);

            // workspacePath is REQUIRED - extension tools must be routed to the correct window
            if (!workspacePath) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Error: workspacePath is required to execute extension tools`
                  }
                ],
                isError: true
              };
            }

            // Find the correct window for this workspace
            const windowId = workspaceToWindowMap.get(workspacePath);
            if (!windowId) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Error: No window found for workspace: ${workspacePath}`
                  }
                ],
                isError: true
              };
            }

            const targetWindow = BrowserWindow.fromId(windowId);
            if (!targetWindow) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Error: Window no longer exists`
                  }
                ],
                isError: true
              };
            }

            // Create a unique channel for the result
            const resultChannel = `mcp-extension-result-${Date.now()}-${Math.random()}`;

            // Get current file path for context
            const states = Array.from(documentStateBySession.values());
            const currentDocState = states[states.length - 1];
            const activeFilePath = currentDocState?.filePath;

            return new Promise((resolve) => {
              const TOOL_TIMEOUT_MS = 30000;
              const timeout = setTimeout(() => {
                ipcMain.removeAllListeners(resultChannel);

                console.error(`[MCP Server] Extension tool timed out:`, {
                  toolName,
                  timeoutMs: TOOL_TIMEOUT_MS,
                  activeFilePath,
                });

                const timeoutMessage = [
                  `Extension Tool Timeout`,
                  `  Tool: ${toolName}`,
                  `  Timeout: ${TOOL_TIMEOUT_MS / 1000}s`,
                  ``,
                  `The tool did not respond in time. This could mean:`,
                  `1. The tool is performing a long-running operation`,
                  `2. The tool is stuck in an infinite loop`,
                  `3. There was a silent error in the tool handler`,
                  ``,
                  `Check the extension logs for more details.`,
                ].join('\n');

                resolve({
                  content: [
                    {
                      type: 'text',
                      text: timeoutMessage
                    }
                  ],
                  isError: true
                });
              }, TOOL_TIMEOUT_MS);

              ipcMain.once(resultChannel, (_event, result) => {
                clearTimeout(timeout);

                // Handle different result formats:
                // 1. { success: true/false, message?, data?, error? } - explicit format
                // 2. { error: "message" } - error format
                // 3. { ...data } - implicit success (any object without error field)
                const hasExplicitSuccess = typeof result?.success === 'boolean';
                const hasError = !!result?.error;
                const success = hasExplicitSuccess ? result.success : !hasError;

                // Extract enhanced error details if available
                const extensionId = result?.extensionId;
                const resultToolName = result?.toolName;
                const stack = result?.stack;
                const errorContext = result?.errorContext;

                // For successful results without explicit message, show the data
                let responseText: string;
                if (success) {
                  if (result?.message) {
                    responseText = result.message;
                    if (result?.data) {
                      responseText += '\n\nData: ' + JSON.stringify(result.data, null, 2);
                    }
                  } else {
                    // No explicit message - the result itself is the data
                    // Filter out metadata fields
                    const dataToShow = { ...result };
                    delete dataToShow.success;
                    delete dataToShow.message;
                    delete dataToShow.extensionId;
                    delete dataToShow.toolName;
                    delete dataToShow.stack;
                    delete dataToShow.errorContext;
                    responseText = JSON.stringify(dataToShow, null, 2);
                  }
                } else {
                  // Build detailed error message for Claude Code
                  const errorParts: string[] = [];

                  // Header with extension and tool info
                  if (extensionId || resultToolName) {
                    errorParts.push(`Extension Tool Error`);
                    if (extensionId) errorParts.push(`  Extension: ${extensionId}`);
                    if (resultToolName) errorParts.push(`  Tool: ${resultToolName}`);
                    errorParts.push('');
                  }

                  // Main error message
                  errorParts.push(`Error: ${result?.error || result?.message || 'Tool execution failed'}`);

                  // Stack trace (truncated to avoid overwhelming the response)
                  if (stack) {
                    const truncatedStack = stack.split('\n').slice(0, 8).join('\n');
                    errorParts.push('');
                    errorParts.push('Stack trace:');
                    errorParts.push(truncatedStack);
                    if (stack.split('\n').length > 8) {
                      errorParts.push('  ... (truncated)');
                    }
                  }

                  // Additional context
                  if (errorContext && Object.keys(errorContext).length > 0) {
                    errorParts.push('');
                    errorParts.push('Context:');
                    for (const [key, value] of Object.entries(errorContext)) {
                      if (value !== undefined && value !== null) {
                        const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
                        errorParts.push(`  ${key}: ${valueStr}`);
                      }
                    }
                  }

                  responseText = errorParts.join('\n');
                }

                console.log(`[MCP Server] Extension tool result:`, {
                  success,
                  hasError,
                  extensionId,
                  toolName: resultToolName,
                  result: JSON.stringify(result).substring(0, 200)
                });

                resolve({
                  content: [
                    {
                      type: 'text',
                      text: responseText
                    }
                  ],
                  isError: !success
                });
              });

              // Send IPC to renderer to execute the tool
              targetWindow.webContents.send('mcp:executeExtensionTool', {
                toolName,
                args: args || {},
                resultChannel,
                context: {
                  workspacePath,
                  activeFilePath
                }
              });
            });
          }
        }
      });

      // Create SSE transport - it will handle headers
      const transport = new SSEServerTransport('/mcp', res);

      // Store the transport by session ID
      activeTransports.set(transport.sessionId, transport);
      // console.log('[MCP Server] Created transport with session ID:', transport.sessionId);

      // Connect server to transport
      server.connect(transport).then(() => {
        // console.log('[MCP Server] Client connected successfully');

        // Clean up on disconnect
        transport.onclose = () => {
          // console.log('[MCP Server] Client disconnected, session:', transport.sessionId);
          activeTransports.delete(transport.sessionId);
        };
      }).catch(error => {
        console.error('[MCP Server] Connection error:', error);
        activeTransports.delete(transport.sessionId);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });

    // Handle POST requests for sending messages
    } else if (pathname === '/mcp' && req.method === 'POST') {
      const sessionId = parsedUrl.query.sessionId as string;
      // console.log('[MCP Server] POST message for session:', sessionId);

      if (!sessionId) {
        res.writeHead(400);
        res.end('Missing sessionId');
        return;
      }

      const transport = activeTransports.get(sessionId);
      if (!transport) {
        console.error('[MCP Server] No transport found for session:', sessionId);
        res.writeHead(404);
        res.end('Session not found');
        return;
      }

      // Let the transport handle the POST message
      try {
        await transport.handlePostMessage(req, res);
      } catch (error) {
        console.error('[MCP Server] Error handling POST message:', error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal server error');
        }
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
    });

    // Try to listen on the port
    httpServer.listen(port, '127.0.0.1', (err?: Error) => {
      if (err) {
        reject(err);
      }
    });

    httpServer.on('listening', () => {
      // console.log(`[MCP Server] Running on http://127.0.0.1:${port}/mcp`);
      // console.log('[MCP Server] Ready to accept SSE connections and POST messages');

      // Unref the server so it doesn't keep the process alive
      httpServer.unref();

      resolve(httpServer);
    });

    httpServer.on('error', (err: any) => {
      reject(err);
    });
  });
}
