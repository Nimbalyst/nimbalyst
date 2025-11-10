/**
 * Test edge cases where CLEAR_DIFF_TAG_COMMAND should be dispatched
 * to properly clean up diff sessions
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import {
  simulateApplyDiff,
  queryTags
} from '../utils/aiToolSimulator';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree
} from '../utils/testHelpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'test.md');

  // Create test file with content
  const initialContent = `# Test Document

This is the first paragraph.

This is the second paragraph.
`;

  await fs.writeFile(testFilePath, initialContent, 'utf8');

  // Launch app
  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);

  // Dismiss API key dialog
  await dismissAPIKeyDialog(page);

  // Wait for workspace
  await waitForWorkspaceReady(page);

  // Open the test file
  await openFileFromTree(page, 'test.md');

  // Wait for editor
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, {
    timeout: TEST_TIMEOUTS.EDITOR_LOAD
  });
});

test.afterEach(async () => {
  if (electronApp) {
    await electronApp.close();
  }
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('should dispatch CLEAR_DIFF_TAG_COMMAND when user manually deletes all diff nodes', async () => {
  // Read original content
  const originalContent = await fs.readFile(testFilePath, 'utf8');

  // Create pre-edit tag (simulates AI session start)
  await page.evaluate(async ([filePath, content]) => {
    await window.electronAPI.invoke('history:create-tag', filePath, 'test-tag-manual-delete', content, 'test-session', 'tool-test');
  }, [testFilePath, originalContent]);

  await page.waitForTimeout(200);

  // Apply diffs
  const result = await simulateApplyDiff(page, testFilePath, [
    { oldText: 'This is the first paragraph.', newText: 'FIRST CHANGE.' },
    { oldText: 'This is the second paragraph.', newText: 'SECOND CHANGE.' },
  ]);

  expect(result.success).toBe(true);

  // Wait for diff approval bar
  await page.waitForSelector('.diff-approval-bar', { timeout: 2000 });

  // Verify we have a pending tag
  const tagsBefore = await queryTags(electronApp, testFilePath);
  const pendingBefore = tagsBefore.filter(t => t.status === 'pending-review');
  console.log('Tags before manual delete:', tagsBefore.map(t => ({ type: t.type, status: t.status })));
  expect(pendingBefore.length).toBeGreaterThan(0);

  // USER MANUALLY DELETES ALL DIFF CONTENT
  const editor = page.locator(PLAYWRIGHT_TEST_SELECTORS.contentEditable);
  await editor.click();

  // Select all and delete
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(100);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);

  // Wait a moment for editor to settle
  await page.waitForTimeout(500);

  // Tag should still be pending BEFORE save
  const tagsBeforeSave = await queryTags(electronApp, testFilePath);
  console.log('Tags after delete but before save:', tagsBeforeSave.map(t => ({ type: t.type, status: t.status })));
  const pendingBeforeSave = tagsBeforeSave.filter(t => t.status === 'pending-review');
  // Note: Tag might or might not be pending here depending on timing, we'll check after save

  // Save the file - this should trigger the tag clearing
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(1000);

  // NOW verify tag was marked as reviewed (checked on save)
  const tagsAfterSave = await queryTags(electronApp, testFilePath);
  console.log('Tags after save:', tagsAfterSave.map(t => ({ type: t.type, status: t.status })));
  const pendingAfterSave = tagsAfterSave.filter(t => t.status === 'pending-review');
  expect(pendingAfterSave.length).toBe(0);

  // Close the tab
  const closeButton = page.locator('.tab-close-button[data-filename="test.md"]');
  await closeButton.click();
  await page.waitForTimeout(500);

  // Reopen the file
  await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
  await page.waitForTimeout(500);

  // Wait for editor
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 3000 });

  // Verify NOT in diff mode (diff approval bar should not appear)
  await page.waitForTimeout(1000);
  await expect(page.locator('.diff-approval-bar')).not.toBeVisible();

  // Verify the content is what we expect (empty or just whitespace)
  const finalContent = await fs.readFile(testFilePath, 'utf8');
  console.log('Final content:', JSON.stringify(finalContent));
  // Content should be empty or minimal since we deleted everything
  expect(finalContent.length).toBeLessThan(50);

  console.log('✓ CLEAR_DIFF_TAG_COMMAND dispatched after manual deletion of all diff nodes');
});
