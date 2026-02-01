import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';

// Store active SSE transports and their metadata
interface TransportMetadata {
  transport: SSEServerTransport;
  aiSessionId: string;
}
const activeTransports = new Map<string, TransportMetadata>();

// Store the HTTP server instance
let httpServerInstance: any = null;

// Store reference to the session manager functions (set once at startup)
let updateSessionTitleFn: ((sessionId: string, title: string) => Promise<void>) | null = null;

/**
 * Set the update function for session titles (called once at startup)
 */
export function setUpdateSessionTitleFn(updateTitleFn: (sessionId: string, title: string) => Promise<void>) {
  updateSessionTitleFn = updateTitleFn;
}

export function cleanupSessionNamingServer() {
  // Close all active SSE transports
  for (const [transportId, metadata] of activeTransports.entries()) {
    try {
      if (metadata.transport.onclose) {
        metadata.transport.onclose();
      }
      const res = (metadata.transport as any).res;
      if (res && !res.headersSent) {
        res.end();
      }
    } catch (error) {
      console.error(`[Session Naming MCP] Error closing transport ${transportId}:`, error);
    }
  }
  activeTransports.clear();
}

export function shutdownSessionNamingHttpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!httpServerInstance) {
      resolve();
      return;
    }

    let hasResolved = false;
    const safeResolve = () => {
      if (!hasResolved) {
        hasResolved = true;
        resolve();
      }
    };

    try {
      cleanupSessionNamingServer();
    } catch (error) {
      console.error('[Session Naming MCP] Error cleaning up transports:', error);
    }

    try {
      if (httpServerInstance && typeof httpServerInstance.closeAllConnections === 'function') {
        httpServerInstance.closeAllConnections();
      }
    } catch (error) {
      console.error('[Session Naming MCP] Error closing connections:', error);
    }

    try {
      if (httpServerInstance && typeof httpServerInstance.close === 'function') {
        httpServerInstance.close((err?: Error) => {
          if (err) {
            console.error('[Session Naming MCP] Error closing HTTP server:', err);
          }
          httpServerInstance = null;
          safeResolve();
        });
      } else {
        httpServerInstance = null;
        safeResolve();
      }
    } catch (error) {
      console.error('[Session Naming MCP] Error in server close:', error);
      httpServerInstance = null;
      safeResolve();
    }

    // Timeout to ensure we don't hang
    setTimeout(() => {
      if (httpServerInstance) {
        console.log('[Session Naming MCP] Force destroying HTTP server after timeout');
        httpServerInstance = null;
      }
      safeResolve();
    }, 1000);
  });
}

export async function startSessionNamingServer(startPort: number = 3457): Promise<{ httpServer: any; port: number }> {
  let port = startPort;
  let httpServer: any = null;
  let maxAttempts = 100;

  while (maxAttempts > 0) {
    try {
      httpServer = await tryCreateSessionNamingServer(port);
      console.log(`[Session Naming MCP] Successfully started on port ${port}`);
      break;
    } catch (error: any) {
      if (error.code === 'EADDRINUSE') {
        port++;
        maxAttempts--;
      } else {
        throw error;
      }
    }
  }

  if (!httpServer) {
    throw new Error(`[Session Naming MCP] Could not find an available port after trying 100 ports starting from ${startPort}`);
  }

  httpServerInstance = httpServer;
  return { httpServer, port };
}

async function tryCreateSessionNamingServer(port: number): Promise<any> {
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
        // Extract AI session ID from query parameter
        const aiSessionId = parsedUrl.query.sessionId as string;

        if (!aiSessionId) {
          res.writeHead(400);
          res.end('Missing sessionId parameter');
          return;
        }

        if (!updateSessionTitleFn) {
          res.writeHead(500);
          res.end('Session naming service not initialized');
          return;
        }

        // Create a new MCP Server instance for this connection
        // This allows us to capture the aiSessionId in the closure
        const server = new Server(
          {
            name: 'nimbalyst-session-naming',
            version: '1.0.0'
          },
          {
            capabilities: {
              tools: {}
            }
          }
        );

        // Register tool handlers with aiSessionId captured in closure
        server.setRequestHandler(ListToolsRequestSchema, async () => {
          return {
            tools: [
              {
                name: 'name_session',
                description: 'Set a concise, descriptive name for the current AI chat session. This should be called ONCE at the start of the conversation after understanding the user\'s task. The name should be 2-5 words with the descriptive part FIRST and action word LAST (noun-phrase style for easier scanning).',
                inputSchema: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description: 'A concise session name (2-5 words) with descriptive part first. Examples: "Authentication bug fix", "Dark mode implementation", "Database layer refactor", "Crash report analysis"'
                    }
                  },
                  required: ['name']
                }
              }
            ]
          };
        });

        // Tool execution handler - aiSessionId is captured from outer scope
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
          const { name, arguments: args } = request.params;

          // Strip MCP server prefix if present
          const toolName = name.replace(/^mcp__nimbalyst-session-naming__/, '');

          if (toolName === 'name_session') {
            const sessionName = args?.name;

            // Validate session name
            if (!sessionName || typeof sessionName !== 'string') {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'Error: Session name is required and must be a string'
                  }
                ],
                isError: true
              };
            }

            // Validate length (max 100 chars as per database schema)
            if (sessionName.length > 100) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Error: Session name too long (${sessionName.length} chars, max 100)`
                  }
                ],
                isError: true
              };
            }

            try {
              // Use the aiSessionId captured in the closure
              // The updateSessionTitleFn performs an atomic check-and-set at the database level
              await updateSessionTitleFn!(aiSessionId, sessionName);

              console.log(`[Session Naming MCP] Updated session ${aiSessionId} to: "${sessionName}"`);

              return {
                content: [
                  {
                    type: 'text',
                    text: `Successfully named session: "${sessionName}"`
                  }
                ],
                isError: false
              };
            } catch (error) {
              console.error('[Session Naming MCP] Failed to update session title:', error);

              // Check if this is the "already named" error
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              if (errorMessage.includes('already been named')) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `Error: This session has already been named. The name_session tool can only be called once per session.`
                    }
                  ],
                  isError: true
                };
              }

              return {
                content: [
                  {
                    type: 'text',
                    text: `Error updating session title: ${errorMessage}`
                  }
                ],
                isError: true
              };
            }
          } else {
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
          }
        });

        // Create SSE transport
        const transport = new SSEServerTransport('/mcp', res);
        activeTransports.set(transport.sessionId, {
          transport,
          aiSessionId
        });

        // console.log(`[Session Naming MCP] New connection for AI session ${aiSessionId}, transport ID: ${transport.sessionId}`);

        // Connect server to transport
        server.connect(transport).then(() => {
          transport.onclose = () => {
            // console.log(`[Session Naming MCP] Connection closed for AI session ${aiSessionId}`);
            activeTransports.delete(transport.sessionId);
          };
        }).catch(error => {
          console.error('[Session Naming MCP] Connection error:', error);
          activeTransports.delete(transport.sessionId);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        });

      } else if (pathname === '/mcp' && req.method === 'POST') {
        // The MCP client sends POST messages with the transport session ID
        const transportSessionId = parsedUrl.query.sessionId as string;

        if (!transportSessionId) {
          res.writeHead(400);
          res.end('Missing sessionId');
          return;
        }

        const metadata = activeTransports.get(transportSessionId);
        if (!metadata) {
          res.writeHead(404);
          res.end('Transport session not found');
          return;
        }

        try {
          await metadata.transport.handlePostMessage(req, res);
        } catch (error) {
          console.error('[Session Naming MCP] Error handling POST message:', error);
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

    httpServer.listen(port, '127.0.0.1', (err?: Error) => {
      if (err) {
        reject(err);
      }
    });

    httpServer.on('listening', () => {
      httpServer.unref();
      resolve(httpServer);
    });

    httpServer.on('error', (err: any) => {
      reject(err);
    });
  });
}
