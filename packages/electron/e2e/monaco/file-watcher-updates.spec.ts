/**
 * Monaco Editor - File Watcher Updates Test
 *
 * Tests that Monaco editor updates when a code file changes on disk externally.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS,
} from '../helpers';

/**
 * Helper to get Monaco editor content
 * Uses multiple methods to find the editor content with retry logic
 */
async function getMonacoContent(page: Page, timeout = 5000): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await page.evaluate(() => {
      // Method 1: Try global monaco API
      const monaco = (window as any).monaco;
      const editors = monaco?.editor?.getEditors();
      console.log('[getMonacoContent] monaco:', !!monaco, 'editors:', editors?.length);
      if (editors && editors.length > 0) {
        return { source: 'monaco-api', content: editors[0].getValue() };
      }

      // Method 2: Try getting from view lines (fallback)
      // Note: view-lines use non-breaking spaces (charCode 160), need to normalize
      const monacoWrapper = document.querySelector('.monaco-code-editor');
      if (monacoWrapper) {
        const lines = monacoWrapper.querySelectorAll('.view-line');
        if (lines.length > 0) {
          const rawContent = Array.from(lines).map(l => l.textContent || '').join('\n');
          // Replace non-breaking spaces with regular spaces
          const normalizedContent = rawContent.replace(/\u00A0/g, ' ');
          return { source: 'view-lines', content: normalizedContent };
        }
      }

      return null;
    });

    if (result !== null && result.content.length > 0) {
      console.log(`[TEST] getMonacoContent source: ${result.source}`);
      return result.content;
    }

    await page.waitForTimeout(200);
  }

  // Final fallback - get text from view-lines
  const fallback = await page.evaluate(() => {
    const monacoWrapper = document.querySelector('.monaco-code-editor');
    if (monacoWrapper) {
      const lines = monacoWrapper.querySelectorAll('.view-line');
      if (lines.length > 0) {
        const rawContent = Array.from(lines).map(l => l.textContent || '').join('\n');
        // Replace non-breaking spaces with regular spaces
        return rawContent.replace(/\u00A0/g, ' ');
      }
    }
    return '';
  });
  console.log('[TEST] getMonacoContent source: fallback');
  return fallback;
}

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.beforeEach(async () => {
  // Create temporary workspace
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'App.tsx');

  // CRITICAL: Create test file BEFORE launching app
  const initialContent = `function hello() {
  console.log("Hello World");
}
`;
  await fs.writeFile(testFilePath, initialContent, 'utf8');

  // Launch Electron app with workspace
  electronApp = await launchElectronApp({ workspace: workspaceDir });

  // Get the first window and wait for app to be ready
  // Console logging is automatically set up by launchElectronApp
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
});

test.afterEach(async () => {
  // Clean up: close app and remove temp files
  if (electronApp) {
    await electronApp.close();
  }
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('Monaco editor detects external file changes', async () => {
  // Open the TypeScript file
  await page.locator('.file-tree-name', { hasText: 'App.tsx' }).click();

  // Wait for Monaco editor container
  await page.waitForSelector('.monaco-code-editor', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Wait for initial content to render
  await page.waitForTimeout(500);

  // Get Monaco editor value using helper with retry logic
  const initialText = await getMonacoContent(page);

  console.log('[TEST] Initial content:', initialText);
  expect(initialText).toContain('Hello World');

  console.log('[TEST] Initial content verified, modifying file on disk...');

  // Modify file externally
  const newContent = `function hello() {
  console.log("Modified externally!");
}
`;
  await fs.writeFile(testFilePath, newContent, 'utf8');
  console.log('[TEST] File modified on disk, waiting for file watcher...');

  // Wait for file watcher to trigger
  await page.waitForTimeout(3000);

  // Check if editor updated using helper with retry logic
  const updatedText = await getMonacoContent(page);

  console.log('[TEST] Content after external change:', {
    contains_modified: updatedText.includes('Modified externally'),
    contains_old: updatedText.includes('Hello World'),
    length: updatedText.length,
    actualContent: updatedText
  });

  expect(updatedText).toContain('Modified externally');
});
