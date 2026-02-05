import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, waitForAppReady, ACTIVE_EDITOR_SELECTOR, ACTIVE_FILE_TAB_SELECTOR } from '../helpers';
import * as path from 'path';
import * as fs from 'fs/promises';

test.describe('File deletion while open', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeAll(async () => {
    workspaceDir = await createTempWorkspace();
    await fs.writeFile(path.join(workspaceDir, 'test.md'), '# Test\n\nThis file should be deleted.\n', 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);

    // Override window.confirm to auto-accept
    await page.evaluate(() => {
      window.confirm = () => true;
    });
  });

  test.afterAll(async () => {
    await electronApp?.close().catch(() => undefined);
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('deleting an open file should close the tab and not recreate the file', async () => {
    const testFile = path.join(workspaceDir, 'test.md');

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Make some edits to ensure autosave would trigger
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.click();
    await page.keyboard.type('\n\nThis is new content that should not be saved.');

    // Wait for dirty indicator
    await expect(page.locator('.file-tabs-container .tab.active .tab-dirty-indicator')).toBeVisible({ timeout: 1000 });

    // Right-click on the file in the tree and delete it
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click({ button: 'right' });
    await page.waitForSelector('.file-context-menu', { timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

    // Click delete (window.confirm is overridden to return true)
    const deleteButton = page.locator('[data-testid="context-menu-delete"]');
    await deleteButton.click();

    // The tab should be closed
    await expect(page.locator('.file-tabs-container .tab .tab-title', { hasText: 'test.md' })).toHaveCount(0, { timeout: 5000 });

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
  });
});
