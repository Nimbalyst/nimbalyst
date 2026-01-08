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
import { ExtensionLogService } from '../services/ExtensionLogService';
import { database } from '../database/initialize';

// ============================================================================
// Manifest Validation
// ============================================================================

interface ManifestWarning {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Validate extension manifest and return warnings/errors
 */
function validateManifest(manifestPath: string): { valid: boolean; warnings: ManifestWarning[] } {
  const warnings: ManifestWarning[] = [];

  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content);

    // Required fields
    if (!manifest.id) {
      warnings.push({ field: 'id', message: 'Missing required field "id"', severity: 'error' });
    } else if (!manifest.id.includes('.')) {
      warnings.push({ field: 'id', message: 'Extension id should use reverse domain notation (e.g., "com.example.my-extension")', severity: 'warning' });
    }

    if (!manifest.name) {
      warnings.push({ field: 'name', message: 'Missing required field "name"', severity: 'error' });
    }

    if (!manifest.version) {
      warnings.push({ field: 'version', message: 'Missing required field "version"', severity: 'error' });
    }

    if (!manifest.main) {
      warnings.push({ field: 'main', message: 'Missing required field "main"', severity: 'error' });
    }

    if (!manifest.apiVersion) {
      warnings.push({ field: 'apiVersion', message: 'Missing required field "apiVersion"', severity: 'warning' });
    }

    // Validate contributions
    if (manifest.contributions) {
      // Validate aiTools - must be array of strings, not objects
      if (manifest.contributions.aiTools && Array.isArray(manifest.contributions.aiTools)) {
        const invalidTools = manifest.contributions.aiTools.filter(
          (tool: unknown) => typeof tool !== 'string'
        );
        if (invalidTools.length > 0) {
          warnings.push({
            field: 'contributions.aiTools',
            message: `aiTools must be an array of strings (tool names), not objects. Found ${invalidTools.length} object(s). The tool definitions with descriptions belong in your TypeScript code, not the manifest. See: https://docs.nimbalyst.com/extensions/manifest-reference#aitools`,
            severity: 'error'
          });
        }
      }

      // Validate customEditors
      if (manifest.contributions.customEditors && Array.isArray(manifest.contributions.customEditors)) {
        manifest.contributions.customEditors.forEach((editor: any, idx: number) => {
          if (!editor.filePatterns || !Array.isArray(editor.filePatterns)) {
            warnings.push({
              field: `contributions.customEditors[${idx}].filePatterns`,
              message: 'customEditor must have a "filePatterns" array',
              severity: 'error'
            });
          }
          if (!editor.displayName) {
            warnings.push({
              field: `contributions.customEditors[${idx}].displayName`,
              message: 'customEditor must have a "displayName"',
              severity: 'error'
            });
          }
          if (!editor.component) {
            warnings.push({
              field: `contributions.customEditors[${idx}].component`,
              message: 'customEditor must have a "component" name',
              severity: 'error'
            });
          }
        });
      }

      // Validate newFileMenu
      if (manifest.contributions.newFileMenu && Array.isArray(manifest.contributions.newFileMenu)) {
        manifest.contributions.newFileMenu.forEach((item: any, idx: number) => {
          if (!item.extension) {
            warnings.push({
              field: `contributions.newFileMenu[${idx}].extension`,
              message: 'newFileMenu item must have an "extension" field',
              severity: 'error'
            });
          }
          if (!item.displayName) {
            warnings.push({
              field: `contributions.newFileMenu[${idx}].displayName`,
              message: 'newFileMenu item must have a "displayName" (not "label")',
              severity: 'error'
            });
          }
          if (item.label && !item.displayName) {
            warnings.push({
              field: `contributions.newFileMenu[${idx}]`,
              message: 'newFileMenu uses "displayName", not "label". Please rename the field.',
              severity: 'error'
            });
          }
          if (!item.icon) {
            warnings.push({
              field: `contributions.newFileMenu[${idx}].icon`,
              message: 'newFileMenu item must have an "icon" field (Material icon name)',
              severity: 'error'
            });
          }
        });
      }
    }

    const hasErrors = warnings.some(w => w.severity === 'error');
    return { valid: !hasErrors, warnings };
  } catch (error) {
    if (error instanceof SyntaxError) {
      warnings.push({ field: 'manifest.json', message: `Invalid JSON: ${error.message}`, severity: 'error' });
    } else {
      warnings.push({ field: 'manifest.json', message: `Failed to read manifest: ${error}`, severity: 'error' });
    }
    return { valid: false, warnings };
  }
}

/**
 * Validate the built extension output for common issues
 */
function validateBuiltExtension(extensionPath: string, manifestPath: string): ManifestWarning[] {
  const warnings: ManifestWarning[] = [];

  try {
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);

    // Validate that the main entry point file actually exists
    if (manifest.main) {
      const mainPath = path.join(extensionPath, manifest.main);
      if (!fs.existsSync(mainPath)) {
        warnings.push({
          field: 'main',
          message: `Main entry point file not found at "${manifest.main}". The file "${mainPath}" does not exist. Make sure your vite.config.ts output filename matches the manifest.json "main" field. Common issue: manifest says "dist/index.mjs" but Vite outputs "dist/index.js".`,
          severity: 'error'
        });
      }
    }

    // Check if extension has customEditors - if so, verify components export exists
    if (manifest.contributions?.customEditors?.length > 0 && manifest.main) {
      const mainPath = path.join(extensionPath, manifest.main);

      if (fs.existsSync(mainPath)) {
        const mainContent = fs.readFileSync(mainPath, 'utf8');

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
          const componentNames = manifest.contributions.customEditors.map((e: any) => e.component).join(', ');
          warnings.push({
            field: 'src/index.ts',
            message: `Extension has customEditors but no "components" export found in the built output.\n\nYour entry point (src/index.ts) must export a "components" object that maps component names to React components:\n\nexport const components = {\n  ${componentNames}: YourComponentFunction,\n};\n\nThe keys must match the "component" field in manifest.json contributions.customEditors[].component.\n\nYou are currently only exporting the component directly (e.g., "export { ${componentNames} }") but Nimbalyst requires a "components" object wrapper.`,
            severity: 'error'
          });
        } else {
          // Check if specific component names are in the export section
          for (const editor of manifest.contributions.customEditors) {
            if (editor.component && !exportSection.includes(editor.component)) {
              warnings.push({
                field: `contributions.customEditors`,
                message: `Component "${editor.component}" referenced in manifest but not found in the export section. Make sure to export it in the components object.`,
                severity: 'warning'
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
        const mainContent = fs.readFileSync(mainPath, 'utf8');

        // Check for aiTools export
        const hasAiToolsExport =
          mainContent.includes('aiTools') &&
          (mainContent.includes('export') || mainContent.includes('exports'));

        if (!hasAiToolsExport) {
          warnings.push({
            field: 'src/index.ts',
            message: `Extension declares aiTools in manifest but no "aiTools" export found in built output. Your entry point must export an aiTools array. Example:\n\nexport const aiTools: ExtensionAITool[] = [...];`,
            severity: 'error'
          });
        }
      }
    }
  } catch (error) {
    // Don't fail validation if we can't check the built output
    console.warn('[Extension Dev MCP] Could not validate built output:', error);
  }

  return warnings;
}

/**
 * Format manifest warnings for display
 */
function formatManifestWarnings(warnings: ManifestWarning[]): string {
  if (warnings.length === 0) return '';

  const errors = warnings.filter(w => w.severity === 'error');
  const warns = warnings.filter(w => w.severity === 'warning');

  let result = '\n\n--- Manifest Validation ---\n';

  if (errors.length > 0) {
    result += `\nERRORS (${errors.length}):\n`;
    errors.forEach(e => {
      result += `  - [${e.field}] ${e.message}\n`;
    });
  }

  if (warns.length > 0) {
    result += `\nWARNINGS (${warns.length}):\n`;
    warns.forEach(w => {
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

    // Try to get extension ID from manifest for log tagging
    let extensionId: string | undefined;
    const manifestPath = path.join(extensionPath, 'manifest.json');
    try {
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        extensionId = manifest.id;
      }
    } catch {
      // Ignore manifest errors during build - they'll be caught in validation
    }

    const logService = ExtensionLogService.getInstance();

    // Log build start
    logService.addMainLog('info', `Starting build for extension: ${extensionId || extensionPath}`, extensionId);

    let stdout = '';
    let stderr = '';

    const child = spawn('npm', ['run', 'build'], {
      cwd: extensionPath,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' }
    });

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Log build output as it comes in
      if (extensionId) {
        logService.addBuildLog(extensionId, chunk, false);
      }
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Log build errors as they come in
      if (extensionId) {
        logService.addBuildLog(extensionId, chunk, true);
      }
    });

    child.on('close', (code) => {
      const success = code === 0;
      logService.addMainLog(
        success ? 'info' : 'error',
        `Build ${success ? 'succeeded' : 'failed'} for extension: ${extensionId || extensionPath}`,
        extensionId
      );
      resolve({
        success,
        stdout,
        stderr
      });
    });

    child.on('error', (error) => {
      logService.addMainLog('error', `Build process error: ${error.message}`, extensionId);
      resolve({
        success: false,
        stdout,
        stderr: stderr + '\n' + error.message
      });
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      child.kill();
      logService.addMainLog('error', 'Build timed out after 60 seconds', extensionId);
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
              },
              {
                name: 'restart_nimbalyst',
                description: 'Restart the Nimbalyst application. Only use this tool when the user explicitly asks you to restart Nimbalyst. This will close all windows and relaunch the app.',
                inputSchema: {
                  type: 'object',
                  properties: {},
                  required: []
                }
              },
              {
                name: 'extension_get_logs',
                description: 'Get recent logs from extension development. Includes console output from the renderer (extension code), main process logs, and build output. Use this to debug extension issues.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    extensionId: {
                      type: 'string',
                      description: 'Filter logs to a specific extension ID (optional)'
                    },
                    lastSeconds: {
                      type: 'number',
                      description: 'Get logs from the last N seconds (default: 60, max: 300)'
                    },
                    logLevel: {
                      type: 'string',
                      enum: ['error', 'warn', 'info', 'debug', 'all'],
                      description: 'Minimum log level to include (default: all)'
                    },
                    source: {
                      type: 'string',
                      enum: ['renderer', 'main', 'build', 'all'],
                      description: 'Log source to filter (default: all)'
                    }
                  }
                }
              },
              {
                name: 'extension_get_status',
                description: 'Get the current status of an installed extension, including whether it loaded successfully and what it contributes (custom editors, AI tools, etc.).',
                inputSchema: {
                  type: 'object',
                  properties: {
                    extensionId: {
                      type: 'string',
                      description: 'The extension ID to query'
                    }
                  },
                  required: ['extensionId']
                }
              },
              {
                name: 'database_query',
                description: 'Execute a SELECT query against the Nimbalyst PGLite database. Only SELECT queries are allowed for safety. Useful for debugging and inspecting application state. Available tables include: ai_sessions, ai_agent_messages, document_history, session_files, queued_prompts, tracker_items.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    sql: {
                      type: 'string',
                      description: 'The SELECT SQL query to execute. Must start with SELECT.'
                    }
                  },
                  required: ['sql']
                }
              },
              {
                name: 'get_environment_info',
                description: 'Get information about the Nimbalyst environment including whether the app is running in development mode or as a packaged build. Use this to verify code changes will take effect.',
                inputSchema: {
                  type: 'object',
                  properties: {},
                  required: []
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

              // Validate manifest before installing
              const validation = validateManifest(manifestPath);

              // Also validate built output for required exports
              const builtValidation = validateBuiltExtension(normalizedPath, manifestPath);
              const allWarnings = [...validation.warnings, ...builtValidation];
              const validationOutput = formatManifestWarnings(allWarnings);

              const hasErrors = allWarnings.some(w => w.severity === 'error');
              if (hasErrors) {
                return {
                  content: [{
                    type: 'text',
                    text: `Installation blocked due to errors.${validationOutput}\n\nPlease fix these errors and try again.`
                  }],
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
                      text: `Extension installed successfully!\n\nExtension ID: ${result.extensionId}${validationOutput}`
                    }],
                    isError: false
                  };
                } else {
                  return {
                    content: [{
                      type: 'text',
                      text: `Installation failed: ${result.error}${validationOutput}`
                    }],
                    isError: true
                  };
                }
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                return {
                  content: [{ type: 'text', text: `Installation error: ${errorMessage}${validationOutput}` }],
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
              const manifestPath = path.join(normalizedPath, 'manifest.json');

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

              // Step 2: Validate manifest after build
              const validation = validateManifest(manifestPath);

              // Step 2b: Validate built output (check for required exports)
              const builtValidation = validateBuiltExtension(normalizedPath, manifestPath);
              const allWarnings = [...validation.warnings, ...builtValidation];
              const validationOutput = formatManifestWarnings(allWarnings);

              const hasErrors = allWarnings.some(w => w.severity === 'error');
              if (hasErrors) {
                return {
                  content: [{
                    type: 'text',
                    text: `Build succeeded but extension has errors.${validationOutput}\n\nPlease fix these errors and reload again.\n\nBuild output:\n${buildResult.stdout}`
                  }],
                  isError: true
                };
              }

              // Step 3: Reload the extension in the running app
              if (reloadExtensionFn) {
                try {
                  const result = await reloadExtensionFn(extensionId, normalizedPath);
                  if (result.success) {
                    return {
                      content: [{
                        type: 'text',
                        text: `Extension ${extensionId} rebuilt and reloaded successfully!${validationOutput}\n\nBuild output:\n${buildResult.stdout}`
                      }],
                      isError: false
                    };
                  } else {
                    return {
                      content: [{
                        type: 'text',
                        text: `Build succeeded but reload failed: ${result.error}${validationOutput}\n\nBuild output:\n${buildResult.stdout}`
                      }],
                      isError: true
                    };
                  }
                } catch (error) {
                  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                  return {
                    content: [{
                      type: 'text',
                      text: `Build succeeded but reload error: ${errorMessage}${validationOutput}\n\nBuild output:\n${buildResult.stdout}`
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
                        text: `Extension rebuilt and reinstalled successfully!${validationOutput}\n\nBuild output:\n${buildResult.stdout}`
                      }],
                      isError: false
                    };
                  } else {
                    return {
                      content: [{
                        type: 'text',
                        text: `Build succeeded but reinstall failed: ${installResult.error}${validationOutput}\n\nBuild output:\n${buildResult.stdout}`
                      }],
                      isError: true
                    };
                  }
                } catch (error) {
                  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                  return {
                    content: [{
                      type: 'text',
                      text: `Build succeeded but reinstall error: ${errorMessage}${validationOutput}\n\nBuild output:\n${buildResult.stdout}`
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

            case 'restart_nimbalyst': {
              console.log('[Extension Dev MCP] Restarting Nimbalyst...');

              const { app } = await import('electron');

              // Check if we're in dev mode (electron-vite spawns both vite and electron)
              const isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL;

              if (isDev) {
                // In dev mode, write a restart signal file and quit.
                // The outer dev-loop.sh script watches for this file and restarts npm run dev.
                // This avoids complex process killing and ensures clean restarts.
                const workingDir = app.getAppPath();
                const restartSignalPath = path.join(workingDir, '.restart-requested');

                console.log(`[Extension Dev MCP] Dev mode restart: writing signal to ${restartSignalPath}`);

                fs.writeFileSync(restartSignalPath, Date.now().toString(), 'utf8');

                // Give the file a moment to be written, then quit
                setTimeout(() => {
                  app.quit();
                }, 100);

                return {
                  content: [{ type: 'text', text: 'Restart requested. The dev server will relaunch shortly.' }],
                  isError: false
                };
              } else {
                // In production, use the standard relaunch mechanism
                app.relaunch();
                app.exit(0);

                return {
                  content: [{ type: 'text', text: 'Restarting Nimbalyst...' }],
                  isError: false
                };
              }
            }

            case 'extension_get_logs': {
              const logService = ExtensionLogService.getInstance();

              // Parse filter options
              const extensionId = args?.extensionId as string | undefined;
              let lastSeconds = args?.lastSeconds as number | undefined;
              const logLevel = args?.logLevel as 'error' | 'warn' | 'info' | 'debug' | 'all' | undefined;
              const source = args?.source as 'renderer' | 'main' | 'build' | 'all' | undefined;

              // Validate and cap lastSeconds
              if (lastSeconds !== undefined) {
                lastSeconds = Math.min(Math.max(1, lastSeconds), 300);
              }

              const logs = logService.getLogs({
                extensionId,
                lastSeconds: lastSeconds || 60,
                logLevel: logLevel || 'all',
                source: source || 'all'
              });

              const stats = logService.getStats();
              const formattedLogs = logService.formatLogsForResponse(logs);

              // Build summary header
              const filterDesc = [
                extensionId ? `extension: ${extensionId}` : null,
                `last ${lastSeconds || 60}s`,
                logLevel && logLevel !== 'all' ? `level: ${logLevel}+` : null,
                source && source !== 'all' ? `source: ${source}` : null
              ].filter(Boolean).join(', ');

              const header = `Extension Development Logs (${filterDesc})\n` +
                `Found ${logs.length} log entries (buffer: ${stats.totalEntries}/${1000})\n` +
                `Errors: ${stats.byLevel.error}, Warnings: ${stats.byLevel.warn}, ` +
                `Info: ${stats.byLevel.info}, Debug: ${stats.byLevel.debug}\n` +
                `---\n`;

              return {
                content: [{ type: 'text', text: header + formattedLogs }],
                isError: false
              };
            }

            case 'extension_get_status': {
              const extensionId = args?.extensionId as string;

              if (!extensionId) {
                return {
                  content: [{ type: 'text', text: 'Error: extensionId is required' }],
                  isError: true
                };
              }

              // Query extension status via IPC to renderer
              // We need to send a message to all windows and collect responses
              const { BrowserWindow } = await import('electron');
              const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());

              if (windows.length === 0) {
                return {
                  content: [{ type: 'text', text: 'Error: No windows available to query extension status' }],
                  isError: true
                };
              }

              // Create a promise that resolves with extension status
              return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                  resolve({
                    content: [{ type: 'text', text: `Extension ${extensionId}: Status query timed out. Extension may not be loaded.` }],
                    isError: false
                  });
                }, 5000);

                // Send query to first available window
                const targetWindow = windows[0];

                // Use a unique channel for the response
                const responseChannel = `extension-status-response-${Date.now()}`;

                const { ipcMain } = require('electron');
                ipcMain.once(responseChannel, (_event: any, result: any) => {
                  clearTimeout(timeout);

                  if (!result || result.error) {
                    resolve({
                      content: [{ type: 'text', text: `Extension ${extensionId}: Not found or not loaded.\n${result?.error || ''}` }],
                      isError: false
                    });
                    return;
                  }

                  // Format the status response
                  const status = result.status || 'unknown';
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
                      response += `  - ${editor.displayName} (${editor.filePatterns?.join(', ')})\n`;
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
                    content: [{ type: 'text', text: response }],
                    isError: false
                  });
                });

                // Send query to renderer
                targetWindow.webContents.send('extension:get-status', {
                  extensionId,
                  responseChannel
                });
              });
            }

            case 'database_query': {
              const sql = args?.sql as string;

              if (!sql) {
                return {
                  content: [{ type: 'text', text: 'Error: sql is required' }],
                  isError: true
                };
              }

              // Safety check: only allow SELECT queries
              const trimmedSQL = sql.trim().toLowerCase();
              if (!trimmedSQL.startsWith('select')) {
                return {
                  content: [{
                    type: 'text',
                    text: 'Error: Only SELECT queries are allowed for safety. Write operations are not permitted through this tool.'
                  }],
                  isError: true
                };
              }

              console.log(`[Extension Dev MCP] Executing database query: ${sql.substring(0, 100)}...`);

              try {
                const result = await database.query(sql);

                // Format results for display
                const rowCount = result.rows.length;
                let responseText = `Query executed successfully.\n\nRows returned: ${rowCount}\n`;

                if (rowCount > 0) {
                  // Get column names from first row
                  const columns = Object.keys(result.rows[0]);
                  responseText += `Columns: ${columns.join(', ')}\n\n`;

                  // Format as JSON for readability (limit to first 100 rows to avoid huge responses)
                  const displayRows = result.rows.slice(0, 100);
                  responseText += JSON.stringify(displayRows, null, 2);

                  if (rowCount > 100) {
                    responseText += `\n\n... and ${rowCount - 100} more rows (truncated)`;
                  }
                } else {
                  responseText += '\nNo rows returned.';
                }

                return {
                  content: [{ type: 'text', text: responseText }],
                  isError: false
                };
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                return {
                  content: [{ type: 'text', text: `Query error: ${errorMessage}` }],
                  isError: true
                };
              }
            }

            case 'get_environment_info': {
              const { app } = await import('electron');
              const isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL;
              const isPackaged = app.isPackaged;
              const appVersion = app.getVersion();

              let responseText = `Nimbalyst Environment Info:\n\n`;
              responseText += `- App Version: ${appVersion}\n`;
              responseText += `- Development Mode: ${isDev ? 'YES' : 'NO'}\n`;
              responseText += `- Packaged Build: ${isPackaged ? 'YES' : 'NO'}\n`;
              responseText += `- NODE_ENV: ${process.env.NODE_ENV || 'not set'}\n`;

              if (!isDev || isPackaged) {
                responseText += `\nWARNING: Nimbalyst is running as a PACKAGED BUILD, not in development mode.\n`;
                responseText += `Code changes you make will NOT be reflected in this running instance.\n`;
                responseText += `Ask the user to run the dev server (npm run dev) if they want to test code changes.`;
              } else {
                responseText += `\nNimbalyst is running in development mode. Code changes will be reflected after hot reload or restart.`;
              }

              return {
                content: [{ type: 'text', text: responseText }],
                isError: false
              };
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

        // console.log(`[Extension Dev MCP] New connection, workspace: ${workspacePath || 'none'}`);

        // Connect server to transport
        server.connect(transport).then(() => {
          transport.onclose = () => {
            // console.log(`[Extension Dev MCP] Connection closed`);
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
