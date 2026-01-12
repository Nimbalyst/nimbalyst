/**
 * Markdown Editor Diff Reject E2E Test
 *
 * Tests that when rejecting AI edits to a markdown file,
 * the editor reverts to the original content.
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

test('rejecting diff reverts to original content', async () => {
  const mdPath = path.join(workspaceDir, 'test.md');

  // Original content
  const originalContent = `# Original Title

This is the original content.
`;

  // Modified content
  const modifiedContent = `# Modified Title

This is the modified content with AI changes.
`;

  // Create the original file
  await fs.writeFile(mdPath, originalContent, 'utf8');

  // Open the markdown file
  await openFileFromTree(page, 'test.md');

  // Wait for the Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify the editor shows original content
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toContainText('Original Title');

  // Simulate AI edit:
  // 1. Write modified content to disk
  // 2. Create a pending history tag
  await fs.writeFile(mdPath, modifiedContent, 'utf8');

  const tagId = `test-tag-${Date.now()}`;
  const sessionId = `test-session-${Date.now()}`;

  await page.evaluate(async ({ filePath, tagId, sessionId, originalContent }) => {
    await window.electronAPI.history.createTag(
      filePath,
      tagId,
      originalContent,
      sessionId,
      'test-tool-use'
    );
  }, { filePath: mdPath, tagId, sessionId, originalContent });

  // Close and reopen the file to trigger pending tag check
  await page.keyboard.press('Meta+w');
  await page.waitForTimeout(300);

  await openFileFromTree(page, 'test.md');
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Wait for unified diff header to appear (Lexical uses UnifiedDiffHeader)
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

  // Verify unaccepted indicator on tab
  const tabElement = getTabByFileName(page, 'test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toBeVisible({ timeout: 2000 });

  // Click "Revert All" to reject the changes (unified header uses "Revert" terminology)
  const rejectButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffRejectAllButton);
  await rejectButton.click();
  await page.waitForTimeout(500);

  // Wait for unified diff header to disappear
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 3000 }).catch(() => {
    console.log('[Test] Unified diff header still visible after Revert');
  });

  await page.waitForTimeout(500);

  // Verify unaccepted indicator is gone
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toHaveCount(0, { timeout: 2000 });

  // Verify editor shows original content (reverted)
  await expect(editor).toContainText('Original Title', { timeout: 3000 });
  await expect(editor).not.toContainText('AI changes');

  // Verify the file on disk has the original content (reverted)
  const finalContent = await fs.readFile(mdPath, 'utf-8');
  expect(finalContent).toContain('Original Title');
  expect(finalContent).not.toContain('AI changes');
});
