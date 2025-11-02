import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
  waitForAutosave
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Consecutive AI Edits Diff Update', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFilePath: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    testFilePath = path.join(workspaceDir, 'test.md');

    // Create initial test file BEFORE launching app
    const initialContent = '# Test Document\n\nOriginal content line 1.\nOriginal content line 2.\n';
    await fs.writeFile(testFilePath, initialContent, 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();

    // Capture console logs
    page.on('console', msg => {
      if (msg.text().includes('[TabEditor]')) {
        console.log('CONSOLE:', msg.text());
      }
    });

    await page.waitForLoadState('domcontentloaded');

    await dismissAPIKeyDialog(page);
    await waitForWorkspaceReady(page);
    await openFileFromTree(page, 'test.md');

    // Wait for editor to be ready
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, {
      timeout: TEST_TIMEOUTS.EDITOR_LOAD
    });
  });

  test.afterEach(async () => {
    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should update diff view when consecutive AI edits occur', async () => {
    console.log('[Test] Starting consecutive edits diff update test');

    // Step 1: Create a pre-edit tag (simulating AI about to edit)
    const tagName = `ai-edit-pending-test-${Date.now()}`;
    const initialContent = await fs.readFile(testFilePath, 'utf8');

    await page.evaluate(async ({ filePath, tag, content }) => {
      await window.electronAPI.invoke('history:create-tag', filePath, tag, content, 'test-session', 'test-tool-use');
    }, { filePath: testFilePath, tag: tagName, content: initialContent });

    console.log('[Test] Created pre-edit tag:', tagName);

    // Step 2: First AI edit - modify the file on disk
    const firstEdit = '# Test Document\n\nFirst edit line 1.\nFirst edit line 2.\n';
    await fs.writeFile(testFilePath, firstEdit, 'utf8');

    console.log('[Test] Applied first edit to disk');

    // Wait for file watcher to detect change and enter diff mode
    await page.waitForTimeout(500);

    // Verify diff mode is active (check for diff-related classes or buttons)
    const acceptAllButton = page.locator('button', { hasText: /accept all/i });
    await expect(acceptAllButton).toBeVisible({ timeout: 3000 });

    console.log('[Test] Diff mode activated for first edit');

    // Verify first edit is visible in the editor (should see green additions)
    const editor = page.locator(PLAYWRIGHT_TEST_SELECTORS.contentEditable);
    const editorText = await editor.textContent();
    expect(editorText).toContain('First edit');

    console.log('[Test] First edit visible in diff view');

    // Step 3: Wait for autosave
    await waitForAutosave(page, 'test.md');

    console.log('[Test] First edit autosaved');

    // Step 4: Second AI edit - modify the file on disk again
    const secondEdit = '# Test Document\n\nSecond edit line 1.\nSecond edit line 2.\nAdditional line.\n';
    await fs.writeFile(testFilePath, secondEdit, 'utf8');

    console.log('[Test] Applied second edit to disk');

    // Wait for file watcher to detect the second change
    await page.waitForTimeout(500);

    // Step 5: Verify diff view updated with second edit
    // The accept button should still be visible (still in diff mode)
    await expect(acceptAllButton).toBeVisible({ timeout: 3000 });

    // Verify second edit content is now visible in the editor
    const updatedEditorText = await editor.textContent();
    expect(updatedEditorText).toContain('Second edit');
    expect(updatedEditorText).toContain('Additional line');

    // Verify first edit content is no longer visible (replaced by second edit)
    expect(updatedEditorText).not.toContain('First edit line 1');

    console.log('[Test] Second edit visible in updated diff view');

    // Step 6: Accept the final diff
    await acceptAllButton.click();
    await page.waitForTimeout(500);

    console.log('[Test] Accepted final diff');

    // Step 7: Verify final content matches the second edit
    const finalContent = await fs.readFile(testFilePath, 'utf8');
    expect(finalContent).toBe(secondEdit);

    console.log('[Test] Final content verified on disk');

    // Verify tag was marked as reviewed
    const tagStatus = await page.evaluate(async ({ filePath, tag }) => {
      const tagData = await window.electronAPI.history.getTag(filePath, tag);
      return tagData?.status;
    }, { filePath: testFilePath, tag: tagName });

    expect(tagStatus).toBe('reviewed');

    console.log('[Test] Tag marked as reviewed');
  });

  test('should show diff between original and latest after multiple rapid edits', async () => {
    console.log('[Test] Starting rapid consecutive edits test');

    // Create pre-edit tag
    const tagName = `ai-edit-pending-rapid-${Date.now()}`;
    const originalContent = await fs.readFile(testFilePath, 'utf8');

    await page.evaluate(async ({ filePath, tag, content }) => {
      await window.electronAPI.invoke('history:create-tag', filePath, tag, content, 'test-session', 'test-tool-use');
    }, { filePath: testFilePath, tag: tagName, content: originalContent });

    // Apply three rapid edits
    const edit1 = '# Test Document\n\nEdit 1.\n';
    await fs.writeFile(testFilePath, edit1, 'utf8');
    await page.waitForTimeout(200);

    const edit2 = '# Test Document\n\nEdit 2.\n';
    await fs.writeFile(testFilePath, edit2, 'utf8');
    await page.waitForTimeout(200);

    const edit3 = '# Test Document\n\nEdit 3.\nFinal line.\n';
    await fs.writeFile(testFilePath, edit3, 'utf8');
    await page.waitForTimeout(500);

    console.log('[Test] Applied three rapid edits');

    // Verify we're in diff mode
    const acceptAllButton = page.locator('button', { hasText: /accept all/i });
    await expect(acceptAllButton).toBeVisible({ timeout: 3000 });

    // Verify the diff shows the ORIGINAL content vs the LATEST content (edit3)
    // Not edit1 vs edit3, not edit2 vs edit3, but ORIGINAL vs edit3
    const editor = page.locator(PLAYWRIGHT_TEST_SELECTORS.contentEditable);
    const editorText = await editor.textContent();

    // Should see the latest edit content
    expect(editorText).toContain('Edit 3');
    expect(editorText).toContain('Final line');

    console.log('[Test] Latest edit visible in diff view');

    // Accept the diff
    await acceptAllButton.click();
    await page.waitForTimeout(200);

    // Verify final content
    const finalContent = await fs.readFile(testFilePath, 'utf8');
    expect(finalContent).toBe(edit3);

    console.log('[Test] Rapid edits test completed successfully');
  });

  test('should maintain diff mode across tab switches during consecutive edits', async () => {
    console.log('[Test] Starting diff mode persistence test');

    // Create second file
    const secondFilePath = path.join(workspaceDir, 'second.md');
    await fs.writeFile(secondFilePath, '# Second File\n\nSecond file content.\n', 'utf8');

    // Refresh workspace to show new file
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await dismissAPIKeyDialog(page);
    await waitForWorkspaceReady(page);

    // Open first file
    await openFileFromTree(page, 'test.md');
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, {
      timeout: TEST_TIMEOUTS.EDITOR_LOAD
    });

    // Create pre-edit tag and apply edit
    const tagName = `ai-edit-tab-switch-${Date.now()}`;
    const originalContent = await fs.readFile(testFilePath, 'utf8');
    await page.evaluate(async ({ filePath, tag, content }) => {
      await window.electronAPI.invoke('history:create-tag', filePath, tag, content, 'test-session', 'test-tool-use');
    }, { filePath: testFilePath, tag: tagName, content: originalContent });

    const firstEdit = '# Test Document\n\nEdited content.\n';
    await fs.writeFile(testFilePath, firstEdit, 'utf8');
    await page.waitForTimeout(500);

    // Verify diff mode
    const acceptAllButton = page.locator('button', { hasText: /accept all/i });
    await expect(acceptAllButton).toBeVisible({ timeout: 3000 });

    console.log('[Test] Diff mode activated');

    // Switch to second file
    await openFileFromTree(page, 'second.md');
    await page.waitForTimeout(500);

    console.log('[Test] Switched to second file');

    // Apply second edit to first file (while viewing second file)
    const secondEdit = '# Test Document\n\nSecond edited content.\n';
    await fs.writeFile(testFilePath, secondEdit, 'utf8');
    await page.waitForTimeout(500);

    // Switch back to first file
    await openFileFromTree(page, 'test.md');
    await page.waitForTimeout(500);

    console.log('[Test] Switched back to first file');

    // Verify diff mode is restored and shows the second edit
    await expect(acceptAllButton).toBeVisible({ timeout: 3000 });

    const editor = page.locator(PLAYWRIGHT_TEST_SELECTORS.contentEditable);
    const editorText = await editor.textContent();
    expect(editorText).toContain('Second edited content');

    console.log('[Test] Diff mode persisted with updated content after tab switch');
  });
});
