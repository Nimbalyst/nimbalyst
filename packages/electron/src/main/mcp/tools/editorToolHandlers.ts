import { app, BrowserWindow, ipcMain } from "electron";
import { isAbsolute } from "path";
import { existsSync } from "fs";
import {
  SessionFilesRepository,
} from "@nimbalyst/runtime";
import { findWindowForFilePath, findWindowIdForWorkspacePath, workspaceToWindowMap, documentStateBySession } from "../mcpWorkspaceResolver";
import { compressImageIfNeeded } from "../mcpImageCompression";
import { isFileInWorkspaceOrWorktree } from "../../utils/workspaceDetection";

type McpToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError: boolean;
};

export function getEditorToolSchemas(sessionId: string | undefined) {
  const tools: Array<{ name: string; description: string; inputSchema: any }> = [
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
          theme: {
            type: "string",
            enum: ["dark", "light"],
            description:
              "Theme to use for the screenshot (optional, uses the app's current theme if not specified). Useful for capturing both dark and light mode versions.",
          },
        },
      },
    },
  ];

  // open_workspace is only available in development mode
  if (!app.isPackaged) {
    tools.push({
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
    });
  }

  if (sessionId) {
    tools.push({
      name: "get_session_edited_files",
      description:
        "Get the list of files that were edited during this AI session. Use this when you need to know which files have been modified as part of the current session, for example when preparing a git commit. Returns file paths relative to the workspace.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    });
  }

  return tools;
}

export async function handleApplyDiff(args: any): Promise<McpToolResult> {
  const typedArgs = args as
    | { filePath?: string; replacements?: any[] }
    | undefined;
  const targetFilePath = typedArgs?.filePath;

  if (!targetFilePath) {
    return {
      content: [{ type: "text", text: "Error: filePath is required for applyDiff" }],
      isError: true,
    };
  }

  const targetWindow = await findWindowForFilePath(targetFilePath);
  if (targetWindow) {
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

    const resultChannel = `mcp-result-${Date.now()}-${Math.random()}`;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ipcMain.removeHandler(resultChannel);
        resolve({
          content: [{ type: "text", text: "Timed out while waiting for diff to apply. The operation may still be in progress." }],
          isError: true,
        });
      }, 30000);

      ipcMain.once(resultChannel, (event, result) => {
        clearTimeout(timeout);
        const success = result?.success ?? false;
        const error = result?.error;
        resolve({
          content: [
            {
              type: "text",
              text: success
                ? `Successfully applied diff to ${targetFilePath}`
                : `Failed to apply diff: ${error || "Unknown error"}`,
            },
          ],
          isError: !success,
        });
      });

      targetWindow.webContents.send("mcp:applyDiff", {
        replacements: typedArgs?.replacements,
        resultChannel,
        targetFilePath,
      });
    });
  }
  return {
    content: [{ type: "text", text: "Error: No window available for target file" }],
    isError: true,
  };
}

export async function handleStreamContent(args: any): Promise<McpToolResult> {
  const typedArgs = args as
    | { filePath?: string; content?: string; position?: string; insertAfter?: string }
    | undefined;
  const targetFilePath = typedArgs?.filePath;

  if (!targetFilePath) {
    return {
      content: [{ type: "text", text: "Error: filePath is required for streamContent" }],
      isError: true,
    };
  }

  const targetWindow = await findWindowForFilePath(targetFilePath);
  if (targetWindow) {
    const streamId = `mcp-stream-${Date.now()}-${Math.random()}`;
    const resultChannel = `mcp-result-${Date.now()}-${Math.random()}`;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ipcMain.removeHandler(resultChannel);
        resolve({
          content: [{ type: "text", text: "Timed out while waiting for content to stream. The operation may still be in progress." }],
          isError: true,
        });
      }, 30000);

      ipcMain.once(resultChannel, (event, result) => {
        clearTimeout(timeout);
        const success = result?.success ?? false;
        const error = result?.error;
        resolve({
          content: [
            {
              type: "text",
              text: success
                ? `Successfully streamed content to ${targetFilePath}`
                : `Failed to stream content: ${error || "Unknown error"}`,
            },
          ],
          isError: !success,
        });
      });

      targetWindow.webContents.send("mcp:streamContent", {
        streamId,
        content: typedArgs?.content,
        position: typedArgs?.position || "end",
        insertAfter: typedArgs?.insertAfter,
        targetFilePath,
        resultChannel,
      });
    });
  }
  return {
    content: [{ type: "text", text: "Error: No window available for target file" }],
    isError: true,
  };
}

export async function handleOpenWorkspace(args: any): Promise<McpToolResult> {
  const workspacePathArg = args?.workspace_path as string;

  if (!workspacePathArg || typeof workspacePathArg !== "string") {
    return {
      content: [{ type: "text", text: "Error: workspace_path is required and must be a string" }],
      isError: true,
    };
  }

  if (!isAbsolute(workspacePathArg)) {
    return {
      content: [{ type: "text", text: `Error: workspace_path must be an absolute path. Got: ${workspacePathArg}` }],
      isError: true,
    };
  }

  if (!existsSync(workspacePathArg)) {
    return {
      content: [{ type: "text", text: `Error: Workspace directory does not exist: ${workspacePathArg}` }],
      isError: true,
    };
  }

  try {
    const { createWindow, findWindowByWorkspace } = await import("../../window/WindowManager");

    // Check if workspace is already open - focus it instead of creating a duplicate
    const existingWindow = findWindowByWorkspace(workspacePathArg);
    if (existingWindow && !existingWindow.isDestroyed()) {
      if (existingWindow.isMinimized()) {
        existingWindow.restore();
      }
      existingWindow.focus();
      console.log(`[MCP Server] Focused existing workspace window: ${workspacePathArg}`);

      return {
        content: [{ type: "text", text: `Workspace already open, brought to foreground: ${workspacePathArg}` }],
        isError: false,
      };
    }

    // No existing window - create a new one
    const newWindow = createWindow(false, true, workspacePathArg);
    workspaceToWindowMap.set(workspacePathArg, newWindow.id);
    console.log(`[MCP Server] Opened workspace: ${workspacePathArg}, registered as window ${newWindow.id}`);

    return {
      content: [{ type: "text", text: `Successfully opened workspace: ${workspacePathArg}` }],
      isError: false,
    };
  } catch (error) {
    console.error("[MCP Server] Failed to open workspace:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [{ type: "text", text: `Error opening workspace: ${errorMessage}` }],
      isError: true,
    };
  }
}

export async function handleCaptureEditorScreenshot(
  args: any,
): Promise<McpToolResult> {
  const filePath = args?.file_path as string | undefined;
  const selector = args?.selector as string | undefined;
  const theme = args?.theme as string | undefined;

  if (!filePath) {
    return {
      content: [{ type: "text", text: "Error: file_path is required for capture_editor_screenshot" }],
      isError: true,
    };
  }

  try {
    // Find which workspace contains this file path
    let fileWorkspacePath: string | undefined;

    for (const wsPath of workspaceToWindowMap.keys()) {
      if (isFileInWorkspaceOrWorktree(filePath, wsPath)) {
        if (!fileWorkspacePath || wsPath.length > fileWorkspacePath.length) {
          fileWorkspacePath = wsPath;
        }
      }
    }

    // Fallback: Check all session workspaces
    if (!fileWorkspacePath) {
      for (const state of documentStateBySession.values()) {
        const wsPath = state.workspacePath;
        if (wsPath && isFileInWorkspaceOrWorktree(filePath, wsPath)) {
          if (!fileWorkspacePath || wsPath.length > fileWorkspacePath.length) {
            fileWorkspacePath = wsPath;
          }
        }
      }
    }

    if (!fileWorkspacePath) {
      const registeredWorkspaces = Array.from(workspaceToWindowMap.keys());
      const sessionWorkspaces = Array.from(documentStateBySession.values())
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
    const { OffscreenEditorManager } = await import(
      "../../services/OffscreenEditorManager"
    );
    const manager = OffscreenEditorManager.getInstance();

    const imageBuffer = await manager.captureScreenshot(
      filePath,
      fileWorkspacePath,
      selector,
      theme
    );
    const imageBase64 = imageBuffer.toString("base64");

    // Validate that we actually got image data
    if (!imageBase64 || imageBase64.length === 0) {
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

    // Compress image if needed
    const compressed = compressImageIfNeeded(imageBase64, "image/png");

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
    console.error("[MCP Server] Failed to capture editor screenshot:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [{ type: "text", text: `Error capturing editor screenshot: ${errorMessage}` }],
      isError: true,
    };
  }
}

export async function handleGetSessionEditedFiles(
  sessionId: string | undefined
): Promise<McpToolResult> {
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
    console.error("[MCP Server] Failed to get session edited files:", error);
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
