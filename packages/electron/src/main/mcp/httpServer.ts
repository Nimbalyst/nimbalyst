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

let documentState: any = null;
let mcpServer: Server | null = null;

// Store active SSE transports by session ID
const activeTransports = new Map<string, SSEServerTransport>();

export function updateDocumentState(state: any) {
  documentState = state;
  console.log('[MCP Server] Document state updated');
}

export async function startMcpHttpServer(port: number = 3456) {
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
          name: 'stravu-editor',
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
              name: 'getDocument',
              description: 'Get the current document content',
              inputSchema: {
                type: 'object',
                properties: {}
              }
            },
            {
              name: 'applyDiff',
              description: 'Apply text replacements to the document',
              inputSchema: {
                type: 'object',
                properties: {
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
            }
          ]
        };
      });

      // Tool execution handler
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        console.log(`[MCP Server] Tool called: ${name}`, args);

        switch (name) {
          case 'getDocument':
            return documentState || { content: '', error: 'No document open' };

          case 'applyDiff': {
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
              // Create a unique channel for the result
              const resultChannel = `mcp-result-${Date.now()}-${Math.random()}`;
              
              // Set up a one-time listener for the result
              return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                  ipcMain.removeHandler(resultChannel);
                  resolve({ success: false, error: 'Timeout waiting for diff application' });
                }, 5000);
                
                ipcMain.once(resultChannel, (event, result) => {
                  clearTimeout(timeout);
                  console.log('[MCP Server] Received applyDiff result:', result);
                  resolve(result || { success: false, error: 'No result received' });
                });
                
                // Send the request with the result channel
                windows[0].webContents.send('mcp:applyDiff', {
                  replacements: args.replacements,
                  resultChannel
                });
              });
            }
            return { success: false, error: 'No window available' };
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
  
  httpServer.listen(port, '127.0.0.1', () => {
    console.log(`[MCP Server] Running on http://127.0.0.1:${port}/mcp`);
    console.log('[MCP Server] Ready to accept SSE connections and POST messages');
  });
  
  return { httpServer, port };
}