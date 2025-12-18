/**
 * MCP Server for Extension Development Kit (EDK)
 *
 * Provides tools for building, installing, and hot-reloading Nimbalyst extensions.
 * These tools enable Claude to iterate on extension development within the running app.
 *
 * Tools:
 * - extension:build - Run vite build on an extension project
 * - extension:install - Install a built extension into the running Nimbalyst
 * - extension:reload - Hot reload an extension (rebuild + reinstall)
 * - extension:uninstall - Remove an extension from the running instance
 */

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
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Store active SSE transports
interface TransportMetadata {
  transport: SSEServerTransport;
  workspacePath?: string;
}
const activeTransports = new Map<string, TransportMetadata>();

// Store the HTTP server instance
let httpServerInstance: any = null;

// Store references to extension management functions (set at startup)
let installExtensionFn: ((extensionPath: string) => Promise<{ success: boolean; extensionId?: string; error?: string }>) | null = null;
let uninstallExtensionFn: ((extensionId: string) => Promise<{ success: boolean; error?: string }>) | null = null;
let reloadExtensionFn: ((extensionId: string, extensionPath?: string) => Promise<{ success: boolean; error?: string }>) | null = null;

/**
 * Set the extension management functions (called once at startup)
 */
export function setExtensionManagementFns(fns: {
  install: (extensionPath: string) => Promise<{ success: boolean; extensionId?: string; error?: string }>;
  uninstall: (extensionId: string) => Promise<{ success: boolean; error?: string }>;
  reload: (extensionId: string, extensionPath?: string) => Promise<{ success: boolean; error?: string }>;
}) {
  installExtensionFn = fns.install;
  uninstallExtensionFn = fns.uninstall;
  reloadExtensionFn = fns.reload;
}

export function cleanupExtensionDevServer() {
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
      console.error(`[Extension Dev MCP] Error closing transport ${transportId}:`, error);
    }
  }
  activeTransports.clear();
}

export function shutdownExtensionDevServer(): Promise<void> {
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
      cleanupExtensionDevServer();
    } catch (error) {
      console.error('[Extension Dev MCP] Error cleaning up transports:', error);
    }

    try {
      if (httpServerInstance && typeof httpServerInstance.closeAllConnections === 'function') {
        httpServerInstance.closeAllConnections();
      }
    } catch (error) {
      console.error('[Extension Dev MCP] Error closing connections:', error);
    }

    try {
      if (httpServerInstance && typeof httpServerInstance.close === 'function') {
        httpServerInstance.close((err?: Error) => {
          if (err) {
            console.error('[Extension Dev MCP] Error closing HTTP server:', err);
          }
          httpServerInstance = null;
          safeResolve();
        });
      } else {
        httpServerInstance = null;
        safeResolve();
      }
    } catch (error) {
      console.error('[Extension Dev MCP] Error in server close:', error);
      httpServerInstance = null;
      safeResolve();
    }

    // Timeout to ensure we don't hang
    setTimeout(() => {
      if (httpServerInstance) {
        console.log('[Extension Dev MCP] Force destroying HTTP server after timeout');
        httpServerInstance = null;
      }
      safeResolve();
    }, 1000);
  });
}

export async function startExtensionDevServer(startPort: number = 3460): Promise<{ httpServer: any; port: number }> {
  let port = startPort;
  let httpServer: any = null;
  let maxAttempts = 100;

  while (maxAttempts > 0) {
    try {
      httpServer = await tryCreateExtensionDevServer(port);
      console.log(`[Extension Dev MCP] Successfully started on port ${port}`);
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
    throw new Error(`[Extension Dev MCP] Could not find an available port after trying 100 ports starting from ${startPort}`);
  }

  httpServerInstance = httpServer;
  return { httpServer, port };
}

/**
 * Run npm build in an extension project directory
 */
async function runBuild(extensionPath: string): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Verify the path exists and has a package.json
    const packageJsonPath = path.join(extensionPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      resolve({
        success: false,
        stdout: '',
        stderr: `Error: No package.json found at ${extensionPath}`
      });
      return;
    }

    let stdout = '';
    let stderr = '';

    const child = spawn('npm', ['run', 'build'], {
      cwd: extensionPath,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' }
    });

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr
      });
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        stdout,
        stderr: stderr + '\n' + error.message
      });
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      child.kill();
      resolve({
        success: false,
        stdout,
        stderr: stderr + '\nBuild timed out after 60 seconds'
      });
    }, 60000);
  });
}

async function tryCreateExtensionDevServer(port: number): Promise<any> {
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

      // Health check endpoint
      if (pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // Handle SSE GET request to establish connection
      if (pathname === '/mcp' && req.method === 'GET') {
        const workspacePath = parsedUrl.query.workspacePath as string | undefined;

        // Create a new MCP Server instance for this connection
        const server = new Server(
          {
            name: 'nimbalyst-extension-dev',
            version: '1.0.0'
          },
          {
            capabilities: {
              tools: {}
            }
          }
        );

        // Register tool definitions
        server.setRequestHandler(ListToolsRequestSchema, async () => {
          return {
            tools: [
              {
                name: 'extension_build',
                description: 'Build a Nimbalyst extension project. Runs `npm run build` in the extension directory and returns the build output.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    path: {
                      type: 'string',
                      description: 'Absolute path to the extension project root (directory containing package.json and manifest.json)'
                    }
                  },
                  required: ['path']
                }
              },
              {
                name: 'extension_install',
                description: 'Install a built extension into the running Nimbalyst instance. The extension must be built first using extension_build.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    path: {
                      type: 'string',
                      description: 'Absolute path to the extension project root (directory containing manifest.json)'
                    }
                  },
                  required: ['path']
                }
              },
              {
                name: 'extension_reload',
                description: 'Hot reload an installed extension. Rebuilds the extension and reinstalls it without restarting Nimbalyst.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    extensionId: {
                      type: 'string',
                      description: 'The extension ID (from manifest.json) to reload'
                    },
                    path: {
                      type: 'string',
                      description: 'Absolute path to the extension project root (for rebuilding)'
                    }
                  },
                  required: ['extensionId', 'path']
                }
              },
              {
                name: 'extension_uninstall',
                description: 'Remove an installed extension from the running Nimbalyst instance.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    extensionId: {
                      type: 'string',
                      description: 'The extension ID (from manifest.json) to uninstall'
                    }
                  },
                  required: ['extensionId']
                }
              }
            ]
          };
        });

        // Handle tool calls
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
          const { name, arguments: args } = request.params;

          // Strip MCP server prefix if present
          const toolName = name.replace(/^mcp__nimbalyst-extension-dev__/, '');

          switch (toolName) {
            case 'extension_build': {
              const extensionPath = args?.path as string;

              if (!extensionPath) {
                return {
                  content: [{ type: 'text', text: 'Error: path is required' }],
                  isError: true
                };
              }

              // Normalize and validate path
              const normalizedPath = path.resolve(extensionPath);
              if (!fs.existsSync(normalizedPath)) {
                return {
                  content: [{ type: 'text', text: `Error: Directory not found: ${normalizedPath}` }],
                  isError: true
                };
              }

              console.log(`[Extension Dev MCP] Building extension at: ${normalizedPath}`);

              const result = await runBuild(normalizedPath);

              if (result.success) {
                return {
                  content: [{
                    type: 'text',
                    text: `Build successful!\n\nOutput:\n${result.stdout}${result.stderr ? '\n\nWarnings:\n' + result.stderr : ''}`
                  }],
                  isError: false
                };
              } else {
                return {
                  content: [{
                    type: 'text',
                    text: `Build failed!\n\nStdout:\n${result.stdout}\n\nStderr:\n${result.stderr}`
                  }],
                  isError: true
                };
              }
            }

            case 'extension_install': {
              const extensionPath = args?.path as string;

              if (!extensionPath) {
                return {
                  content: [{ type: 'text', text: 'Error: path is required' }],
                  isError: true
                };
              }

              if (!installExtensionFn) {
                return {
                  content: [{ type: 'text', text: 'Error: Extension installation service not initialized' }],
                  isError: true
                };
              }

              const normalizedPath = path.resolve(extensionPath);

              // Verify manifest.json exists
              const manifestPath = path.join(normalizedPath, 'manifest.json');
              if (!fs.existsSync(manifestPath)) {
                return {
                  content: [{ type: 'text', text: `Error: No manifest.json found at ${normalizedPath}` }],
                  isError: true
                };
              }

              console.log(`[Extension Dev MCP] Installing extension from: ${normalizedPath}`);

              try {
                const result = await installExtensionFn(normalizedPath);

                if (result.success) {
                  return {
                    content: [{
                      type: 'text',
                      text: `Extension installed successfully!\n\nExtension ID: ${result.extensionId}`
                    }],
                    isError: false
                  };
                } else {
                  return {
                    content: [{
                      type: 'text',
                      text: `Installation failed: ${result.error}`
                    }],
                    isError: true
                  };
                }
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                return {
                  content: [{ type: 'text', text: `Installation error: ${errorMessage}` }],
                  isError: true
                };
              }
            }

            case 'extension_reload': {
              const extensionId = args?.extensionId as string;
              const extensionPath = args?.path as string;

              if (!extensionId || !extensionPath) {
                return {
                  content: [{ type: 'text', text: 'Error: extensionId and path are required' }],
                  isError: true
                };
              }

              const normalizedPath = path.resolve(extensionPath);

              // Step 1: Always rebuild first
              console.log(`[Extension Dev MCP] Rebuilding extension ${extensionId} at ${normalizedPath}`);
              const buildResult = await runBuild(normalizedPath);
              if (!buildResult.success) {
                return {
                  content: [{
                    type: 'text',
                    text: `Rebuild failed!\n\nStdout:\n${buildResult.stdout}\n\nStderr:\n${buildResult.stderr}`
                  }],
                  isError: true
                };
              }

              // Step 2: Reload the extension in the running app
              if (reloadExtensionFn) {
                try {
                  const result = await reloadExtensionFn(extensionId, normalizedPath);
                  if (result.success) {
                    return {
                      content: [{
                        type: 'text',
                        text: `Extension ${extensionId} rebuilt and reloaded successfully!\n\nBuild output:\n${buildResult.stdout}`
                      }],
                      isError: false
                    };
                  } else {
                    return {
                      content: [{
                        type: 'text',
                        text: `Build succeeded but reload failed: ${result.error}\n\nBuild output:\n${buildResult.stdout}`
                      }],
                      isError: true
                    };
                  }
                } catch (error) {
                  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                  return {
                    content: [{
                      type: 'text',
                      text: `Build succeeded but reload error: ${errorMessage}\n\nBuild output:\n${buildResult.stdout}`
                    }],
                    isError: true
                  };
                }
              }

              // Fallback: use install function if reload not available
              if (installExtensionFn) {
                try {
                  const installResult = await installExtensionFn(normalizedPath);
                  if (installResult.success) {
                    return {
                      content: [{
                        type: 'text',
                        text: `Extension rebuilt and reinstalled successfully!\n\nBuild output:\n${buildResult.stdout}`
                      }],
                      isError: false
                    };
                  } else {
                    return {
                      content: [{
                        type: 'text',
                        text: `Build succeeded but reinstall failed: ${installResult.error}\n\nBuild output:\n${buildResult.stdout}`
                      }],
                      isError: true
                    };
                  }
                } catch (error) {
                  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                  return {
                    content: [{
                      type: 'text',
                      text: `Build succeeded but reinstall error: ${errorMessage}\n\nBuild output:\n${buildResult.stdout}`
                    }],
                    isError: true
                  };
                }
              }

              return {
                content: [{ type: 'text', text: 'Error: Extension management service not initialized' }],
                isError: true
              };
            }

            case 'extension_uninstall': {
              const extensionId = args?.extensionId as string;

              if (!extensionId) {
                return {
                  content: [{ type: 'text', text: 'Error: extensionId is required' }],
                  isError: true
                };
              }

              if (!uninstallExtensionFn) {
                return {
                  content: [{ type: 'text', text: 'Error: Extension uninstall service not initialized' }],
                  isError: true
                };
              }

              console.log(`[Extension Dev MCP] Uninstalling extension: ${extensionId}`);

              try {
                const result = await uninstallExtensionFn(extensionId);

                if (result.success) {
                  return {
                    content: [{ type: 'text', text: `Extension ${extensionId} uninstalled successfully!` }],
                    isError: false
                  };
                } else {
                  return {
                    content: [{ type: 'text', text: `Uninstall failed: ${result.error}` }],
                    isError: true
                  };
                }
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                return {
                  content: [{ type: 'text', text: `Uninstall error: ${errorMessage}` }],
                  isError: true
                };
              }
            }

            default:
              throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
          }
        });

        // Create SSE transport
        const transport = new SSEServerTransport('/mcp', res);
        activeTransports.set(transport.sessionId, {
          transport,
          workspacePath
        });

        console.log(`[Extension Dev MCP] New connection, workspace: ${workspacePath || 'none'}`);

        // Connect server to transport
        server.connect(transport).then(() => {
          transport.onclose = () => {
            console.log(`[Extension Dev MCP] Connection closed`);
            activeTransports.delete(transport.sessionId);
          };
        }).catch(error => {
          console.error('[Extension Dev MCP] Connection error:', error);
          activeTransports.delete(transport.sessionId);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        });

      } else if (pathname === '/mcp' && req.method === 'POST') {
        // Handle POST messages for existing SSE connections
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
          console.error('[Extension Dev MCP] Error handling POST message:', error);
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
