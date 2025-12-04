# Internal MCP Servers

This document explains how Nimbalyst implements internal MCP (Model Context Protocol) servers to provide tools to Claude Code and other AI providers.

## Overview

Nimbalyst runs MCP servers **inside the Electron main process** to provide AI capabilities without requiring external server processes. These servers use HTTP with Server-Sent Events (SSE) transport, listening only on localhost.

### Current Internal MCP Servers

1. **Shared MCP Server** (`httpServer.ts`) - Port varies, provides:
   - `applyDiff` - Apply code replacements to documents
   - `streamContent` - Stream content to documents
   - `capture_mockup_screenshot` - Capture annotated mockup screenshots

2. **Session Naming MCP Server** (`sessionNamingServer.ts`) - Port varies, provides:
   - `update_session_title` - Update AI session titles

## Architecture

### Components

```
┌─────────────────────────────────────────────────┐
│           Claude Code Provider                   │
│  (runtime/ai/server/providers/ClaudeCodeProvider)│
│                                                   │
│  - Manages MCP server configuration              │
│  - Connects to internal MCP servers via HTTP/SSE │
└─────────────────────────────────────────────────┘
                      ↓ HTTP
┌─────────────────────────────────────────────────┐
│         Internal MCP HTTP Server                 │
│      (electron/src/main/mcp/httpServer.ts)       │
│                                                   │
│  - Listens on localhost:PORT                     │
│  - Handles SSE connections                       │
│  - Registers MCP tools                           │
│  - Routes tool calls to services                 │
└─────────────────────────────────────────────────┘
                      ↓ IPC / Direct
┌─────────────────────────────────────────────────┐
│              Service Layer                        │
│  (electron/src/main/services/*)                  │
│                                                   │
│  - MockupScreenshotService                    │
│  - SessionNamingService                          │
│  - EditorRegistry (via IPC)                      │
└─────────────────────────────────────────────────┘
                      ↓ IPC
┌─────────────────────────────────────────────────┐
│            Renderer Process                       │
│  (electron/src/renderer/*)                       │
│                                                   │
│  - MockupViewer (screenshot capture)          │
│  - Editor components (content streaming)         │
└─────────────────────────────────────────────────┘
```

### Key Patterns

1. **Singleton Services**: Main process services use singleton pattern
2. **Port Injection**: Server ports are injected into providers via static methods
3. **Workspace Context**: Workspace paths are passed via query parameters
4. **IPC Bridge**: Services coordinate with renderer via IPC handlers
5. **SSE Transport**: MCP protocol uses Server-Sent Events over HTTP

## How to Add a New Internal MCP Server

### Step 1: Create the MCP Server Module

Create a new file in `packages/electron/src/main/mcp/yourServerName.ts`:

```typescript
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

// Store active SSE transports
const activeTransports = new Map<string, SSEServerTransport>();
let httpServerInstance: any = null;

export function shutdownYourMcpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!httpServerInstance) {
      resolve();
      return;
    }

    // Close all active transports
    for (const [, transport] of activeTransports.entries()) {
      try {
        if (transport.onclose) {
          transport.onclose();
        }
      } catch (error) {
        console.error('[Your MCP] Error closing transport:', error);
      }
    }
    activeTransports.clear();

    // Close HTTP server
    httpServerInstance.close(() => {
      console.log('[Your MCP] HTTP server closed');
      resolve();
    });
  });
}

export async function startYourMcpServer(): Promise<{ port: number }> {
  // Try ports starting from 41000
  let port = 41000;
  const maxPort = 41100;

  while (port < maxPort) {
    try {
      const server = await tryCreateServer(port);
      httpServerInstance = server;
      console.log(`[Your MCP] Server started on port ${port}`);
      return { port };
    } catch (error) {
      port++;
    }
  }

  throw new Error('[Your MCP] Could not find available port');
}

async function tryCreateServer(port: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const parsedUrl = parseUrl(req.url || '', true);
      const pathname = parsedUrl.pathname;

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Health check endpoint
      if (pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // MCP SSE endpoint
      if (pathname === '/mcp' && req.method === 'GET') {
        // Extract context from query params (e.g., sessionId, workspacePath)
        const context = parsedUrl.query.context as string | undefined;
        console.log('[Your MCP] Connection established with context:', context);

        // Create MCP server instance
        const server = new Server(
          {
            name: 'your-mcp-server',
            version: '1.0.0',
          },
          {
            capabilities: {
              tools: {},
            },
          }
        );

        // Register tools
        server.setRequestHandler(ListToolsRequestSchema, async () => {
          return {
            tools: [
              {
                name: 'your_tool_name',
                description: 'Description of what your tool does',
                inputSchema: {
                  type: 'object',
                  properties: {
                    param1: {
                      type: 'string',
                      description: 'Description of param1'
                    }
                  },
                  required: ['param1']
                }
              }
            ]
          };
        });

        // Handle tool calls
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
          const { name, arguments: args } = request.params;

          switch (name) {
            case 'your_tool_name': {
              const param1 = args?.param1 as string;

              if (!param1) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: 'Error: param1 is required'
                    }
                  ],
                  isError: true
                };
              }

              try {
                // Implement your tool logic here
                const result = await doSomething(param1);

                return {
                  content: [
                    {
                      type: 'text',
                      text: `Success: ${result}`
                    }
                  ],
                  isError: false
                };
              } catch (error) {
                console.error('[Your MCP] Tool failed:', error);
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';

                return {
                  content: [
                    {
                      type: 'text',
                      text: `Error: ${errorMessage}`
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

        // Set up SSE transport
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const transport = new SSEServerTransport('/mcp', res);
        const transportId = `${Date.now()}-${Math.random()}`;
        activeTransports.set(transportId, transport);

        transport.onclose = () => {
          activeTransports.delete(transportId);
          console.log('[Your MCP] Transport closed');
        };

        await server.connect(transport);
        return;
      }

      // 404 for unknown routes
      res.writeHead(404);
      res.end('Not Found');
    });

    httpServer.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        reject(error);
      } else {
        console.error('[Your MCP] Server error:', error);
      }
    });

    httpServer.listen(port, '127.0.0.1', () => {
      resolve(httpServer);
    });
  });
}

async function doSomething(param: string): Promise<string> {
  // Implement your logic
  return `Processed: ${param}`;
}
```

### Step 2: Create a Service (Optional)

If your tool needs complex logic or coordination with renderer process, create a service in `packages/electron/src/main/services/YourService.ts`:

```typescript
/**
 * Service to provide [your feature] capabilities
 * This runs in the electron main process and is called by the MCP server
 */
export class YourService {
  private static instance: YourService | null = null;

  private constructor() {}

  public static getInstance(): YourService {
    if (!YourService.instance) {
      YourService.instance = new YourService();
    }
    return YourService.instance;
  }

  /**
   * Main method called by MCP server
   */
  public async doSomething(param: string): Promise<{ success: boolean; result?: string; error?: string }> {
    try {
      // Implement your logic here
      const result = await this.processParam(param);
      return { success: true, result };
    } catch (error) {
      console.error('[YourService] Failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async processParam(param: string): Promise<string> {
    // Implementation
    return `Processed: ${param}`;
  }

  /**
   * Cleanup method called on app shutdown
   */
  public cleanup(): void {
    console.log('[YourService] Cleanup complete');
  }
}
```

### Step 3: Create IPC Handlers (If Needed)

If your service needs to communicate with the renderer process, create IPC handlers in `packages/electron/src/main/ipc/YourHandlers.ts`:

```typescript
import { ipcMain } from 'electron';
import { YourService } from '../services/YourService';

/**
 * Register IPC handlers for your feature
 */
export function registerYourHandlers() {
  // Handle requests from renderer
  ipcMain.handle('your-feature:do-something', async (_event, param: string) => {
    const service = YourService.getInstance();
    const result = await service.doSomething(param);
    return result;
  });
}
```

### Step 4: Integrate with Main Process

In `packages/electron/src/main/index.ts`:

```typescript
// 1. Import your modules
import { YourService } from './services/YourService';
import { registerYourHandlers } from './ipc/YourHandlers';
import { startYourMcpServer, shutdownYourMcpServer } from './mcp/yourServerName';

// 2. Register IPC handlers in app.whenReady()
app.whenReady().then(async () => {
  // ... existing code ...

  registerYourHandlers();

  // ... existing code ...
});

// 3. Start your MCP server in app.whenReady()
app.whenReady().then(async () => {
  // ... after other servers start ...

  try {
    const result = await startYourMcpServer();
    console.log('[Main] Your MCP server started on port:', result.port);

    // Store port for provider access (if needed)
    (global as any).yourMcpServerPort = result.port;
  } catch (error) {
    console.error('[Main] Failed to start your MCP server:', error);
  }

  // ... existing code ...
});

// 4. Add cleanup in app.on('before-quit')
app.on('before-quit', async (event) => {
  // ... existing cleanup ...

  try {
    // Cleanup service
    const yourService = YourService.getInstance();
    yourService.cleanup();
  } catch (error) {
    console.error('[QUIT] Error cleaning up your service:', error);
  }

  try {
    // Shutdown MCP server
    await shutdownYourMcpServer();
  } catch (error) {
    console.error('[QUIT] Error shutting down your MCP server:', error);
  }

  // ... existing cleanup ...
});
```

### Step 5: Integrate with AI Provider

If your MCP server should be accessible to Claude Code, update `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts`:

```typescript
export class ClaudeCodeProvider extends BaseAIProvider {
  // Add static port property
  private static yourMcpServerPort: number | null = null;

  // Add setter method
  public static setYourMcpServerPort(port: number | null): void {
    ClaudeCodeProvider.yourMcpServerPort = port;
  }

  // Update getMcpServersConfig() to include your server
  private async getMcpServersConfig(sessionId?: string, workspacePath?: string) {
    const config: any = {};

    // ... existing servers ...

    // Include your MCP server if it's started
    if (ClaudeCodeProvider.yourMcpServerPort !== null) {
      config['your-mcp-server'] = {
        type: 'sse',
        transport: 'sse',
        url: `http://127.0.0.1:${ClaudeCodeProvider.yourMcpServerPort}/mcp?context=${encodeURIComponent(contextValue)}`
      };
      console.log('[CLAUDE-CODE] Your MCP server configured on port', ClaudeCodeProvider.yourMcpServerPort);
    }

    return config;
  }
}
```

Then in `packages/electron/src/main/index.ts`, inject the port after starting the server:

```typescript
import { ClaudeCodeProvider } from '@nimbalyst/runtime/ai/server';

app.whenReady().then(async () => {
  // ... after starting your MCP server ...

  try {
    const result = await startYourMcpServer();
    (global as any).yourMcpServerPort = result.port;

    // Inject port into ClaudeCodeProvider
    ClaudeCodeProvider.setYourMcpServerPort(result.port);
  } catch (error) {
    console.error('[Main] Failed to start your MCP server:', error);
  }
});
```

## Best Practices

### Security

1. **Localhost Only**: Always bind to `127.0.0.1`, never `0.0.0.0`
2. **No External Access**: Internal MCP servers should never be exposed to the network
3. **Validate Input**: Always validate tool parameters before processing
4. **File Path Validation**: Restrict file operations to allowed directories

### Error Handling

1. **Try-Catch Everything**: Wrap all tool logic in try-catch blocks
2. **Return Errors as Content**: Use `isError: true` in MCP responses, don't throw
3. **Log Errors**: Always log errors with context for debugging
4. **Graceful Degradation**: Handle missing services/windows gracefully

### Performance

1. **Short Timeouts**: Use reasonable timeouts for operations (5-10 seconds)
2. **Cleanup Resources**: Always cleanup on shutdown (close connections, clear maps)
3. **Port Reuse**: Close servers properly to avoid EADDRINUSE errors
4. **Avoid Blocking**: Use async/await for I/O operations

### Testing

1. **Health Endpoint**: Include `/health` endpoint for testing
2. **Logging**: Add detailed logging for debugging MCP flow
3. **Manual Testing**: Test with Claude Code to verify tool integration
4. **Edge Cases**: Test with missing context, invalid params, closed windows

### Context Passing

1. **Query Parameters**: Pass context via URL query params (sessionId, workspacePath)
2. **Per-Connection State**: Store state per SSE connection, not globally
3. **Workspace Routing**: Use workspace paths to route to correct window
4. **Document State**: Maintain document state per session to avoid cross-contamination

## Common Patterns

### Pattern 1: Hot vs Cold Path

Used in `MockupScreenshotService`:

```typescript
// Try hot path first (e.g., open tab with annotations)
const hotResult = await this.tryHotPath();
if (hotResult.success || !hotResult.error?.includes('not available')) {
  return hotResult;
}

// Fall back to cold path (e.g., headless rendering)
console.log('Hot path not available, falling back to cold path');
return this.tryColdPath();
```

### Pattern 2: Request-Response via IPC

Used in `MockupScreenshotService`:

```typescript
// Generate unique request ID
const requestId = `request-${Date.now()}-${Math.random().toString(36).substring(7)}`;

// Create promise for result
return new Promise((resolve) => {
  const timeout = setTimeout(() => {
    this.pendingRequests.delete(requestId);
    resolve({ success: false, error: 'Timeout' });
  }, 5000);

  this.pendingRequests.set(requestId, { resolve, reject: () => {}, timeout });

  // Send IPC to renderer
  targetWindow.webContents.send('your-feature:request', { requestId, data });
});

// Handler for response from renderer
public handleResponse(requestId: string, result: any): void {
  const pending = this.pendingRequests.get(requestId);
  if (pending) {
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    pending.resolve(result);
  }
}
```

### Pattern 3: Workspace to Window Routing

Used in `httpServer.ts`:

```typescript
function findWindowForWorkspace(workspacePath: string): BrowserWindow | null {
  // First try to find window by workspace path
  let targetWindow = findWindowByWorkspace(workspacePath);

  // Fall back to first available window
  if (!targetWindow) {
    const allWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
    if (allWindows.length > 0) {
      targetWindow = allWindows[0];
    }
  }

  return targetWindow;
}
```

## Debugging

### Enable Verbose Logging

Uncomment console.log statements in MCP server files for detailed flow:

```typescript
console.log('[Your MCP] Connection established with context:', context);
console.log('[Your MCP] Tool called:', name, 'with args:', args);
console.log('[Your MCP] Result:', result);
```

### Test MCP Server Health

```bash
curl http://127.0.0.1:PORT/health
# Should return: {"status":"ok"}
```

### Check Active Connections

Add logging to track active SSE transports:

```typescript
console.log('[Your MCP] Active transports:', activeTransports.size);
```

### Inspect Claude Code Configuration

In ClaudeCodeProvider, log the MCP config:

```typescript
const config = await this.getMcpServersConfig(sessionId, workspacePath);
console.log('[CLAUDE-CODE] MCP config:', JSON.stringify(config, null, 2));
```

## Examples

See existing implementations:

1. **Shared MCP Server**: `packages/electron/src/main/mcp/httpServer.ts`
   - Multi-tool server with workspace routing
   - IPC coordination with renderer
   - Document state management

2. **Session Naming Server**: `packages/electron/src/main/mcp/sessionNamingServer.ts`
   - Simple single-tool server
   - Session-scoped context
   - Direct database updates

3. **Mockup Screenshot Service**: `packages/electron/src/main/services/MockupScreenshotService.ts`
   - Hot/cold path pattern
   - Request-response via IPC
   - Timeout handling

## Troubleshooting

### Port Already in Use

If you see `EADDRINUSE` errors:
1. Ensure previous server instance is shut down properly
2. Try a different port range
3. Check for zombie processes

### Tool Not Available in Claude Code

If your tool doesn't appear:
1. Verify server started successfully (check logs)
2. Ensure port was injected into provider
3. Check MCP config includes your server
4. Verify Claude Code is using correct session/workspace

### IPC Not Working

If IPC handlers don't receive messages:
1. Verify handlers are registered before windows open
2. Check window is not destroyed
3. Ensure correct channel names
4. Add logging to both sender and receiver

### Context Not Available

If workspace/session context is missing:
1. Pass context via URL query parameters
2. Store per-connection, not globally
3. Validate context before using it
4. Provide clear error messages when context is missing
