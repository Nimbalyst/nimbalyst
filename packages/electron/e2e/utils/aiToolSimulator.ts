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
 * Simulate an applyDiff operation by writing changes to disk (triggers file watcher)
 * This properly simulates the AI edit flow with tags and file watching
 */
export async function simulateApplyDiff(
  page: Page,
  targetFilePath: string,
  replacements: TextReplacement[]
): Promise<{ success: boolean; error?: string }> {
  const fs = await import('fs/promises');

  try {
    // Read current file content
    const currentContent = await fs.readFile(targetFilePath, 'utf8');

    // Apply all replacements
    let modifiedContent = currentContent;
    for (const replacement of replacements) {
      modifiedContent = modifiedContent.replace(replacement.oldText, replacement.newText);
    }

    // Write modified content to disk - this triggers file watcher
    await fs.writeFile(targetFilePath, modifiedContent, 'utf8');

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
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
 * Accept all pending diffs in the active editor
 */
export async function acceptDiffs(page: Page): Promise<void> {
  // Click the Accept All button using Playwright locator
  const acceptButton = page.locator('button:has-text("Accept All")').first();

  try {
    // Wait for the button to appear (it should already be there if there are diffs)
    await acceptButton.waitFor({ state: 'visible', timeout: 2000 });
    await acceptButton.click();
  } catch (e) {
    console.warn('[Test] Accept All button not found or not clickable');
  }

  // Wait for diffs to be processed
  await page.waitForTimeout(300);
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

/**
 * Query all tags for a file from the database (returns full metadata)
 * This includes status, sessionId, tagId, etc.
 */
export async function queryTags(electronApp: any, filePath: string): Promise<any[]> {
  const page = await electronApp.firstWindow();
  return page.evaluate(async (filePath: string) => {
    return await window.electronAPI.invoke('history:get-all-tags', filePath);
  }, filePath);
}

/**
 * Get pending tags for a file
 */
export async function getPendingTags(electronApp: any, filePath: string): Promise<any[]> {
  const page = await electronApp.firstWindow();
  return page.evaluate(async (filePath: string) => {
    return await window.electronAPI.history.getPendingTags(filePath);
  }, filePath);
}

/**
 * Get the diff baseline for a file (latest incremental-approval or pre-edit tag)
 */
export async function getDiffBaseline(electronApp: any, filePath: string): Promise<{ content: string; tagType: string } | null> {
  const page = await electronApp.firstWindow();
  return page.evaluate(async (filePath: string) => {
    return await window.electronAPI.invoke('history:get-diff-baseline', filePath);
  }, filePath);
}

/**
 * Count tags of a specific type for a file
 */
export async function countTagsByType(electronApp: any, filePath: string, tagType: string): Promise<number> {
  const tags = await queryTags(electronApp, filePath);
  return tags.filter((tag: any) => tag.type === tagType).length;
}
