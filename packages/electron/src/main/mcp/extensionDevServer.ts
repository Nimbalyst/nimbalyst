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
 * - restart_nimbalyst - Restart the Nimbalyst application (only when user explicitly requests)
 */

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
import { parse as parseUrl } from "url";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import * as fs from "fs";
import { ExtensionLogService } from "../services/ExtensionLogService";
import { database } from "../database/initialize";
import { findWindowByWorkspace } from "../window/WindowManager";
import { getRestartSignalPath } from "../utils/appPaths";

// ============================================================================
// File Utilities
// ============================================================================

/**
 * Efficiently read the last N lines from a file.
 * Reads from the end of the file in chunks to avoid loading entire file into memory.
 */
function tailFile(filePath: string, maxLines: number): string[] {
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;

  if (fileSize === 0) {
    return [];
  }

  // For small files, just read the whole thing
  if (fileSize < 1024 * 1024) {
    // 1MB
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.length > 0);
    return lines.slice(-maxLines);
  }

  // For larger files, read from the end in chunks
  const chunkSize = Math.min(1024 * 1024, fileSize); // 1MB or file size
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(chunkSize);

  try {
    const position = Math.max(0, fileSize - chunkSize);
    fs.readSync(fd, buffer, 0, chunkSize, position);

    const content = buffer.toString("utf-8");
    const lines = content.split("\n").filter((line) => line.length > 0);
    return lines.slice(-maxLines);
  } finally {
    fs.closeSync(fd);
  }
}

// ============================================================================
// Manifest Validation
// ============================================================================

interface ManifestWarning {
  field: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Validate extension manifest and return warnings/errors
 */
function validateManifest(manifestPath: string): {
  valid: boolean;
  warnings: ManifestWarning[];
} {
  const warnings: ManifestWarning[] = [];

  try {
    const content = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(content);

    // Required fields
    if (!manifest.id) {
      warnings.push({
        field: "id",
        message: 'Missing required field "id"',
        severity: "error",
      });
    } else if (!manifest.id.includes(".")) {
      warnings.push({
        field: "id",
        message:
          'Extension id should use reverse domain notation (e.g., "com.example.my-extension")',
        severity: "warning",
      });
    }

    if (!manifest.name) {
      warnings.push({
        field: "name",
        message: 'Missing required field "name"',
        severity: "error",
      });
    }

    if (!manifest.version) {
      warnings.push({
        field: "version",
        message: 'Missing required field "version"',
        severity: "error",
      });
    }

    if (!manifest.main) {
      warnings.push({
        field: "main",
        message: 'Missing required field "main"',
        severity: "error",
      });
    }

    if (!manifest.apiVersion) {
      warnings.push({
        field: "apiVersion",
        message: 'Missing required field "apiVersion"',
        severity: "warning",
      });
    }

    // Validate contributions
    if (manifest.contributions) {
      // Validate aiTools - must be array of strings, not objects
      if (
        manifest.contributions.aiTools &&
        Array.isArray(manifest.contributions.aiTools)
      ) {
        const invalidTools = manifest.contributions.aiTools.filter(
          (tool: unknown) => typeof tool !== "string"
        );
        if (invalidTools.length > 0) {
          warnings.push({
            field: "contributions.aiTools",
            message: `aiTools must be an array of strings (tool names), not objects. Found ${invalidTools.length} object(s). The tool definitions with descriptions belong in your TypeScript code, not the manifest. See: https://docs.nimbalyst.com/extensions/manifest-reference#aitools`,
            severity: "error",
          });
        }
      }

      // Validate customEditors
      if (
        manifest.contributions.customEditors &&
        Array.isArray(manifest.contributions.customEditors)
      ) {
        manifest.contributions.customEditors.forEach(
          (editor: any, idx: number) => {
            if (!editor.filePatterns || !Array.isArray(editor.filePatterns)) {
              warnings.push({
                field: `contributions.customEditors[${idx}].filePatterns`,
                message: 'customEditor must have a "filePatterns" array',
                severity: "error",
              });
            }
            if (!editor.displayName) {
              warnings.push({
                field: `contributions.customEditors[${idx}].displayName`,
                message: 'customEditor must have a "displayName"',
                severity: "error",
              });
            }
            if (!editor.component) {
              warnings.push({
                field: `contributions.customEditors[${idx}].component`,
                message: 'customEditor must have a "component" name',
                severity: "error",
              });
            }
          }
        );
      }

      // Validate newFileMenu
      if (
        manifest.contributions.newFileMenu &&
        Array.isArray(manifest.contributions.newFileMenu)
      ) {
        manifest.contributions.newFileMenu.forEach((item: any, idx: number) => {
          if (!item.extension) {
            warnings.push({
              field: `contributions.newFileMenu[${idx}].extension`,
              message: 'newFileMenu item must have an "extension" field',
              severity: "error",
            });
          }
          if (!item.displayName) {
            warnings.push({
              field: `contributions.newFileMenu[${idx}].displayName`,
              message:
                'newFileMenu item must have a "displayName" (not "label")',
              severity: "error",
            });
          }
          if (item.label && !item.displayName) {
            warnings.push({
              field: `contributions.newFileMenu[${idx}]`,
              message:
                'newFileMenu uses "displayName", not "label". Please rename the field.',
              severity: "error",
            });
          }
          if (!item.icon) {
            warnings.push({
              field: `contributions.newFileMenu[${idx}].icon`,
              message:
                'newFileMenu item must have an "icon" field (Material icon name)',
              severity: "error",
            });
          }
        });
      }
    }

    const hasErrors = warnings.some((w) => w.severity === "error");
    return { valid: !hasErrors, warnings };
  } catch (error) {
    if (error instanceof SyntaxError) {
      warnings.push({
        field: "manifest.json",
        message: `Invalid JSON: ${error.message}`,
        severity: "error",
      });
    } else {
      warnings.push({
        field: "manifest.json",
        message: `Failed to read manifest: ${error}`,
        severity: "error",
      });
    }
    return { valid: false, warnings };
  }
}

/**
 * Validate the built extension output for common issues
 */
function validateBuiltExtension(
  extensionPath: string,
  manifestPath: string
): ManifestWarning[] {
  const warnings: ManifestWarning[] = [];

  try {
    const manifestContent = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);

    // Validate that the main entry point file actually exists
    if (manifest.main) {
      const mainPath = path.join(extensionPath, manifest.main);
      if (!fs.existsSync(mainPath)) {
        warnings.push({
          field: "main",
          message: `Main entry point file not found at "${manifest.main}". The file "${mainPath}" does not exist. Make sure your vite.config.ts output filename matches the manifest.json "main" field. Common issue: manifest says "dist/index.mjs" but Vite outputs "dist/index.js".`,
          severity: "error",
        });
      }
    }

    // Check if extension has customEditors - if so, verify components export exists
    if (manifest.contributions?.customEditors?.length > 0 && manifest.main) {
      const mainPath = path.join(extensionPath, manifest.main);

      if (fs.existsSync(mainPath)) {
        const mainContent = fs.readFileSync(mainPath, "utf8");

        // Check for components export at the END of the built output
        // Vite/Rollup puts exports at the end: "export { X as components }" or "export { components }"
        // Get the last 2000 chars to check exports section (500 was too small for large exports)
        const exportSection = mainContent.slice(-2000);

        // Look for "components" in the export statement
        // Patterns: "as components", "components }" (named export), "components:" (object property)
        // Also check for "as components" which is common in minified Vite output
        const hasComponentsExport =
          /export\s*\{[^}]*\bcomponents\b[^}]*\}/.test(exportSection) ||
          /\bas\s+components\b/.test(exportSection) ||
          /exports\.components\s*=/.test(mainContent) ||
          /export\s+const\s+components\s*=/.test(mainContent);

        if (!hasComponentsExport) {
          const componentNames = manifest.contributions.customEditors
            .map((e: any) => e.component)
            .join(", ");
          warnings.push({
            field: "src/index.ts",
            message: `Extension has customEditors but no "components" export found in the built output.\n\nYour entry point (src/index.ts) must export a "components" object that maps component names to React components:\n\nexport const components = {\n  ${componentNames}: YourComponentFunction,\n};\n\nThe keys must match the "component" field in manifest.json contributions.customEditors[].component.\n\nYou are currently only exporting the component directly (e.g., "export { ${componentNames} }") but Nimbalyst requires a "components" object wrapper.`,
            severity: "error",
          });
        } else {
          // Check if specific component names are in the export section
          for (const editor of manifest.contributions.customEditors) {
            if (editor.component && !exportSection.includes(editor.component)) {
              warnings.push({
                field: `contributions.customEditors`,
                message: `Component "${editor.component}" referenced in manifest but not found in the export section. Make sure to export it in the components object.`,
                severity: "warning",
              });
            }
          }
        }
      }
    }

    // Check if extension has aiTools - if so, verify aiTools export exists
    if (manifest.contributions?.aiTools?.length > 0 && manifest.main) {
      const mainPath = path.join(extensionPath, manifest.main);

      if (fs.existsSync(mainPath)) {
        const mainContent = fs.readFileSync(mainPath, "utf8");

        // Check for aiTools export
        const hasAiToolsExport =
          mainContent.includes("aiTools") &&
          (mainContent.includes("export") || mainContent.includes("exports"));

        if (!hasAiToolsExport) {
          warnings.push({
            field: "src/index.ts",
            message: `Extension declares aiTools in manifest but no "aiTools" export found in built output. Your entry point must export an aiTools array. Example:\n\nexport const aiTools: ExtensionAITool[] = [...];`,
            severity: "error",
          });
        }
      }
    }
  } catch (error) {
    // Don't fail validation if we can't check the built output
    console.warn("[Extension Dev MCP] Could not validate built output:", error);
  }

  return warnings;
}

/**
 * Format manifest warnings for display
 */
function formatManifestWarnings(warnings: ManifestWarning[]): string {
  if (warnings.length === 0) return "";

  const errors = warnings.filter((w) => w.severity === "error");
  const warns = warnings.filter((w) => w.severity === "warning");

  let result = "\n\n--- Manifest Validation ---\n";

  if (errors.length > 0) {
    result += `\nERRORS (${errors.length}):\n`;
    errors.forEach((e) => {
      result += `  - [${e.field}] ${e.message}\n`;
    });
  }

  if (warns.length > 0) {
    result += `\nWARNINGS (${warns.length}):\n`;
    warns.forEach((w) => {
      result += `  - [${w.field}] ${w.message}\n`;
    });
  }

  return result;
}

// Store active SSE transports
interface TransportMetadata {
  transport: SSEServerTransport;
  workspacePath?: string;
}
const activeTransports = new Map<string, TransportMetadata>();

interface StreamableTransportMetadata {
  transport: StreamableHTTPServerTransport;
  workspacePath?: string;
}
const activeStreamableTransports = new Map<
  string,
  StreamableTransportMetadata
>();

// Store the HTTP server instance
let httpServerInstance: any = null;

// Store references to extension management functions (set at startup)
let installExtensionFn:
  | ((
      extensionPath: string
    ) => Promise<{ success: boolean; extensionId?: string; error?: string }>)
  | null = null;
let uninstallExtensionFn:
  | ((extensionId: string) => Promise<{ success: boolean; error?: string }>)
  | null = null;
let reloadExtensionFn:
  | ((
      extensionId: string,
      extensionPath?: string
    ) => Promise<{ success: boolean; error?: string }>)
  | null = null;

/**
 * Set the extension management functions (called once at startup)
 */
export function setExtensionManagementFns(fns: {
  install: (
    extensionPath: string
  ) => Promise<{ success: boolean; extensionId?: string; error?: string }>;
  uninstall: (
    extensionId: string
  ) => Promise<{ success: boolean; error?: string }>;
  reload: (
    extensionId: string,
    extensionPath?: string
  ) => Promise<{ success: boolean; error?: string }>;
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
      console.error(
        `[Extension Dev MCP] Error closing transport ${transportId}:`,
        error
      );
    }
  }
  activeTransports.clear();

  for (const [
    streamableTransportId,
    metadata,
  ] of activeStreamableTransports.entries()) {
    try {
      void metadata.transport.close().catch((error) => {
        console.error(
          `[Extension Dev MCP] Error closing streamable transport ${streamableTransportId}:`,
          error
        );
      });
    } catch (error) {
      console.error(
        `[Extension Dev MCP] Error closing streamable transport ${streamableTransportId}:`,
        error
      );
    }
  }
  activeStreamableTransports.clear();
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
      console.error("[Extension Dev MCP] Error cleaning up transports:", error);
    }

    try {
      if (
        httpServerInstance &&
        typeof httpServerInstance.closeAllConnections === "function"
      ) {
        httpServerInstance.closeAllConnections();
      }
    } catch (error) {
      console.error("[Extension Dev MCP] Error closing connections:", error);
    }

    try {
      if (
        httpServerInstance &&
        typeof httpServerInstance.close === "function"
      ) {
        httpServerInstance.close((err?: Error) => {
          if (err) {
            console.error(
              "[Extension Dev MCP] Error closing HTTP server:",
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
      console.error("[Extension Dev MCP] Error in server close:", error);
      httpServerInstance = null;
      safeResolve();
    }

    // Timeout to ensure we don't hang
    setTimeout(() => {
      if (httpServerInstance) {
        console.log(
          "[Extension Dev MCP] Force destroying HTTP server after timeout"
        );
        httpServerInstance = null;
      }
      safeResolve();
    }, 1000);
  });
}

export async function startExtensionDevServer(
  startPort: number = 3460
): Promise<{ httpServer: any; port: number }> {
  let port = startPort;
  let httpServer: any = null;
  let maxAttempts = 100;

  while (maxAttempts > 0) {
    try {
      httpServer = await tryCreateExtensionDevServer(port);
      console.log(`[Extension Dev MCP] Successfully started on port ${port}`);
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
      `[Extension Dev MCP] Could not find an available port after trying 100 ports starting from ${startPort}`
    );
  }

  httpServerInstance = httpServer;
  return { httpServer, port };
}

/**
 * Run npm build in an extension project directory
 */
async function runBuild(
  extensionPath: string
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Verify the path exists and has a package.json
    const packageJsonPath = path.join(extensionPath, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      resolve({
        success: false,
        stdout: "",
        stderr: `Error: No package.json found at ${extensionPath}`,
      });
      return;
    }

    // Try to get extension ID from manifest for log tagging
    let extensionId: string | undefined;
    const manifestPath = path.join(extensionPath, "manifest.json");
    try {
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        extensionId = manifest.id;
      }
    } catch {
      // Ignore manifest errors during build - they'll be caught in validation
    }

    const logService = ExtensionLogService.getInstance();

    // Log build start
    logService.addMainLog(
      "info",
      `Starting build for extension: ${extensionId || extensionPath}`,
      extensionId
    );

    let stdout = "";
    let stderr = "";

    const child = spawn("npm", ["run", "build"], {
      cwd: extensionPath,
      shell: true,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Log build output as it comes in
      if (extensionId) {
        logService.addBuildLog(extensionId, chunk, false);
      }
    });

    child.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Log build errors as they come in
      if (extensionId) {
        logService.addBuildLog(extensionId, chunk, true);
      }
    });

    child.on("close", (code) => {
      const success = code === 0;
      logService.addMainLog(
        success ? "info" : "error",
        `Build ${success ? "succeeded" : "failed"} for extension: ${
          extensionId || extensionPath
        }`,
        extensionId
      );
      resolve({
        success,
        stdout,
        stderr,
      });
    });

    child.on("error", (error) => {
      logService.addMainLog(
        "error",
        `Build process error: ${error.message}`,
        extensionId
      );
      resolve({
        success: false,
        stdout,
        stderr: stderr + "\n" + error.message,
      });
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      child.kill();
      logService.addMainLog(
        "error",
        "Build timed out after 60 seconds",
        extensionId
      );
      resolve({
        success: false,
        stdout,
        stderr: stderr + "\nBuild timed out after 60 seconds",
      });
    }, 60000);
  });
}

function createExtensionDevMcpServer(
  workspacePath: string | undefined
): Server {
  // Create a new MCP Server instance for this connection
  const server = new Server(
    {
      name: "nimbalyst-extension-dev",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool definitions
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "extension_build",
          description:
            "Build a Nimbalyst extension project. Runs `npm run build` in the extension directory and returns the build output.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "Absolute path to the extension project root (directory containing package.json and manifest.json)",
              },
            },
            required: ["path"],
          },
        },
        {
          name: "extension_install",
          description:
            "Install a built extension into the running Nimbalyst instance. The extension must be built first using extension_build.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "Absolute path to the extension project root (directory containing manifest.json)",
              },
            },
            required: ["path"],
          },
        },
        {
          name: "extension_reload",
          description:
            "Hot reload an installed extension. Rebuilds the extension and reinstalls it without restarting Nimbalyst.",
          inputSchema: {
            type: "object",
            properties: {
              extensionId: {
                type: "string",
                description: "The extension ID (from manifest.json) to reload",
              },
              path: {
                type: "string",
                description:
                  "Absolute path to the extension project root (for rebuilding)",
              },
            },
            required: ["extensionId", "path"],
          },
        },
        {
          name: "extension_uninstall",
          description:
            "Remove an installed extension from the running Nimbalyst instance.",
          inputSchema: {
            type: "object",
            properties: {
              extensionId: {
                type: "string",
                description:
                  "The extension ID (from manifest.json) to uninstall",
              },
            },
            required: ["extensionId"],
          },
        },
        {
          name: "restart_nimbalyst",
          description:
            "Restart the Nimbalyst application. Only use this tool when the user explicitly asks you to restart Nimbalyst. This will close all windows and relaunch the app. All active AI sessions will automatically continue after restart with a continuation message.",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        {
          name: "extension_get_status",
          description:
            "Get the current status of an installed extension, including whether it loaded successfully and what it contributes (custom editors, AI tools, etc.).",
          inputSchema: {
            type: "object",
            properties: {
              extensionId: {
                type: "string",
                description: "The extension ID to query",
              },
            },
            required: ["extensionId"],
          },
        },
        {
          name: "database_query",
          description:
            "Execute a SELECT query against the Nimbalyst PGLite database. Only SELECT queries are allowed for safety. Useful for debugging and inspecting application state. Available tables include: ai_sessions, ai_agent_messages, document_history, session_files, queued_prompts, tracker_items.",
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description:
                  "The SELECT SQL query to execute. Must start with SELECT.",
              },
            },
            required: ["sql"],
          },
        },
        {
          name: "get_environment_info",
          description:
            "Get information about the Nimbalyst environment including whether the app is running in development mode or as a packaged build. Use this to verify code changes will take effect.",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_main_process_logs",
          description:
            "Read logs from the main process log file (Node.js side). Use this for debugging file system errors, IPC channel issues, AI provider failures, extension loading errors, and database query errors. The main log persists across sessions and contains component-scoped entries.",
          inputSchema: {
            type: "object",
            properties: {
              lastLines: {
                type: "number",
                description:
                  "Number of recent lines to read (default: 100, max: 1000)",
              },
              component: {
                type: "string",
                description:
                  "Filter by component name: FILE_WATCHER, WORKSPACE_WATCHER, AI_CLAUDE, AI_CLAUDE_CODE, STREAMING, EXTENSION, IPC, DATABASE, etc.",
              },
              logLevel: {
                type: "string",
                enum: ["error", "warn", "info", "debug"],
                description: "Filter by minimum log level",
              },
              searchTerm: {
                type: "string",
                description:
                  "Search for specific text in logs (case-insensitive)",
              },
            },
          },
        },
        {
          name: "get_renderer_debug_logs",
          description:
            "Read the renderer debug log file (development mode only). Logs rotate on app restart, keeping last 5 sessions. Use session parameter to access previous session logs for crash investigation or historical debugging. This provides file-based access to renderer logs beyond the in-memory ring buffer.",
          inputSchema: {
            type: "object",
            properties: {
              session: {
                type: "number",
                description:
                  "Which session to read: 0 = current (default), 1 = previous, 2 = two sessions ago, up to 4",
              },
              lastLines: {
                type: "number",
                description:
                  "Number of recent lines to read (default: 100, max: 1000)",
              },
              windowId: {
                type: "number",
                description: "Filter to logs from a specific window ID",
              },
              logLevel: {
                type: "string",
                enum: ["error", "warn", "info", "debug"],
                description: "Filter by log level",
              },
              searchTerm: {
                type: "string",
                description:
                  "Search for specific text in logs (case-insensitive)",
              },
            },
          },
        },
        // Only include renderer_eval in development mode
        ...(process.env.NODE_ENV === "development" ||
        !!process.env.ELECTRON_RENDERER_URL
          ? [
              {
                name: "renderer_eval",
                description:
                  "Execute JavaScript in the Nimbalyst renderer context. Only available in development mode. Useful for debugging, inspecting DOM state, and checking computed styles. Supports async/await expressions.",
                inputSchema: {
                  type: "object",
                  properties: {
                    expression: {
                      type: "string",
                      description:
                        "JavaScript expression to evaluate. Supports async/await. Return values will be serialized. Examples: \"document.querySelector('.my-class').textContent\", \"getComputedStyle(document.documentElement).getPropertyValue('--nim-text')\", \"await fetch('/api/status').then(r => r.json())\"",
                    },
                    timeout: {
                      type: "number",
                      description:
                        "Maximum execution time in milliseconds (default: 5000, max: 30000)",
                    },
                  },
                  required: ["expression"],
                },
              },
            ]
          : []),
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;

    // Strip MCP server prefix if present
    const toolName = name.replace(/^mcp__nimbalyst-extension-dev__/, "");

    switch (toolName) {
      case "extension_build": {
        const extensionPath = args?.path as string;

        if (!extensionPath) {
          return {
            content: [{ type: "text", text: "Error: path is required" }],
            isError: true,
          };
        }

        // Normalize and validate path
        const normalizedPath = path.resolve(extensionPath);
        if (!fs.existsSync(normalizedPath)) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Directory not found: ${normalizedPath}`,
              },
            ],
            isError: true,
          };
        }

        console.log(
          `[Extension Dev MCP] Building extension at: ${normalizedPath}`
        );

        const result = await runBuild(normalizedPath);

        if (result.success) {
          return {
            content: [
              {
                type: "text",
                text: `Build successful!\n\nOutput:\n${result.stdout}${
                  result.stderr ? "\n\nWarnings:\n" + result.stderr : ""
                }`,
              },
            ],
            isError: false,
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Build failed!\n\nStdout:\n${result.stdout}\n\nStderr:\n${result.stderr}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "extension_install": {
        const extensionPath = args?.path as string;

        if (!extensionPath) {
          return {
            content: [{ type: "text", text: "Error: path is required" }],
            isError: true,
          };
        }

        if (!installExtensionFn) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Extension installation service not initialized",
              },
            ],
            isError: true,
          };
        }

        const normalizedPath = path.resolve(extensionPath);

        // Verify manifest.json exists
        const manifestPath = path.join(normalizedPath, "manifest.json");
        if (!fs.existsSync(manifestPath)) {
          return {
            content: [
              {
                type: "text",
                text: `Error: No manifest.json found at ${normalizedPath}`,
              },
            ],
            isError: true,
          };
        }

        // Validate manifest before installing
        const validation = validateManifest(manifestPath);

        // Also validate built output for required exports
        const builtValidation = validateBuiltExtension(
          normalizedPath,
          manifestPath
        );
        const allWarnings = [...validation.warnings, ...builtValidation];
        const validationOutput = formatManifestWarnings(allWarnings);

        const hasErrors = allWarnings.some((w) => w.severity === "error");
        if (hasErrors) {
          return {
            content: [
              {
                type: "text",
                text: `Installation blocked due to errors.${validationOutput}\n\nPlease fix these errors and try again.`,
              },
            ],
            isError: true,
          };
        }

        console.log(
          `[Extension Dev MCP] Installing extension from: ${normalizedPath}`
        );

        try {
          const result = await installExtensionFn(normalizedPath);

          if (result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Extension installed successfully!\n\nExtension ID: ${result.extensionId}${validationOutput}`,
                },
              ],
              isError: false,
            };
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `Installation failed: ${result.error}${validationOutput}`,
                },
              ],
              isError: true,
            };
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          return {
            content: [
              {
                type: "text",
                text: `Installation error: ${errorMessage}${validationOutput}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "extension_reload": {
        const extensionId = args?.extensionId as string;
        const extensionPath = args?.path as string;

        if (!extensionId || !extensionPath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: extensionId and path are required",
              },
            ],
            isError: true,
          };
        }

        const normalizedPath = path.resolve(extensionPath);
        const manifestPath = path.join(normalizedPath, "manifest.json");

        // Step 1: Always rebuild first
        console.log(
          `[Extension Dev MCP] Rebuilding extension ${extensionId} at ${normalizedPath}`
        );
        const buildResult = await runBuild(normalizedPath);
        if (!buildResult.success) {
          return {
            content: [
              {
                type: "text",
                text: `Rebuild failed!\n\nStdout:\n${buildResult.stdout}\n\nStderr:\n${buildResult.stderr}`,
              },
            ],
            isError: true,
          };
        }

        // Step 2: Validate manifest after build
        const validation = validateManifest(manifestPath);

        // Step 2b: Validate built output (check for required exports)
        const builtValidation = validateBuiltExtension(
          normalizedPath,
          manifestPath
        );
        const allWarnings = [...validation.warnings, ...builtValidation];
        const validationOutput = formatManifestWarnings(allWarnings);

        const hasErrors = allWarnings.some((w) => w.severity === "error");
        if (hasErrors) {
          return {
            content: [
              {
                type: "text",
                text: `Build succeeded but extension has errors.${validationOutput}\n\nPlease fix these errors and reload again.\n\nBuild output:\n${buildResult.stdout}`,
              },
            ],
            isError: true,
          };
        }

        // Step 3: Reload the extension in the running app
        if (reloadExtensionFn) {
          try {
            const result = await reloadExtensionFn(extensionId, normalizedPath);
            if (result.success) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Extension ${extensionId} rebuilt and reloaded successfully!${validationOutput}\n\nBuild output:\n${buildResult.stdout}`,
                  },
                ],
                isError: false,
              };
            } else {
              return {
                content: [
                  {
                    type: "text",
                    text: `Build succeeded but reload failed: ${result.error}${validationOutput}\n\nBuild output:\n${buildResult.stdout}`,
                  },
                ],
                isError: true,
              };
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            return {
              content: [
                {
                  type: "text",
                  text: `Build succeeded but reload error: ${errorMessage}${validationOutput}\n\nBuild output:\n${buildResult.stdout}`,
                },
              ],
              isError: true,
            };
          }
        }

        // Fallback: use install function if reload not available
        if (installExtensionFn) {
          try {
            const installResult = await installExtensionFn(normalizedPath);
            if (installResult.success) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Extension rebuilt and reinstalled successfully!${validationOutput}\n\nBuild output:\n${buildResult.stdout}`,
                  },
                ],
                isError: false,
              };
            } else {
              return {
                content: [
                  {
                    type: "text",
                    text: `Build succeeded but reinstall failed: ${installResult.error}${validationOutput}\n\nBuild output:\n${buildResult.stdout}`,
                  },
                ],
                isError: true,
              };
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            return {
              content: [
                {
                  type: "text",
                  text: `Build succeeded but reinstall error: ${errorMessage}${validationOutput}\n\nBuild output:\n${buildResult.stdout}`,
                },
              ],
              isError: true,
            };
          }
        }

        return {
          content: [
            {
              type: "text",
              text: "Error: Extension management service not initialized",
            },
          ],
          isError: true,
        };
      }

      case "extension_uninstall": {
        const extensionId = args?.extensionId as string;

        if (!extensionId) {
          return {
            content: [{ type: "text", text: "Error: extensionId is required" }],
            isError: true,
          };
        }

        if (!uninstallExtensionFn) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Extension uninstall service not initialized",
              },
            ],
            isError: true,
          };
        }

        console.log(
          `[Extension Dev MCP] Uninstalling extension: ${extensionId}`
        );

        try {
          const result = await uninstallExtensionFn(extensionId);

          if (result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Extension ${extensionId} uninstalled successfully!`,
                },
              ],
              isError: false,
            };
          } else {
            return {
              content: [
                { type: "text", text: `Uninstall failed: ${result.error}` },
              ],
              isError: true,
            };
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          return {
            content: [
              { type: "text", text: `Uninstall error: ${errorMessage}` },
            ],
            isError: true,
          };
        }
      }

      case "restart_nimbalyst": {
        console.log("[Extension Dev MCP] Restarting Nimbalyst...");

        const { app } = await import("electron");

        // Get all active agent sessions to continue after restart
        try {
          const { getSessionStateManager } = await import(
            "@nimbalyst/runtime/ai/server/SessionStateManager"
          );
          const stateManager = getSessionStateManager();
          const activeSessionIds = stateManager.getActiveSessionIds();

          // Filter to only agent sessions that are running or streaming
          const agentSessionIds: string[] = [];
          for (const sessionId of activeSessionIds) {
            const state = stateManager.getSessionState(sessionId);
            if (state && (state.status === "running" || state.isStreaming)) {
              agentSessionIds.push(sessionId);
            }
          }

          if (agentSessionIds.length > 0) {
            const userData = app.getPath("userData");
            const restartContinuationPath = path.join(
              userData,
              "restart-continuation.json"
            );
            const continuationData = {
              sessionIds: agentSessionIds,
              timestamp: Date.now(),
            };
            fs.writeFileSync(
              restartContinuationPath,
              JSON.stringify(continuationData),
              "utf8"
            );
            console.log(
              `[Extension Dev MCP] Saved restart continuation for ${agentSessionIds.length} active session(s):`,
              agentSessionIds
            );
          }
        } catch (error) {
          console.error(
            "[Extension Dev MCP] Failed to save restart continuation:",
            error
          );
        }

        // Check if we're in dev mode (electron-vite spawns both vite and electron)
        const isDev =
          process.env.NODE_ENV === "development" ||
          !!process.env.ELECTRON_RENDERER_URL;

        if (isDev) {
          // In dev mode, write a restart signal file and quit.
          // The outer dev-loop.sh script watches for this file and restarts npm run dev.
          // This avoids complex process killing and ensures clean restarts.
          const restartSignalPath = getRestartSignalPath();

          console.log(
            `[Extension Dev MCP] Dev mode restart: writing signal to ${restartSignalPath}`
          );

          fs.writeFileSync(restartSignalPath, Date.now().toString(), "utf8");

          // Give the file a moment to be written, then quit
          setTimeout(() => {
            app.quit();
          }, 100);

          return {
            content: [
              {
                type: "text",
                text: "Restart requested. The dev server will relaunch shortly.",
              },
            ],
            isError: false,
          };
        } else {
          // In production, use the standard relaunch mechanism
          // CRITICAL: Use app.quit() NOT app.exit(0) to trigger the before-quit handler
          // which performs proper database backup and cleanup to prevent corruption
          app.relaunch();
          app.quit();

          return {
            content: [{ type: "text", text: "Restarting Nimbalyst..." }],
            isError: false,
          };
        }
      }

      case "extension_get_status": {
        const extensionId = args?.extensionId as string;

        if (!extensionId) {
          return {
            content: [{ type: "text", text: "Error: extensionId is required" }],
            isError: true,
          };
        }

        // workspacePath is REQUIRED to route to the correct window
        if (!workspacePath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: workspacePath is required to query extension status",
              },
            ],
            isError: true,
          };
        }

        // Find the window for this workspace - do NOT fall back to windows[0]
        const targetWindow = findWindowByWorkspace(workspacePath);
        if (!targetWindow || targetWindow.isDestroyed()) {
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

        // Create a promise that resolves with extension status
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            resolve({
              content: [
                {
                  type: "text",
                  text: `Extension ${extensionId}: Status query timed out. Extension may not be loaded.`,
                },
              ],
              isError: false,
            });
          }, 5000);

          // Use a unique channel for the response
          const responseChannel = `extension-status-response-${Date.now()}`;

          const { ipcMain } = require("electron");
          ipcMain.once(responseChannel, (_event: any, result: any) => {
            clearTimeout(timeout);

            if (!result || result.error) {
              resolve({
                content: [
                  {
                    type: "text",
                    text: `Extension ${extensionId}: Not found or not loaded.\n${
                      result?.error || ""
                    }`,
                  },
                ],
                isError: false,
              });
              return;
            }

            // Format the status response
            const status = result.status || "unknown";
            const contributions = result.contributions || {};
            const loadError = result.loadError;

            let response = `Extension: ${extensionId}\n`;
            response += `Status: ${status}\n`;

            if (loadError) {
              response += `Load Error: ${loadError}\n`;
            }

            if (contributions.customEditors?.length > 0) {
              response += `\nCustom Editors (${contributions.customEditors.length}):\n`;
              contributions.customEditors.forEach((editor: any) => {
                response += `  - ${
                  editor.displayName
                } (${editor.filePatterns?.join(", ")})\n`;
              });
            }

            if (contributions.aiTools?.length > 0) {
              response += `\nAI Tools (${contributions.aiTools.length}):\n`;
              contributions.aiTools.forEach((tool: string) => {
                response += `  - ${tool}\n`;
              });
            }

            if (contributions.newFileMenu?.length > 0) {
              response += `\nNew File Menu Items (${contributions.newFileMenu.length}):\n`;
              contributions.newFileMenu.forEach((item: any) => {
                response += `  - ${item.displayName} (${item.extension})\n`;
              });
            }

            resolve({
              content: [{ type: "text", text: response }],
              isError: false,
            });
          });

          // Send query to renderer
          targetWindow.webContents.send("extension:get-status", {
            extensionId,
            responseChannel,
          });
        });
      }

      case "database_query": {
        const sql = args?.sql as string;

        if (!sql) {
          return {
            content: [{ type: "text", text: "Error: sql is required" }],
            isError: true,
          };
        }

        // Safety check: only allow SELECT queries
        const trimmedSQL = sql.trim().toLowerCase();
        if (!trimmedSQL.startsWith("select")) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Only SELECT queries are allowed for safety. Write operations are not permitted through this tool.",
              },
            ],
            isError: true,
          };
        }

        console.log(
          `[Extension Dev MCP] Executing database query: ${sql.substring(
            0,
            100
          )}...`
        );

        try {
          const result = await database.query(sql);

          // Format results for display
          const rowCount = result.rows.length;
          let responseText = `Query executed successfully.\n\nRows returned: ${rowCount}\n`;

          if (rowCount > 0) {
            // Get column names from first row
            const columns = Object.keys(result.rows[0]);
            responseText += `Columns: ${columns.join(", ")}\n\n`;

            // Format as JSON for readability (limit to first 100 rows to avoid huge responses)
            const displayRows = result.rows.slice(0, 100);
            responseText += JSON.stringify(displayRows, null, 2);

            if (rowCount > 100) {
              responseText += `\n\n... and ${
                rowCount - 100
              } more rows (truncated)`;
            }
          } else {
            responseText += "\nNo rows returned.";
          }

          return {
            content: [{ type: "text", text: responseText }],
            isError: false,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          return {
            content: [{ type: "text", text: `Query error: ${errorMessage}` }],
            isError: true,
          };
        }
      }

      case "get_environment_info": {
        const { app } = await import("electron");
        const isDev =
          process.env.NODE_ENV === "development" ||
          !!process.env.ELECTRON_RENDERER_URL;
        const isPackaged = app.isPackaged;
        const appVersion = app.getVersion();

        let responseText = `Nimbalyst Environment Info:\n\n`;
        responseText += `- App Version: ${appVersion}\n`;
        responseText += `- Development Mode: ${isDev ? "YES" : "NO"}\n`;
        responseText += `- Packaged Build: ${isPackaged ? "YES" : "NO"}\n`;
        responseText += `- NODE_ENV: ${process.env.NODE_ENV || "not set"}\n`;

        if (!isDev || isPackaged) {
          responseText += `\nWARNING: Nimbalyst is running as a PACKAGED BUILD, not in development mode.\n`;
          responseText += `Code changes you make will NOT be reflected in this running instance.\n`;
          responseText += `Ask the user to run the dev server (npm run dev) if they want to test code changes.`;
        } else {
          responseText += `\nNimbalyst is running in development mode. Code changes will be reflected after hot reload or restart.`;
        }

        return {
          content: [{ type: "text", text: responseText }],
          isError: false,
        };
      }

      case "get_main_process_logs": {
        const { app } = await import("electron");
        const mainLogPath = path.join(
          app.getPath("userData"),
          "logs",
          "main.log"
        );

        // Parse parameters
        let lastLines = (args?.lastLines as number) || 100;
        lastLines = Math.min(Math.max(1, lastLines), 1000);
        const component = args?.component as string | undefined;
        const logLevel = args?.logLevel as
          | "error"
          | "warn"
          | "info"
          | "debug"
          | undefined;
        const searchTerm = args?.searchTerm as string | undefined;

        // Check if file exists
        if (!fs.existsSync(mainLogPath)) {
          return {
            content: [
              {
                type: "text",
                text: `Main process log file not found at: ${mainLogPath}`,
              },
            ],
            isError: true,
          };
        }

        try {
          // Read and tail the file efficiently
          const lines = tailFile(mainLogPath, lastLines * 2); // Read extra for filtering

          // Filter lines
          let filteredLines = lines;

          // Filter by component (e.g., [FILE_WATCHER])
          if (component) {
            const componentPattern = `[${component.toUpperCase()}]`;
            filteredLines = filteredLines.filter((line) =>
              line.includes(componentPattern)
            );
          }

          // Filter by log level
          if (logLevel) {
            const levelPatterns: Record<string, string[]> = {
              error: ["[error]"],
              warn: ["[error]", "[warn]"],
              info: ["[error]", "[warn]", "[info]"],
              debug: ["[error]", "[warn]", "[info]", "[debug]"],
            };
            const patterns = levelPatterns[logLevel] || [];
            filteredLines = filteredLines.filter((line) =>
              patterns.some((p) => line.toLowerCase().includes(p))
            );
          }

          // Filter by search term
          if (searchTerm) {
            const lowerSearch = searchTerm.toLowerCase();
            filteredLines = filteredLines.filter((line) =>
              line.toLowerCase().includes(lowerSearch)
            );
          }

          // Take last N lines after filtering
          filteredLines = filteredLines.slice(-lastLines);

          // Build header
          const filterDesc = [
            `last ${lastLines} lines`,
            component ? `component: ${component}` : null,
            logLevel ? `level: ${logLevel}+` : null,
            searchTerm ? `search: "${searchTerm}"` : null,
          ]
            .filter(Boolean)
            .join(", ");

          const header =
            `Main Process Logs (${filterDesc})\n` +
            `File: ${mainLogPath}\n` +
            `Found ${filteredLines.length} matching lines\n` +
            `---\n`;

          return {
            content: [
              { type: "text", text: header + filteredLines.join("\n") },
            ],
            isError: false,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          return {
            content: [
              { type: "text", text: `Error reading main log: ${errorMsg}` },
            ],
            isError: true,
          };
        }
      }

      case "get_renderer_debug_logs": {
        const { app } = await import("electron");
        const isDev =
          process.env.NODE_ENV === "development" ||
          !!process.env.ELECTRON_RENDERER_URL;

        // Only available in development mode
        if (!isDev) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Renderer debug logs are only available in development mode.\n" +
                  "In production builds, use extension_get_logs for recent renderer console output.",
              },
            ],
            isError: true,
          };
        }

        // Parse parameters
        const session = Math.min(
          Math.max(0, (args?.session as number) || 0),
          4
        );
        let lastLines = (args?.lastLines as number) || 100;
        lastLines = Math.min(Math.max(1, lastLines), 1000);
        const windowId = args?.windowId as number | undefined;
        const logLevel = args?.logLevel as
          | "error"
          | "warn"
          | "info"
          | "debug"
          | undefined;
        const searchTerm = args?.searchTerm as string | undefined;

        // Determine log file path based on session
        const userData = app.getPath("userData");
        const baseName = "nimbalyst-debug";
        const ext = ".log";
        const logPath =
          session === 0
            ? path.join(userData, `${baseName}${ext}`)
            : path.join(userData, `${baseName}.${session}${ext}`);

        // Check if file exists
        if (!fs.existsSync(logPath)) {
          const sessionDesc =
            session === 0 ? "current" : `${session} session(s) ago`;
          return {
            content: [
              {
                type: "text",
                text:
                  `No debug log found for session ${session} (${sessionDesc}).\n` +
                  `File not found: ${logPath}\n\n` +
                  `Available sessions: Check which nimbalyst-debug*.log files exist in:\n${userData}`,
              },
            ],
            isError: true,
          };
        }

        try {
          // Read and tail the file efficiently
          const lines = tailFile(logPath, lastLines * 2); // Read extra for filtering

          // Filter lines
          let filteredLines = lines;

          // Filter by window ID (format: [Window N])
          if (windowId !== undefined) {
            const windowPattern = `[Window ${windowId}]`;
            filteredLines = filteredLines.filter((line) =>
              line.includes(windowPattern)
            );
          }

          // Filter by log level
          if (logLevel) {
            const levelPatterns: Record<string, string[]> = {
              error: ["[ERROR]"],
              warn: ["[ERROR]", "[WARN]"],
              info: ["[ERROR]", "[WARN]", "[INFO]"],
              debug: ["[ERROR]", "[WARN]", "[INFO]", "[DEBUG]"],
            };
            const patterns = levelPatterns[logLevel] || [];
            filteredLines = filteredLines.filter((line) =>
              patterns.some((p) => line.includes(p))
            );
          }

          // Filter by search term
          if (searchTerm) {
            const lowerSearch = searchTerm.toLowerCase();
            filteredLines = filteredLines.filter((line) =>
              line.toLowerCase().includes(lowerSearch)
            );
          }

          // Take last N lines after filtering
          filteredLines = filteredLines.slice(-lastLines);

          // Build header
          const sessionDesc =
            session === 0 ? "current" : `${session} session(s) ago`;
          const filterDesc = [
            `session: ${sessionDesc}`,
            `last ${lastLines} lines`,
            windowId !== undefined ? `window: ${windowId}` : null,
            logLevel ? `level: ${logLevel}+` : null,
            searchTerm ? `search: "${searchTerm}"` : null,
          ]
            .filter(Boolean)
            .join(", ");

          const header =
            `Renderer Debug Logs (${filterDesc})\n` +
            `File: ${logPath}\n` +
            `Found ${filteredLines.length} matching lines\n` +
            `---\n`;

          return {
            content: [
              { type: "text", text: header + filteredLines.join("\n") },
            ],
            isError: false,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          return {
            content: [
              { type: "text", text: `Error reading debug log: ${errorMsg}` },
            ],
            isError: true,
          };
        }
      }

      case "renderer_eval": {
        // Double-check dev mode (tool definition should already be hidden in prod)
        const isDev =
          process.env.NODE_ENV === "development" ||
          !!process.env.ELECTRON_RENDERER_URL;
        if (!isDev) {
          return {
            content: [
              {
                type: "text",
                text: "Error: renderer_eval is only available in development mode.",
              },
            ],
            isError: true,
          };
        }

        const expression = args?.expression as string;
        if (!expression) {
          return {
            content: [{ type: "text", text: "Error: expression is required" }],
            isError: true,
          };
        }

        // Validate and cap timeout
        let timeout = (args?.timeout as number) || 5000;
        timeout = Math.min(Math.max(100, timeout), 30000);

        // Require workspace path for routing to the correct window
        if (!workspacePath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: workspacePath is required to route to the correct window",
              },
            ],
            isError: true,
          };
        }

        // Find the target window
        const targetWindow = findWindowByWorkspace(workspacePath);
        if (!targetWindow || targetWindow.isDestroyed()) {
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

        // Execute in renderer via IPC
        return new Promise((resolve) => {
          const responseChannel = `renderer-eval-response-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`;

          const timeoutId = setTimeout(() => {
            resolve({
              content: [
                {
                  type: "text",
                  text: `Error: Evaluation timed out after ${timeout}ms`,
                },
              ],
              isError: true,
            });
          }, timeout);

          const { ipcMain } = require("electron");
          ipcMain.once(responseChannel, (_event: any, result: any) => {
            clearTimeout(timeoutId);

            if (result.error) {
              resolve({
                content: [
                  {
                    type: "text",
                    text: `Error: ${result.error}${
                      result.stack ? "\n\nStack:\n" + result.stack : ""
                    }`,
                  },
                ],
                isError: true,
              });
              return;
            }

            resolve({
              content: [{ type: "text", text: `Result:\n${result.value}` }],
              isError: false,
            });
          });

          targetWindow.webContents.send("renderer:eval", {
            expression,
            responseChannel,
          });
        });
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  });

  return server;
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
async function tryCreateExtensionDevServer(port: number): Promise<any> {
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

        // Health check endpoint
        if (pathname === "/health" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
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
                "[Extension Dev MCP] Error handling streamable GET request:",
                error
              );
              if (!res.headersSent) {
                res.writeHead(500);
                res.end("Internal server error");
              }
            }
            return;
          }

          const workspacePath = parsedUrl.query.workspacePath as
            | string
            | undefined;

          const server = createExtensionDevMcpServer(workspacePath);

          // Create SSE transport
          const transport = new SSEServerTransport("/mcp", res);
          activeTransports.set(transport.sessionId, {
            transport,
            workspacePath,
          });


          // Connect server to transport
          server
            .connect(transport)
            .then(() => {
              transport.onclose = () => {
                activeTransports.delete(transport.sessionId);
              };
            })
            .catch((error) => {
              console.error("[Extension Dev MCP] Connection error:", error);
              activeTransports.delete(transport.sessionId);
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

          const legacyMetadata = legacyTransportSessionId
            ? activeTransports.get(legacyTransportSessionId)
            : undefined;

          if (legacyMetadata && !mcpSessionIdHeader) {
            try {
              await legacyMetadata.transport.handlePostMessage(req, res);
            } catch (error) {
              console.error(
                "[Extension Dev MCP] Error handling legacy SSE POST message:",
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

            const workspacePath = parsedUrl.query.workspacePath as
              | string
              | undefined;
            const server = createExtensionDevMcpServer(workspacePath);
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (streamableSessionId) => {
                activeStreamableTransports.set(streamableSessionId, {
                  transport,
                  workspacePath,
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
                "[Extension Dev MCP] Streamable transport error:",
                error
              );
            };

            await server.connect(transport);
            streamableMetadata = { transport, workspacePath };
          }

          try {
            await streamableMetadata.transport.handleRequest(
              req,
              res,
              parsedBody
            );
          } catch (error) {
            console.error(
              "[Extension Dev MCP] Error handling streamable POST request:",
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
              "[Extension Dev MCP] Error handling streamable DELETE request:",
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
