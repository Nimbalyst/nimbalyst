import { ipcMain } from 'electron';
import { MockupScreenshotService } from '../services/MockupScreenshotService';

/**
 * Register IPC handlers for mockup-related operations
 */
export function registerMockupHandlers() {
  // Handle screenshot result from renderer
  ipcMain.handle('mockup:screenshot-result', (_event, payload: {
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
}
