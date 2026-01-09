import { test, expect } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
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
  await fs.writeFile(testFilePath, '# Test\n\nOriginal content.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Listen to console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[TabEditor]') || text.includes('file-changed') || text.includes('pending tag')) {
      console.log('[CONSOLE]', text);
    }
  });

  // Wait for workspace
  await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('should handle consecutive AI edits without errors', async () => {
  // Open file
  await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
  await page.waitForSelector('[contenteditable="true"]', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Read original content
  const originalContent = await fs.readFile(testFilePath, 'utf8');
  console.log('[TEST] Original content:', originalContent);

  // STEP 1: Create a pre-edit tag by calling history API via IPC
  // This simulates what PreToolUse hook does
  await page.evaluate(async ([filePath, content]) => {
    await window.electronAPI.history.createTag(
      filePath,
      'test-tag-1',
      content,
      'test-session',
      'tool-1'
    );
    console.log('[TEST-RENDERER] Created pre-edit tag');
  }, [testFilePath, originalContent]);

  await page.waitForTimeout(200);

  // STEP 2: Write edit 1 to disk (simulates Edit tool)
  const content1 = originalContent.replace('Original content.', 'Original content.\n\nFirst edit.');
  await fs.writeFile(testFilePath, content1, 'utf8');
  console.log('[TEST] Wrote edit 1 to disk');

  // Wait for file watcher to detect change and activate diff mode
  await page.waitForTimeout(1000);

  // CHECK FOR DIALOGS - These should NOT appear!
  const bgChangeDialog = page.locator('.file-background-change-dialog-overlay');
  const conflictDialog = page.locator('text=File Changed on Disk');

  const hasBgDialog = await bgChangeDialog.isVisible().catch(() => false);
  const hasConflictDialog = await conflictDialog.isVisible().catch(() => false);

  if (hasBgDialog) {
    console.log('[TEST] ERROR: Background change dialog is showing!');
  }

  if (hasConflictDialog) {
    console.log('[TEST] ERROR: Conflict dialog is showing!');
  }

  // Dialogs should NOT be visible
  await expect(bgChangeDialog).not.toBeVisible({ timeout: 500 });
  await expect(conflictDialog).not.toBeVisible({ timeout: 500 });
  console.log('[TEST] ✓ No dialogs showing');

  // Check if diff mode activated - Accept All button should be visible
  const acceptAllButton = page.locator('button', { hasText: /Accept All/i });
  const isVisible = await acceptAllButton.isVisible().catch(() => false);
  console.log('[TEST] Accept All button visible after edit 1:', isVisible);

  if (!isVisible) {
    console.log('[TEST] ERROR: Diff mode did not activate!');
  }

  await expect(acceptAllButton).toBeVisible({ timeout: 2000 });
  console.log('[TEST] ✓ Diff mode activated after edit 1');

  // STEP 3: Write edit 2 to disk (consecutive edit)
  const content2 = content1.replace('First edit.', 'First edit.\n\nSecond edit.');
  await fs.writeFile(testFilePath, content2, 'utf8');
  console.log('[TEST] Wrote edit 2 to disk');

  await page.waitForTimeout(1000);

  // Diff button should still be visible (diff mode still active)
  await expect(acceptAllButton).toBeVisible({ timeout: 2000 });
  console.log('[TEST] ✓ Diff mode still active after edit 2');

  // STEP 4: Write edit 3 to disk (another consecutive edit)
  const content3 = content2.replace('Second edit.', 'Second edit.\n\nThird edit.');
  await fs.writeFile(testFilePath, content3, 'utf8');
  console.log('[TEST] Wrote edit 3 to disk');

  await page.waitForTimeout(1000);

  // Diff button should still be visible
  await expect(acceptAllButton).toBeVisible({ timeout: 2000 });
  console.log('[TEST] ✓ Diff mode still active after edit 3');

  // STEP 5: Accept changes
  await acceptAllButton.click();
  await page.waitForTimeout(500);

  // Diff button should disappear
  await expect(acceptAllButton).not.toBeVisible({ timeout: 2000 });
  console.log('[TEST] ✓ Diff mode exited after accept');

  // Verify final content on disk contains all edits
  const finalContent = await fs.readFile(testFilePath, 'utf8');
  expect(finalContent).toContain('First edit');
  expect(finalContent).toContain('Second edit');
  expect(finalContent).toContain('Third edit');

  console.log('[TEST] ✓ All consecutive edits succeeded!');
});

test('should show diff mode after first edit and update on subsequent edits', async () => {
  // Open file
  await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
  await page.waitForSelector('[contenteditable="true"]', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Simulate first AI edit
  await page.evaluate(async ([filePath]) => {
    const editorRegistry = (window as any).__editorRegistry;
    await editorRegistry.applyReplacements(filePath, [
      { oldText: 'Original content.', newText: 'First edit.' }
    ]);
  }, [testFilePath]);

  // Wait for diff mode to activate
  await page.waitForTimeout(500);

  // Check if Accept/Reject buttons appear (indicates diff mode)
  const acceptButton = page.locator('button', { hasText: 'Accept' }).first();
  await expect(acceptButton).toBeVisible({ timeout: 3000 });

  // Make second edit
  await page.evaluate(async ([filePath]) => {
    const editorRegistry = (window as any).__editorRegistry;
    await editorRegistry.applyReplacements(filePath, [
      { oldText: 'First edit.', newText: 'Second edit.' }
    ]);
  }, [testFilePath]);

  await page.waitForTimeout(500);

  // Diff buttons should still be visible (diff mode still active)
  await expect(acceptButton).toBeVisible();

  // Accept the changes
  await acceptButton.click();
  await page.waitForTimeout(200);

  // Diff buttons should disappear
  await expect(acceptButton).not.toBeVisible({ timeout: 2000 });
});
