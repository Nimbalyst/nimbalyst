import { dialog, BrowserWindow } from 'electron';
import { safeHandle } from '../utils/ipcRegistry';
import { writeFile } from 'fs/promises';
import { logger } from '../utils/logger';

/**
 * Registers IPC handlers for export functionality.
 */
export function registerExportHandlers() {
  /**
   * Show save dialog for PDF export and return the selected path.
   */
  safeHandle(
    'export:showSaveDialogPdf',
    async (
      event,
      options: {
        defaultPath?: string;
      }
    ): Promise<string | null> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions: Electron.SaveDialogOptions = {
        title: 'Export to PDF',
        buttonLabel: 'Export',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        defaultPath: options?.defaultPath,
      };

      const result = window
        ? await dialog.showSaveDialog(window, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);

      if (result.canceled || !result.filePath) {
        return null;
      }

      return result.filePath;
    }
  );

  /**
   * Export HTML content to PDF using Electron's printToPDF.
   * Creates a hidden window, loads the HTML, and generates a PDF.
   */
  safeHandle(
    'export:htmlToPdf',
    async (
      _event,
      options: {
        html: string;
        outputPath: string;
        pageSize?: 'A4' | 'Letter' | 'Legal';
        landscape?: boolean;
        margins?: {
          top?: number;
          bottom?: number;
          left?: number;
          right?: number;
        };
      }
    ): Promise<{ success: boolean; error?: string }> => {
      const { html, outputPath, pageSize = 'Letter', landscape = false, margins } = options;

      let hiddenWindow: BrowserWindow | null = null;

      try {
        // Create a hidden window for PDF generation
        hiddenWindow = new BrowserWindow({
          show: false,
          width: 800,
          height: 600,
          webPreferences: {
            offscreen: true,
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        // Load the HTML content
        await hiddenWindow.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
        );

        // Wait for content to be fully rendered
        // Give the page a moment to render any dynamic content
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Generate PDF with options
        const pdfBuffer = await hiddenWindow.webContents.printToPDF({
          printBackground: true,
          pageSize: pageSize,
          landscape: landscape,
          margins: margins
            ? {
                marginType: 'custom',
                top: margins.top ?? 0.4,
                bottom: margins.bottom ?? 0.4,
                left: margins.left ?? 0.4,
                right: margins.right ?? 0.4,
              }
            : {
                marginType: 'default',
              },
        });

        // Write the PDF to file
        await writeFile(outputPath, pdfBuffer);

        logger.file.info(`[ExportHandlers] PDF exported successfully to: ${outputPath}`);

        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.file.error(`[ExportHandlers] PDF export failed: ${errorMessage}`);
        return { success: false, error: errorMessage };
      } finally {
        // Clean up the hidden window
        if (hiddenWindow && !hiddenWindow.isDestroyed()) {
          hiddenWindow.close();
        }
      }
    }
  );
}
