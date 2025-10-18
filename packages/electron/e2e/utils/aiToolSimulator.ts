/**
 * AI Tool Simulator - Test utility for simulating AI tool calls without actual AI
 *
 * This utility allows tests to simulate:
 * - applyDiff operations (text replacements)
 * - streamContent operations (streaming edits)
 * - getDocumentContent operations
 *
 * Usage:
 * ```typescript
 * import { simulateApplyDiff, simulateStreamContent } from './utils/aiToolSimulator';
 *
 * // Simulate a diff edit
 * await simulateApplyDiff(page, filePath, [
 *   { oldText: 'hello', newText: 'goodbye' }
 * ]);
 *
 * // Simulate streaming content
 * await simulateStreamContent(page, 'New content here', { insertAtEnd: true });
 * ```
 */

import type { Page } from '@playwright/test';

export interface TextReplacement {
  oldText: string;
  newText: string;
}

export interface StreamConfig {
  position?: string;
  insertAfter?: string;
  insertAtEnd?: boolean;
  mode?: 'append' | 'replace';
}

/**
 * Simulate an applyDiff operation by directly calling editorRegistry
 */
export async function simulateApplyDiff(
  page: Page,
  targetFilePath: string,
  replacements: TextReplacement[]
): Promise<{ success: boolean; error?: string }> {
  return await page.evaluate(
    async ({ filePath, reps }) => {
      // Access the already-loaded editorRegistry from window
      const editorRegistry = (window as any).__editorRegistry;

      if (!editorRegistry) {
        throw new Error('EditorRegistry not found on window');
      }

      // Get the active file path if not specified
      const target = filePath || editorRegistry.getActiveFilePath();

      if (!target) {
        return {
          success: false,
          error: 'No target file path available and no active editor'
        };
      }

      // Apply replacements directly
      return await editorRegistry.applyReplacements(target, reps);
    },
    { filePath: targetFilePath, reps: replacements }
  );
}

/**
 * Simulate a streamContent operation by directly calling editorRegistry
 */
export async function simulateStreamContent(
  page: Page,
  content: string,
  config: StreamConfig = {}
): Promise<void> {
  await page.evaluate(
    async ({ contentText, cfg }) => {
      // Access the already-loaded editorRegistry from window
      const editorRegistry = (window as any).__editorRegistry;

      if (!editorRegistry) {
        throw new Error('EditorRegistry not found on window');
      }

      const streamId = `stream-test-${Date.now()}`;

      // Get active file path
      const filePath = editorRegistry.getActiveFilePath();
      if (!filePath) {
        throw new Error('No active editor for streaming');
      }

      // Start streaming
      editorRegistry.startStreaming(filePath, {
        id: streamId,
        position: cfg.position || (cfg.insertAtEnd ? undefined : 'cursor'),
        insertAfter: cfg.insertAfter,
        insertAtEnd: cfg.insertAtEnd || false,
        mode: cfg.mode || 'append'
      });

      // Small delay to let React state update
      await new Promise(resolve => setTimeout(resolve, 50));

      // Stream content in chunks (simulate real streaming)
      const chunkSize = 50;
      for (let i = 0; i < contentText.length; i += chunkSize) {
        const chunk = contentText.slice(i, Math.min(i + chunkSize, contentText.length));
        editorRegistry.streamContent(filePath, streamId, chunk);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // End streaming
      editorRegistry.endStreaming(filePath, streamId);
    },
    { contentText: content, cfg: config }
  );
}

/**
 * Simulate getting document content
 */
export async function simulateGetDocumentContent(page: Page, filePath?: string): Promise<string> {
  return await page.evaluate(async (path) => {
    // Access the already-loaded editorRegistry from window
    const editorRegistry = (window as any).__editorRegistry;

    if (!editorRegistry) {
      throw new Error('EditorRegistry not found on window');
    }

    // Get target file path
    const target = path || editorRegistry.getActiveFilePath();
    if (!target) {
      throw new Error('No active editor');
    }

    return editorRegistry.getContent(target);
  }, filePath);
}

/**
 * Wait for editor to be ready (has content and is editable)
 */
export async function waitForEditorReady(page: Page, timeout = 5000): Promise<void> {
  await page.waitForSelector('.editor [contenteditable="true"]', { timeout, state: 'visible' });
  await page.waitForTimeout(100); // Small delay for Lexical initialization
}

/**
 * Get the active editor's file path
 */
export async function getActiveEditorFilePath(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const activeEditor = document.querySelector('.multi-editor-instance.active');
    return activeEditor?.getAttribute('data-file-path') || null;
  });
}

/**
 * Set up AI API for testing - expose editorRegistry on window
 */
export async function setupAIApiForTesting(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Wait for editorRegistry to be available
    const checkRegistry = () => {
      // Try to find it from any loaded module
      const modules = (window as any).__modules;
      if (modules) {
        for (const mod of Object.values(modules)) {
          if ((mod as any).editorRegistry) {
            (window as any).__editorRegistry = (mod as any).editorRegistry;
            return true;
          }
        }
      }
      return false;
    };

    // If not found, we'll need to wait for it to load
    if (!checkRegistry()) {
      console.log('[Test] EditorRegistry not yet available, will retry');
    }
  });
}

/**
 * Helper to create test markdown content
 */
export function createTestMarkdown(sections: Record<string, string>): string {
  return Object.entries(sections)
    .map(([heading, content]) => `# ${heading}\n\n${content}\n`)
    .join('\n');
}

/**
 * Helper to verify text exists in editor
 */
export async function verifyEditorContains(
  page: Page,
  text: string,
  shouldExist = true
): Promise<boolean> {
  const editorText = await page.evaluate(() => {
    const activeEditor = document.querySelector('.multi-editor-instance.active .editor');
    return activeEditor?.textContent || '';
  });

  const exists = editorText.includes(text);
  return shouldExist ? exists : !exists;
}

/**
 * Trigger manual save via IPC (simulates Cmd+S / File > Save menu action)
 *
 * This properly simulates how the Electron menu triggers a save by sending
 * the 'file-save' IPC event to the focused window.
 */
export async function triggerManualSave(electronApp: any): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }: any) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('file-save');
    }
  });
}

/**
 * Wait for file to be saved (dirty indicator disappears)
 */
export async function waitForSave(page: Page, fileName: string = 'test.md', timeout = 2000): Promise<void> {
  const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: fileName }) });
  await tab.locator('.tab-dirty-indicator').waitFor({ state: 'hidden', timeout });
}
