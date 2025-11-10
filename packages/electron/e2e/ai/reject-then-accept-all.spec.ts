/**
 * Test for rejecting one diff group, then accepting all remaining groups
 * Verifies that rejected changes stay rejected when using "Accept All"
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import { PLAYWRIGHT_TEST_SELECTORS } from '../utils/testHelpers';
import {
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree
} from '../utils/testHelpers';
import {
  simulateApplyDiff,
  queryTags,
  countTagsByType
} from '../utils/aiToolSimulator';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'test.md');

  // Create initial file with three distinct sections
  const initialContent = `# Document

First section.

Second section.

Third section.
`;
  await fs.writeFile(testFilePath, initialContent, 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Capture console logs from renderer
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('TabEditor') || text.includes('DIFF') || text.includes('REJECT')) {
      console.log(`[RENDERER] ${text}`);
    }
  });

  await dismissAPIKeyDialog(page);
  await waitForWorkspaceReady(page);
  await openFileFromTree(page, 'test.md');
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('should remember rejected change when accepting all remaining changes', async () => {
  const originalContent = await fs.readFile(testFilePath, 'utf8');

  console.log('\n===== APPLYING THREE DIFF GROUPS =====');

  // Create pre-edit tag for AI session
  await page.evaluate(async ([filePath, content]) => {
    await window.electronAPI.invoke('history:create-tag', filePath, 'ai-edit-tag', content, 'test-ai-session', 'tool-1');
  }, [testFilePath, originalContent]);

  await page.waitForTimeout(200);

  // Apply three separate diff changes (writes to disk, triggers file watcher)
  const diffResult = await simulateApplyDiff(page, testFilePath, [
    { oldText: 'First section.', newText: 'FIRST CHANGE.' },
    { oldText: 'Second section.', newText: 'SECOND CHANGE.' },
    { oldText: 'Third section.', newText: 'THIRD CHANGE.' }
  ]);

  expect(diffResult.success).toBe(true);

  // Wait for file watcher to detect change and activate diff mode
  await page.waitForTimeout(1000);

  // Wait for diff approval bar to appear
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.diffApprovalBar, { timeout: 2000 });

  // Debug: check what's in the DOM
  const htmlContent = await page.evaluate(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    return editor?.innerHTML || 'NO EDITOR';
  });
  console.log('Editor HTML (first 500 chars):', htmlContent.substring(0, 500));

  // Verify we have three diff groups (check what counter says)
  const changeCounter = await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffChangeCounter).textContent();
  console.log('Change counter text:', changeCounter);
  expect(changeCounter).toContain('3');

  // Check database state before any actions
  const tagsBeforeActions = await queryTags(electronApp, testFilePath);
  console.log('Tags BEFORE any actions:', tagsBeforeActions.map(t => ({ type: t.type, status: t.status })));

  console.log('\n===== REJECTING SECOND CHANGE =====');

  // Use proper selectors instead of fragile .first()
  const acceptButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.diffAcceptButton);
  const rejectButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.diffRejectButton);

  // Accept first change
  await acceptButton.click();
  await page.waitForTimeout(500);

  // Verify we now have 2 changes remaining
  const counterAfterAccept = await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffChangeCounter).textContent();
  console.log('Change counter after accepting first:', counterAfterAccept);
  expect(counterAfterAccept).toContain('of 2');

  // Now reject the SECOND change (which is now the "current" change)
  await rejectButton.click();
  await page.waitForTimeout(500);

  // VERIFY: Incremental-approval tag created for the rejection
  const incrementalCountAfterReject = await countTagsByType(electronApp, testFilePath, 'incremental-approval');
  console.log('Incremental tags after reject:', incrementalCountAfterReject);
  expect(incrementalCountAfterReject).toBeGreaterThanOrEqual(1);

  // Check how many changes remain (should be 1 now - only the third change)
  const counterAfterReject = await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffChangeCounter).textContent();
  console.log('Change counter after rejecting second:', counterAfterReject);
  expect(counterAfterReject).toContain('of 1');

  // Get content after rejection to verify it stayed original
  const contentAfterReject = await page.evaluate(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    return editor?.textContent || '';
  });
  console.log('Editor content after reject (checking for original):', contentAfterReject.includes('Second section'));

  console.log('\n===== CLICKING ACCEPT ALL =====');

  // Now click "Accept All" - this should accept the remaining third change
  // The first was already accepted, the second was rejected
  // The key test: the rejected second change should NOT be re-applied
  const acceptAllButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.diffAcceptAllButton);
  await acceptAllButton.click();
  await page.waitForTimeout(1000);

  // Diff mode should exit now
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.diffApprovalBar)).toHaveCount(0, { timeout: 2000 });

  // Check database state after Accept All
  const tagsAfterAcceptAll = await queryTags(electronApp, testFilePath);
  console.log('Tags AFTER Accept All:', tagsAfterAcceptAll.map(t => ({ type: t.type, status: t.status })));

  // VERIFY: Pre-edit tag should be marked as 'reviewed'
  const preEditTag = tagsAfterAcceptAll.find(t => t.type === 'pre-edit' && t.sessionId === 'test-ai-session');
  console.log('Pre-edit tag status:', preEditTag?.status);
  expect(preEditTag?.status).toBe('reviewed');

  console.log('\n===== VERIFYING FINAL CONTENT =====');

  // CRITICAL: File content should have:
  // - FIRST CHANGE (accepted)
  // - Second section (rejected - original text preserved)
  // - THIRD CHANGE (accepted)
  const finalContent = await fs.readFile(testFilePath, 'utf8');
  console.log('Final content:', finalContent);

  expect(finalContent).toContain('FIRST CHANGE'); // First was accepted
  expect(finalContent).toContain('Second section'); // Second was REJECTED - should be original
  expect(finalContent).not.toContain('SECOND CHANGE'); // Should NOT have the rejected change
  expect(finalContent).toContain('THIRD CHANGE'); // Third was accepted

  console.log('\n===== VERIFYING STATE PERSISTENCE =====');

  // Close and reopen to verify the state persists correctly
  console.log('Closing tab...');
  await page.locator('.tab-close-button[data-filename="test.md"]').click();
  await page.waitForTimeout(500);

  console.log('Reopening file...');
  await openFileFromTree(page, 'test.md');
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(1000);

  // CRITICAL: No diff mode - session is complete
  const finalDiffBarCount = await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffApprovalBar).count();
  console.log('Diff bar count after reopen:', finalDiffBarCount);
  expect(finalDiffBarCount).toBe(0);

  // Verify no diff highlights visible
  const diffHighlightsAtEnd = await page.locator('.diff-group-highlight-added, .diff-group-highlight-removed').count();
  console.log('Diff highlights visible at end:', diffHighlightsAtEnd);
  expect(diffHighlightsAtEnd).toBe(0);

  // VERIFY: Content still has the correct state after reopen
  const contentAfterReopen = await fs.readFile(testFilePath, 'utf8');
  expect(contentAfterReopen).toContain('FIRST CHANGE');
  expect(contentAfterReopen).toContain('Second section'); // REJECTED change stayed original
  expect(contentAfterReopen).not.toContain('SECOND CHANGE');
  expect(contentAfterReopen).toContain('THIRD CHANGE');

  // VERIFY: No pending tags should exist
  const pendingTags = await page.evaluate(async (filePath: string) => {
    return await window.electronAPI.history.getPendingTags(filePath);
  }, testFilePath);
  console.log('Pending tags at end:', pendingTags);
  expect(pendingTags.length).toBe(0);

  console.log('\n✓ Test passed: Rejected change stayed rejected after Accept All!');
});
