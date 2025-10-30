import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR } from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
  editDocumentContent,
  manualSaveDocument,
  openHistoryDialog,
  selectHistoryItem,
  restoreFromHistory
} from '../utils/testHelpers';
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

      // Handle any JavaScript dialogs that might appear
      page.on('dialog', async dialog => {
        console.log(`[TEST] Dialog appeared: ${dialog.type()} - ${dialog.message()}`);
        if (dialog.type() === 'beforeunload') {
          return;
        }
        await dialog.accept();
      });

      await page.waitForLoadState('domcontentloaded');

      // Dismiss API key dialog
      await dismissAPIKeyDialog(page);

      // Wait for workspace
      await waitForWorkspaceReady(page);
      await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'test-document.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

      // Open the test file
      await openFileFromTree(page, 'test-document.md');

      // Verify original content is loaded
      const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
      await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });
      let editorText = await editor.innerText();
      expect(editorText).toContain('Original Content');

      // Make first edit and save manually
      await editDocumentContent(page, editor, '# First Edit\n\nThis is the first version after editing.\n');
      await manualSaveDocument(page);

      // Verify file was saved
      const firstEditContent = await fs.readFile(testFile, 'utf8');
      expect(firstEditContent).toContain('First Edit');

      // Make second edit and save
      await editDocumentContent(page, editor, '# Second Edit\n\nThis is the second version after editing.\n');
      await manualSaveDocument(page);

      // Verify second save
      const secondEditContent = await fs.readFile(testFile, 'utf8');
      expect(secondEditContent).toContain('Second Edit');

      // Open history dialog
      await openHistoryDialog(page);

      // Verify we have multiple snapshots listed
      const snapshotCount = await page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem).count();
      expect(snapshotCount).toBeGreaterThanOrEqual(2);

      // Select the second snapshot (first edit) - snapshots are ordered newest first
      await selectHistoryItem(page, 1);

      // Verify preview shows the first edit content
      const previewContent = page.locator(PLAYWRIGHT_TEST_SELECTORS.historyPreviewContent);
      await expect(previewContent).toContainText('First Edit');

      // Restore the snapshot
      await restoreFromHistory(page);

      // History dialog should close
      await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.historyDialog)).toHaveCount(0);

      // Wait for content to update
      await page.waitForTimeout(1000);

      // Verify editor now shows the restored content (First Edit)
      editorText = await editor.innerText();
      expect(editorText).toContain('First Edit');
      expect(editorText).not.toContain('Second Edit');

      // Verify the file on disk now contains the restored content
      const restoredFileContent = await fs.readFile(testFile, 'utf8');
      expect(restoredFileContent).toContain('First Edit');
      expect(restoredFileContent).not.toContain('Second Edit');

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

      // Dismiss API key dialog
      await dismissAPIKeyDialog(page);

      // Wait for workspace
      await waitForWorkspaceReady(page);
      await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'immediate-test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

      // Open file
      await openFileFromTree(page, 'immediate-test.md');

      const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
      await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });

      // Edit and save
      await editDocumentContent(page, editor, '# Modified\n\nModified text.\n');
      await manualSaveDocument(page);

      // Open history dialog
      await openHistoryDialog(page);

      // Select the original version (second snapshot)
      await selectHistoryItem(page, 1);

      // Restore from history
      await restoreFromHistory(page);

      await page.waitForTimeout(300);

      // CRITICAL: Content should appear immediately without refresh
      // This is the main bug we're testing - before the fix, editor would be blank here
      const editorText = await editor.innerText();
      expect(editorText).toContain('Original');
      expect(editorText).not.toContain('Modified');

      // Verify we don't need to refresh to see the content
      expect(editorText.trim().length).toBeGreaterThan(0);

    } finally {
      await electronApp.close().catch(() => undefined);
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
