import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { parse as parseUrl } from "url";
import { randomUUID } from "crypto";
import {
  AISessionsRepository,
  AgentMessagesRepository,
  SessionFilesRepository,
} from "@nimbalyst/runtime";
import type { AgentMessage, SessionMeta } from "@nimbalyst/runtime";

// ─── Transport tracking ─────────────────────────────────────────────

interface TransportMetadata {
  transport: SSEServerTransport;
  aiSessionId: string;
  workspaceId: string;
}
const activeTransports = new Map<string, TransportMetadata>();

interface StreamableTransportMetadata {
  transport: StreamableHTTPServerTransport;
  aiSessionId: string;
  workspaceId: string;
}
const activeStreamableTransports = new Map<
  string,
  StreamableTransportMetadata
>();

let httpServerInstance: any = null;

// ─── Cleanup / shutdown ─────────────────────────────────────────────

export function cleanupSessionContextServer() {
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
      console.error(
        `[Session Context MCP] Error closing transport ${transportId}:`,
        error
      );
    }
  }
  activeTransports.clear();

  for (const [id, metadata] of activeStreamableTransports.entries()) {
    try {
      void metadata.transport.close().catch((error) => {
        console.error(
          `[Session Context MCP] Error closing streamable transport ${id}:`,
          error
        );
      });
    } catch (error) {
      console.error(
        `[Session Context MCP] Error closing streamable transport ${id}:`,
        error
      );
    }
  }
  activeStreamableTransports.clear();
}

export function shutdownSessionContextServer(): Promise<void> {
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
      cleanupSessionContextServer();
    } catch (error) {
      console.error(
        "[Session Context MCP] Error cleaning up transports:",
        error
      );
    }

    try {
      if (httpServerInstance?.closeAllConnections) {
        httpServerInstance.closeAllConnections();
      }
    } catch (error) {
      console.error(
        "[Session Context MCP] Error closing connections:",
        error
      );
    }

    try {
      if (httpServerInstance?.close) {
        httpServerInstance.close((err?: Error) => {
          if (err) {
            console.error(
              "[Session Context MCP] Error closing HTTP server:",
              err
            );
          }
          httpServerInstance = null;
          safeResolve();
        });
      } else {
        httpServerInstance = null;
        safeResolve();
      }
    } catch (error) {
      console.error("[Session Context MCP] Error in server close:", error);
      httpServerInstance = null;
      safeResolve();
    }

    setTimeout(() => {
      if (httpServerInstance) {
        httpServerInstance = null;
      }
      safeResolve();
    }, 1000);
  });
}

// ─── Message parsing utilities ──────────────────────────────────────

/**
 * Extract user prompts from agent messages.
 * Input messages are JSON with a .prompt field.
 */
function extractUserPrompts(messages: AgentMessage[]): string[] {
  const prompts: string[] = [];
  for (const msg of messages) {
    if (msg.direction !== "input") continue;
    try {
      const parsed = JSON.parse(msg.content);
      if (parsed.prompt && typeof parsed.prompt === "string") {
        const prompt = parsed.prompt.trim();
        if (prompt.length > 0) {
          prompts.push(prompt);
        }
      }
    } catch {
      // Not JSON or missing prompt field, skip
    }
  }
  return prompts;
}

/**
 * Extract the last substantive agent text response from messages.
 * Walks backwards through output messages to find the last text content.
 */
function extractLastAgentResponse(
  messages: AgentMessage[],
  maxLength: number = 500
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.direction !== "output") continue;

    try {
      const parsed = JSON.parse(msg.content);

      // Handle type: 'text' (streaming text chunks)
      if (parsed.type === "text" && parsed.content) {
        const text = parsed.content.trim();
        if (text.length > 0) {
          return text.length > maxLength
            ? text.substring(0, maxLength) + "..."
            : text;
        }
      }

      // Handle type: 'assistant' with text content blocks
      if (parsed.type === "assistant" && parsed.message?.content) {
        const textBlocks = parsed.message.content.filter(
          (block: any) => block.type === "text" && block.text
        );
        if (textBlocks.length > 0) {
          const text = textBlocks
            .map((b: any) => b.text)
            .join("\n")
            .trim();
          if (text.length > 0) {
            return text.length > maxLength
              ? text.substring(0, maxLength) + "..."
              : text;
          }
        }
      }
    } catch {
      // Not JSON, skip
    }
  }
  return null;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Tool handlers ──────────────────────────────────────────────────

async function handleGetSessionSummary(
  targetSessionId: string | undefined,
  currentSessionId: string,
  workspaceId: string
): Promise<string> {
  const sessionId = targetSessionId || currentSessionId;

  const session = await AISessionsRepository.get(sessionId);
  if (!session) {
    return `Error: Session ${sessionId} not found`;
  }

  const messages = await AgentMessagesRepository.list(sessionId, {
    limit: 500,
  });

  const userPrompts = extractUserPrompts(messages);
  const lastResponse = extractLastAgentResponse(messages);

  let editedFiles: string[] = [];
  try {
    const fileLinks = await SessionFilesRepository.getFilesBySession(
      sessionId,
      "edited"
    );
    editedFiles = fileLinks.map((f: any) => f.filePath);
  } catch {
    // File tracking might not be available for all sessions
  }

  const lines: string[] = [];
  lines.push(
    `Session: "${session.title || "Untitled"}" (${sessionId})`
  );
  lines.push(
    `Provider: ${session.provider}${session.model ? ` | Model: ${session.model}` : ""}`
  );
  lines.push(
    `Created: ${formatDate(session.createdAt)} | Last active: ${formatDate(session.updatedAt)}`
  );

  if (session.parentSessionId) {
    const parent = await AISessionsRepository.get(session.parentSessionId);
    if (parent) {
      lines.push(`Workstream: "${parent.title || "Untitled"}"`);
    }
  }

  lines.push("");

  if (userPrompts.length > 0) {
    lines.push(`User prompts (${userPrompts.length} turns):`);
    for (let i = 0; i < userPrompts.length; i++) {
      const prompt = userPrompts[i];
      const truncated =
        prompt.length > 200 ? prompt.substring(0, 200) + "..." : prompt;
      lines.push(`${i + 1}. "${truncated}"`);
    }
  } else {
    lines.push("No user prompts found.");
  }

  if (lastResponse) {
    lines.push("");
    lines.push("Last agent response (truncated):");
    lines.push(`"${lastResponse}"`);
  }

  if (editedFiles.length > 0) {
    lines.push("");
    lines.push(`Files edited (${editedFiles.length}):`);
    for (const file of editedFiles) {
      lines.push(`- ${file}`);
    }
  }

  return lines.join("\n");
}

async function handleGetWorkstreamOverview(
  workstreamId: string | undefined,
  currentSessionId: string,
  workspaceId: string
): Promise<string> {
  let parentId = workstreamId;

  if (!parentId) {
    const currentSession = await AISessionsRepository.get(currentSessionId);
    if (!currentSession) {
      return "Error: Current session not found";
    }
    parentId = currentSession.parentSessionId ?? undefined;
    if (!parentId) {
      return "This session is not part of a workstream (no parent session). Use get_session_summary to view the current session.";
    }
  }

  const parent = await AISessionsRepository.get(parentId);
  if (!parent) {
    return `Error: Workstream session ${parentId} not found`;
  }

  const { database } = await import("../database/PGLiteDatabaseWorker");
  const { rows } = await database.query<any>(
    `SELECT s.id, s.title, s.provider, s.model, s.session_type, s.created_at, s.updated_at
     FROM ai_sessions s
     WHERE s.parent_session_id = $1 AND s.workspace_id = $2
     ORDER BY s.created_at ASC`,
    [parentId, workspaceId]
  );

  if (rows.length === 0) {
    return `Workstream: "${parent.title || "Untitled"}" (${parentId})\nNo child sessions found.`;
  }

  const childIds = rows.map((r: any) => r.id);
  let allFileLinks: Array<{ sessionId: string; filePath: string }> = [];
  try {
    const links = await SessionFilesRepository.getFilesBySessionMany(
      childIds,
      "edited"
    );
    allFileLinks = links.map((l) => ({
      sessionId: l.sessionId,
      filePath: l.filePath,
    }));
  } catch {
    // File tracking might not be available
  }

  const filesBySession = new Map<string, string[]>();
  for (const link of allFileLinks) {
    const existing = filesBySession.get(link.sessionId) || [];
    existing.push(link.filePath);
    filesBySession.set(link.sessionId, existing);
  }

  let messageCounts = new Map<string, number>();
  try {
    messageCounts = await AgentMessagesRepository.getMessageCounts(childIds);
  } catch {
    // Fall back to empty counts
  }

  const lines: string[] = [];
  lines.push(
    `Workstream: "${parent.title || "Untitled"}" (${parentId})`
  );
  lines.push(`Sessions (${rows.length}):`);
  lines.push("");

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const updatedAt =
      row.updated_at instanceof Date
        ? row.updated_at.getTime()
        : new Date(row.updated_at).getTime();
    const msgCount = messageCounts.get(row.id) || 0;
    const sessionFiles = filesBySession.get(row.id) || [];
    const isCurrentSession = row.id === currentSessionId;

    lines.push(
      `${i + 1}. "${row.title || "Untitled"}" (${row.id}) - ${msgCount} messages, last active ${formatRelativeTime(updatedAt)}${isCurrentSession ? " [CURRENT]" : ""}`
    );

    if (sessionFiles.length > 0) {
      const shown = sessionFiles.slice(0, 3);
      const more = sessionFiles.length - shown.length;
      lines.push(
        `   Files: ${shown.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`
      );
    }
  }

  const allUniqueFiles = new Set<string>();
  for (const link of allFileLinks) {
    allUniqueFiles.add(link.filePath);
  }

  if (allUniqueFiles.size > 0) {
    lines.push("");
    lines.push(
      `All files edited across workstream (${allUniqueFiles.size} unique):`
    );
    for (const file of allUniqueFiles) {
      lines.push(`- ${file}`);
    }
  }

  return lines.join("\n");
}

async function handleListRecentSessions(
  query: string | undefined,
  limit: number,
  workspaceId: string,
  currentSessionId: string
): Promise<string> {
  let sessions: SessionMeta[];

  if (query && query.trim().length > 0) {
    sessions = await AISessionsRepository.search(workspaceId, query.trim());
  } else {
    sessions = await AISessionsRepository.list(workspaceId);
  }

  const leafSessions = sessions.filter(
    (s) => s.sessionType !== "workstream"
  );
  const limited = leafSessions.slice(0, limit);

  if (limited.length === 0) {
    return query
      ? `No sessions found matching "${query}"`
      : "No sessions found in this workspace.";
  }

  const parentIds = new Set<string>();
  for (const s of limited) {
    if (s.parentSessionId) {
      parentIds.add(s.parentSessionId);
    }
  }

  const parentTitles = new Map<string, string>();
  if (parentIds.size > 0) {
    try {
      const parents = await AISessionsRepository.getMany(
        Array.from(parentIds)
      );
      for (const p of parents) {
        parentTitles.set(p.id, p.title || "Untitled");
      }
    } catch {
      // Continue without parent titles
    }
  }

  // list() and search() return messageCount: 0 for performance, so fetch actual counts
  const sessionIds = limited.map((s) => s.id);
  let messageCounts = new Map<string, number>();
  try {
    messageCounts = await AgentMessagesRepository.getMessageCounts(sessionIds);
  } catch {
    // Fall back to empty counts
  }

  const lines: string[] = [];
  const totalLabel = query ? `matching "${query}"` : "total";
  lines.push(
    `Recent sessions (showing ${limited.length} of ${leafSessions.length} ${totalLabel}):`
  );
  lines.push("");

  for (let i = 0; i < limited.length; i++) {
    const s = limited[i];
    const isCurrentSession = s.id === currentSessionId;
    const msgCount = messageCounts.get(s.id) || 0;

    let line = `${i + 1}. "${s.title}" (${s.id}) - ${formatRelativeTime(s.updatedAt)}, ${msgCount} messages`;
    if (isCurrentSession) {
      line += " [CURRENT]";
    }
    lines.push(line);

    const meta: string[] = [];
    meta.push(`Provider: ${s.provider}`);
    if (s.sessionType && s.sessionType !== "session") {
      meta.push(`Type: ${s.sessionType}`);
    }
    if (s.parentSessionId) {
      const parentTitle = parentTitles.get(s.parentSessionId);
      if (parentTitle) {
        meta.push(`Workstream: "${parentTitle}"`);
      }
    }
    lines.push(`   ${meta.join(" | ")}`);
  }

  return lines.join("\n");
}

async function handleGetWorkstreamEditedFiles(
  groupBySession: boolean,
  currentSessionId: string,
  workspaceId: string
): Promise<string> {
  const currentSession = await AISessionsRepository.get(currentSessionId);
  if (!currentSession) {
    return "Error: Current session not found";
  }

  const parentId = currentSession.parentSessionId;
  if (!parentId) {
    const files = await SessionFilesRepository.getFilesBySession(
      currentSessionId,
      "edited"
    );
    if (files.length === 0) {
      return "No files have been edited in this session. This session is not part of a workstream.";
    }
    return `This session is not part of a workstream. Files edited in current session (${files.length}):\n${files.map((f) => `- ${f.filePath}`).join("\n")}`;
  }

  const { database } = await import("../database/PGLiteDatabaseWorker");
  const { rows } = await database.query<any>(
    `SELECT id, title FROM ai_sessions WHERE parent_session_id = $1 AND workspace_id = $2 ORDER BY created_at ASC`,
    [parentId, workspaceId]
  );

  if (rows.length === 0) {
    return "No child sessions found in this workstream.";
  }

  const childIds = rows.map((r: any) => r.id);
  const allLinks = await SessionFilesRepository.getFilesBySessionMany(
    childIds,
    "edited"
  );

  if (allLinks.length === 0) {
    return "No files have been edited across the workstream.";
  }

  if (groupBySession) {
    const titleMap = new Map<string, string>();
    for (const row of rows) {
      titleMap.set(row.id, row.title || "Untitled");
    }

    const grouped = new Map<string, string[]>();
    for (const link of allLinks) {
      const existing = grouped.get(link.sessionId) || [];
      existing.push(link.filePath);
      grouped.set(link.sessionId, existing);
    }

    const uniqueFiles = new Set(allLinks.map((l) => l.filePath));

    const lines: string[] = [];
    lines.push("Files edited across workstream by session:");
    lines.push("");

    for (const [sessionId, files] of grouped) {
      const title = titleMap.get(sessionId) || "Untitled";
      lines.push(`Session: "${title}" (${sessionId})`);
      for (const file of files) {
        lines.push(`- ${file}`);
      }
      lines.push("");
    }

    lines.push(
      `Total: ${uniqueFiles.size} unique files across ${grouped.size} sessions`
    );
    return lines.join("\n");
  } else {
    const uniqueFiles = new Set(allLinks.map((l) => l.filePath));
    const lines: string[] = [];
    lines.push(
      `Files edited across workstream (${allLinks.length} total, ${uniqueFiles.size} unique):`
    );
    for (const file of uniqueFiles) {
      lines.push(`- ${file}`);
    }
    return lines.join("\n");
  }
}

// ─── MCP server creation ────────────────────────────────────────────

function createSessionContextMcpServer(
  aiSessionId: string,
  workspaceId: string
): Server {
  const server = new Server(
    {
      name: "nimbalyst-session-context",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_session_summary",
          description:
            "Get a compact summary of an AI session including its title, user prompts, last agent response, and files edited. Use this to understand what happened in a specific session. If no sessionId is provided, summarizes the current session.",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: {
                type: "string",
                description:
                  "ID of the session to summarize. If omitted, summarizes the current session. Use list_recent_sessions to find session IDs.",
              },
            },
            required: [],
          },
        },
        {
          name: "get_workstream_overview",
          description:
            "Get an overview of the current workstream (parent session with child sessions). Shows all child sessions with their titles, message counts, and files edited. Use this to understand the broader context when working in a workstream.",
          inputSchema: {
            type: "object",
            properties: {
              workstreamId: {
                type: "string",
                description:
                  "ID of the workstream parent session. If omitted, uses the current session's parent workstream.",
              },
            },
            required: [],
          },
        },
        {
          name: "list_recent_sessions",
          description:
            "List recent AI sessions in the current workspace. Optionally search by title or content. Use this when the user references a previous session or asks about past work (e.g., 'implement the plan from our session about X').",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Optional search string to filter sessions by title or content.",
              },
              limit: {
                type: "number",
                description:
                  "Maximum number of results (default 10, max 25).",
              },
            },
            required: [],
          },
        },
        {
          name: "get_workstream_edited_files",
          description:
            "Get all files edited across all sessions in the current workstream. Useful for understanding the full scope of changes or preparing a commit that spans multiple sessions.",
          inputSchema: {
            type: "object",
            properties: {
              groupBySession: {
                type: "boolean",
                description:
                  "If true, group files by session with titles. If false (default), return a flat deduplicated list.",
              },
            },
            required: [],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;
    const toolName = name.replace(
      /^mcp__nimbalyst-session-context__/,
      ""
    );

    try {
      switch (toolName) {
        case "get_session_summary": {
          const result = await handleGetSessionSummary(
            args?.sessionId as string | undefined,
            aiSessionId,
            workspaceId
          );
          return {
            content: [{ type: "text", text: result }],
            isError: result.startsWith("Error:"),
          };
        }

        case "get_workstream_overview": {
          const result = await handleGetWorkstreamOverview(
            args?.workstreamId as string | undefined,
            aiSessionId,
            workspaceId
          );
          return {
            content: [{ type: "text", text: result }],
            isError: result.startsWith("Error:"),
          };
        }

        case "list_recent_sessions": {
          const limit = Math.min(
            Math.max((args?.limit as number) || 10, 1),
            25
          );
          const result = await handleListRecentSessions(
            args?.query as string | undefined,
            limit,
            workspaceId,
            aiSessionId
          );
          return {
            content: [{ type: "text", text: result }],
            isError: false,
          };
        }

        case "get_workstream_edited_files": {
          const result = await handleGetWorkstreamEditedFiles(
            (args?.groupBySession as boolean) || false,
            aiSessionId,
            workspaceId
          );
          return {
            content: [{ type: "text", text: result }],
            isError: result.startsWith("Error:"),
          };
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${name}`
          );
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      console.error(`[Session Context MCP] Tool ${toolName} failed:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ─── HTTP server ────────────────────────────────────────────────────

function getMcpSessionIdHeader(req: IncomingMessage): string | undefined {
  const headerValue = req.headers["mcp-session-id"];
  if (Array.isArray(headerValue)) return headerValue[0];
  if (typeof headerValue === "string" && headerValue.length > 0)
    return headerValue;
  return undefined;
}

async function readJsonBody(
  req: IncomingMessage
): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) return undefined;
  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

function isInitializePayload(payload: unknown): boolean {
  if (!payload) return false;
  if (Array.isArray(payload))
    return payload.some((entry) => isInitializeRequest(entry));
  return isInitializeRequest(payload);
}

async function tryCreateSessionContextServer(port: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const parsedUrl = parseUrl(req.url || "", true);
        const pathname = parsedUrl.pathname;
        const mcpSessionIdHeader = getMcpSessionIdHeader(req);

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

        if (pathname === "/mcp" && req.method === "GET") {
          if (mcpSessionIdHeader) {
            const metadata =
              activeStreamableTransports.get(mcpSessionIdHeader);
            if (!metadata) {
              res.writeHead(404);
              res.end("Streamable session not found");
              return;
            }
            try {
              await metadata.transport.handleRequest(req, res);
            } catch (error) {
              console.error(
                "[Session Context MCP] Error handling streamable GET:",
                error
              );
              if (!res.headersSent) {
                res.writeHead(500);
                res.end("Internal server error");
              }
            }
            return;
          }

          const aiSessionId = parsedUrl.query.sessionId as string;
          const workspaceId = parsedUrl.query.workspaceId as string;

          if (!aiSessionId || typeof aiSessionId !== "string") {
            res.writeHead(400);
            res.end("Missing or invalid sessionId parameter");
            return;
          }

          if (!workspaceId || typeof workspaceId !== "string") {
            res.writeHead(400);
            res.end("Missing or invalid workspaceId parameter");
            return;
          }

          const server = createSessionContextMcpServer(
            aiSessionId,
            workspaceId
          );

          const transport = new SSEServerTransport("/mcp", res);
          activeTransports.set(transport.sessionId, {
            transport,
            aiSessionId,
            workspaceId,
          });

          server
            .connect(transport)
            .then(() => {
              transport.onclose = () => {
                activeTransports.delete(transport.sessionId);
              };
            })
            .catch((error) => {
              console.error(
                "[Session Context MCP] Connection error:",
                error
              );
              activeTransports.delete(transport.sessionId);
              if (!res.headersSent) {
                res.writeHead(500);
                res.end();
              }
            });
        } else if (pathname === "/mcp" && req.method === "POST") {
          const legacyTransportSessionId = parsedUrl.query.sessionId as
            | string
            | undefined;

          if (
            legacyTransportSessionId !== undefined &&
            typeof legacyTransportSessionId !== "string"
          ) {
            res.writeHead(400);
            res.end("Invalid sessionId parameter");
            return;
          }

          const legacyMetadata = legacyTransportSessionId
            ? activeTransports.get(legacyTransportSessionId)
            : undefined;

          if (legacyMetadata && !mcpSessionIdHeader) {
            try {
              await legacyMetadata.transport.handlePostMessage(req, res);
            } catch (error) {
              console.error(
                "[Session Context MCP] Error handling legacy SSE POST:",
                error
              );
              if (!res.headersSent) {
                res.writeHead(500);
                res.end("Internal server error");
              }
            }
            return;
          }

          const parsedBody = await readJsonBody(req);

          if (
            !mcpSessionIdHeader &&
            legacyTransportSessionId &&
            !isInitializePayload(parsedBody)
          ) {
            res.writeHead(404);
            res.end("Transport session not found");
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

            const aiSessionId = parsedUrl.query.sessionId as string;
            const workspaceId = parsedUrl.query.workspaceId as string;

            if (!aiSessionId || typeof aiSessionId !== "string") {
              res.writeHead(400);
              res.end("Missing or invalid sessionId parameter");
              return;
            }

            if (!workspaceId || typeof workspaceId !== "string") {
              res.writeHead(400);
              res.end("Missing or invalid workspaceId parameter");
              return;
            }

            const server = createSessionContextMcpServer(
              aiSessionId,
              workspaceId
            );
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (streamableSessionId) => {
                activeStreamableTransports.set(streamableSessionId, {
                  transport,
                  aiSessionId,
                  workspaceId,
                });
              },
            });

            transport.onclose = () => {
              const streamableSessionId = transport.sessionId;
              if (streamableSessionId) {
                activeStreamableTransports.delete(streamableSessionId);
              }
            };

            transport.onerror = (error) => {
              console.error(
                "[Session Context MCP] Streamable transport error:",
                error
              );
            };

            await server.connect(transport);
            streamableMetadata = { transport, aiSessionId, workspaceId };
          }

          try {
            await streamableMetadata.transport.handleRequest(
              req,
              res,
              parsedBody
            );
          } catch (error) {
            console.error(
              "[Session Context MCP] Error handling streamable POST:",
              error
            );
            if (!res.headersSent) {
              res.writeHead(500);
              res.end("Internal server error");
            }
          }
        } else if (pathname === "/mcp" && req.method === "DELETE") {
          if (!mcpSessionIdHeader) {
            res.writeHead(400);
            res.end("Missing mcp-session-id header");
            return;
          }

          const metadata =
            activeStreamableTransports.get(mcpSessionIdHeader);
          if (!metadata) {
            res.writeHead(404);
            res.end("Streamable session not found");
            return;
          }

          try {
            await metadata.transport.handleRequest(req, res);
          } catch (error) {
            console.error(
              "[Session Context MCP] Error handling streamable DELETE:",
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
      if (err) reject(err);
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

// ─── Public API ─────────────────────────────────────────────────────

export async function startSessionContextServer(
  startPort: number = 3557
): Promise<{ httpServer: any; port: number }> {
  let port = startPort;
  let httpServer: any = null;
  let maxAttempts = 100;

  while (maxAttempts > 0) {
    try {
      httpServer = await tryCreateSessionContextServer(port);
      console.log(
        `[Session Context MCP] Successfully started on port ${port}`
      );
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
      `[Session Context MCP] Could not find an available port after trying 100 ports starting from ${startPort}`
    );
  }

  httpServerInstance = httpServer;
  return { httpServer, port };
}
