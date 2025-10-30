import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR } from '../helpers';
import {
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
  editDocumentContent,
  manualSaveDocument,
  openHistoryDialog,
  getHistoryItemCount
} from '../utils/testHelpers';
import * as path from 'path';
import * as fs from 'fs/promises';

test.describe('History - Simple Manual/Auto Test', () => {
  test('should create manual save entry', async () => {
    const workspaceDir = await createTempWorkspace();
    const testFile = path.join(workspaceDir, 'simple-test.md');

    const initialContent = '# Test\n\nInitial.\n';
    await fs.writeFile(testFile, initialContent, 'utf8');

    const electronApp = await launchElectronApp({ workspace: workspaceDir });

    try {
      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Dismiss API key dialog
      await dismissAPIKeyDialog(page);

      // Wait for workspace
      await waitForWorkspaceReady(page);
      await page.locator('.file-tree-name', { hasText: 'simple-test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

      // Open file
      await openFileFromTree(page, 'simple-test.md');

      const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
      await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });

      // Make edit and manually save
      await editDocumentContent(page, editor, '# Test\n\nManual save.\n');
      await manualSaveDocument(page);

      // Verify save worked
      const savedContent = await fs.readFile(testFile, 'utf8');
      expect(savedContent).toContain('Manual save');

      console.log('[TEST] Saved content verified, attempting to open history dialog');

      // Open file history dialog
      await openHistoryDialog(page);

      console.log('[TEST] History dialog opened successfully');

      // Just verify dialog opened - don't test complex restoration yet
      const count = await getHistoryItemCount(page);
      expect(count).toBeGreaterThanOrEqual(1);

      console.log(`[TEST] Found ${count} history items`);

    } finally {
      await electronApp.close().catch(() => undefined);
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
