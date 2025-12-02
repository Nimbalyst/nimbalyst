import { BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { findWindowByWorkspace } from '../window/WindowManager';

/**
 * Service to provide wireframe screenshot capture capabilities
 * This runs in the electron main process and is called by the shared MCP server
 */
export class WireframeScreenshotService {
  private static instance: WireframeScreenshotService | null = null;

  // Store pending screenshot requests by request ID
  private pendingRequests = new Map<string, {
    resolve: (result: { success: boolean; imageBase64?: string; mimeType?: string; error?: string }) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  private constructor() {}

  public static getInstance(): WireframeScreenshotService {
    if (!WireframeScreenshotService.instance) {
      WireframeScreenshotService.instance = new WireframeScreenshotService();
    }
    return WireframeScreenshotService.instance;
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
   * Capture a screenshot of a wireframe file for MCP
   * This is called by the shared MCP server when the capture_wireframe_screenshot tool is invoked
   */
  public async captureScreenshotForMCP(filePath: string, workspacePath: string): Promise<{ success: boolean; imageBase64?: string; mimeType?: string; error?: string }> {
    // First, try to capture from an open window/tab (this includes user annotations)
    const openTabResult = await this.captureFromOpenTab(filePath, workspacePath);

    // If we got a successful result or a definitive error (not just "file not open"), return it
    if (openTabResult.success || !openTabResult.error?.includes('not open')) {
      return openTabResult;
    }

    // Fall back to headless capture (no annotations, but works for any file)
    console.log('[WireframeScreenshotService] File not open in tab, falling back to headless capture');
    return this.captureHeadless(filePath);
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
    const requestId = `wireframe-screenshot-${Date.now()}-${Math.random().toString(36).substring(7)}`;

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
        targetWindow!.webContents.send('wireframe:capture-screenshot', {
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
      // Read the wireframe HTML file
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
        throw new Error(`Failed to load wireframe HTML (file may be too large or contain invalid content): ${errorMsg}`);
      }

      // Wait for the page to fully render
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Capture the screenshot
      const image = await headlessWindow.webContents.capturePage();
      const pngBuffer = image.toPNG();
      const base64Data = pngBuffer.toString('base64');

      console.log('[WireframeScreenshotService] Headless screenshot captured successfully');

      return {
        success: true,
        imageBase64: base64Data,
        mimeType: 'image/png'
      };
    } catch (error) {
      console.error('[WireframeScreenshotService] Headless capture failed:', error);
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
    console.log('[WireframeScreenshotService] Cleanup complete');
  }
}
