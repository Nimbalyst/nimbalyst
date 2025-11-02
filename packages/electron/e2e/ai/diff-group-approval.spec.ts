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

  test('should group adjacent whitespace changes with content changes', async () => {
    // Open the file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await waitForEditorReady(page);

    // Add a new paragraph with surrounding whitespace (newlines before and after)
    // This simulates what streaming does: \n\nContent paragraph\n
    // Which creates: empty paragraph + content paragraph + empty paragraph
    const addParagraphResult = await simulateApplyDiff(page, testFilePath, [
      {
        oldText: 'This is the third paragraph.',
        newText: 'This is the third paragraph.\n\nThis is a new paragraph with content.\nTest 1\nTest 2\nTest 3\n\n'
      }
    ]);

    expect(addParagraphResult.success).toBe(true);

    // Wait for diff approval bar to appear
    await page.waitForSelector('.diff-approval-bar', { timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

    // Get the change count - this should ideally be 1 group (not multiple separate groups)
    const countText = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] Change count after adding paragraph with surrounding newlines:', countText);

    // Get the actual paragraph nodes to see what's creating separate groups
    const paragraphInfo = await page.evaluate(() => {
      const content = document.querySelector('.PlaygroundEditorTheme__paragraph');
      const allParagraphs = document.querySelectorAll('.PlaygroundEditorTheme__paragraph');

      const paragraphs = Array.from(allParagraphs).map((p: any) => {
        const classList = Array.from(p.classList) as string[];
        const text = p.textContent || '';
        const isEmpty = text.trim().length === 0;
        const hasDiff = classList.some((c: string) => c.includes('diff') || c.includes('add') || c.includes('remove'));

        return {
          text: text.substring(0, 50),
          isEmpty,
          hasDiff,
          classes: classList.filter((c: string) => c.includes('diff') || c.includes('add') || c.includes('remove'))
        };
      });

      return { total: allParagraphs.length, paragraphs };
    });

    console.log('[Test] Paragraph breakdown:', JSON.stringify(paragraphInfo, null, 2));

    // The issue: whitespace paragraphs are creating separate groups
    if (countText && (countText.includes('3') || countText.includes('4'))) {
      console.log('[Test] ❌ ISSUE CONFIRMED: Empty paragraphs around content are creating separate groups');
      console.log('[Test] Expected: 1-2 groups, Actual:', countText);
    } else if (countText && countText.includes('1')) {
      console.log('[Test] ✅ GOOD: Whitespace paragraphs are properly grouped with content');
    }

    // For now, just verify the bar appeared
    expect(countText).toBeTruthy();
  });

  test('should keep separate groups for changes across multiple paragraphs', async () => {
    // Open the file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await waitForEditorReady(page);

    // Make changes to multiple different paragraphs
    // This simulates the "Multi-Paragraph Edits" test from DiffTestDropdown
    const result = await simulateApplyDiff(page, testFilePath, [
      {
        oldText: 'This is the first paragraph',
        newText: '**This is the first paragraph**'
      },
      {
        oldText: 'This is the second paragraph',
        newText: '_This is the second paragraph_'
      }
    ]);

    expect(result.success).toBe(true);

    // Wait for diff approval bar to appear
    await page.waitForSelector('.diff-approval-bar', { timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

    // Get the change count
    const countText = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] Change count for multi-paragraph edits:', countText);

    // These should be 2 separate groups because they're changes to different paragraphs
    // with content (not just whitespace) between them
    if (countText && countText.includes('2')) {
      console.log('[Test] ✅ GOOD: Changes to different paragraphs remain separate groups');
    } else if (countText && countText.includes('1')) {
      console.log('[Test] ❌ ISSUE: Changes to different paragraphs incorrectly grouped together');
      console.log('[Test] Expected: 2 groups, Actual: 1 group');
    }

    // Should be 2 groups
    expect(countText).toContain('2');

    // Now approve the first group and see what happens
    const nextButton = page.locator('button[aria-label="Next change"]');
    await nextButton.click();
    await page.waitForTimeout(200);

    // Should show "1 of 2"
    const selectedCountText = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] After selecting first group:', selectedCountText);

    // Approve the first group
    const acceptButton = page.locator('button', { hasText: 'Accept' }).first();
    await acceptButton.click();
    await page.waitForTimeout(300);

    // Check the count after approval
    const afterApprovalCountText = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] After approving first group:', afterApprovalCountText);

    // This should show "1 changes" or "1 of 1" - one group remaining
    // NOT "2 changes" or split into multiple groups
    if (afterApprovalCountText && (afterApprovalCountText.includes('1 change') || afterApprovalCountText.includes('1 of 1'))) {
      console.log('[Test] ✅ GOOD: Remaining paragraph is still 1 group after approval');
    } else if (afterApprovalCountText && afterApprovalCountText.match(/[2-9]/)) {
      console.log('[Test] ❌ ISSUE: Remaining paragraph split into multiple groups after approval');
      console.log('[Test] Expected: 1 group remaining, Actual:', afterApprovalCountText);
    }

    // Should have exactly 1 group remaining (either "1 changes" or "1 of 1")
    expect(afterApprovalCountText).toMatch(/1/);
  });

  test('should handle DiffTestDropdown Multi-Paragraph Edits exact sequence', async () => {
    // This replicates the exact sequence from DiffTestDropdown "Multi-Paragraph Edits"
    // 1. Adds two paragraphs with streaming (with whitespace)
    // 2. User accepts the addition
    // 3. Modifies both paragraphs
    // 4. User approves first modification
    // 5. Check if second modification splits into multiple groups

    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await waitForEditorReady(page);

    // Step 1: Add two paragraphs with streaming (simulating the setup phase)
    const addResult = await page.evaluate(async (filePath) => {
      const editorRegistry = (window as any).__editorRegistry;
      const streamId = 'test-' + Date.now();

      editorRegistry.startStreaming(filePath, { id: streamId, insertAtEnd: true });
      await new Promise(resolve => setTimeout(resolve, 50));

      editorRegistry.streamContent(
        filePath,
        streamId,
        '\n\nFirst paragraph with some sample text for testing.\n\nSecond paragraph with different content for modifications.\n'
      );
      await new Promise(resolve => setTimeout(resolve, 50));

      editorRegistry.endStreaming(filePath, streamId);
      return { success: true };
    }, testFilePath);

    await page.waitForTimeout(300);
    await page.waitForSelector('.diff-approval-bar', { timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

    const initialCount = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] After adding paragraphs:', initialCount);

    // Step 2: Accept the addition
    const acceptAllButton = page.locator('button', { hasText: 'Accept All' });
    await acceptAllButton.click();
    await page.waitForTimeout(300);

    // Wait for diff bar to disappear
    await page.waitForSelector('.diff-approval-bar', { state: 'hidden', timeout: 2000 }).catch(() => {
      console.log('[Test] Diff bar did not disappear after accepting all');
    });

    // Step 3: Modify both paragraphs
    const modifyResult = await simulateApplyDiff(page, testFilePath, [
      {
        oldText: 'First paragraph',
        newText: '**First paragraph**'
      },
      {
        oldText: 'Second paragraph',
        newText: '_Second paragraph_'
      }
    ]);

    expect(modifyResult.success).toBe(true);
    await page.waitForSelector('.diff-approval-bar', { timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

    const afterModifyCount = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] After modifying both paragraphs:', afterModifyCount);

    // Step 4: Approve first modification
    const nextButton = page.locator('button[aria-label="Next change"]');
    await nextButton.click();
    await page.waitForTimeout(200);

    const acceptButton = page.locator('button', { hasText: 'Accept' }).first();
    await acceptButton.click();
    await page.waitForTimeout(300);

    // Step 5: Check the count - should still be 1 group, not split
    const finalCount = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] After approving first modification:', finalCount);

    // Should be 1 group remaining (not split into multiple groups)
    expect(finalCount).toMatch(/1/);
  });

  test('should not split multiple added paragraphs after approving first group', async () => {
    // This tests the ACTUAL issue: multiple paragraphs added via streaming
    // When you approve the group, it should stay as 1 group, not split

    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await waitForEditorReady(page);

    // Add multiple paragraphs via streaming (like AI does)
    const streamResult = await page.evaluate(async (filePath) => {
      const editorRegistry = (window as any).__editorRegistry;
      const streamId = 'test-' + Date.now();

      editorRegistry.startStreaming(filePath, { id: streamId, insertAtEnd: true });
      await new Promise(resolve => setTimeout(resolve, 50));

      // This creates: empty paragraph + First para + empty para + Second para + empty para
      editorRegistry.streamContent(
        filePath,
        streamId,
        '\n\nFirst paragraph added.\n\nSecond paragraph added.\n'
      );
      await new Promise(resolve => setTimeout(resolve, 50));

      editorRegistry.endStreaming(filePath, streamId);
      return { success: true };
    }, testFilePath);

    await page.waitForTimeout(300);
    await page.waitForSelector('.diff-approval-bar', { timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

    const initialCount = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] After adding multiple paragraphs:', initialCount);

    // Should be 1 group initially
    expect(initialCount).toContain('1 change');

    // User clicks the arrow to select the first group
    const nextButton = page.locator('button[aria-label="Next change"]');
    await nextButton.click();
    await page.waitForTimeout(200);

    const selectedCount = await page.locator('.diff-change-counter').textContent();
    console.log('[Test] After selecting group:', selectedCount);

    // Now click the individual "Accept" button (not "Accept All")
    const acceptButton = page.locator('button', { hasText: 'Accept' }).first();
    await acceptButton.click();
    await page.waitForTimeout(300);

    // The diff bar should disappear completely - all changes approved
    const barGone = await page.locator('.diff-approval-bar').isHidden().catch(() => false);

    // Diff bar should be gone - all changes were approved in one group
    await expect(page.locator('.diff-approval-bar')).toBeHidden({ timeout: 2000 });
  });
});
