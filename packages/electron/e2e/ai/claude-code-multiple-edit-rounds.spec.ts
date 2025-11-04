import { test, expect } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  waitForWorkspaceReady,
  openFileFromTree,
  openAIChatWithSession,
  submitChatPrompt,
  openHistoryDialog,
  getHistoryItemCount
} from '../utils/testHelpers';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'test.md');

  // Create test file BEFORE launching app
  await fs.writeFile(
    testFilePath,
    '# Shopping List\n\n- Milk\n- Bread\n- Eggs\n',
    'utf8'
  );

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Listen to console logs
  page.on('console', msg => {
    const text = msg.text();
    if (
      text.includes('[TabEditor]') ||
      text.includes('[CLAUDE-CODE]') ||
      text.includes('PreToolUse') ||
      text.includes('PostToolUse') ||
      text.includes('TURN ENDING') ||
      text.includes('pending tag') ||
      text.includes('snapshot')
    ) {
      console.log('[CONSOLE]', text);
    }
  });

  // Wait for workspace
  await waitForWorkspaceReady(page);

  // Open the file
  await openFileFromTree(page, 'test.md');
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('should handle multiple rounds of AI edits with proper tagging', async () => {
  test.setTimeout(120000); // 2 minutes for real Claude Code requests
  console.log('\n========== TEST START ==========\n');

  // Open AI chat panel and create session
  await openAIChatWithSession(page);
  console.log('[TEST] ✓ AI session created');

  // ========== ROUND 1: Add fruits ==========
  console.log('\n========== ROUND 1: Add fruits ==========\n');

  const prompt1 = 'Add a "Fruits" section with apples and bananas to the shopping list';
  console.log('[TEST] Sending prompt 1:', prompt1);

  // Submit prompt and wait for response
  await submitChatPrompt(page, prompt1, { waitForResponse: true, timeout: 15000 });
  console.log('[TEST] AI response 1 complete');

  // Check for diff mode activation
  const acceptAllButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.acceptAllButton);
  await expect(acceptAllButton).toBeVisible({ timeout: 10000 });
  console.log('[TEST] ✓ Diff mode activated after round 1');

  // Open history dialog to check tags
  await openHistoryDialog(page);
  await page.waitForTimeout(500);

  // Count history items and check for pre-edit tags
  const historyItemsRound1 = await page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem).count();
  console.log('[TEST] History items after round 1:', historyItemsRound1);

  // Check for pre-edit tags (look for items with "pre edit" label - note the space!)
  const preEditTagsRound1 = await page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem, { hasText: 'pre edit' }).count();
  console.log('[TEST] Pre-edit tags after round 1:', preEditTagsRound1);
  expect(preEditTagsRound1).toBeGreaterThanOrEqual(1);

  // Close history dialog
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // DON'T ACCEPT - leave it in diff mode to test multiple rounds

  // ========== ROUND 2: Add vegetables ==========
  console.log('\n========== ROUND 2: Add vegetables ==========\n');

  const prompt2 = 'Add a "Vegetables" section with carrots and broccoli';
  console.log('[TEST] Sending prompt 2:', prompt2);

  await submitChatPrompt(page, prompt2, { waitForResponse: true, timeout: 15000 });
  console.log('[TEST] AI response 2 complete');

  // Diff mode should still be active
  await expect(acceptAllButton).toBeVisible({ timeout: 5000 });
  console.log('[TEST] ✓ Diff mode still active after round 2');

  // Open history dialog again to check tags
  await openHistoryDialog(page);
  await page.waitForTimeout(500);

  // Count history items
  const historyItemsRound2 = await page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem).count();
  console.log('[TEST] History items after round 2:', historyItemsRound2);

  // Check for pre-edit tags
  const preEditTagsRound2 = await page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem, { hasText: 'pre edit' }).count();
  console.log('[TEST] Pre-edit tags after round 2:', preEditTagsRound2);

  // CRITICAL CHECK: Should still have only 1 pre-edit tag (not 2!)
  expect(preEditTagsRound2).toBe(1);
  console.log('[TEST] ✓ Still only 1 pre-edit tag after round 2');

  // Check for AI Edit snapshots
  const aiEditSnapshotsRound2 = await page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem, { hasText: 'ai edit' }).count();
  console.log('[TEST] AI Edit snapshots after round 2:', aiEditSnapshotsRound2);

  // Close history dialog
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ========== ROUND 3: Add dairy ==========
  console.log('\n========== ROUND 3: Add dairy ==========\n');

  const prompt3 = 'Add a "Dairy" section with cheese and yogurt';
  console.log('[TEST] Sending prompt 3:', prompt3);

  await submitChatPrompt(page, prompt3, { waitForResponse: true, timeout: 15000 });
  console.log('[TEST] AI response 3 complete');

  // Diff mode should still be active
  await expect(acceptAllButton).toBeVisible({ timeout: 5000 });
  console.log('[TEST] ✓ Diff mode still active after round 3');

  // Open history dialog one more time
  await openHistoryDialog(page);
  await page.waitForTimeout(500);

  // Count history items
  const historyItemsRound3 = await page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem).count();
  console.log('[TEST] History items after round 3:', historyItemsRound3);

  // Check for pre-edit tags
  const preEditTagsRound3 = await page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem, { hasText: 'pre edit' }).count();
  console.log('[TEST] Pre-edit tags after round 3:', preEditTagsRound3);

  // CRITICAL CHECK: Should STILL have only 1 pre-edit tag (not 3!)
  expect(preEditTagsRound3).toBe(1);
  console.log('[TEST] ✓ Still only 1 pre-edit tag after round 3');

  // Check for AI Edit snapshots - should have 3 (one per turn)
  const aiEditSnapshotsRound3 = await page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem, { hasText: 'ai edit' }).count();
  console.log('[TEST] AI Edit snapshots after round 3:', aiEditSnapshotsRound3);
  expect(aiEditSnapshotsRound3).toBe(3);
  console.log('[TEST] ✓ Correct number of AI Edit snapshots (3)');

  // Close history dialog
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ========== ACCEPT ALL ==========
  console.log('\n========== ACCEPT ALL ==========\n');

  await acceptAllButton.click();
  await page.waitForTimeout(1000);

  // Diff mode should exit
  await expect(acceptAllButton).not.toBeVisible({ timeout: 2000 });
  console.log('[TEST] ✓ Diff mode exited after accept');

  // Verify final content has all additions
  const finalContent = await fs.readFile(testFilePath, 'utf8');
  console.log('[TEST] Final content:\n', finalContent);

  expect(finalContent).toContain('Fruits');
  expect(finalContent).toContain('apples');
  expect(finalContent).toContain('Vegetables');
  expect(finalContent).toContain('carrots');
  expect(finalContent).toContain('Dairy');
  expect(finalContent).toContain('cheese');

  console.log('[TEST] ✓ All edits present in final content');
  console.log('\n========== TEST COMPLETE ==========\n');
});
