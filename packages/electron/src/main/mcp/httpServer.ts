import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { BrowserWindow, ipcMain, nativeImage, app } from "electron";
import { parse as parseUrl } from "url";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import path, { isAbsolute } from "path";
import {
  isVoiceModeActive,
  sendToVoiceAgent,
  getActiveVoiceSessionId,
  stopVoiceSession,
} from "../services/voice/VoiceModeService";
import { findWindowByWorkspace } from "../window/WindowManager";
import {
  SessionFilesRepository,
  AgentMessagesRepository,
  AISessionsRepository,
} from "@nimbalyst/runtime";
import { notificationService } from "../services/NotificationService";
import { TrayManager } from "../tray/TrayManager";
import { isFileInWorkspaceOrWorktree } from "../utils/workspaceDetection";

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

  if (byteSize <= MAX_IMAGE_SIZE_BYTES) {
    return { data: base64Data, mimeType, wasCompressed: false };
  }

  try {
    // Validate base64 data before attempting to decode
    if (!base64Data || base64Data.length === 0) {
      console.error(
        "[MCP Server] Empty base64 data provided to compressImageIfNeeded"
      );
      return { data: base64Data, mimeType, wasCompressed: false };
    }

    // Create nativeImage from base64 PNG
    const buffer = Buffer.from(base64Data, "base64");

    // Validate that we actually got a buffer with data
    if (buffer.length === 0) {
      console.error(
        "[MCP Server] Buffer is empty after decoding base64, data may be corrupted"
      );
      return { data: base64Data, mimeType, wasCompressed: false };
    }

    const image = nativeImage.createFromBuffer(buffer);

    if (image.isEmpty()) {
      console.warn(
        "[MCP Server] Failed to create image from base64 (image is empty), buffer may be corrupted. Returning original without compression."
      );
      return { data: base64Data, mimeType, wasCompressed: false };
    }

    const originalSize = image.getSize();

    // Quality levels to try
    const qualities = [85, 70, 55, 40, 30, 20];
    // Scale factors to try if quality reduction isn't enough
    const scaleFactors = [1.0, 0.75, 0.5, 0.35, 0.25];

    // Try progressively more aggressive compression, early-exit when target is met
    for (const scale of scaleFactors) {
      // Resize image if scale < 1.0
      let workingImage = image;
      if (scale < 1.0) {
        const newWidth = Math.round(originalSize.width * scale);
        const newHeight = Math.round(originalSize.height * scale);
        workingImage = image.resize({
          width: newWidth,
          height: newHeight,
          quality: "better",
        });
      }

      for (const quality of qualities) {
        const jpegBuffer = workingImage.toJPEG(quality);
        const compressedSize = jpegBuffer.length;
        const compressedSizeMB = compressedSize / 1024 / 1024;

        if (compressedSize <= MAX_IMAGE_SIZE_BYTES) {
          const jpegBase64 = jpegBuffer.toString("base64");
          const finalSize = workingImage.getSize();
          return {
            data: jpegBase64,
            mimeType: "image/jpeg",
            wasCompressed: true,
          };
        }
      }

      // Early exit: if we've tried all qualities at this scale and still too large,
      // move to next scale factor. No point retrying qualities at same scale.
    }

    // If even smallest scale and lowest quality doesn't fit, use smallest anyway
    const smallestScale = scaleFactors[scaleFactors.length - 1];
    const lowestQuality = qualities[qualities.length - 1];
    const smallWidth = Math.round(originalSize.width * smallestScale);
    const smallHeight = Math.round(originalSize.height * smallestScale);
    const smallestImage = image.resize({
      width: smallWidth,
      height: smallHeight,
      quality: "better",
    });
    const smallestBuffer = smallestImage.toJPEG(lowestQuality);
    const smallestSizeMB = smallestBuffer.length / 1024 / 1024;

    return {
      data: smallestBuffer.toString("base64"),
      mimeType: "image/jpeg",
      wasCompressed: true,
    };
  } catch (error) {
    console.error("[MCP Server] Failed to compress image:", error);
    return { data: base64Data, mimeType, wasCompressed: false };
  }
}

// Store document state PER SESSION to avoid cross-window contamination
const documentStateBySession = new Map<string, any>();
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

// Map workspace paths to window IDs for routing
// This is populated when we receive document state updates
const workspaceToWindowMap = new Map<string, number>();

// Cache for worktree path -> project path resolution
// This avoids repeated database lookups for the same worktree
const worktreeToProjectPathCache = new Map<string, string | null>();

/**
 * Find the window ID for a given workspace path, resolving worktree paths to their parent project.
 *
 * When Claude Code runs in a worktree, the workspacePath is the worktree directory
 * (e.g., /Users/foo/repo_worktrees/gentle-flame), but the window is registered under
 * the parent project path (e.g., /Users/foo/repo). This function handles that resolution.
 *
 * @param workspacePath The workspace path (may be a worktree path or regular workspace)
 * @returns The window ID if found, or null if no window is found
 */
async function findWindowIdForWorkspacePath(
  workspacePath: string
): Promise<number | null> {
  // First try direct lookup - this works for regular workspaces
  let windowId = workspaceToWindowMap.get(workspacePath);
  if (windowId !== undefined) {
    return windowId;
  }

  // Try findWindowByWorkspace directly
  let targetWindow = findWindowByWorkspace(workspacePath);
  if (targetWindow && !targetWindow.isDestroyed()) {
    // Cache the mapping for future lookups
    workspaceToWindowMap.set(workspacePath, targetWindow.id);
    return targetWindow.id;
  }

  // Check if this might be a worktree path
  // First check cache to avoid repeated DB lookups
  if (worktreeToProjectPathCache.has(workspacePath)) {
    const cachedProjectPath = worktreeToProjectPathCache.get(workspacePath);
    if (cachedProjectPath) {
      windowId = workspaceToWindowMap.get(cachedProjectPath);
      if (windowId !== undefined) {
        return windowId;
      }
      targetWindow = findWindowByWorkspace(cachedProjectPath);
      if (targetWindow && !targetWindow.isDestroyed()) {
        workspaceToWindowMap.set(cachedProjectPath, targetWindow.id);
        return targetWindow.id;
      }
    }
    // cachedProjectPath is null means we already checked and it's not a worktree
    return null;
  }

  // Query the database to check if this is a worktree path
  try {
    const { getDatabase } = await import("../database/initialize");
    const { createWorktreeStore } = await import("../services/WorktreeStore");
    const db = getDatabase();
    const worktreeStore = createWorktreeStore(db);
    const worktree = await worktreeStore.getByPath(workspacePath);

    if (worktree) {
      // It's a worktree - use the project path
      const projectPath = worktree.projectPath;
      worktreeToProjectPathCache.set(workspacePath, projectPath);
      console.log(
        `[MCP Server] Resolved worktree path ${workspacePath} -> project path ${projectPath}`
      );

      windowId = workspaceToWindowMap.get(projectPath);
      if (windowId !== undefined) {
        return windowId;
      }
      targetWindow = findWindowByWorkspace(projectPath);
      if (targetWindow && !targetWindow.isDestroyed()) {
        workspaceToWindowMap.set(projectPath, targetWindow.id);
        return targetWindow.id;
      }
    } else {
      // Not a worktree - cache the negative result
      worktreeToProjectPathCache.set(workspacePath, null);
    }
  } catch (error) {
    console.warn("[MCP Server] Error checking worktree path:", error);
    // Don't cache errors - they might be transient
  }

  return null;
}

// Extension tools registered from renderer
interface ExtensionToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  extensionId: string;
  scope: "global" | "editor";
  editorFilePatterns?: string[];
}
const extensionToolsByWorkspace = new Map<string, ExtensionToolDefinition[]>();

/**
 * Register extension tools from a workspace window.
 * Notifies all connected MCP sessions for this workspace to re-fetch their tool list.
 * This includes sessions connected via worktree paths that resolve to this workspace.
 */
export function registerExtensionTools(
  workspacePath: string,
  tools: ExtensionToolDefinition[]
) {
  extensionToolsByWorkspace.set(workspacePath, tools);

  // Notify connected MCP sessions that the tool list has changed.
  // We need to check all entries in serversByWorkspace because worktree sessions
  // connect with their worktree path, but tools are registered under the project path.
  for (const [connectedPath, servers] of serversByWorkspace) {
    // Match if the path is the same, or if the connected path is a worktree
    // that resolves to this workspace path
    const resolvedPath = resolveExtensionToolsWorkspacePathSync(connectedPath);
    if (resolvedPath === workspacePath) {
      for (const server of servers) {
        server.sendToolListChanged().catch(() => {
          // Ignore errors - client may have disconnected
        });
      }
    }
  }
}

/**
 * Unregister extension tools for a workspace (when window closes)
 */
export function unregisterExtensionTools(workspacePath: string) {
  extensionToolsByWorkspace.delete(workspacePath);
}

/**
 * Resolve a workspace path to the path under which extension tools are registered.
 * In worktree sessions, tools are registered under the main project path,
 * but the MCP connection uses the worktree path. This function resolves
 * worktree paths to their parent project path using the cache (sync).
 */
function resolveExtensionToolsWorkspacePathSync(
  workspacePath: string
): string {
  // Direct lookup first
  if (extensionToolsByWorkspace.has(workspacePath)) {
    return workspacePath;
  }

  // Check if this is a worktree path that maps to a project path
  const projectPath = worktreeToProjectPathCache.get(workspacePath);
  if (projectPath && extensionToolsByWorkspace.has(projectPath)) {
    return projectPath;
  }

  return workspacePath;
}

/**
 * Resolve a workspace path to the path under which extension tools are registered.
 * Falls back to async database lookup if the cache doesn't have the mapping yet.
 */
async function resolveExtensionToolsWorkspacePath(
  workspacePath: string
): Promise<string> {
  // Try synchronous resolution first (cache hit)
  const syncResolved = resolveExtensionToolsWorkspacePathSync(workspacePath);
  if (syncResolved !== workspacePath || extensionToolsByWorkspace.has(workspacePath)) {
    return syncResolved;
  }

  // Cache miss - try async DB lookup for worktree resolution
  // This handles the case where the MCP connection arrives before the cache is populated
  try {
    const { getDatabase } = await import("../database/initialize");
    const { createWorktreeStore } = await import("../services/WorktreeStore");
    const db = getDatabase();
    const worktreeStore = createWorktreeStore(db);
    const worktree = await worktreeStore.getByPath(workspacePath);

    if (worktree) {
      const projectPath = worktree.projectPath;
      worktreeToProjectPathCache.set(workspacePath, projectPath);
      if (extensionToolsByWorkspace.has(projectPath)) {
        return projectPath;
      }
    } else {
      worktreeToProjectPathCache.set(workspacePath, null);
    }
  } catch (error) {
    // Don't fail tool listing because of DB errors
  }

  return workspacePath;
}

/**
 * Get available extension tools for a given file path
 * Filters based on scope and file patterns
 */
async function getAvailableExtensionTools(
  workspacePath: string | undefined,
  filePath: string | undefined
): Promise<ExtensionToolDefinition[]> {
  if (!workspacePath) {
    console.log(
      "[MCP Server] getAvailableExtensionTools: No workspacePath provided, returning empty array"
    );
    return [];
  }

  // Resolve worktree paths to the project path where tools are registered
  const resolvedPath = await resolveExtensionToolsWorkspacePath(workspacePath);
  const tools = extensionToolsByWorkspace.get(resolvedPath) || [];

  if (tools.length === 0) {
    console.log(
      `[MCP Server] getAvailableExtensionTools: No tools registered for workspace: ${workspacePath}${resolvedPath !== workspacePath ? ` (resolved to: ${resolvedPath})` : ""}`
    );
    return [];
  }

  const filtered = tools.filter((tool) => {
    // Global tools are always available
    if (tool.scope === "global") {
      return true;
    }

    // Editor-scoped tools require a matching file
    if (!filePath) {
      return false;
    }

    // Check if file matches any pattern
    if (!tool.editorFilePatterns || tool.editorFilePatterns.length === 0) {
      return false;
    }

    const fileExtension = filePath.substring(filePath.lastIndexOf("."));
    return tool.editorFilePatterns.some((pattern) => {
      // Handle "*.ext" patterns
      if (pattern.startsWith("*.")) {
        const patternExt = pattern.substring(1); // ".ext"
        return fileExtension.toLowerCase() === patternExt.toLowerCase();
      }
      // Exact match
      return filePath.toLowerCase().endsWith(pattern.toLowerCase());
    });
  });

  // console.log(
  //   `[MCP Server] getAvailableExtensionTools: Filtered ${filtered.length}/${
  //     tools.length
  //   } tools for workspace: ${workspacePath}, filePath: ${filePath || "none"}`
  // );

  return filtered;
}

export function updateDocumentState(state: any, sessionId?: string) {
  if (!sessionId) {
    // console.warn('[MCP Server] No sessionId provided for document state update - using "default"');
    sessionId = "default";
  }

  // CRITICAL: Workspace path is REQUIRED for routing
  if (!state?.workspacePath) {
    const error = new Error(
      `[MCP Server] CRITICAL: No workspacePath in document state for session ${sessionId}! Cannot route MCP tools without workspace path. State keys: ${Object.keys(
        state || {}
      ).join(", ")}`
    );
    console.error(error.message);
    throw error;
  }

  // filePath is optional - if missing, only global-scoped extension tools will be available
  // This is normal for agent mode sessions without a specific file open
  if (!state?.filePath) {
    console.log(
      `[MCP Server] No filePath in document state for session ${sessionId} - only global tools will be available`
    );
  }

  // DEFENSIVE LOGGING: Log exactly what we received
  //   sessionId,
  //   filePath: state.filePath,
  //   workspacePath: state.workspacePath,
  //   stateKeys: Object.keys(state || {})
  // });

  // Check if file path changed - if so, the available editor-scoped tools may have changed
  const previousState = documentStateBySession.get(sessionId);
  const filePathChanged = previousState?.filePath !== state?.filePath;

  // Store state with sessionId included so handlers can access it from the value
  documentStateBySession.set(sessionId, { ...state, sessionId });

  // Notify the MCP client that the tool list may have changed
  // This causes Claude Code to re-fetch tools via ListTools, picking up
  // any editor-scoped tools that are now available for the new file type
  if (filePathChanged) {
    const server = serverByNimbalystSession.get(sessionId);
    if (server) {
      server.sendToolListChanged().catch(() => {
        // Ignore errors - client may have disconnected
      });
    }
  }
}

/**
 * Register a workspace path to window mapping
 * This should be called from the main process when document state is updated
 */
export function registerWorkspaceWindow(
  workspacePath: string,
  windowId: number
) {
  workspaceToWindowMap.set(workspacePath, windowId);
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
async function findWindowForFilePath(
  filePath: string | undefined
): Promise<BrowserWindow | null> {
  if (!filePath) {
    throw new Error(
      "[MCP Server] CRITICAL: No file path provided to findWindowForFilePath, cannot determine target window"
    );
  }


  // DEFENSIVE: Log ALL document states in detail
  // const stateDetails = Array.from(documentStateBySession.entries()).map(([id, state]) => ({
  //   sessionId: id,
  //   filePath: state?.filePath,
  //   workspacePath: state?.workspacePath,
  //   hasFilePath: !!state?.filePath,
  //   hasWorkspacePath: !!state?.workspacePath,
  //   filePathMatches: state?.filePath === filePath
  // }));

  // First, find which workspace this file belongs to
  let targetWorkspacePath: string | undefined;
  for (const [sessionId, state] of documentStateBySession.entries()) {
    //   stateFilePath: state?.filePath,
    //   targetFilePath: filePath,
    //   matches: state?.filePath === filePath,
    //   hasWorkspacePath: !!state?.workspacePath,
    //   workspacePath: state?.workspacePath
    // });

    if (state?.filePath === filePath) {
      if (!state?.workspacePath) {
        // This should never happen because updateDocumentState throws if workspacePath is missing
        throw new Error(
          `[MCP Server] CRITICAL: Found matching file ${filePath} but NO WORKSPACE PATH in state! This should be impossible - updateDocumentState should have thrown. State keys: ${Object.keys(
            state || {}
          ).join(", ")}`
        );
      }

      targetWorkspacePath = state.workspacePath;
      break;
    }
  }

  if (!targetWorkspacePath) {
    const availableSessions = Array.from(documentStateBySession.entries())
      .map(([id, state]) => `${id}: ${state?.filePath || "NO FILE"}`)
      .join(", ");
    throw new Error(
      `[MCP Server] CRITICAL: Could not determine workspace for file: ${filePath}. Available sessions (${documentStateBySession.size}): ${availableSessions}`
    );
  }

  // Look up the window ID for this workspace path (resolves worktree paths to parent project)
  const windowId = await findWindowIdForWorkspacePath(targetWorkspacePath);
  if (!windowId) {
    const availableWorkspaces = Array.from(workspaceToWindowMap.entries())
      .map(([path, id]) => `${path} -> window ${id}`)
      .join(", ");
    throw new Error(
      `[MCP Server] CRITICAL: No window registered for workspace: ${targetWorkspacePath}. Available workspaces: ${
        availableWorkspaces || "NONE"
      }`
    );
  }

  // Get the window by ID
  const window = BrowserWindow.fromId(windowId);
  if (!window) {
    // Clean up stale mapping
    workspaceToWindowMap.delete(targetWorkspacePath);
    throw new Error(
      `[MCP Server] CRITICAL: Window ${windowId} for workspace ${targetWorkspacePath} no longer exists (window was closed)`
    );
  }

  return window;
}

/**
 * Remove a window from the workspace mapping when it's closed
 */
export function unregisterWindow(windowId: number) {
  // Find and remove any workspace mappings for this window
  for (const [
    workspacePath,
    mappedWindowId,
  ] of workspaceToWindowMap.entries()) {
    if (mappedWindowId === windowId) {
      workspaceToWindowMap.delete(workspacePath);
    }
  }
}

export async function cleanupMcpServer() {
  // Close all active SSE transports
  for (const [sessionId, transport] of activeTransports.entries()) {
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

  // Clear the MCP server instance
  if (mcpServer) {
    mcpServer = null;
  }
}

export async function shutdownHttpServer(): Promise<void> {
  if (!httpServerInstance) {
    return;
  }

  try {
    // First cleanup transports
    await cleanupMcpServer();
  } catch (error) {
    console.error("[MCP Server] Error cleaning up transports:", error);
  }

  return new Promise((resolve) => {
    // Track if we've resolved
    let hasResolved = false;
    const safeResolve = () => {
      if (!hasResolved) {
        hasResolved = true;
        resolve();
      }
    };

    try {
      // Force close all connections
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
      // Close the server
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

    // More aggressive timeout for production
    const isProduction = process.env.NODE_ENV === "production";
    const timeout = isProduction ? 300 : 1000;

    // Timeout to ensure we don't hang
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
  // Try to find an available port starting from the given port
  let port = startPort;
  let httpServer: any = null;
  let maxAttempts = 100; // Try up to 100 ports

  while (maxAttempts > 0) {
    try {
      httpServer = await tryCreateServer(port);
      break;
    } catch (error: any) {
      if (error.code === "EADDRINUSE") {
        port++;
        maxAttempts--;
      } else {
        // Some other error, re-throw it
        throw error;
      }
    }
  }

  if (!httpServer) {
    throw new Error(
      `[MCP Server] Could not find an available port after trying ${100} ports starting from ${startPort}`
    );
  }

  // Store the instance for cleanup
  httpServerInstance = httpServer;

  return { httpServer, port };
}

function createSharedMcpServer(
  workspacePath: string | undefined,
  sessionId: string | undefined
): Server {
  // Create a new MCP server instance for this connection
  const server = new Server(
    {
      name: "nimbalyst-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
    }
  );

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Get current document state to determine which extension tools to show
    const currentDocState = sessionId
      ? documentStateBySession.get(sessionId)
      : undefined;
    const currentFilePath = currentDocState?.filePath;

    // Built-in tools exposed via MCP (for Claude Code / agent mode)
    // NOTE: applyDiff and streamContent are intentionally NOT exposed here.
    // They are only available through chat providers via direct IPC, not through
    // Claude Code MCP. This was the original design - see commit af94ef47.
    // The agent should use native Edit/Write tools with file-watcher diff approval.
    const builtInTools: Array<{
      name: string;
      description: string;
      inputSchema: any;
    }> = [
      {
        name: "capture_editor_screenshot",
        description:
          "Capture a screenshot of any editor view. Works with all file types including custom editors (Excalidraw, CSV, mockups), markdown, code, etc. Use this to visually verify UI, diagrams, or any editor content.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description:
                "The absolute path to the file being edited (optional, uses active file if not specified)",
            },
            selector: {
              type: "string",
              description:
                "CSS selector to capture a specific element (optional, captures full editor area if not specified)",
            },
          },
        },
      },
      // open_workspace is only available in development mode to prevent
      // agents from accidentally opening duplicate windows in production
      ...(!app.isPackaged
        ? [
            {
              name: "open_workspace",
              description:
                "Open a workspace (project directory) in Nimbalyst. This allows switching between different projects or opening additional workspaces. The workspace will open in a new window.",
              inputSchema: {
                type: "object",
                properties: {
                  workspace_path: {
                    type: "string",
                    description:
                      "The absolute path to the workspace directory to open",
                  },
                },
                required: ["workspace_path"],
              },
            },
          ]
        : []),
      // TODO: Re-enable open_file tool when it's working
      // {
      //   name: 'open_file',
      //   description: 'Open a file in the Nimbalyst editor. The file will open in a new tab in the current window.',
      //   inputSchema: {
      //     type: 'object',
      //     properties: {
      //       file_path: {
      //         type: 'string',
      //         description: 'The absolute path to the file to open'
      //       }
      //     },
      //     required: ['file_path']
      //   }
      // }
    ];

    builtInTools.push({
      name: "display_to_user",
      description:
        'Display visual content inline in the conversation. Use this to show images or charts to the user. Provide an array of items, where each item has a description and exactly one content type: either "image" (for displaying a LOCAL file) or "chart" (for data visualizations). IMPORTANT: For images, you must provide an ABSOLUTE path to a LOCAL file on disk (e.g., "/Users/name/project/image.png"). URLs and relative paths are NOT supported. If a file does not exist, that specific image will show an error while other valid images still display.',
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            description:
              "Array of visual items to display. Each item must have a description and exactly one content type (image or chart).",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                description: {
                  type: "string",
                  description:
                    "Brief description of what this visual content shows",
                },
                image: {
                  type: "object",
                  description:
                    "Display a LOCAL image file from disk. Provide this OR chart, not both. The file must exist locally.",
                  properties: {
                    path: {
                      type: "string",
                      description:
                        'ABSOLUTE path to a LOCAL image file on disk (e.g., "/Users/name/project/screenshot.png"). URLs and relative paths are NOT supported. The file must exist.',
                    },
                  },
                  required: ["path"],
                },
                chart: {
                  type: "object",
                  description:
                    "Display a data chart. Provide this OR image, not both.",
                  properties: {
                    chartType: {
                      type: "string",
                      enum: ["bar", "line", "pie", "area", "scatter"],
                      description: "The type of chart to render",
                    },
                    data: {
                      type: "array",
                      items: { type: "object" },
                      description:
                        "Array of data objects with keys matching xAxisKey and yAxisKey",
                    },
                    xAxisKey: {
                      type: "string",
                      description:
                        "Key in data objects for x-axis labels (or pie chart segment names)",
                    },
                    yAxisKey: {
                      oneOf: [
                        { type: "string" },
                        { type: "array", items: { type: "string" } },
                      ],
                      description:
                        "Key(s) in data objects for y-axis values. String for single series, array for multi-series",
                    },
                    colors: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Optional colors for chart series (hex codes or CSS color names)",
                    },
                    errorBars: {
                      type: "object",
                      description:
                        "Optional error bars configuration. Supports bar, line, area, and scatter charts.",
                      properties: {
                        dataKey: {
                          type: "string",
                          description:
                            "Key in data objects for the y-axis series to add error bars to (required when yAxisKey is an array)",
                        },
                        errorKey: {
                          type: "string",
                          description:
                            "Key in data objects containing error values (symmetric errors)",
                        },
                        errorKeyLower: {
                          type: "string",
                          description:
                            "Key in data objects for lower error values (asymmetric errors)",
                        },
                        errorKeyUpper: {
                          type: "string",
                          description:
                            "Key in data objects for upper error values (asymmetric errors)",
                        },
                        strokeWidth: {
                          type: "number",
                          description: "Width of error bar lines (default: 2)",
                        },
                      },
                    },
                  },
                  required: ["chartType", "data", "xAxisKey", "yAxisKey"],
                },
              },
              required: ["description"],
            },
          },
        },
        required: ["items"],
      },
    });

    // Always add voice_agent_speak tool so it's discoverable
    // The handler will return a non-error response if voice mode is not active
    builtInTools.push({
      name: "voice_agent_speak",
      description:
        "Send a message to the voice agent to be spoken aloud to the user. This tool serves as a communication bridge between the coding agent and the voice agent, enabling the coding agent to provide spoken updates, task completion notifications, or responses to the user during voice mode sessions. Use this when you want to inform the user about progress or results while they are interacting via voice. If voice mode is not active, this tool will return a non-error response indicating voice is unavailable. Keep messages concise and conversational.",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description:
              "The message for the voice agent to speak to the user. Be concise and natural. This enables the coding agent to communicate with the user through the voice agent.",
          },
        },
        required: ["message"],
      },
    });

    // Add voice_agent_stop tool to allow AI to end voice sessions
    builtInTools.push({
      name: "voice_agent_stop",
      description:
        "Stop the current voice mode session. Use this to end voice interactions when the conversation is complete, when the user requests to stop, or when transitioning away from voice mode. This will disconnect from the voice service and clean up resources. Returns success if a session was stopped, or indicates if no session was active.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    });

    // Add session files tool if sessionId is available
    if (sessionId) {
      builtInTools.push({
        name: "get_session_edited_files",
        description:
          "Get the list of files that were edited during this AI session. Use this when you need to know which files have been modified as part of the current session, for example when preparing a git commit. Returns file paths relative to the workspace.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      });

      // Git commit proposal tool - must be built-in (not from extension) because:
      // 1. The built-in handler waits for user confirmation before returning to Claude
      // 2. Extension tools return immediately, which doesn't allow Claude to see the result
      builtInTools.push({
        name: "developer_git_commit_proposal",
        description: `Propose files and commit message for a git commit.

IMPORTANT: Before calling this tool, you MUST:
1. Call get_session_edited_files to get ALL files edited in this session
2. Cross-reference with git status to find which session files have uncommitted changes
3. Include ALL session-edited files that have changes - do not cherry-pick a subset

This tool will present an interactive widget to the user where they can review
and adjust your proposal before committing.

The commit message should follow these guidelines:
- Start with type prefix: feat:, fix:, refactor:, docs:, test:, chore:
- Focus on IMPACT and WHY, not implementation details
- Title describes user-visible outcome or bug fixed
- Use bullet points (dash prefix) only for multiple distinct changes
- Keep lines under 72 characters
- No emojis
- Lead with problem solved or capability added, not technique used`,
        inputSchema: {
          type: "object",
          properties: {
            filesToStage: {
              type: "array",
              items: {
                oneOf: [
                  { type: "string" },
                  {
                    type: "object",
                    properties: {
                      path: {
                        type: "string",
                        description: "File path relative to workspace root",
                      },
                      status: {
                        type: "string",
                        enum: ["added", "modified", "deleted"],
                        description: "Git status of the file",
                      },
                    },
                    required: ["path", "status"],
                  },
                ],
              },
              description:
                "Array of file paths (strings) or file objects with path and status (added/modified/deleted)",
            },
            commitMessage: {
              type: "string",
              description:
                "Proposed commit message following the guidelines above",
            },
            reasoning: {
              type: "string",
              description:
                "Explanation of why these files were selected and why this commit message is appropriate",
            },
          },
          required: ["filesToStage", "commitMessage", "reasoning"],
        },
      });
    }

    // Tracker tools - always available
    builtInTools.push(
      {
        name: "tracker_list",
        description:
          "List tracker items (bugs, tasks, plans, ideas, decisions, etc.) with optional filtering. Returns a summary of each item. Use this to see what work items exist.",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: {
              type: "string",
              description:
                "Filter by item type (e.g., 'bug', 'task', 'plan', 'idea', 'decision')",
            },
            status: {
              type: "string",
              description:
                "Filter by status (e.g., 'to-do', 'in-progress', 'done')",
            },
            priority: {
              type: "string",
              description:
                "Filter by priority (e.g., 'low', 'medium', 'high', 'critical')",
            },
            archived: {
              type: "boolean",
              description: "Include archived items (default: false)",
            },
            search: {
              type: "string",
              description: "Search title and description text",
            },
            limit: {
              type: "number",
              description: "Maximum number of items to return (default: 50)",
            },
          },
        },
      },
      {
        name: "tracker_get",
        description:
          "Get a single tracker item with its full content (as markdown). Use this to read the detailed body of a bug, plan, task, etc.",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description: "The tracker item ID",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "tracker_create",
        description:
          "Create a new tracker item (bug, task, plan, idea, decision, or any custom type).",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: {
              type: "string",
              description:
                "Item type (e.g., 'bug', 'task', 'plan', 'idea', 'decision')",
            },
            title: {
              type: "string",
              description: "Item title",
            },
            description: {
              type: "string",
              description:
                "Plain text or markdown description (stored as rich content)",
            },
            status: {
              type: "string",
              description: "Status (default: 'to-do')",
            },
            priority: {
              type: "string",
              description:
                "Priority level (e.g., 'low', 'medium', 'high', 'critical')",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags for categorization",
            },
          },
          required: ["type", "title"],
        },
      },
      {
        name: "tracker_update",
        description:
          "Update an existing tracker item's metadata or content. Can change title, status, priority, tags, description, or archive state.",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description: "The tracker item ID to update",
            },
            title: {
              type: "string",
              description: "New title",
            },
            status: {
              type: "string",
              description: "New status",
            },
            priority: {
              type: "string",
              description: "New priority",
            },
            description: {
              type: "string",
              description: "New description content (replaces existing content)",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "New tags (replaces existing tags)",
            },
            archived: {
              type: "boolean",
              description: "Set archive state",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "tracker_link_session",
        description:
          "Link the current AI session to a tracker item. This creates a bidirectional reference between the session and the work item.",
        inputSchema: {
          type: "object" as const,
          properties: {
            trackerId: {
              type: "string",
              description: "The tracker item ID to link to this session",
            },
          },
          required: ["trackerId"],
        },
      }
    );

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

    if (extensionTools.length > 0) {
      const globalTools = extensionTools.filter(
        (t) => t.scope === "global"
      ).length;
      const editorTools = extensionTools.filter(
        (t) => t.scope === "editor"
      ).length;
      console.log(
        `[MCP Server] Including ${
          extensionTools.length
        } extension tools (${globalTools} global, ${editorTools} editor-scoped) for workspace: ${workspacePath}, file: ${
          currentFilePath || "none"
        }`
      );
    }

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

    return {
      tools: allTools,
    };
  });

  // Tool execution handler
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;
    // Log _meta to understand what IDs are available for proposal matching
    if (request.params._meta) {
      console.log(
        `[MCP Server] Tool called: ${name}, _meta:`,
        JSON.stringify(request.params._meta)
      );
    }

    // Strip MCP server prefix if present (Claude Code sends tools as mcp__nimbalyst__toolName)
    const toolName = name.replace(/^mcp__nimbalyst__/, "");

    switch (toolName) {
      case "applyDiff": {
        const typedArgs = args as
          | { filePath?: string; replacements?: any[] }
          | undefined;
        const targetFilePath = typedArgs?.filePath;

        if (!targetFilePath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: filePath is required for applyDiff",
              },
            ],
            isError: true,
          };
        }

        // Find the correct window for this file
        const targetWindow = await findWindowForFilePath(targetFilePath);
        if (targetWindow) {
          // Validate that the file is a markdown file
          if (!targetFilePath.endsWith(".md")) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: applyDiff can only modify markdown files (.md). Attempted to modify: ${targetFilePath}`,
                },
              ],
              isError: true,
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
                    type: "text",
                    text: "Timed out while waiting for diff to apply. The operation may still be in progress.",
                  },
                ],
                isError: true,
              });
            }, 30000);

            ipcMain.once(resultChannel, (event, result) => {
              clearTimeout(timeout);

              const success = result?.success ?? false;
              const error = result?.error;

              // Use the targetFilePath we determined earlier
              const filePath = targetFilePath || "untitled";

              resolve({
                content: [
                  {
                    type: "text",
                    text: success
                      ? `Successfully applied diff to ${filePath}`
                      : `Failed to apply diff: ${error || "Unknown error"}`,
                  },
                ],
                isError: !success,
              });
            });

            // Send the request with the result channel and target file path
            targetWindow.webContents.send("mcp:applyDiff", {
              replacements: typedArgs?.replacements,
              resultChannel,
              targetFilePath: targetFilePath,
            });
          });
        }
        return {
          content: [
            {
              type: "text",
              text: "Error: No window available for target file",
            },
          ],
          isError: true,
        };
      }

      case "streamContent": {
        const typedArgs = args as
          | {
              filePath?: string;
              content?: string;
              position?: string;
              insertAfter?: string;
            }
          | undefined;
        const targetFilePath = typedArgs?.filePath;

        if (!targetFilePath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: filePath is required for streamContent",
              },
            ],
            isError: true,
          };
        }

        // Find the correct window for this file
        const targetWindow = await findWindowForFilePath(targetFilePath);
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
                    type: "text",
                    text: "Timed out while waiting for content to stream. The operation may still be in progress.",
                  },
                ],
                isError: true,
              });
            }, 30000);

            ipcMain.once(resultChannel, (event, result) => {
              clearTimeout(timeout);

              const success = result?.success ?? false;
              const error = result?.error;

              // Use the targetFilePath we determined earlier
              const filePath = targetFilePath || "untitled";

              resolve({
                content: [
                  {
                    type: "text",
                    text: success
                      ? `Successfully streamed content to ${filePath}`
                      : `Failed to stream content: ${error || "Unknown error"}`,
                  },
                ],
                isError: !success,
              });
            });

            // Send IPC message to renderer with result channel

            targetWindow.webContents.send("mcp:streamContent", {
              streamId,
              content: typedArgs?.content,
              position: typedArgs?.position || "end",
              insertAfter: typedArgs?.insertAfter,
              targetFilePath: targetFilePath,
              resultChannel,
            });

          });
        }
        return {
          content: [
            {
              type: "text",
              text: "Error: No window available for target file",
            },
          ],
          isError: true,
        };
      }

      // TODO: Re-enable open_file case handler when the tool is working
      // case 'open_file': {
      //   const filePathArg = args?.file_path as string;
      //   // console.log('[MCP Server] open_file called with:', { file_path: filePathArg });

      //   // Validate file path
      //   if (!filePathArg || typeof filePathArg !== 'string') {
      //     return {
      //       content: [
      //         {
      //           type: 'text',
      //           text: 'Error: file_path is required and must be a string'
      //         }
      //       ],
      //       isError: true
      //     };
      //   }

      //   // Validate it's an absolute path
      //   if (!isAbsolute(filePathArg)) {
      //     return {
      //       content: [
      //         {
      //           type: 'text',
      //           text: `Error: file_path must be an absolute path. Got: ${filePathArg}`
      //         }
      //       ],
      //       isError: true
      //     };
      //   }

      //   // Validate file exists
      //   if (!existsSync(filePathArg)) {
      //     return {
      //       content: [
      //         {
      //           type: 'text',
      //           text: `Error: File does not exist: ${filePathArg}`
      //         }
      //       ],
      //       isError: true
      //     };
      //   }

      //   try {
      //     // Find which workspace contains this file
      //     // This is worktree-aware: checks both direct path matching and worktree/project relationships
      //     let fileWorkspacePath: string | undefined;

      //     // Check registered workspaces first
      //     for (const wsPath of workspaceToWindowMap.keys()) {
      //       if (isFileInWorkspaceOrWorktree(filePathArg, wsPath)) {
      //         if (!fileWorkspacePath || wsPath.length > fileWorkspacePath.length) {
      //           fileWorkspacePath = wsPath;
      //         }
      //       }
      //     }

      //     // Fallback to session workspaces
      //     if (!fileWorkspacePath) {
      //       for (const state of documentStateBySession.values()) {
      //         const wsPath = state.workspacePath;
      //         if (wsPath && isFileInWorkspaceOrWorktree(filePathArg, wsPath)) {
      //           if (!fileWorkspacePath || wsPath.length > fileWorkspacePath.length) {
      //             fileWorkspacePath = wsPath;
      //           }
      //         }
      //       }
      //     }

      //     if (!fileWorkspacePath) {
      //       return {
      //         content: [
      //           {
      //             type: 'text',
      //             text: `Error: File "${filePathArg}" does not belong to any open workspace. Please open the workspace first.`
      //           }
      //         ],
      //         isError: true
      //       };
      //     }

      //     // Find the window for this workspace (resolves worktree paths to parent project)
      //     const windowId = await findWindowIdForWorkspacePath(fileWorkspacePath);
      //     if (!windowId) {
      //       return {
      //         content: [
      //           {
      //             type: 'text',
      //             text: `Error: No window found for workspace "${fileWorkspacePath}"`
      //           }
      //         ],
      //         isError: true
      //       };
      //     }

      //     const targetWindow = BrowserWindow.fromId(windowId);
      //     if (!targetWindow || targetWindow.isDestroyed()) {
      //       return {
      //         content: [
      //           {
      //             type: 'text',
      //             text: `Error: Window no longer exists for workspace "${fileWorkspacePath}"`
      //           }
      //         ],
      //         isError: true
      //       };
      //     }

      //     // Register the workspace if not already registered
      //     if (!workspaceToWindowMap.has(fileWorkspacePath)) {
      //       workspaceToWindowMap.set(fileWorkspacePath, targetWindow.id);
      //       // console.log(`[MCP Server] Registered workspace ${fileWorkspacePath} -> window ${targetWindow.id}`);
      //     }

      //     // Send IPC to open the file
      //     targetWindow.webContents.send('file:open', { filePath: filePathArg });

      //     // console.log(`[MCP Server] Opened file: ${filePathArg} in window ${targetWindow.id}`);

      //     return {
      //       content: [
      //         {
      //           type: 'text',
      //           text: `Successfully opened file: ${filePathArg}`
      //         }
      //       ],
      //       isError: false
      //     };
      //   } catch (error) {
      //     console.error('[MCP Server] Failed to open file:', error);
      //     const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      //     return {
      //       content: [
      //         {
      //           type: 'text',
      //           text: `Error opening file: ${errorMessage}`
      //         }
      //       ],
      //       isError: true
      //     };
      //   }
      // }

      case "open_workspace": {
        const workspacePathArg = args?.workspace_path as string;

        // Validate workspace path
        if (!workspacePathArg || typeof workspacePathArg !== "string") {
          return {
            content: [
              {
                type: "text",
                text: "Error: workspace_path is required and must be a string",
              },
            ],
            isError: true,
          };
        }

        // Validate it's an absolute path
        if (!isAbsolute(workspacePathArg)) {
          return {
            content: [
              {
                type: "text",
                text: `Error: workspace_path must be an absolute path. Got: ${workspacePathArg}`,
              },
            ],
            isError: true,
          };
        }

        // Validate directory exists
        if (!existsSync(workspacePathArg)) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Workspace directory does not exist: ${workspacePathArg}`,
              },
            ],
            isError: true,
          };
        }

        try {
          // Import dynamically to avoid circular dependencies
          const { createWindow, findWindowByWorkspace } = await import(
            "../window/WindowManager"
          );

          // Check if workspace is already open - focus it instead of creating a duplicate
          const existingWindow = findWindowByWorkspace(workspacePathArg);
          if (existingWindow && !existingWindow.isDestroyed()) {
            if (existingWindow.isMinimized()) {
              existingWindow.restore();
            }
            existingWindow.focus();
            console.log(
              `[MCP Server] Focused existing workspace window: ${workspacePathArg}`
            );

            return {
              content: [
                {
                  type: "text",
                  text: `Workspace already open, brought to foreground: ${workspacePathArg}`,
                },
              ],
              isError: false,
            };
          }

          // No existing window - create a new one
          const newWindow = createWindow(false, true, workspacePathArg);

          // Register the workspace immediately
          workspaceToWindowMap.set(workspacePathArg, newWindow.id);
          console.log(
            `[MCP Server] Opened workspace: ${workspacePathArg}, registered as window ${newWindow.id}`
          );

          return {
            content: [
              {
                type: "text",
                text: `Successfully opened workspace: ${workspacePathArg}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.error("[MCP Server] Failed to open workspace:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";

          return {
            content: [
              {
                type: "text",
                text: `Error opening workspace: ${errorMessage}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "capture_editor_screenshot": {
        const filePath = args?.file_path as string | undefined;
        const selector = args?.selector as string | undefined;


        if (!filePath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: file_path is required for capture_editor_screenshot",
              },
            ],
            isError: true,
          };
        }

        try {
          // Find which workspace contains this file path
          // This is worktree-aware: checks both direct path matching and worktree/project relationships
          let fileWorkspacePath: string | undefined;

          for (const wsPath of workspaceToWindowMap.keys()) {
            if (isFileInWorkspaceOrWorktree(filePath, wsPath)) {
              if (
                !fileWorkspacePath ||
                wsPath.length > fileWorkspacePath.length
              ) {
                fileWorkspacePath = wsPath;
              }
            }
          }

          // Fallback: Check all session workspaces
          if (!fileWorkspacePath) {
            for (const state of documentStateBySession.values()) {
              const wsPath = state.workspacePath;
              if (wsPath && isFileInWorkspaceOrWorktree(filePath, wsPath)) {
                if (
                  !fileWorkspacePath ||
                  wsPath.length > fileWorkspacePath.length
                ) {
                  fileWorkspacePath = wsPath;
                }
              }
            }
          }

          if (!fileWorkspacePath) {
            const registeredWorkspaces = Array.from(
              workspaceToWindowMap.keys()
            );
            const sessionWorkspaces = Array.from(
              documentStateBySession.values()
            )
              .map((s) => s.workspacePath)
              .filter(Boolean);
            const allWorkspaces = [
              ...new Set([...registeredWorkspaces, ...sessionWorkspaces]),
            ];
            const availableWorkspaces = allWorkspaces.join(", ") || "none";
            return {
              content: [
                {
                  type: "text",
                  text: `Error: File "${filePath}" does not belong to any open workspace. Available workspaces: ${availableWorkspaces}`,
                },
              ],
              isError: true,
            };
          }


          // Use offscreen editor system for screenshot
          // This will mount the editor offscreen if needed, capture, and unmount
          const { OffscreenEditorManager } = await import(
            "../services/OffscreenEditorManager"
          );
          const manager = OffscreenEditorManager.getInstance();

          const imageBuffer = await manager.captureScreenshot(
            filePath,
            fileWorkspacePath,
            selector
          );
          const imageBase64 = imageBuffer.toString("base64");

          const result = {
            success: true,
            imageBase64,
            mimeType: "image/png",
          };

          // Validate that we actually got image data
          // This prevents the API error: "image cannot be empty"
          if (!result.imageBase64 || result.imageBase64.length === 0) {
            console.error(
              "[MCP Server] Editor screenshot returned empty base64 data"
            );
            return {
              content: [
                {
                  type: "text",
                  text: "Error: Screenshot capture returned empty image data. The editor element may not have rendered properly or the capture failed silently.",
                },
              ],
              isError: true,
            };
          }


          // Compress image if needed (reuse mockup compression logic)
          const compressed = compressImageIfNeeded(
            result.imageBase64,
            result.mimeType || "image/png"
          );

          const finalSizeBytes = Math.floor((compressed.data.length * 3) / 4);

          return {
            content: [
              {
                type: "image",
                data: compressed.data,
                mimeType: compressed.mimeType,
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.error(
            "[MCP Server] Failed to capture editor screenshot:",
            error
          );
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";

          return {
            content: [
              {
                type: "text",
                text: `Error capturing editor screenshot: ${errorMessage}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "display_to_user": {
        // Types for the new array-based schema
        type ImageContent = {
          path: string;
        };

        type ErrorBarsConfig = {
          dataKey?: string;
          errorKey?: string;
          errorKeyLower?: string;
          errorKeyUpper?: string;
          strokeWidth?: number;
        };

        type ChartContent = {
          chartType: "bar" | "line" | "pie" | "area" | "scatter";
          data: Record<string, unknown>[];
          xAxisKey: string;
          yAxisKey: string | string[];
          colors?: string[];
          errorBars?: ErrorBarsConfig;
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
            content: [
              {
                type: "text",
                text: 'Error: "items" array is required. Provide an array of display items, each with a description and either an "image" or "chart" object.',
              },
            ],
            isError: true,
          };
        }

        if (!Array.isArray(typedArgs.items)) {
          return {
            content: [
              {
                type: "text",
                text: 'Error: "items" must be an array of display items.',
              },
            ],
            isError: true,
          };
        }

        if (typedArgs.items.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: 'Error: "items" array must contain at least one item.',
              },
            ],
            isError: true,
          };
        }

        // Validate each item
        const validChartTypes = ["bar", "line", "pie", "area", "scatter"];
        const displayedItems: string[] = [];

        for (let i = 0; i < typedArgs.items.length; i++) {
          const item = typedArgs.items[i];
          const itemPrefix = `items[${i}]`;

          // Validate description
          if (!item.description || typeof item.description !== "string") {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${itemPrefix} is missing required "description" field.`,
                },
              ],
              isError: true,
            };
          }

          // Check that exactly one content type is provided
          const hasImage = !!item.image;
          const hasChart = !!item.chart;

          if (!hasImage && !hasChart) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${itemPrefix} must have either an "image" or "chart" object. Description: "${item.description}"`,
                },
              ],
              isError: true,
            };
          }

          if (hasImage && hasChart) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${itemPrefix} has both "image" and "chart" - provide only one content type per item.`,
                },
              ],
              isError: true,
            };
          }

          // Validate image content
          if (hasImage) {
            if (!item.image!.path || typeof item.image!.path !== "string") {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: ${itemPrefix}.image.path is required and must be a string.`,
                  },
                ],
                isError: true,
              };
            }

            const imagePath = item.image!.path;

            // Check if path looks like a URL (common mistake)
            if (
              imagePath.startsWith("http://") ||
              imagePath.startsWith("https://") ||
              imagePath.startsWith("data:")
            ) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: ${itemPrefix}.image.path must be a LOCAL file path, not a URL. Got: "${imagePath.substring(
                      0,
                      100
                    )}${
                      imagePath.length > 100 ? "..." : ""
                    }". Download the image to a local file first, then provide the absolute path to that file.`,
                  },
                ],
                isError: true,
              };
            }

            // Validate path is absolute (prevents relative path traversal)
            if (!isAbsolute(imagePath)) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: ${itemPrefix}.image.path must be an ABSOLUTE local file path (e.g., "/Users/name/image.png"), not a relative path. Got: "${imagePath}"`,
                  },
                ],
                isError: true,
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
                content: [
                  {
                    type: "text",
                    text: `Error: ${itemPrefix}.chart.chartType is required.`,
                  },
                ],
                isError: true,
              };
            }

            if (!validChartTypes.includes(chart.chartType)) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: ${itemPrefix}.chart.chartType must be one of: ${validChartTypes.join(
                      ", "
                    )}. Got: "${chart.chartType}"`,
                  },
                ],
                isError: true,
              };
            }

            if (
              !chart.data ||
              !Array.isArray(chart.data) ||
              chart.data.length === 0
            ) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: ${itemPrefix}.chart.data must be a non-empty array.`,
                  },
                ],
                isError: true,
              };
            }

            if (!chart.xAxisKey || typeof chart.xAxisKey !== "string") {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: ${itemPrefix}.chart.xAxisKey is required.`,
                  },
                ],
                isError: true,
              };
            }

            if (!chart.yAxisKey) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: ${itemPrefix}.chart.yAxisKey is required.`,
                  },
                ],
                isError: true,
              };
            }

            // Validate error bars if provided
            if (chart.errorBars) {
              const errorBars = chart.errorBars as Record<string, unknown>;

              // Check that we have either symmetric or asymmetric error data
              const hasSymmetric = typeof errorBars.errorKey === "string";
              const hasAsymmetric =
                typeof errorBars.errorKeyLower === "string" &&
                typeof errorBars.errorKeyUpper === "string";

              if (!hasSymmetric && !hasAsymmetric) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error: ${itemPrefix}.chart.errorBars must have either "errorKey" (for symmetric errors) or both "errorKeyLower" and "errorKeyUpper" (for asymmetric errors).`,
                    },
                  ],
                  isError: true,
                };
              }

              if (hasSymmetric && hasAsymmetric) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error: ${itemPrefix}.chart.errorBars cannot have both "errorKey" and "errorKeyLower"/"errorKeyUpper". Use one or the other.`,
                    },
                  ],
                  isError: true,
                };
              }

              // Validate strokeWidth if provided
              if (
                errorBars.strokeWidth !== undefined &&
                typeof errorBars.strokeWidth !== "number"
              ) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error: ${itemPrefix}.chart.errorBars.strokeWidth must be a number.`,
                    },
                  ],
                  isError: true,
                };
              }

              // Validate dataKey if provided (used for multi-series charts)
              if (
                errorBars.dataKey !== undefined &&
                typeof errorBars.dataKey !== "string"
              ) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error: ${itemPrefix}.chart.errorBars.dataKey must be a string.`,
                    },
                  ],
                  isError: true,
                };
              }

              // Pie charts don't support error bars
              if (chart.chartType === "pie") {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error: ${itemPrefix}.chart.errorBars is not supported for pie charts.`,
                    },
                  ],
                  isError: true,
                };
              }
            }

            displayedItems.push(
              `${chart.chartType} chart: ${item.description}`
            );
          }
        }


        return {
          content: [
            {
              type: "text",
              text: `Displayed ${
                typedArgs.items.length
              } item(s):\n${displayedItems.map((d) => `- ${d}`).join("\n")}`,
            },
          ],
          isError: false,
        };
      }

      case "voice_agent_speak": {
        const message = args?.message as string | undefined;

        if (!message || typeof message !== "string") {
          return {
            content: [
              {
                type: "text",
                text: "Error: message parameter is required and must be a string",
              },
            ],
            isError: true,
          };
        }

        // Get the active voice session directly - works regardless of document state
        const activeVoiceSessionId = getActiveVoiceSessionId();

        if (!activeVoiceSessionId) {
          return {
            content: [
              {
                type: "text",
                text: "Voice mode is not currently active. The message cannot be spoken aloud. You can still respond to the user via text in the normal way.",
              },
            ],
            isError: false, // Not a hard error - just means voice mode isn't active
          };
        }

        // Debug logging - uncomment if needed for troubleshooting voice message routing

        // Attempt to send message to voice agent
        const success = sendToVoiceAgent(activeVoiceSessionId, message);

        if (!success) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to send message to voice agent. The voice connection may have been lost or disconnected. You can still respond to the user via text in the normal way.`,
              },
            ],
            isError: false, // Not a hard error - voice agent just isn't reachable
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Message queued for voice agent: "${message.substring(
                0,
                100
              )}${message.length > 100 ? "..." : ""}"`,
            },
          ],
          isError: false,
        };
      }

      case "voice_agent_stop": {
        // Stop the active voice session
        const wasActive = stopVoiceSession();

        if (wasActive) {
          return {
            content: [
              {
                type: "text",
                text: "Voice mode session has been stopped successfully.",
              },
            ],
            isError: false,
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: "No active voice mode session to stop.",
              },
            ],
            isError: false, // Not a hard error - just means no session was active
          };
        }
      }

      case "get_session_edited_files": {
        // Return the list of files edited during this session
        if (!sessionId) {
          return {
            content: [
              {
                type: "text",
                text: "Error: No session ID available. This tool is only available during an active AI session.",
              },
            ],
            isError: true,
          };
        }

        try {
          const files = await SessionFilesRepository.getFilesBySession(
            sessionId,
            "edited"
          );
          const filePaths = files.map((f) => f.filePath);

          if (filePaths.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No files have been edited in this session yet.",
                },
              ],
              isError: false,
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `Files edited in this session (${
                  filePaths.length
                }):\n${filePaths.map((p) => `- ${p}`).join("\n")}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.error(
            "[MCP Server] Failed to get session edited files:",
            error
          );
          return {
            content: [
              {
                type: "text",
                text: `Error getting session files: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }

      case "developer_git_commit_proposal":
      case "developer.git_commit_proposal": {
        // Git commit proposal tool - waits for user confirmation before returning
        // This allows Claude to see the final result (committed/cancelled)
        type FileToStage =
          | string
          | { path: string; status: "added" | "modified" | "deleted" };
        const proposalArgs = args as
          | {
              filesToStage?: FileToStage[];
              commitMessage?: string;
              reasoning?: string;
            }
          | undefined;

        if (!proposalArgs?.filesToStage || !proposalArgs?.commitMessage) {
          return {
            content: [
              {
                type: "text",
                text: "Error: filesToStage and commitMessage are required",
              },
            ],
            isError: true,
          };
        }

        if (!workspacePath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: workspacePath is required for git commit proposal",
              },
            ],
            isError: true,
          };
        }

        // Find the target window (resolves worktree paths to parent project)
        const commitWindowId = await findWindowIdForWorkspacePath(
          workspacePath
        );
        if (!commitWindowId) {
          return {
            content: [
              {
                type: "text",
                text: `Error: No window found for workspace: ${workspacePath}`,
              },
            ],
            isError: true,
          };
        }

        const commitWindow = BrowserWindow.fromId(commitWindowId);
        if (!commitWindow || commitWindow.isDestroyed()) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Window no longer exists",
              },
            ],
            isError: true,
          };
        }

        // Use provider tool-call ID as the proposal ID when available so widget
        // responses can resolve the exact pending MCP call.
        const requestMeta =
          request.params && typeof request.params._meta === "object"
            ? (request.params._meta as Record<string, unknown>)
            : undefined;
        const toolUseId = (
          [
            requestMeta?.["claudecode/toolUseId"],
            requestMeta?.["openai/toolUseId"],
            requestMeta?.["openai/toolCallId"],
            requestMeta?.["toolUseId"],
            requestMeta?.["tool_use_id"],
            requestMeta?.["toolCallId"],
            typeof request.id === "string" ? request.id : undefined,
          ].find((value) => typeof value === "string" && value.length > 0) as
            | string
            | undefined
        );
        const proposalId =
          toolUseId ||
          `git-commit-proposal-${Date.now()}-${Math.random()
            .toString(36)
            .substring(7)}`;

        // Persist the proposal to database for durability
        const targetSessionId = sessionId || "unknown";

        try {
          const now = new Date();
          await AgentMessagesRepository.create({
            sessionId: targetSessionId,
            source: "mcp",
            direction: "output",
            content: JSON.stringify({
              type: "git_commit_proposal",
              proposalId,
              toolUseId, // Store for matching with widget's toolCall.id
              filesToStage: proposalArgs.filesToStage,
              commitMessage: proposalArgs.commitMessage,
              reasoning: proposalArgs.reasoning,
              workspacePath,
              timestamp: now.getTime(),
              status: "pending",
            }),
            hidden: false,
            createdAt: now,
          });
          // Notify renderer to refresh pending prompts
          console.log(
            `[MCP Server] Persisted git commit proposal: ${proposalId}, notifying renderer for session: ${targetSessionId}`
          );
          if (commitWindow) {
            commitWindow.webContents.send("ai:gitCommitProposal", {
              sessionId: targetSessionId,
              proposalId,
            });
          } else {
            console.warn(
              "[MCP Server] No commitWindow found to send IPC event"
            );
          }

          // Notify tray of pending prompt
          TrayManager.getInstance().onPromptCreated(targetSessionId);
        } catch (error) {
          console.error(
            "[MCP Server] Failed to persist git commit proposal:",
            error
          );
          // Continue anyway - worst case is no durability
        }

        // Check if auto-commit is enabled - if so, commit directly without waiting for UI
        let isAutoCommit = false;
        try {
          const Store = (await import("electron-store")).default;
          const aiSettingsStore = new Store({ name: "ai-settings" });
          isAutoCommit = aiSettingsStore.get(
            "autoCommitEnabled",
            false
          ) as boolean;
        } catch {
          // If we can't read settings, fall through to manual mode
        }

        if (isAutoCommit) {
          console.log(
            `[MCP Server] Auto-commit enabled, executing commit directly for proposal: ${proposalId}`
          );

          const getFilePath = (f: FileToStage) =>
            typeof f === "string" ? f : f.path;
          const filePaths = proposalArgs.filesToStage!.map(getFilePath);
          const commitMessage = proposalArgs.commitMessage!;

          try {
            const simpleGit = (await import("simple-git")).default;
            const { gitOperationLock } = await import(
              "../services/GitOperationLock"
            );

            const commitResult = await gitOperationLock.withLock(
              workspacePath,
              "git:commit",
              async () => {
                const git = simpleGit(workspacePath);

                // Reset staging area, then add only selected files
                try {
                  await git.reset(["HEAD"]);
                } catch {
                  // May fail in fresh repo with no commits - that's OK
                }
                await git.add(filePaths);

                // Commit
                return await git.commit(commitMessage);
              }
            );

            // Get commit date
            let commitDate: string | undefined;
            if (commitResult.commit) {
              try {
                const git = simpleGit(workspacePath);
                const showResult = await git.show([
                  commitResult.commit,
                  "--no-patch",
                  "--format=%aI",
                ]);
                commitDate = showResult.trim();
              } catch {
                // Non-critical
              }
            }

            const response = {
              action: (commitResult.commit
                ? "committed"
                : "cancelled") as "committed" | "cancelled",
              commitHash: commitResult.commit || undefined,
              commitDate,
              error: commitResult.commit
                ? undefined
                : "No changes were committed",
              filesCommitted: commitResult.commit ? filePaths : undefined,
              commitMessage: commitResult.commit ? commitMessage : undefined,
            };

            // Persist the response to DB
            const { database } = await import(
              "../database/PGLiteDatabaseWorker"
            );
            const timestamp = Date.now();
            const responseContent = {
              type: "git_commit_proposal_response",
              proposalId,
              ...response,
              respondedAt: timestamp,
              respondedBy: "auto_commit",
            };
            await database.query(
              `INSERT INTO ai_agent_messages (session_id, source, direction, content, created_at, hidden)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                targetSessionId,
                "nimbalyst",
                "output",
                JSON.stringify(responseContent),
                new Date(timestamp),
                false,
              ]
            );

            // Notify renderer to clear the pending interactive prompt indicator
            if (commitWindow && !commitWindow.isDestroyed()) {
              commitWindow.webContents.send("ai:gitCommitProposalResolved", {
                sessionId: targetSessionId,
                proposalId,
              });
              // Also send the proposal to renderer so the widget shows the result
              commitWindow.webContents.send("mcp:gitCommitProposal", {
                proposalId,
                workspacePath,
                sessionId: targetSessionId,
                filesToStage: proposalArgs.filesToStage,
                commitMessage: proposalArgs.commitMessage,
                reasoning: proposalArgs.reasoning,
              });
            }

            console.log(
              `[MCP Server] Auto-commit completed: ${
                commitResult.commit || "no changes"
              }`
            );

            // Return the result directly (no need for the promise/ipcMain.once flow)
            if (response.action === "committed" && response.commitHash) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Auto-committed ${filePaths.length} file(s).\nCommit hash: ${
                      response.commitHash
                    }${
                      response.commitDate
                        ? `\nCommit date: ${response.commitDate}`
                        : ""
                    }\nCommit message: ${commitMessage}`,
                  },
                ],
                isError: false,
              };
            } else {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Auto-commit failed: ${
                      response.error || "No changes were committed"
                    }`,
                  },
                ],
                isError: true,
              };
            }
          } catch (error) {
            console.error("[MCP Server] Auto-commit failed:", error);
            // Fall through to manual mode on error
          }
        }

        // Show OS notification if app is backgrounded
        // Get session title for notification body
        let sessionTitle = "AI Session";
        try {
          const session = await AISessionsRepository.get(targetSessionId);
          if (session?.title) {
            sessionTitle = session.title;
          }
        } catch {
          // Ignore - use default title
        }
        notificationService.showBlockedNotification(
          targetSessionId,
          sessionTitle,
          "git_commit",
          workspacePath
        );

        // Wait indefinitely for user confirmation.
        // The user may step away and return hours or days later — no timeout.
        return new Promise((resolve) => {
          // Helper to extract file path from string or object
          const getFilePath = (f: FileToStage) =>
            typeof f === "string" ? f : f.path;

          // Listen for response via unified handler (SessionHandlers persists to DB)
          ipcMain.once(
            proposalId,
            async (
              _event,
              result: {
                action: "committed" | "cancelled";
                commitHash?: string;
                commitDate?: string;
                error?: string;
                filesCommitted?: string[];
                commitMessage?: string;
              }
            ) => {

              if (result.action === "committed" && result.commitHash) {
                // Only report success if we have a valid commit hash
                const filesCount =
                  result.filesCommitted?.length ||
                  proposalArgs.filesToStage!.map(getFilePath).length;
                resolve({
                  content: [
                    {
                      type: "text",
                      text: `User confirmed and committed ${filesCount} file(s).\nCommit hash: ${
                        result.commitHash
                      }${
                        result.commitDate
                          ? `\nCommit date: ${result.commitDate}`
                          : ""
                      }\nCommit message: ${
                        result.commitMessage || proposalArgs.commitMessage
                      }`,
                    },
                  ],
                  isError: false,
                });
              } else if (result.action === "committed" && !result.commitHash) {
                // Widget reported committed but no hash - something went wrong
                resolve({
                  content: [
                    {
                      type: "text",
                      text: `Commit failed: No commit hash returned. The files may not have been staged correctly.`,
                    },
                  ],
                  isError: true,
                });
              } else {
                resolve({
                  content: [
                    {
                      type: "text",
                      text: result.error
                        ? `Commit failed: ${result.error}`
                        : "User cancelled the commit proposal.",
                    },
                  ],
                  isError: result.error ? true : false,
                });
              }
            }
          );

          // Send the proposal to the renderer
          // IMPORTANT: sessionId is required to properly scope proposals when multiple sessions are running
          commitWindow.webContents.send("mcp:gitCommitProposal", {
            proposalId,
            workspacePath,
            sessionId: sessionId || "unknown", // Must include sessionId for proper scoping
            filesToStage: proposalArgs.filesToStage,
            commitMessage: proposalArgs.commitMessage,
            reasoning: proposalArgs.reasoning,
          });
        });
      }

      case "tracker_list": {
        try {
          const { getDatabase } = await import("../database/initialize");
          const db = getDatabase();
          const typedArgs = args as {
            type?: string;
            status?: string;
            priority?: string;
            archived?: boolean;
            search?: string;
            limit?: number;
          };

          const conditions: string[] = [];
          const params: any[] = [];
          let paramIdx = 1;

          // Always scope to workspace
          if (workspacePath) {
            conditions.push(`workspace = $${paramIdx++}`);
            params.push(workspacePath);
          }

          // Filter by archived state (default: exclude archived)
          if (args.archived) {
            conditions.push(`archived = TRUE`);
          } else {
            conditions.push(`(archived = FALSE OR archived IS NULL)`);
          }

          // Filter by type
          if (args.type) {
            conditions.push(`type = $${paramIdx++}`);
            params.push(args.type);
          }

          // Filter by status (stored in JSONB data field)
          if (args.status) {
            conditions.push(`data->>'status' = $${paramIdx++}`);
            params.push(args.status);
          }

          // Filter by priority (stored in JSONB data field)
          if (args.priority) {
            conditions.push(`data->>'priority' = $${paramIdx++}`);
            params.push(args.priority);
          }

          // Search title and description
          if (args.search) {
            conditions.push(
              `(data->>'title' ILIKE $${paramIdx} OR data->>'description' ILIKE $${paramIdx})`
            );
            params.push(`%${args.search}%`);
            paramIdx++;
          }

          const limit = Math.min(args.limit || 50, 250);
          const whereClause =
            conditions.length > 0
              ? `WHERE ${conditions.join(" AND ")}`
              : "";

          const result = await db.query<any>(
            `SELECT id, type, data, archived, source, source_ref, updated
             FROM tracker_items
             ${whereClause}
             ORDER BY updated DESC
             LIMIT ${limit}`,
            params
          );

          const items = result.rows.map((row: any) => {
            const data =
              typeof row.data === "string"
                ? JSON.parse(row.data)
                : row.data || {};
            return {
              id: row.id,
              type: row.type,
              title: data.title || "",
              status: data.status || "",
              priority: data.priority || "",
              tags: data.tags || [],
              archived: row.archived ?? false,
              source: row.source || "native",
              updated: row.updated,
            };
          });

          const summary = items
            .map(
              (item: any) =>
                `- [${item.type}] ${item.title} (${item.status || "no status"}, ${item.priority || "no priority"}) [id: ${item.id}]`
            )
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text:
                  items.length > 0
                    ? `Found ${items.length} tracker item(s):\n\n${summary}`
                    : "No tracker items found matching the filters.",
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.error("[MCP Server] tracker_list failed:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error listing tracker items: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "tracker_get": {
        try {
          const { getDatabase } = await import("../database/initialize");
          const db = getDatabase();
          const typedArgs = args as { id: string };

          const result = await db.query<any>(
            `SELECT * FROM tracker_items WHERE id = $1`,
            [args.id]
          );

          if (result.rows.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `Tracker item not found: ${args.id}`,
                },
              ],
              isError: true,
            };
          }

          const row = result.rows[0];
          const data =
            typeof row.data === "string"
              ? JSON.parse(row.data)
              : row.data || {};

          // Build a readable representation
          const lines: string[] = [];
          lines.push(`# ${data.title || "Untitled"}`);
          lines.push("");
          lines.push(`**Type**: ${row.type}`);
          if (data.status) lines.push(`**Status**: ${data.status}`);
          if (data.priority) lines.push(`**Priority**: ${data.priority}`);
          if (data.tags?.length)
            lines.push(`**Tags**: ${data.tags.join(", ")}`);
          if (data.owner) lines.push(`**Owner**: ${data.owner}`);
          if (row.archived) lines.push(`**Archived**: yes`);
          if (row.source && row.source !== "native")
            lines.push(
              `**Source**: ${row.source}${row.source_ref ? ` (${row.source_ref})` : ""}`
            );
          if (data.linkedSessions?.length)
            lines.push(
              `**Linked Sessions**: ${data.linkedSessions.join(", ")}`
            );
          lines.push(`**ID**: ${row.id}`);
          lines.push(`**Updated**: ${row.updated}`);
          lines.push("");

          // Include content as markdown
          if (row.content) {
            const content =
              typeof row.content === "string"
                ? row.content
                : JSON.stringify(row.content);
            lines.push("---");
            lines.push("");
            lines.push(content);
          } else if (data.description) {
            lines.push("---");
            lines.push("");
            lines.push(data.description);
          }

          return {
            content: [
              {
                type: "text",
                text: lines.join("\n"),
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.error("[MCP Server] tracker_get failed:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error getting tracker item: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "tracker_create": {
        try {
          const { getDatabase } = await import("../database/initialize");
          const db = getDatabase();
          const typedArgs = args as {
            type: string;
            title: string;
            description?: string;
            status?: string;
            priority?: string;
            tags?: string[];
          };

          if (!workspacePath) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: No workspace path available. Cannot create tracker item.",
                },
              ],
              isError: true,
            };
          }

          const id = `${args.type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const data: Record<string, any> = {
            title: args.title,
            status: args.status || "to-do",
            priority: args.priority || "medium",
            created: new Date().toISOString().split("T")[0],
          };
          if (args.tags?.length) data.tags = args.tags;
          if (args.description) data.description = args.description;

          const contentJson = args.description
            ? JSON.stringify(args.description)
            : null;

          await db.query(
            `INSERT INTO tracker_items (
              id, type, data, workspace, document_path, line_number,
              created, updated, last_indexed, sync_status,
              content, archived, source, source_ref
            ) VALUES ($1, $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'pending', $5, FALSE, 'native', NULL)`,
            [id, args.type, JSON.stringify(data), workspacePath, contentJson]
          );

          // Notify renderer of the new item
          const { BrowserWindow } = await import("electron");
          const windows = BrowserWindow.getAllWindows();
          for (const win of windows) {
            if (!win.isDestroyed()) {
              win.webContents.send("tracker-items-changed", {
                workspacePath,
              });
            }
          }

          return {
            content: [
              {
                type: "text",
                text: `Created tracker item:\n- **Type**: ${args.type}\n- **Title**: ${args.title}\n- **Status**: ${data.status}\n- **ID**: ${id}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.error("[MCP Server] tracker_create failed:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error creating tracker item: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "tracker_update": {
        try {
          const { getDatabase } = await import("../database/initialize");
          const db = getDatabase();
          const typedArgs = args as {
            id: string;
            title?: string;
            status?: string;
            priority?: string;
            description?: string;
            tags?: string[];
            archived?: boolean;
          };

          // Read existing item
          const existing = await db.query<any>(
            `SELECT * FROM tracker_items WHERE id = $1`,
            [args.id]
          );
          if (existing.rows.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `Tracker item not found: ${args.id}`,
                },
              ],
              isError: true,
            };
          }

          const row = existing.rows[0];
          const data =
            typeof row.data === "string"
              ? JSON.parse(row.data)
              : row.data || {};

          // Apply updates to data JSONB
          if (args.title !== undefined) data.title = args.title;
          if (args.status !== undefined) data.status = args.status;
          if (args.priority !== undefined) data.priority = args.priority;
          if (args.tags !== undefined) data.tags = args.tags;
          if (args.description !== undefined)
            data.description = args.description;

          // Update data field
          await db.query(
            `UPDATE tracker_items SET data = $1, updated = NOW() WHERE id = $2`,
            [JSON.stringify(data), args.id]
          );

          // Update content if description changed
          if (args.description !== undefined) {
            const contentJson = JSON.stringify(args.description);
            await db.query(
              `UPDATE tracker_items SET content = $1 WHERE id = $2`,
              [contentJson, args.id]
            );
          }

          // Handle archive state
          if (args.archived !== undefined) {
            await db.query(
              `UPDATE tracker_items SET archived = $1, archived_at = $2 WHERE id = $3`,
              [
                args.archived,
                args.archived ? new Date().toISOString() : null,
                args.id,
              ]
            );
          }

          // Notify renderer
          const { BrowserWindow } = await import("electron");
          const windows = BrowserWindow.getAllWindows();
          for (const win of windows) {
            if (!win.isDestroyed()) {
              win.webContents.send("tracker-items-changed", {
                workspacePath,
              });
            }
          }

          return {
            content: [
              {
                type: "text",
                text: `Updated tracker item ${args.id}:\n${
                  args.title !== undefined ? `- **Title**: ${args.title}\n` : ""
                }${
                  args.status !== undefined
                    ? `- **Status**: ${args.status}\n`
                    : ""
                }${
                  args.priority !== undefined
                    ? `- **Priority**: ${args.priority}\n`
                    : ""
                }${
                  args.archived !== undefined
                    ? `- **Archived**: ${args.archived}\n`
                    : ""
                }${
                  args.tags !== undefined
                    ? `- **Tags**: ${args.tags.join(", ")}\n`
                    : ""
                }`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.error("[MCP Server] tracker_update failed:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error updating tracker item: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "tracker_link_session": {
        try {
          const { getDatabase } = await import("../database/initialize");
          const db = getDatabase();
          const typedArgs = args as { trackerId: string };

          if (!sessionId) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: No session ID available. This tool is only available during an active AI session.",
                },
              ],
              isError: true,
            };
          }

          // Read existing item
          const existing = await db.query<any>(
            `SELECT * FROM tracker_items WHERE id = $1`,
            [args.trackerId]
          );
          if (existing.rows.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `Tracker item not found: ${args.trackerId}`,
                },
              ],
              isError: true,
            };
          }

          const row = existing.rows[0];
          const data =
            typeof row.data === "string"
              ? JSON.parse(row.data)
              : row.data || {};

          // Add session to linkedSessions array
          const linkedSessions: string[] = data.linkedSessions || [];
          if (!linkedSessions.includes(sessionId)) {
            linkedSessions.push(sessionId);
            data.linkedSessions = linkedSessions;

            await db.query(
              `UPDATE tracker_items SET data = $1, updated = NOW() WHERE id = $2`,
              [JSON.stringify(data), args.trackerId]
            );
          }

          // Notify renderer
          const { BrowserWindow } = await import("electron");
          const windows = BrowserWindow.getAllWindows();
          for (const win of windows) {
            if (!win.isDestroyed()) {
              win.webContents.send("tracker-items-changed", {
                workspacePath,
              });
            }
          }

          return {
            content: [
              {
                type: "text",
                text: `Linked session ${sessionId} to tracker item ${args.trackerId}. Total linked sessions: ${linkedSessions.length}`,
              },
            ],
            isError: false,
          };
        } catch (error) {
          console.error(
            "[MCP Server] tracker_link_session failed:",
            error
          );
          return {
            content: [
              {
                type: "text",
                text: `Error linking session: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      default: {
        // Check if this is an extension tool - use session-specific state
        const currentDocState = sessionId
          ? documentStateBySession.get(sessionId)
          : undefined;
        const extensionTools = await getAvailableExtensionTools(
          workspacePath,
          currentDocState?.filePath
        );

        const extensionTool = extensionTools.find((t) => t.name === toolName);
        if (!extensionTool) {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }

        // Execute extension tool via IPC to renderer

        // workspacePath is REQUIRED - extension tools must be routed to the correct window
        if (!workspacePath) {
          return {
            content: [
              {
                type: "text",
                text: `Error: workspacePath is required to execute extension tools`,
              },
            ],
            isError: true,
          };
        }

        // Find the correct window for this workspace (resolves worktree paths to parent project)
        const windowId = await findWindowIdForWorkspacePath(workspacePath);
        if (!windowId) {
          return {
            content: [
              {
                type: "text",
                text: `Error: No window found for workspace: ${workspacePath}`,
              },
            ],
            isError: true,
          };
        }

        const targetWindow = BrowserWindow.fromId(windowId);
        if (!targetWindow) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Window no longer exists`,
              },
            ],
            isError: true,
          };
        }

        // Create a unique channel for the result
        const resultChannel = `mcp-extension-result-${Date.now()}-${Math.random()}`;

        // activeFilePath comes from currentDocState declared at the start of this block
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
            ].join("\n");

            resolve({
              content: [
                {
                  type: "text",
                  text: timeoutMessage,
                },
              ],
              isError: true,
            });
          }, TOOL_TIMEOUT_MS);

          ipcMain.once(resultChannel, (_event, result) => {
            clearTimeout(timeout);

            // Handle different result formats:
            // 1. { success: true/false, message?, data?, error? } - explicit format
            // 2. { error: "message" } - error format
            // 3. { ...data } - implicit success (any object without error field)
            const hasExplicitSuccess = typeof result?.success === "boolean";
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
                  responseText +=
                    "\n\nData: " + JSON.stringify(result.data, null, 2);
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
                if (resultToolName)
                  errorParts.push(`  Tool: ${resultToolName}`);
                errorParts.push("");
              }

              // Main error message
              errorParts.push(
                `Error: ${
                  result?.error || result?.message || "Tool execution failed"
                }`
              );

              // Stack trace (truncated to avoid overwhelming the response)
              if (stack) {
                const truncatedStack = stack.split("\n").slice(0, 8).join("\n");
                errorParts.push("");
                errorParts.push("Stack trace:");
                errorParts.push(truncatedStack);
                if (stack.split("\n").length > 8) {
                  errorParts.push("  ... (truncated)");
                }
              }

              // Additional context
              if (errorContext && Object.keys(errorContext).length > 0) {
                errorParts.push("");
                errorParts.push("Context:");
                for (const [key, value] of Object.entries(errorContext)) {
                  if (value !== undefined && value !== null) {
                    const valueStr =
                      typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value);
                    errorParts.push(`  ${key}: ${valueStr}`);
                  }
                }
              }

              responseText = errorParts.join("\n");
            }

            //   success,
            //   hasError,
            //   extensionId,
            //   toolName: resultToolName,
            //   result: JSON.stringify(result).substring(0, 200)
            // });

            resolve({
              content: [
                {
                  type: "text",
                  text: responseText,
                },
              ],
              isError: !success,
            });
          });

          // Send IPC to renderer to execute the tool
          targetWindow.webContents.send("mcp:executeExtensionTool", {
            toolName,
            args: args || {},
            resultChannel,
            context: {
              workspacePath,
              activeFilePath,
            },
          });
        });
      }
    }
  });

  return server;
}

function registerWorkspaceMappingForConnection(
  workspacePath: string | undefined
): void {
  if (!workspacePath) {
    return;
  }

  // Async registration - don't await, just fire and forget.
  findWindowIdForWorkspacePath(workspacePath)
    .then((windowId) => {
      if (windowId) {
        workspaceToWindowMap.set(workspacePath, windowId);
      }
    })
    .catch((err) => {
      console.warn(
        "[MCP Server] Failed to register workspace window mapping:",
        err
      );
    });
}

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

          // Validate query parameters are strings if provided (could be arrays if duplicated)
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

          // Create SSE transport - it will handle headers
          const transport = new SSEServerTransport("/mcp", res);

          // Store the transport by session ID
          activeTransports.set(transport.sessionId, transport);

          // Store server instance by Nimbalyst session ID for sending notifications later
          if (sessionId) {
            serverByNimbalystSession.set(sessionId, server);
          }

          // Store server instance by workspace path for extension tool change notifications
          if (workspacePath) {
            if (!serversByWorkspace.has(workspacePath)) {
              serversByWorkspace.set(workspacePath, new Set());
            }
            serversByWorkspace.get(workspacePath)!.add(server);
          }

          // Connect server to transport
          server
            .connect(transport)
            .then(() => {

              // Clean up on disconnect
              transport.onclose = () => {
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

          // Validate sessionId is a string if provided (could be array if duplicated)
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
            // Preserve legacy behavior for unknown SSE sessions.
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

            // Validate query parameters are strings if provided (could be arrays if duplicated)
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
            // Store server instance by workspace path for extension tool change notifications
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

    // Try to listen on the port
    httpServer.listen(port, "127.0.0.1", (err?: Error) => {
      if (err) {
        reject(err);
      }
    });

    httpServer.on("listening", () => {

      // Unref the server so it doesn't keep the process alive
      httpServer.unref();

      resolve(httpServer);
    });

    httpServer.on("error", (err: any) => {
      reject(err);
    });
  });
}
