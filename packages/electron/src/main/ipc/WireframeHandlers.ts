import { ipcMain } from 'electron';
import { WireframeScreenshotService } from '../services/WireframeScreenshotService';

/**
 * Register IPC handlers for wireframe-related operations
 */
export function registerWireframeHandlers() {
  // Handle screenshot result from renderer
  ipcMain.handle('wireframe:screenshot-result', (_event, payload: {
    requestId: string;
    success: boolean;
    imageBase64?: string;
    mimeType?: string;
    error?: string;
  }) => {
    const service = WireframeScreenshotService.getInstance();
    service.handleScreenshotResult(payload.requestId, {
      success: payload.success,
      imageBase64: payload.imageBase64,
      mimeType: payload.mimeType,
      error: payload.error
    });
    return { success: true };
  });
}
