import { BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { findWindowByWorkspace } from '../window/WindowManager';

/**
 * Service to provide mockup screenshot capture capabilities
 * This runs in the electron main process and is called by the shared MCP server
 */
export class MockupScreenshotService {
  private static instance: MockupScreenshotService | null = null;

  // Store pending screenshot requests by request ID
  private pendingRequests = new Map<string, {
    resolve: (result: { success: boolean; imageBase64?: string; mimeType?: string; error?: string }) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  private constructor() {}

  public static getInstance(): MockupScreenshotService {
    if (!MockupScreenshotService.instance) {
      MockupScreenshotService.instance = new MockupScreenshotService();
    }
    return MockupScreenshotService.instance;
  }

  /**
   * Handle screenshot result from renderer process
   */
  public handleScreenshotResult(requestId: string, result: { success: boolean; imageBase64?: string; mimeType?: string; error?: string }): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.resolve(result);
    }
  }

  /**
   * Capture a screenshot of a mockup file for MCP
   * This is called by the shared MCP server when the capture_mockup_screenshot tool is invoked
   */
  public async captureScreenshotForMCP(filePath: string, workspacePath: string): Promise<{ success: boolean; imageBase64?: string; mimeType?: string; error?: string }> {
    // First, try to capture from an open window/tab (this includes user annotations)
    const openTabResult = await this.captureFromOpenTab(filePath, workspacePath);

    // If successful, return the result with annotations
    if (openTabResult.success) {
      return openTabResult;
    }

    // If the file isn't open or the capture failed for rendering reasons, fall back to headless
    // Common failure reasons when file isn't open: "not open", "zero dimensions", "timeout"
    const errorLower = (openTabResult.error || '').toLowerCase();
    const shouldFallback = errorLower.includes('not open') ||
                           errorLower.includes('zero dimensions') ||
                           errorLower.includes('timeout') ||
                           errorLower.includes('iframe');

    if (shouldFallback) {
      console.log('[MockupScreenshotService] File not open or capture failed, falling back to headless capture');
      return this.captureHeadless(filePath);
    }

    // Some other error occurred - return it
    return openTabResult;
  }

  /**
   * Try to capture screenshot from an open tab (includes annotations)
   */
  private async captureFromOpenTab(filePath: string, workspacePath: string): Promise<{ success: boolean; imageBase64?: string; mimeType?: string; error?: string }> {
    // Find windows that might have this file open
    let targetWindow = findWindowByWorkspace(workspacePath);

    // If no window found for workspace, try all windows
    if (!targetWindow) {
      const allWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
      if (allWindows.length > 0) {
        targetWindow = allWindows[0];
      }
    }

    if (!targetWindow || targetWindow.isDestroyed()) {
      return {
        success: false,
        error: 'File not open in any window'
      };
    }

    // Generate unique request ID
    const requestId = `mockup-screenshot-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Create promise for the result
    return new Promise((resolve) => {
      // Set timeout for the request (shorter timeout since we'll fall back to headless)
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({
          success: false,
          error: 'File not open in tab (timeout)'
        });
      }, 5000); // 5 second timeout for open tab check

      this.pendingRequests.set(requestId, { resolve, reject: () => {}, timeout });

      // Send IPC message to renderer to capture screenshot
      try {
        targetWindow!.webContents.send('mockup:capture-screenshot', {
          requestId,
          filePath
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        resolve({
          success: false,
          error: 'File not open in tab'
        });
      }
    });
  }

  /**
   * Capture screenshot using a headless BrowserWindow
   * This works even when the file isn't open, but won't include user annotations
   */
  private async captureHeadless(filePath: string): Promise<{ success: boolean; imageBase64?: string; mimeType?: string; error?: string }> {
    let headlessWindow: BrowserWindow | null = null;

    try {
      // Read the mockup HTML file
      const htmlContent = await fs.readFile(filePath, 'utf-8');

      // Create a hidden window for rendering
      headlessWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          offscreen: true
        }
      });

      // Load the HTML content
      // We need to set a base URL so relative paths work correctly
      const baseDir = path.dirname(filePath);
      const baseUrl = `file://${baseDir}/`;

      // Inject base tag for relative paths
      const htmlWithBase = htmlContent.includes('<base')
        ? htmlContent
        : htmlContent.replace(/<head>/i, `<head><base href="${baseUrl}">`);

      try {
        await headlessWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlWithBase)}`);
      } catch (loadError) {
        const errorMsg = loadError instanceof Error ? loadError.message : 'Unknown error';
        throw new Error(`Failed to load mockup HTML (file may be too large or contain invalid content): ${errorMsg}`);
      }

      // Wait for the page to fully render
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Capture the screenshot
      const image = await headlessWindow.webContents.capturePage();

      // Validate that we got a non-empty image
      if (image.isEmpty()) {
        throw new Error('capturePage returned an empty image. The page may not have rendered correctly.');
      }

      const size = image.getSize();
      if (size.width === 0 || size.height === 0) {
        throw new Error(`Screenshot has zero dimensions (${size.width}x${size.height}). The page may not have rendered correctly.`);
      }

      const pngBuffer = image.toPNG();
      if (pngBuffer.length === 0) {
        throw new Error('PNG conversion produced empty buffer.');
      }

      const base64Data = pngBuffer.toString('base64');
      if (base64Data.length === 0) {
        throw new Error('Base64 encoding produced empty string.');
      }

      console.log(`[MockupScreenshotService] Headless screenshot captured successfully (${size.width}x${size.height}, ${base64Data.length} bytes)`);

      return {
        success: true,
        imageBase64: base64Data,
        mimeType: 'image/png'
      };
    } catch (error) {
      console.error('[MockupScreenshotService] Headless capture failed:', error);
      return {
        success: false,
        error: `Failed to capture screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    } finally {
      // Clean up the headless window
      if (headlessWindow && !headlessWindow.isDestroyed()) {
        headlessWindow.close();
      }
    }
  }

  /**
   * Cleanup pending requests on shutdown
   */
  public cleanup(): void {
    // Cancel all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.resolve({
        success: false,
        error: 'Service shutting down'
      });
    }
    this.pendingRequests.clear();
    console.log('[MockupScreenshotService] Cleanup complete');
  }
}
