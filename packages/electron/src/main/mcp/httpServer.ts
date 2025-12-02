import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { BrowserWindow, ipcMain } from 'electron';
import { parse as parseUrl } from 'url';
import { WireframeScreenshotService } from '../services/WireframeScreenshotService';

// Store document state PER SESSION to avoid cross-window contamination
const documentStateBySession = new Map<string, any>();
let mcpServer: Server | null = null;

// Store active SSE transports by session ID
const activeTransports = new Map<string, SSEServerTransport>();

// Map workspace paths to window IDs for routing
// This is populated when we receive document state updates
const workspaceToWindowMap = new Map<string, number>();

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

  if (!state?.filePath) {
    const error = new Error(`[MCP Server] CRITICAL: No filePath in document state for session ${sessionId}! State keys: ${Object.keys(state || {}).join(', ')}`);
    console.error(error.message);
    throw error;
  }

  // DEFENSIVE LOGGING: Log exactly what we received
  // console.log(`[MCP Server] Received document state update:`, {
  //   sessionId,
  //   filePath: state.filePath,
  //   workspacePath: state.workspacePath,
  //   stateKeys: Object.keys(state || {})
  // });

  documentStateBySession.set(sessionId, state);
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

      // Extract workspace path from query parameter (used by capture_wireframe_screenshot)
      const workspacePath = parsedUrl.query.workspacePath as string | undefined;
      console.log('[MCP Server] Connection established with workspacePath:', workspacePath);

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
        // console.log('[MCP Server] Listing tools');
        return {
          tools: [
            {
              name: 'applyDiff',
              description: 'Apply text replacements to a markdown document. IMPORTANT: Only .md files can be modified. If no filePath is provided, applies to the currently active document.',
              inputSchema: {
                type: 'object',
                properties: {
                  filePath: {
                    type: 'string',
                    description: 'Optional absolute path to the markdown file (.md) to apply replacements to. If not provided, applies to the currently active document. MUST end in .md extension.'
                  },
                  replacements: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        oldText: { type: 'string' },
                        newText: { type: 'string' }
                      },
                      required: ['oldText', 'newText']
                    }
                  }
                },
                required: ['replacements']
              }
            },
            {
              name: 'streamContent',
              description: 'Stream new content into the document at a specific position. Use this for inserting NEW content without replacing existing text.',
              inputSchema: {
                type: 'object',
                properties: {
                  content: {
                    type: 'string',
                    description: 'The content to insert into the document'
                  },
                  position: {
                    type: 'string',
                    enum: ['cursor', 'end', 'after-selection'],
                    description: 'Where to insert the content. "cursor" inserts at current cursor position, "end" appends to end of document, "after-selection" inserts after selected text.'
                  },
                  insertAfter: {
                    type: 'string',
                    description: 'Optional: specific text to insert after. If provided, content will be inserted after the first occurrence of this text.'
                  },
                  filePath: {
                    type: 'string',
                    description: 'Optional: absolute path to the file to insert into. If not provided, uses the currently active document.'
                  }
                },
                required: ['content']
              }
            },
            {
              name: 'capture_wireframe_screenshot',
              description: 'Capture a screenshot of a .wireframe.html file. Returns the screenshot as a base64-encoded PNG image. If the file is open in the editor, the screenshot will include any user annotations (drawings, highlights). If the file is not open, it will be rendered in a headless window (without annotations).',
              inputSchema: {
                type: 'object',
                properties: {
                  file_path: {
                    type: 'string',
                    description: 'The absolute path to the .wireframe.html file to capture.'
                  }
                },
                required: ['file_path']
              }
            }
          ]
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
            // Use explicit filePath from args, or fall back to current document state
            let targetFilePath = args?.filePath;

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
                  replacements: args?.replacements,
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
            // Use explicit filePath from args, or fall back to current document state
            let targetFilePath = args?.filePath;

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
                // console.log('[MCP Server] position:', args?.position || 'end');
                // console.log('[MCP Server] content length:', args?.content?.length);
                // console.log('[MCP Server] content preview:', args?.content?.substring(0, 100));
                // console.log('[MCP Server] ==========================================');

                targetWindow.webContents.send('mcp:streamContent', {
                  streamId,
                  content: args?.content,
                  position: args?.position || 'end',
                  insertAfter: args?.insertAfter,
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

          case 'capture_wireframe_screenshot': {
            const filePath = args?.file_path as string;
            console.log('[MCP Server] capture_wireframe_screenshot called with:', { filePath, workspacePath });

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

            // Validate it's a wireframe file
            if (!filePath.endsWith('.wireframe.html')) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Error: File must be a .wireframe.html file. Got: ${filePath}`
                  }
                ],
                isError: true
              };
            }

            try {
              // Get the wireframe screenshot service
              const wireframeService = WireframeScreenshotService.getInstance();

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
              const result = await wireframeService.captureScreenshotForMCP(filePath, effectiveWorkspacePath);

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

              console.log(`[MCP Server] Captured screenshot for ${filePath}`);

              // Return the image as base64-encoded content
              return {
                content: [
                  {
                    type: 'image',
                    data: result.imageBase64!,
                    mimeType: result.mimeType || 'image/png'
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

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
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
