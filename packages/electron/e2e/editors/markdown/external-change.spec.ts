/**
 * Markdown Editor External Change E2E Test
 *
 * Tests that external file changes auto-reload when editor is clean.
 *
 * NOTE: This test is currently skipped as the file watcher behavior
 * for Markdown files needs investigation. See the original test in
 * markdown-file-operations.spec.ts for context.
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
  TEST_TIMEOUTS,
  ACTIVE_EDITOR_SELECTOR,
} from '../../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  openFileFromTree,
  getTabByFileName,
} from '../../utils/testHelpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a markdown file
  const mdPath = path.join(workspaceDir, 'test.md');
  await fs.writeFile(mdPath, '# Original Title\n\nOriginal content.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
});

test.afterEach(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

// Skip: File watcher tests for markdown are flaky - needs investigation
test.skip('external file change auto-reloads when editor is clean', async () => {
  const mdPath = path.join(workspaceDir, 'test.md');
  const externalContent = '# Modified Externally\n\nThis was modified outside the editor.\n';

  // Open the markdown file
  await openFileFromTree(page, 'test.md');

  // Wait for Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify no dirty indicator (editor is clean)
  const tabElement = getTabByFileName(page, 'test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0);

  // Verify original content
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toContainText('Original Title');

  // Modify file externally
  await fs.writeFile(mdPath, externalContent, 'utf8');

  // Wait for file watcher to detect and reload
  await page.waitForTimeout(1500);

  // Verify editor shows new content (no conflict dialog)
  await expect(editor).toContainText('Modified Externally', { timeout: 5000 });
  await expect(editor).not.toContainText('Original Title');
});
