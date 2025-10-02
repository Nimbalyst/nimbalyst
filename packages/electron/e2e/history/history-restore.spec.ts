import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, getKeyboardShortcut, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR, getEditorContent } from '../helpers';
import * as path from 'path';
import * as fs from 'fs/promises';

test.describe('History restore functionality', () => {
  test('creates manual snapshot and restores previous version', async () => {
    const workspaceDir = await createTempWorkspace();
    const testFile = path.join(workspaceDir, 'test-document.md');

    // Create initial document content
    const originalContent = '# Original Content\n\nThis is the original content of the document.\n';
    await fs.writeFile(testFile, originalContent, 'utf8');

    const electronApp = await launchElectronApp({ workspace: workspaceDir });

    try {
      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Dismiss API key dialog if present
      const apiDialog = page.locator('.api-key-dialog-overlay');
      if (await apiDialog.isVisible()) {
        await page.locator('.api-key-dialog-button.secondary').click();
      }

      // Wait for workspace to load
      await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
      await page.locator('.file-tree-name', { hasText: 'test-document.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

      // Open the test file
      await page.locator('.file-tree-name', { hasText: 'test-document.md' }).click();
      await expect(page.locator('.tab.active .tab-title')).toContainText('test-document.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

      // Verify original content is loaded
      const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
      await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });
      let editorText = await editor.innerText();
      expect(editorText).toContain('Original Content');

      // Make first edit and save manually (Cmd+S)
      await editor.click();
      await page.keyboard.press(getKeyboardShortcut('Mod+A'));
      await page.keyboard.type('# First Edit\n\nThis is the first version after editing.\n');
      await page.waitForTimeout(200);

      // Manual save with Cmd+S (creates manual snapshot)
      await page.keyboard.press(getKeyboardShortcut('Mod+S'));
      await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

      // Verify file was saved
      const firstEditContent = await fs.readFile(testFile, 'utf8');
      expect(firstEditContent).toContain('First Edit');

      // Make second edit and save
      await editor.click();
      await page.keyboard.press(getKeyboardShortcut('Mod+A'));
      await page.keyboard.type('# Second Edit\n\nThis is the second version after editing.\n');
      await page.waitForTimeout(200);

      // Manual save with Cmd+S (creates another manual snapshot)
      await page.keyboard.press(getKeyboardShortcut('Mod+S'));
      await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

      // Verify second save
      const secondEditContent = await fs.readFile(testFile, 'utf8');
      expect(secondEditContent).toContain('Second Edit');

      // Open history dialog by clicking on the history button in the toolbar
      const historyButton = page.locator('button[aria-label*="history" i], button[title*="history" i], .history-button').first();
      if (await historyButton.isVisible().catch(() => false)) {
        await historyButton.click();
      } else {
        // Fallback: try keyboard shortcut with better focus
        await page.click('body'); // Ensure not in editor
        await page.keyboard.press(getKeyboardShortcut('Mod+Y'));
      }
      await page.waitForSelector('.history-dialog', { timeout: 5000 });

      // Verify we have multiple snapshots listed
      const snapshotItems = page.locator('.history-item');
      const snapshotCount = await snapshotItems.count();
      expect(snapshotCount).toBeGreaterThanOrEqual(2);

      // Select the second snapshot (first edit) - snapshots are ordered newest first
      // So index 1 should be the "First Edit" snapshot
      const secondSnapshot = snapshotItems.nth(1);
      await secondSnapshot.click();
      await page.waitForTimeout(500);

      // Verify preview shows the first edit content
      const previewContent = page.locator('.history-preview-content pre');
      await expect(previewContent).toContainText('First Edit');

      // Click restore button
      const restoreButton = page.locator('.history-restore-button');
      await restoreButton.click();
      await page.waitForTimeout(500);

      // History dialog should close
      await expect(page.locator('.history-dialog')).toHaveCount(0);

      // Verify editor now shows the restored content (First Edit)
      editorText = await editor.innerText();
      expect(editorText).toContain('First Edit');
      expect(editorText).not.toContain('Second Edit');

      // Document should be marked as dirty (unsaved changes)
      await expect(page.locator('.tab.active .tab-dirty-indicator')).toBeVisible();

      // Save the restored version
      await page.keyboard.press(getKeyboardShortcut('Mod+S'));
      await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

      // Verify the file on disk now contains the restored content
      const restoredFileContent = await fs.readFile(testFile, 'utf8');
      expect(restoredFileContent).toContain('First Edit');
      expect(restoredFileContent).not.toContain('Second Edit');

      // Close and reopen file to verify persistence
      const closeButton = page.locator('.tab.active .tab-close');
      await closeButton.click();
      await page.waitForTimeout(300);

      // Reopen the file
      await page.locator('.file-tree-name', { hasText: 'test-document.md' }).click();
      await expect(page.locator('.tab.active .tab-title')).toContainText('test-document.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

      // Verify restored content persists after reload
      editorText = await editor.innerText();
      expect(editorText).toContain('First Edit');
      expect(editorText).not.toContain('Second Edit');

    } finally {
      await electronApp.close().catch(() => undefined);
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('restored content appears immediately without refresh', async () => {
    const workspaceDir = await createTempWorkspace();
    const testFile = path.join(workspaceDir, 'immediate-test.md');

    const originalContent = '# Original\n\nOriginal text.\n';
    await fs.writeFile(testFile, originalContent, 'utf8');

    const electronApp = await launchElectronApp({ workspace: workspaceDir });

    try {
      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const apiDialog = page.locator('.api-key-dialog-overlay');
      if (await apiDialog.isVisible()) {
        await page.locator('.api-key-dialog-button.secondary').click();
      }

      await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
      await page.locator('.file-tree-name', { hasText: 'immediate-test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

      await page.locator('.file-tree-name', { hasText: 'immediate-test.md' }).click();
      await expect(page.locator('.tab.active .tab-title')).toContainText('immediate-test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

      const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
      await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });

      // Edit and save
      await editor.click();
      await page.keyboard.press(getKeyboardShortcut('Mod+A'));
      await page.keyboard.type('# Modified\n\nModified text.\n');
      await page.keyboard.press(getKeyboardShortcut('Mod+S'));
      await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

      // Open history dialog by clicking on the history button in the toolbar
      const historyButton = page.locator('button[aria-label*="history" i], button[title*="history" i], .history-button').first();
      if (await historyButton.isVisible().catch(() => false)) {
        await historyButton.click();
      } else {
        // Fallback: try keyboard shortcut with better focus
        await page.click('body'); // Ensure not in editor
        await page.keyboard.press(getKeyboardShortcut('Mod+Y'));
      }
      await page.waitForSelector('.history-dialog', { timeout: 5000 });

      const snapshotItems = page.locator('.history-item');
      const secondSnapshot = snapshotItems.nth(1); // Original version
      await secondSnapshot.click();
      await page.waitForTimeout(500);

      await page.locator('.history-restore-button').click();
      await page.waitForTimeout(300); // Brief wait for restore to apply

      // CRITICAL: Content should appear immediately without refresh
      // This is the main bug we're testing - before the fix, editor would be blank here
      const editorText = await editor.innerText();
      expect(editorText).toContain('Original');
      expect(editorText).not.toContain('Modified');

      // Verify we don't need to refresh to see the content
      // If the bug exists, the editor will be blank at this point
      expect(editorText.trim().length).toBeGreaterThan(0);

    } finally {
      await electronApp.close().catch(() => undefined);
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
