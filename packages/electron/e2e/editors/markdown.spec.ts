/**
 * Markdown Editor E2E Tests (Consolidated)
 *
 * Tests for the Lexical-based markdown editor including:
 * - Autosave functionality
 * - Dirty close (save on tab close)
 * - External file change detection
 * - AI diff accept
 * - AI diff reject
 *
 * This file consolidates tests that previously lived in separate files.
 * All tests share a single app instance for performance.
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
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  openFileFromTree,
  closeTabByFileName,
  getTabByFileName,
} from '../utils/testHelpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

// Shared app instance for all tests in this file
test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create ALL test files upfront for all scenarios
  await fs.writeFile(
    path.join(workspaceDir, 'autosave-test.md'),
    '# Autosave Test\n\nOriginal content.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'dirty-close-test.md'),
    '# Dirty Close Test\n\nOriginal content.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'external-change-test.md'),
    '# External Change Test\n\nOriginal content.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'diff-accept-test.md'),
    '# Original Title\n\nThis is the original content.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'diff-reject-test.md'),
    '# Original Title\n\nThis is the original content.\n',
    'utf8'
  );

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
});

test.afterAll(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('autosave clears dirty indicator and saves content', async () => {
  const mdPath = path.join(workspaceDir, 'autosave-test.md');
  const marker = `autosave-marker-${Date.now()}`;

  // Open the markdown file
  await openFileFromTree(page, 'autosave-test.md');

  // Wait for Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Click in the editor and type at the end
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(`\n\n${marker}`);

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'autosave-test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Wait for autosave (2s interval + 200ms debounce + buffer)
  await page.waitForTimeout(3500);

  // Verify dirty indicator cleared
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0, { timeout: 1000 });

  // Verify content saved to disk
  const savedContent = await fs.readFile(mdPath, 'utf-8');
  expect(savedContent).toContain(marker);

  // Close the tab to clean up for next test
  await closeTabByFileName(page, 'autosave-test.md');
});

test('edited content is saved when tab is closed', async () => {
  const mdPath = path.join(workspaceDir, 'dirty-close-test.md');
  const marker = `edited-marker-${Date.now()}`;

  // Open the markdown file
  await openFileFromTree(page, 'dirty-close-test.md');

  // Wait for Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Click in the editor and type at the end
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(`\n\n${marker}`);

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'dirty-close-test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Close the tab using helper (clicks close button, waits for tab to disappear)
  await closeTabByFileName(page, 'dirty-close-test.md');

  // Wait for save to complete (async save via IPC)
  await page.waitForTimeout(500);

  // Read the file and check the content
  const savedContent = await fs.readFile(mdPath, 'utf-8');

  // Verify the content was saved
  expect(savedContent).toContain(marker);
});

// Skip: File watcher tests for markdown are flaky - needs investigation
test.skip('external file change auto-reloads when editor is clean', async () => {
  const mdPath = path.join(workspaceDir, 'external-change-test.md');
  const externalContent = '# Modified Externally\n\nThis was modified outside the editor.\n';

  // Open the markdown file
  await openFileFromTree(page, 'external-change-test.md');

  // Wait for Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify no dirty indicator (editor is clean)
  const tabElement = getTabByFileName(page, 'external-change-test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0);

  // Verify original content
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toContainText('External Change Test');

  // Modify file externally
  await fs.writeFile(mdPath, externalContent, 'utf8');

  // Wait for file watcher to detect and reload
  await page.waitForTimeout(1500);

  // Verify editor shows new content (no conflict dialog)
  await expect(editor).toContainText('Modified Externally', { timeout: 5000 });
  await expect(editor).not.toContainText('External Change Test');

  // Close the tab to clean up
  await closeTabByFileName(page, 'external-change-test.md');
});

test('accepting diff applies changes and saves to disk', async () => {
  const mdPath = path.join(workspaceDir, 'diff-accept-test.md');

  // Original content (already written in beforeAll)
  const originalContent = '# Original Title\n\nThis is the original content.\n';

  // Modified content
  const modifiedContent = '# Modified Title\n\nThis is the modified content with AI changes.\n';

  // Open the markdown file
  await openFileFromTree(page, 'diff-accept-test.md');

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

  await openFileFromTree(page, 'diff-accept-test.md');
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Wait for unified diff header to appear (Lexical uses UnifiedDiffHeader)
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

  // Verify unaccepted indicator on tab
  const tabElement = getTabByFileName(page, 'diff-accept-test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toBeVisible({ timeout: 2000 });

  // Click "Keep All" to accept the changes (unified header uses "Keep" terminology)
  const acceptButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton);
  await acceptButton.click();
  await page.waitForTimeout(500);

  // Wait for unified diff header to disappear
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 3000 }).catch(() => {
    console.log('[Test] Unified diff header still visible after Keep');
  });

  await page.waitForTimeout(500);

  // Verify unaccepted indicator is gone
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toHaveCount(0, { timeout: 2000 });

  // Verify editor shows modified content
  await expect(editor).toContainText('Modified Title', { timeout: 3000 });
  await expect(editor).toContainText('AI changes');

  // Verify the file on disk has the modified content
  const finalContent = await fs.readFile(mdPath, 'utf-8');
  expect(finalContent).toContain('Modified Title');
  expect(finalContent).toContain('AI changes');

  // Close the tab to clean up
  await closeTabByFileName(page, 'diff-accept-test.md');
});

test('rejecting diff reverts to original content', async () => {
  const mdPath = path.join(workspaceDir, 'diff-reject-test.md');

  // Original content (already written in beforeAll)
  const originalContent = '# Original Title\n\nThis is the original content.\n';

  // Modified content
  const modifiedContent = '# Modified Title\n\nThis is the modified content with AI changes.\n';

  // Open the markdown file
  await openFileFromTree(page, 'diff-reject-test.md');

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

  await openFileFromTree(page, 'diff-reject-test.md');
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Wait for unified diff header to appear (Lexical uses UnifiedDiffHeader)
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

  // Verify unaccepted indicator on tab
  const tabElement = getTabByFileName(page, 'diff-reject-test.md');
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
  // Note: handleClearDiffTag saves to disk automatically when CLEAR_DIFF_TAG_COMMAND is dispatched
  const finalContent = await fs.readFile(mdPath, 'utf-8');
  expect(finalContent).toContain('Original Title');
  expect(finalContent).not.toContain('AI changes');

  // Close the tab to clean up
  await closeTabByFileName(page, 'diff-reject-test.md');
});
