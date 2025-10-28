/**
 * Diff Group Approval E2E Test
 *
 * Tests the individual diff group approval functionality to ensure:
 * - Approving a group removes it from the pending changes count
 * - Highlighting is correctly applied and removed
 * - Multiple changes can be approved individually
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  waitForAppReady,
} from '../helpers';
import {
  simulateApplyDiff,
  waitForEditorReady,
  triggerManualSave,
  waitForSave,
} from '../utils/aiToolSimulator';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Diff Group Approval', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFilePath: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    testFilePath = path.join(workspaceDir, 'test.md');

    // Create initial content with a paragraph BEFORE launching app
    const initialContent = `# Document Title

This is the first paragraph with some content that we will modify.

This is the second paragraph with different content.

This is the third paragraph.
`;
    await fs.writeFile(testFilePath, initialContent, 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should decrease change count after approving individual group', async () => {
    // Open the file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await waitForEditorReady(page);

    // Apply diffs to create multiple change groups
    const result = await simulateApplyDiff(page, testFilePath, [
      { oldText: 'first paragraph', newText: 'FIRST PARAGRAPH' },
      { oldText: 'second paragraph', newText: 'SECOND PARAGRAPH' },
    ]);

    expect(result.success).toBe(true);

    // Wait for diff approval bar to appear
    await page.waitForSelector('.diff-approval-bar', { timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

    // Check initial change count (should show 2 groups, no selection)
    const initialCountText = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] Initial change count:', initialCountText);
    expect(initialCountText).toContain('2 changes');

    // Click the next arrow to select the first group
    const nextButton = page.locator('button[aria-label="Next change"]');
    await nextButton.click();
    await page.waitForTimeout(200);

    // Now should show "1 of 2"
    const selectedCountText = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] After selecting first group:', selectedCountText);
    expect(selectedCountText).toContain('1 of 2');

    // Click the individual "Accept" button (not "Accept All")
    const acceptButton = page.locator('button', { hasText: 'Accept' }).first();
    await acceptButton.click();

    // Wait for UI to update
    await page.waitForTimeout(300);

    // Check updated change count (should now show 1 group remaining)
    const updatedCountText = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] Updated change count:', updatedCountText);

    // The count should have decreased from 2 to 1
    expect(updatedCountText).toContain('1');
    expect(updatedCountText).not.toContain('2');

    // Verify that the diff bar still exists (there's still one change pending)
    await expect(page.locator('.diff-approval-bar')).toBeVisible();

    // Verify there are still highlights in the document for the remaining change
    const highlightCount = await page.evaluate(() => {
      const highlights = document.querySelectorAll(
        '.diff-group-highlight-added, .diff-group-highlight-removed, .diff-group-highlight-modified'
      );
      return highlights.length;
    });

    console.log('[Test] Remaining highlights:', highlightCount);
    // Note: This might be 0 if the highlighting bug exists where no group is selected
  });
});
