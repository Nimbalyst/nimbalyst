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

  // Get Monaco editor value directly instead of textContent (which includes line numbers)
  const initialText = await page.evaluate(() => {
    // Access Monaco editor instance via the global monaco variable
    const editors = (window as any).monaco?.editor?.getEditors();
    if (editors && editors.length > 0) {
      return editors[0].getValue();
    }
    return '';
  });

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

  // Check if editor updated
  const updatedText = await page.evaluate(() => {
    const editors = (window as any).monaco?.editor?.getEditors();
    if (editors && editors.length > 0) {
      return editors[0].getValue();
    }
    return '';
  });

  console.log('[TEST] Content after external change:', {
    contains_modified: updatedText.includes('Modified externally'),
    contains_old: updatedText.includes('Hello World'),
    length: updatedText.length,
    actualContent: updatedText
  });

  expect(updatedText).toContain('Modified externally');
});
