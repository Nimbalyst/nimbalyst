/**
 * E2E tests for incremental diff accept/reject cleanup
 *
 * Tests that when users incrementally accept or reject AI diff changes one-by-one,
 * the "pre-edit" tag gets properly cleared from the history database after all
 * changes are processed.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
  editDocumentContent,
  manualSaveDocument
} from '../utils/testHelpers';
import {
  simulateApplyDiff,
  waitForSave
} from '../utils/aiToolSimulator';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.beforeEach(async () => {
  // Create temporary workspace
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'test.md');

  // Create test file with multi-section content
  const initialContent = `# Document Title

## Section One
This is the first section with some content.

## Section Two
This is the second section with different content.

## Section Three
This is the third section with more content.
`;

  await fs.writeFile(testFilePath, initialContent, 'utf8');

  // Launch app
  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);

  // Dismiss API key dialog if present
  await dismissAPIKeyDialog(page);

  // Wait for workspace to be ready
  await waitForWorkspaceReady(page);

  // Open the test file
  await openFileFromTree(page, 'test.md');

  // Wait for editor to be ready
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

test('should clear tag and exit diff mode after incrementally accepting all changes', async () => {
  // Apply a multi-section diff that creates multiple change groups
  const result = await simulateApplyDiff(page, testFilePath, [
    { oldText: 'This is the first section with some content.', newText: 'This is the UPDATED first section with new content.' },
    { oldText: 'This is the second section with different content.', newText: 'This is the MODIFIED second section with changed content.' },
    { oldText: 'This is the third section with more content.', newText: 'This is the REVISED third section with updated content.' }
  ]);

  expect(result.success).toBe(true);

  // Wait for diff approval bar to appear
  await page.waitForSelector('.diff-approval-bar', { timeout: 2000 });

  // Verify we have 3 change groups (shows "3 changes" when no selection)
  const changeCounter = await page.locator('.diff-change-counter').textContent();
  expect(changeCounter).toContain('3');

  // Incrementally accept each change
  const acceptButton = page.locator('button:has-text("Accept")').first();

  // Accept first change
  await acceptButton.click();
  await page.waitForTimeout(200);

  // Verify still in diff mode with 2 changes remaining
  await expect(page.locator('.diff-change-counter')).toContainText('of 2');

  // Accept second change
  await acceptButton.click();
  await page.waitForTimeout(200);

  // Verify still in diff mode with 1 change remaining
  await expect(page.locator('.diff-change-counter')).toContainText('of 1');

  // Accept third (final) change
  await acceptButton.click();
  await page.waitForTimeout(500);

  // Verify diff approval bar is gone (no more diffs)
  await expect(page.locator('.diff-approval-bar')).toHaveCount(0, { timeout: 2000 });

  // Verify file can be saved (autosave should work now)
  await manualSaveDocument(page);
  await waitForSave(page, 'test.md');

  // Verify final content on disk
  const finalContent = await fs.readFile(testFilePath, 'utf8');
  expect(finalContent).toContain('UPDATED first section');
  expect(finalContent).toContain('MODIFIED second section');
  expect(finalContent).toContain('REVISED third section');
});

test('should clear tag and exit diff mode after incrementally rejecting all changes', async () => {
  // Apply a multi-section diff that creates multiple change groups
  const result = await simulateApplyDiff(page, testFilePath, [
    { oldText: 'This is the first section with some content.', newText: 'This is the UPDATED first section with new content.' },
    { oldText: 'This is the second section with different content.', newText: 'This is the MODIFIED second section with changed content.' },
    { oldText: 'This is the third section with more content.', newText: 'This is the REVISED third section with updated content.' }
  ]);

  expect(result.success).toBe(true);

  // Wait for diff approval bar to appear
  await page.waitForSelector('.diff-approval-bar', { timeout: 2000 });

  // Verify we have 3 change groups (shows "3 changes" when no selection)
  const changeCounter = await page.locator('.diff-change-counter').textContent();
  expect(changeCounter).toContain('3');

  // Incrementally reject each change
  const rejectButton = page.locator('button:has-text("Reject")').first();

  // Reject first change
  await rejectButton.click();
  await page.waitForTimeout(200);

  // Verify still in diff mode with 2 changes remaining
  await expect(page.locator('.diff-change-counter')).toContainText('of 2');

  // Reject second change
  await rejectButton.click();
  await page.waitForTimeout(200);

  // Verify still in diff mode with 1 change remaining
  await expect(page.locator('.diff-change-counter')).toContainText('of 1');

  // Reject third (final) change
  await rejectButton.click();
  await page.waitForTimeout(500);

  // Verify diff approval bar is gone (no more diffs)
  await expect(page.locator('.diff-approval-bar')).toHaveCount(0, { timeout: 2000 });

  // Verify file can be saved (autosave should work now)
  await manualSaveDocument(page);
  await waitForSave(page, 'test.md');

  // Verify content unchanged on disk (all changes rejected)
  const finalContent = await fs.readFile(testFilePath, 'utf8');
  expect(finalContent).toContain('This is the first section with some content.');
  expect(finalContent).toContain('This is the second section with different content.');
  expect(finalContent).toContain('This is the third section with more content.');
});

test('should allow autosave after incremental accept cleanup', async () => {
  // Apply diff
  const result = await simulateApplyDiff(page, testFilePath, [
    { oldText: 'This is the first section with some content.', newText: 'Updated content.' },
    { oldText: 'This is the second section with different content.', newText: 'Changed content.' }
  ]);

  expect(result.success).toBe(true);

  // Wait for diff approval bar
  await page.waitForSelector('.diff-approval-bar', { timeout: 2000 });

  // Accept all changes incrementally
  const acceptButton = page.locator('button:has-text("Accept")').first();
  await acceptButton.click();
  await page.waitForTimeout(200);
  await acceptButton.click();
  await page.waitForTimeout(500);

  // Verify diff mode exited
  await expect(page.locator('.diff-approval-bar')).toHaveCount(0);

  // Make an edit to trigger autosave
  const editor = page.locator(PLAYWRIGHT_TEST_SELECTORS.contentEditable);
  await editDocumentContent(page, editor, '# Modified Document\n\nNew content after diff.');

  // Wait for autosave to complete (dirty indicator should appear then disappear)
  const tab = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer).locator(PLAYWRIGHT_TEST_SELECTORS.tab, {
    has: page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: 'test.md' })
  });

  // Dirty indicator appears
  await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toBeVisible({ timeout: 1000 });

  // Wait for autosave (3 seconds)
  await page.waitForTimeout(3500);

  // Dirty indicator disappears
  await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toHaveCount(0, { timeout: 1000 });

  // Verify file was saved
  const savedContent = await fs.readFile(testFilePath, 'utf8');
  expect(savedContent).toContain('Modified Document');
  expect(savedContent).toContain('New content after diff');
});

test('should handle mixed accept/reject incrementally', async () => {
  // Apply a multi-section diff
  const result = await simulateApplyDiff(page, testFilePath, [
    { oldText: 'This is the first section with some content.', newText: 'ACCEPT this change.' },
    { oldText: 'This is the second section with different content.', newText: 'REJECT this change.' },
    { oldText: 'This is the third section with more content.', newText: 'ACCEPT this too.' }
  ]);

  expect(result.success).toBe(true);

  // Wait for diff approval bar
  await page.waitForSelector('.diff-approval-bar', { timeout: 2000 });

  // Accept first change
  const acceptButton = page.locator('button:has-text("Accept")').first();
  await acceptButton.click();
  await page.waitForTimeout(200);

  // Reject second change
  const rejectButton = page.locator('button:has-text("Reject")').first();
  await rejectButton.click();
  await page.waitForTimeout(200);

  // Accept third (final) change
  await acceptButton.click();
  await page.waitForTimeout(500);

  // Verify diff mode exited
  await expect(page.locator('.diff-approval-bar')).toHaveCount(0);

  // Save and verify final state
  await manualSaveDocument(page);
  await waitForSave(page, 'test.md');

  const finalContent = await fs.readFile(testFilePath, 'utf8');
  expect(finalContent).toContain('ACCEPT this change');
  expect(finalContent).toContain('This is the second section with different content.'); // Original (rejected)
  expect(finalContent).toContain('ACCEPT this too');
});

test('should save partial acceptances correctly with rejections', async () => {
  // Apply a multi-section diff with distinct content
  const result = await simulateApplyDiff(page, testFilePath, [
    { oldText: 'This is the first section with some content.', newText: 'FIRST ACCEPTED.' },
    { oldText: 'This is the second section with different content.', newText: 'SECOND REJECTED.' },
    { oldText: 'This is the third section with more content.', newText: 'THIRD ACCEPTED.' }
  ]);

  expect(result.success).toBe(true);

  // Wait for diff approval bar
  await page.waitForSelector('.diff-approval-bar', { timeout: 2000 });

  // Verify we have 3 change groups
  let changeCounter = await page.locator('.diff-change-counter').textContent();
  expect(changeCounter).toContain('3');

  // Navigate to first group to select it
  const nextButton = page.locator('.diff-nav-button').last();
  await nextButton.click();
  await page.waitForTimeout(200);

  // Accept the first change
  const acceptButton = page.locator('button:has-text("Accept")').first();
  await acceptButton.click();
  await page.waitForTimeout(200);

  // Verify we still have 2 changes remaining (tag should NOT be cleared)
  changeCounter = await page.locator('.diff-change-counter').textContent();
  expect(changeCounter).toContain('2');
  await expect(page.locator('.diff-approval-bar')).toBeVisible();

  // Reject the second change
  const rejectButton = page.locator('button:has-text("Reject")').first();
  await rejectButton.click();
  await page.waitForTimeout(200);

  // Verify we still have 1 change remaining (tag should NOT be cleared)
  changeCounter = await page.locator('.diff-change-counter').textContent();
  expect(changeCounter).toContain('1');
  await expect(page.locator('.diff-approval-bar')).toBeVisible();

  // Accept the third and final change
  await acceptButton.click();
  await page.waitForTimeout(500);

  // Verify diff mode exited (tag is NOW cleared)
  await expect(page.locator('.diff-approval-bar')).toHaveCount(0);

  // Save to ensure everything is flushed
  await manualSaveDocument(page);
  await waitForSave(page, 'test.md');

  // Verify the final content on disk reflects our decisions:
  // - First change: ACCEPTED
  // - Second change: REJECTED (should have original text)
  // - Third change: ACCEPTED
  const finalContent = await fs.readFile(testFilePath, 'utf8');
  expect(finalContent).toContain('FIRST ACCEPTED');
  expect(finalContent).toContain('This is the second section with different content.'); // Original (rejected)
  expect(finalContent).not.toContain('SECOND REJECTED');
  expect(finalContent).toContain('THIRD ACCEPTED');
});
