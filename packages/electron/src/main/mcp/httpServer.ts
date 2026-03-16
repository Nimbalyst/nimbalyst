import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { parse as parseUrl } from "url";
import { randomUUID } from "crypto";

// Extracted modules
import {
  documentStateBySession,
  getAvailableExtensionTools,
  registerWorkspaceMappingForConnection,
  ExtensionToolDefinition,
} from "./mcpWorkspaceResolver";

// Tool handlers + schemas
import { handleVoiceAgentSpeak, handleVoiceAgentStop, voiceToolSchemas } from "./tools/voiceToolHandlers";
import { handleDisplayToUser, displayToolSchemas } from "./tools/displayToolHandler";
import {
  handleApplyDiff,
  handleStreamContent,
  handleOpenWorkspace,
  handleCaptureEditorScreenshot,
  handleGetSessionEditedFiles,
  getEditorToolSchemas,
} from "./tools/editorToolHandlers";
import {
  handleTrackerList,
  handleTrackerGet,
  handleTrackerCreate,
  handleTrackerUpdate,
  handleTrackerLinkSession,
  trackerToolSchemas,
} from "./tools/trackerToolHandlers";
import {
  handleAskUserQuestion,
  handleGitCommitProposal,
  getInteractiveToolSchemas,
} from "./tools/interactiveToolHandlers";
import { handleExtensionTool } from "./tools/extensionToolHandler";

// Re-export functions that don't need transport state
export {
  registerWorkspaceWindow,
  unregisterWindow,
  unregisterExtensionTools,
} from "./mcpWorkspaceResolver";

// ---- Transport State ----

let mcpServer: Server | null = null;

// Store active SSE transports by session ID
const activeTransports = new Map<string, SSEServerTransport>();

interface StreamableTransportMetadata {
  transport: StreamableHTTPServerTransport;
  nimbalystSessionId?: string;
}
const activeStreamableTransports = new Map<
  string,
  StreamableTransportMetadata
>();

// Store MCP Server instances by Nimbalyst session ID
// Used to send notifications (e.g., tools/list_changed) when document state changes
const serverByNimbalystSession = new Map<string, Server>();

// Store MCP Server instances by workspace path
// Used to send tools/list_changed notifications when extension tools are registered
const serversByWorkspace = new Map<string, Set<Server>>();

// Store the HTTP server instance
let httpServerInstance: any = null;

// ---- Re-export wrappers that inject transport state ----
// Callers import these from httpServer.ts with original 2-arg signatures.
// We wrap to inject the serverByNimbalystSession / serversByWorkspace maps.

import {
  updateDocumentState as _updateDocumentState,
  registerExtensionTools as _registerExtensionTools,
} from "./mcpWorkspaceResolver";

export { documentStateBySession };

/**
 * Update document state for a session.
 * Wraps the resolver's version to inject the server map for tool list notifications.
 */
export function updateDocumentState(state: any, sessionId?: string) {
  _updateDocumentState(state, sessionId, serverByNimbalystSession);
}

/**
 * Register extension tools from a workspace window.
 * Wraps the resolver's version to inject the servers map for notifications.
 */
export function registerExtensionTools(
  workspacePath: string,
  tools: ExtensionToolDefinition[]
) {
  _registerExtensionTools(workspacePath, tools, serversByWorkspace);
}

// ---- Server Lifecycle ----

export async function cleanupMcpServer() {
  // Close all active SSE transports
  for (const [sessionId, transport] of activeTransports.entries()) {
    try {
      if (transport.onclose) {
        transport.onclose();
      }
      const res = (transport as any).res;
      if (res && !res.headersSent) {
        res.end();
      }
    } catch (error) {
      console.error(
        `[MCP Server] Error closing transport ${sessionId}:`,
        error
      );
    }
  }
  activeTransports.clear();
  for (const [
    streamableSessionId,
    metadata,
  ] of activeStreamableTransports.entries()) {
    try {
      await metadata.transport.close().catch((error) => {
        console.error(
          `[MCP Server] Error closing streamable transport ${streamableSessionId}:`,
          error
        );
      });
    } catch (error) {
      console.error(
        `[MCP Server] Error closing streamable transport ${streamableSessionId}:`,
        error
      );
    }
  }
  activeStreamableTransports.clear();
  serverByNimbalystSession.clear();
  serversByWorkspace.clear();

  if (mcpServer) {
    mcpServer = null;
  }
}

export async function shutdownHttpServer(): Promise<void> {
  if (!httpServerInstance) {
    return;
  }

  try {
    await cleanupMcpServer();
  } catch (error) {
    console.error("[MCP Server] Error cleaning up transports:", error);
  }

  return new Promise((resolve) => {
    let hasResolved = false;
    const safeResolve = () => {
      if (!hasResolved) {
        hasResolved = true;
        resolve();
      }
    };

    try {
      if (
        httpServerInstance &&
        typeof httpServerInstance.closeAllConnections === "function"
      ) {
        httpServerInstance.closeAllConnections();
      }
    } catch (error) {
      console.error("[MCP Server] Error closing connections:", error);
    }

    try {
      if (
        httpServerInstance &&
        typeof httpServerInstance.close === "function"
      ) {
        httpServerInstance.close((err?: Error) => {
          if (err) {
            console.error("[MCP Server] Error closing HTTP server:", err);
          }
          httpServerInstance = null;
          safeResolve();
        });
      } else {
        httpServerInstance = null;
        safeResolve();
      }
    } catch (error) {
      console.error("[MCP Server] Error in server close:", error);
      httpServerInstance = null;
      safeResolve();
    }

    const isProduction = process.env.NODE_ENV === "production";
    const timeout = isProduction ? 300 : 1000;

    setTimeout(() => {
      if (httpServerInstance) {
        console.log("[MCP Server] Force destroying HTTP server after timeout");
        httpServerInstance = null;
      }
      safeResolve();
    }, timeout);
  });
}

export async function startMcpHttpServer(
  startPort: number = 3456
): Promise<{ httpServer: any; port: number }> {
  let port = startPort;
  let httpServer: any = null;
  let maxAttempts = 100;

  while (maxAttempts > 0) {
    try {
      httpServer = await tryCreateServer(port);
      break;
    } catch (error: any) {
      if (error.code === "EADDRINUSE") {
        port++;
        maxAttempts--;
      } else {
        throw error;
      }
    }
  }

  if (!httpServer) {
    throw new Error(
      `[MCP Server] Could not find an available port after trying ${100} ports starting from ${startPort}`
    );
  }

  httpServerInstance = httpServer;
  return { httpServer, port };
}

// ---- MCP Server Factory ----

function createSharedMcpServer(
  workspacePath: string | undefined,
  sessionId: string | undefined
): Server {
  const server = new Server(
    { name: "nimbalyst-mcp", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } } }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const currentDocState = sessionId
      ? documentStateBySession.get(sessionId)
      : undefined;
    const currentFilePath = currentDocState?.filePath;

    const builtInTools = [
      ...getEditorToolSchemas(sessionId),
      ...displayToolSchemas,
      ...voiceToolSchemas,
      ...getInteractiveToolSchemas(sessionId),
      ...trackerToolSchemas,
    ];

    // Get extension tools for the current workspace/file
    const extensionTools = await getAvailableExtensionTools(
      workspacePath,
      currentFilePath
    );
    const extensionToolSchemas = extensionTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    const allTools = [...builtInTools, ...extensionToolSchemas];

    // Check for duplicate tool names
    const toolNames = allTools.map((t) => t.name);
    const duplicates = toolNames.filter(
      (name, idx) => toolNames.indexOf(name) !== idx
    );
    if (duplicates.length > 0) {
      console.error("[MCP Server] DUPLICATE TOOL NAMES DETECTED:", duplicates);
      console.error("[MCP Server] All tool names:", toolNames.join(", "));
    }

    return { tools: allTools };
  });

  // Register tool execution handler
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;
    if (request.params._meta) {
      console.log(
        `[MCP Server] Tool called: ${name}, _meta:`,
        JSON.stringify(request.params._meta)
      );
    }

    // Strip MCP server prefix if present
    const toolName = name.replace(/^mcp__nimbalyst__/, "");

    switch (toolName) {
      case "applyDiff":
        return handleApplyDiff(args);

      case "streamContent":
        return handleStreamContent(args);

      case "open_workspace":
        return handleOpenWorkspace(args);

      case "capture_editor_screenshot":
        return handleCaptureEditorScreenshot(args);

      case "display_to_user":
        return handleDisplayToUser(args);

      case "voice_agent_speak":
        return handleVoiceAgentSpeak(args);

      case "voice_agent_stop":
        return handleVoiceAgentStop();

      case "AskUserQuestion":
        return handleAskUserQuestion(args, sessionId, request);

      case "get_session_edited_files":
        return handleGetSessionEditedFiles(sessionId);

      case "developer_git_commit_proposal":
      case "developer.git_commit_proposal":
        return handleGitCommitProposal(args, sessionId, workspacePath, request);

      case "tracker_list":
        return handleTrackerList(args, workspacePath);

      case "tracker_get":
        return handleTrackerGet(args);

      case "tracker_create":
        return handleTrackerCreate(args, workspacePath);

      case "tracker_update":
        return handleTrackerUpdate(args, workspacePath);

      case "tracker_link_session":
        return handleTrackerLinkSession(args, sessionId, workspacePath);

      default:
        return handleExtensionTool(toolName, name, args, sessionId, workspacePath);
    }
  });

  return server;
}

// ---- HTTP Transport Helpers ----

function getMcpSessionIdHeader(req: IncomingMessage): string | undefined {
  const headerValue = req.headers["mcp-session-id"];
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }
  if (typeof headerValue === "string" && headerValue.length > 0) {
    return headerValue;
  }
  return undefined;
}

async function readJsonBody(
  req: IncomingMessage
): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return undefined;
  }
  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

function isInitializeMessage(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'method' in value && (value as Record<string, unknown>).method === 'initialize';
}

function isInitializePayload(payload: unknown): boolean {
  if (!payload) {
    return false;
  }
  if (Array.isArray(payload)) {
    return payload.some((entry) => isInitializeMessage(entry));
  }
  return isInitializeMessage(payload);
}

// ---- HTTP Server Creation ----

async function tryCreateServer(port: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const parsedUrl = parseUrl(req.url || "", true);
        const pathname = parsedUrl.pathname;
        const mcpSessionIdHeader = getMcpSessionIdHeader(req);

        // Handle CORS preflight
        if (req.method === "OPTIONS") {
          res.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, mcp-session-id, mcp-protocol-version",
          });
          res.end();
          return;
        }

        // Handle SSE GET request to establish connection
        if (pathname === "/mcp" && req.method === "GET") {
          // Streamable HTTP GET (session established, uses Mcp-Session-Id header)
          if (mcpSessionIdHeader) {
            const metadata = activeStreamableTransports.get(mcpSessionIdHeader);
            if (!metadata) {
              res.writeHead(404);
              res.end("Streamable session not found");
              return;
            }

            try {
              await metadata.transport.handleRequest(req, res);
            } catch (error) {
              console.error(
                "[MCP Server] Error handling streamable GET request:",
                error
              );
              if (!res.headersSent) {
                res.writeHead(500);
                res.end("Internal server error");
              }
            }
            return;
          }

          // Extract workspace path and session ID from query parameters
          const workspacePath = parsedUrl.query.workspacePath as
            | string
            | undefined;
          const sessionId = parsedUrl.query.sessionId as string | undefined;

          if (workspacePath !== undefined && typeof workspacePath !== 'string') {
            res.writeHead(400);
            res.end("Invalid workspacePath parameter");
            return;
          }
          if (sessionId !== undefined && typeof sessionId !== 'string') {
            res.writeHead(400);
            res.end("Invalid sessionId parameter");
            return;
          }

          registerWorkspaceMappingForConnection(workspacePath);

          const server = createSharedMcpServer(workspacePath, sessionId);

          // Create SSE transport
          const transport = new SSEServerTransport("/mcp", res);
          activeTransports.set(transport.sessionId, transport);

          // SSE keepalive: send periodic comment pings to prevent the
          // TCP connection from going idle during long-running MCP tool
          // waits (e.g., AskUserQuestion waiting for user input).
          // Without this, the connection can silently die and the SDK
          // subprocess never receives the tool result.
          const keepaliveInterval = setInterval(() => {
            try {
              if (!res.writableEnded) {
                res.write(": keepalive\n\n");
              } else {
                clearInterval(keepaliveInterval);
              }
            } catch {
              clearInterval(keepaliveInterval);
            }
          }, 30_000);

          if (sessionId) {
            serverByNimbalystSession.set(sessionId, server);
          }
          if (workspacePath) {
            if (!serversByWorkspace.has(workspacePath)) {
              serversByWorkspace.set(workspacePath, new Set());
            }
            serversByWorkspace.get(workspacePath)!.add(server);
          }

          server
            .connect(transport)
            .then(() => {
              transport.onclose = () => {
                clearInterval(keepaliveInterval);
                activeTransports.delete(transport.sessionId);
                if (sessionId) {
                  serverByNimbalystSession.delete(sessionId);
                }
                if (workspacePath) {
                  serversByWorkspace.get(workspacePath)?.delete(server);
                }
              };
            })
            .catch((error) => {
              console.error("[MCP Server] Connection error:", error);
              clearInterval(keepaliveInterval);
              activeTransports.delete(transport.sessionId);
              if (sessionId) {
                serverByNimbalystSession.delete(sessionId);
              }
              if (workspacePath) {
                serversByWorkspace.get(workspacePath)?.delete(server);
              }
              if (!res.headersSent) {
                res.writeHead(500);
                res.end();
              }
            });
        } else if (pathname === "/mcp" && req.method === "POST") {
          // Legacy SSE POST flow: route to existing SSE transport if found
          const legacyTransportSessionId = parsedUrl.query.sessionId as
            | string
            | undefined;

          if (legacyTransportSessionId !== undefined && typeof legacyTransportSessionId !== 'string') {
            res.writeHead(400);
            res.end("Invalid sessionId parameter");
            return;
          }

          const legacyTransport = legacyTransportSessionId
            ? activeTransports.get(legacyTransportSessionId)
            : undefined;

          if (legacyTransport && !mcpSessionIdHeader) {
            try {
              await legacyTransport.handlePostMessage(req, res);
            } catch (error) {
              console.error(
                "[MCP Server] Error handling legacy SSE POST message:",
                error
              );
              if (!res.headersSent) {
                res.writeHead(500);
                res.end("Internal server error");
              }
            }
            return;
          }

          // Streamable HTTP flow (initialize or existing session)
          const parsedBody = await readJsonBody(req);

          if (
            !mcpSessionIdHeader &&
            legacyTransportSessionId &&
            !isInitializePayload(parsedBody)
          ) {
            res.writeHead(404);
            res.end("Session not found");
            return;
          }

          let streamableMetadata: StreamableTransportMetadata | undefined =
            mcpSessionIdHeader
              ? activeStreamableTransports.get(mcpSessionIdHeader)
              : undefined;

          if (mcpSessionIdHeader && !streamableMetadata) {
            res.writeHead(404);
            res.end("Streamable session not found");
            return;
          }

          if (!streamableMetadata) {
            if (!isInitializePayload(parsedBody)) {
              res.writeHead(400);
              res.end("Missing sessionId");
              return;
            }

            const workspacePath = parsedUrl.query.workspacePath as
              | string
              | undefined;
            const nimbalystSessionId = parsedUrl.query.sessionId as
              | string
              | undefined;

            if (workspacePath !== undefined && typeof workspacePath !== 'string') {
              res.writeHead(400);
              res.end("Invalid workspacePath parameter");
              return;
            }
            if (nimbalystSessionId !== undefined && typeof nimbalystSessionId !== 'string') {
              res.writeHead(400);
              res.end("Invalid sessionId parameter");
              return;
            }

            registerWorkspaceMappingForConnection(workspacePath);

            const server = createSharedMcpServer(
              workspacePath,
              nimbalystSessionId
            );
            if (workspacePath) {
              if (!serversByWorkspace.has(workspacePath)) {
                serversByWorkspace.set(workspacePath, new Set());
              }
              serversByWorkspace.get(workspacePath)!.add(server);
            }

            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (streamableSessionId) => {
                activeStreamableTransports.set(streamableSessionId, {
                  transport,
                  nimbalystSessionId,
                });
                if (nimbalystSessionId) {
                  serverByNimbalystSession.set(nimbalystSessionId, server);
                }
              },
            });

            transport.onclose = () => {
              const streamableSessionId = transport.sessionId;
              if (streamableSessionId) {
                activeStreamableTransports.delete(streamableSessionId);
              }
              if (nimbalystSessionId) {
                serverByNimbalystSession.delete(nimbalystSessionId);
              }
              if (workspacePath) {
                serversByWorkspace.get(workspacePath)?.delete(server);
              }
            };

            transport.onerror = (error) => {
              console.error("[MCP Server] Streamable transport error:", error);
            };

            await server.connect(transport);
            streamableMetadata = { transport, nimbalystSessionId };
          }

          try {
            await streamableMetadata.transport.handleRequest(
              req,
              res,
              parsedBody
            );
          } catch (error) {
            console.error(
              "[MCP Server] Error handling streamable POST request:",
              error
            );
            if (!res.headersSent) {
              res.writeHead(500);
              res.end("Internal server error");
            }
          }
        } else if (pathname === "/mcp" && req.method === "DELETE") {
          // Streamable HTTP session termination
          if (!mcpSessionIdHeader) {
            res.writeHead(400);
            res.end("Missing mcp-session-id header");
            return;
          }

          const metadata = activeStreamableTransports.get(mcpSessionIdHeader);
          if (!metadata) {
            res.writeHead(404);
            res.end("Streamable session not found");
            return;
          }

          try {
            await metadata.transport.handleRequest(req, res);
          } catch (error) {
            console.error(
              "[MCP Server] Error handling streamable DELETE request:",
              error
            );
            if (!res.headersSent) {
              res.writeHead(500);
              res.end("Internal server error");
            }
          }
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      }
    );

    httpServer.listen(port, "127.0.0.1", (err?: Error) => {
      if (err) {
        reject(err);
      }
    });

    httpServer.on("listening", () => {
      httpServer.unref();
      resolve(httpServer);
    });

    httpServer.on("error", (err: any) => {
      reject(err);
    });
  });
}
