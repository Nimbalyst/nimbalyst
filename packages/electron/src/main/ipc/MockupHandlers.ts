/**
 * IPC handlers for mockup-related operations.
 *
 * Provides handlers for:
 * - Capturing and saving mockup screenshots
 * - File existence and modification time checks
 */

import { BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { MockupScreenshotService } from '../services/MockupScreenshotService';
import { logger } from '../utils/logger';
import { safeHandle, safeOn } from '../utils/ipcRegistry';
import { getWindowId, windowStates } from '../window/WindowManager';

/**
 * Register IPC handlers for mockup operations.
 */
export function registerMockupHandlers(): void {
  // Handle screenshot result from renderer
  safeHandle('mockup:screenshot-result', (_event, payload: {
    requestId: string;
    success: boolean;
    imageBase64?: string;
    mimeType?: string;
    error?: string;
  }) => {
    const service = MockupScreenshotService.getInstance();
    service.handleScreenshotResult(payload.requestId, {
      success: payload.success,
      imageBase64: payload.imageBase64,
      mimeType: payload.mimeType,
      error: payload.error
    });
    return { success: true };
  });

  // Capture mockup screenshot and save to file
  safeHandle(
    'mockup:capture-and-save-screenshot',
    async (_event, mockupPath: string, outputPath: string) => {
      logger.main.info(`[MockupHandlers] Capturing screenshot: ${mockupPath} -> ${outputPath}`);

      try {
        // Get the workspace path from the mockup path
        // We assume the workspace is a parent directory
        const workspacePath = path.dirname(mockupPath);

        // Use the existing MockupScreenshotService
        const service = MockupScreenshotService.getInstance();
        const result = await service.captureScreenshotForMCP(
          mockupPath,
          workspacePath,
        );

        if (!result.success || !result.imageBase64) {
          return {
            success: false,
            error: result.error || 'Failed to capture screenshot',
          };
        }

        // Ensure the output directory exists
        const outputDir = path.dirname(outputPath);
        await fs.mkdir(outputDir, { recursive: true });

        // Convert base64 to buffer and write to file
        const imageBuffer = Buffer.from(result.imageBase64, 'base64');
        await fs.writeFile(outputPath, imageBuffer);

        logger.main.info(`[MockupHandlers] Screenshot saved: ${outputPath}`);

        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        logger.main.error(`[MockupHandlers] Failed to capture and save screenshot: ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
  );

  // Get file modification time
  safeHandle('file:get-modified-time', async (_event, filePath: string) => {
    try {
      const stats = await fs.stat(filePath);
      return stats.mtimeMs;
    } catch (error) {
      logger.main.error(`[MockupHandlers] Failed to get file modified time for ${filePath}:`, error);
      throw error;
    }
  });

  // Check if file exists
  safeHandle('file:exists', async (_event, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // List all mockup files in the workspace
  safeHandle('mockup:list-mockups', async (event) => {
    try {
      // Get the workspace path from the sender window
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      if (!senderWindow) {
        return [];
      }

      // Get workspace path from window state
      const windowId = getWindowId(senderWindow);
      if (windowId === null) {
        return [];
      }
      const state = windowStates.get(windowId);
      const workspacePath = state?.workspacePath;

      if (!workspacePath) {
        return [];
      }

      // Recursively find all .mockup.html files
      const mockups: Array<{
        absolutePath: string;
        relativePath: string;
        name: string;
      }> = [];

      async function scanDirectory(dir: string): Promise<void> {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            // Skip hidden directories and node_modules
            if (entry.isDirectory()) {
              if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                await scanDirectory(fullPath);
              }
            } else if (entry.name.endsWith('.mockup.html') && workspacePath) {
              mockups.push({
                absolutePath: fullPath,
                relativePath: path.relative(workspacePath, fullPath),
                name: entry.name.replace('.mockup.html', ''),
              });
            }
          }
        } catch (error) {
          // Ignore permission errors
        }
      }

      await scanDirectory(workspacePath);
      return mockups;
    } catch (error) {
      logger.main.error('[MockupHandlers] Failed to list mockups:', error);
      return [];
    }
  });

  // Create a new mockup file
  safeHandle(
    'mockup:create-mockup',
    async (_event, name: string, directory: string) => {
      try {
        const fileName = `${name}.mockup.html`;
        const filePath = path.join(directory, fileName);

        // Check if file already exists
        try {
          await fs.access(filePath);
          return {
            success: false,
            error: `Mockup "${fileName}" already exists`,
          };
        } catch {
          // File doesn't exist, which is what we want
        }

        // Create a basic mockup template
        const template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }
    .mockup-container {
      background: white;
      border: 2px dashed #ccc;
      border-radius: 8px;
      min-height: 400px;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="mockup-container">
    <p>Edit this mockup to create your design</p>
  </div>
</body>
</html>`;

        await fs.writeFile(filePath, template, 'utf-8');
        logger.main.info(`[MockupHandlers] Created mockup: ${filePath}`);

        return { success: true, filePath };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        logger.main.error(`[MockupHandlers] Failed to create mockup: ${errorMessage}`);
        return { success: false, error: errorMessage };
      }
    },
  );

  logger.main.info('[MockupHandlers] Mockup handlers registered');
}
