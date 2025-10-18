import { test, expect } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR, ACTIVE_FILE_TAB_SELECTOR } from '../helpers';
import * as path from 'path';
import * as fs from 'fs/promises';

test.describe('File deletion while open', () => {
  test('deleting an open file should close the tab and not recreate the file', async () => {
    const workspaceDir = await createTempWorkspace();
    const testFile = path.join(workspaceDir, 'test.md');

    await fs.writeFile(testFile, '# Test\n\nThis file should be deleted.\n', 'utf8');

    const electronApp = await launchElectronApp({ workspace: workspaceDir });

    try {
      const page = await electronApp.firstWindow();

      // Log all console messages from the page
      page.on('console', msg => {
        if (msg.text().includes('FILE_DELETED') || msg.text().includes('MAIN')) {
          console.log(`[PAGE CONSOLE] ${msg.text()}`);
        }
      });

      await page.waitForLoadState('domcontentloaded');

      // Dismiss API key dialog if present
      const apiDialog = page.locator('.api-key-dialog-overlay');
      if (await apiDialog.isVisible()) {
        await page.locator('.api-key-dialog-button.secondary').click();
      }

      // Wait for workspace to load
      await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
      await page.locator('.file-tree-name', { hasText: 'test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

      // Override window.confirm to auto-accept
      await page.evaluate(() => {
        window.confirm = () => true;
      });

      // Open the file
      await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
      await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

      // Make some edits to ensure autosave would trigger
      const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
      await editor.click();
      await page.keyboard.type('\n\nThis is new content that should not be saved.');

      // Wait a moment for the dirty indicator
      await page.waitForTimeout(500);
      await expect(page.locator('.file-tabs-container .tab.active .tab-dirty-indicator')).toBeVisible();

      // Right-click on the file in the tree and delete it
      await page.locator('.file-tree-name', { hasText: 'test.md' }).click({ button: 'right' });
      await page.waitForSelector('.file-context-menu', { timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

      // Click delete (window.confirm is overridden to return true)
      const deleteButton = page.locator('.context-menu-item-danger', { hasText: 'Delete' });
      await deleteButton.click();

      // Wait for the deletion to complete and IPC event to be processed
      await page.waitForTimeout(2000);

      // Verify the file was actually deleted first
      const fileExists = await fs.access(testFile).then(() => true).catch(() => false);
      console.log('File exists after deletion:', fileExists);

      // The tab should be closed
      await expect(page.locator('.file-tabs-container .tab .tab-title', { hasText: 'test.md' })).toHaveCount(0);

      // Verify the file was actually deleted and not recreated
      await expect.poll(async () => {
        try {
          await fs.access(testFile);
          return false; // File exists
        } catch {
          return true; // File does not exist
        }
      }, {
        timeout: TEST_TIMEOUTS.SAVE_OPERATION * 2,
        message: 'Expected file to remain deleted'
      }).toBe(true);

    } finally {
      await electronApp.close().catch(() => undefined);
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
