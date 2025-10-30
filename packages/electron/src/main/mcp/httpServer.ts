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

// Store document state PER SESSION to avoid cross-window contamination
const documentStateBySession = new Map<string, any>();
let mcpServer: Server | null = null;

// Store active SSE transports by session ID
const activeTransports = new Map<string, SSEServerTransport>();

export function updateDocumentState(state: any, sessionId?: string) {
  if (!sessionId) {
    // console.warn('[MCP Server] No sessionId provided for document state update - using "default"');
    sessionId = 'default';
  }
  documentStateBySession.set(sessionId, state);
  // console.log(`[MCP Server] Document state updated for session ${sessionId}`);
}

// Store the HTTP server instance
let httpServerInstance: any = null;

export function cleanupMcpServer() {
  // Close all active SSE transports
  for (const [sessionId, transport] of activeTransports.entries()) {
    console.log(`[MCP Server] Closing transport for session ${sessionId}`);
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

    console.log('[MCP Server] Shutting down HTTP server');

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
      console.log(`[MCP Server] Successfully started on port ${port}`);
      break;
    } catch (error: any) {
      if (error.code === 'EADDRINUSE') {
        console.log(`[MCP Server] Port ${port} is in use, trying ${port + 1}...`);
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
      console.log('[MCP Server] SSE connection request');

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
        console.log('[MCP Server] Listing tools');
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
            }
          ]
        };
      });

      // Tool execution handler
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        console.log(`[MCP Server] Tool called: ${name}`, args);

        switch (name) {
          case 'applyDiff': {
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
              // Use explicit filePath from args, or fall back to current document state
              let targetFilePath = args?.filePath;

              if (!targetFilePath) {
                // Get the current document state for file path
                const states = Array.from(documentStateBySession.values());
                const currentDocState = states[states.length - 1];
                targetFilePath = currentDocState?.filePath;
              }

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
                windows[0].webContents.send('mcp:applyDiff', {
                  replacements: args?.replacements,
                  resultChannel,
                  targetFilePath: targetFilePath
                });
              });
            }
            return { success: false, error: 'No window available' };
          }

          case 'streamContent': {
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
              // Use explicit filePath from args, or fall back to current document state
              let targetFilePath = args?.filePath;

              if (!targetFilePath) {
                // Get the current document state for file path
                const states = Array.from(documentStateBySession.values());
                const currentDocState = states[states.length - 1];
                targetFilePath = currentDocState?.filePath;
              }

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
                windows[0].webContents.send('mcp:streamContent', {
                  streamId,
                  content: args?.content,
                  position: args?.position || 'end',
                  insertAfter: args?.insertAfter,
                  targetFilePath: targetFilePath,
                  resultChannel
                });
              });
            }
            return {
              content: [
                {
                  type: 'text',
                  text: 'Error: No window available'
                }
              ],
              isError: true
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      });

      // Create SSE transport - it will handle headers
      const transport = new SSEServerTransport('/mcp', res);

      // Store the transport by session ID
      activeTransports.set(transport.sessionId, transport);
      console.log('[MCP Server] Created transport with session ID:', transport.sessionId);

      // Connect server to transport
      server.connect(transport).then(() => {
        console.log('[MCP Server] Client connected successfully');

        // Clean up on disconnect
        transport.onclose = () => {
          console.log('[MCP Server] Client disconnected, session:', transport.sessionId);
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
      console.log('[MCP Server] POST message for session:', sessionId);

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
      console.log(`[MCP Server] Running on http://127.0.0.1:${port}/mcp`);
      console.log('[MCP Server] Ready to accept SSE connections and POST messages');

      // Unref the server so it doesn't keep the process alive
      httpServer.unref();

      resolve(httpServer);
    });

    httpServer.on('error', (err: any) => {
      reject(err);
    });
  });
}
