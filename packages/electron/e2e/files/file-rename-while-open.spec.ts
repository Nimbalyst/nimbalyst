import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  waitForAppReady,
  ACTIVE_EDITOR_SELECTOR,
  ACTIVE_FILE_TAB_SELECTOR
} from '../helpers';
import * as path from 'path';
import * as fs from 'fs/promises';

test.describe('File rename while open', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeAll(async () => {
    workspaceDir = await createTempWorkspace();
    await fs.writeFile(path.join(workspaceDir, 'original.md'), '# Original\n\nSome content.\n', 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterAll(async () => {
    await electronApp?.close().catch(() => undefined);
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('renaming an open file should update the tab name and path', async () => {
    // Open the file
    await page.locator('.file-tree-name', { hasText: 'original.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('original.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Verify content loaded
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toContainText('Some content');

    // Right-click on the file in the tree to open context menu
    await page.locator('.file-tree-name', { hasText: 'original.md' }).click({ button: 'right' });
    await page.waitForSelector('.file-context-menu', { timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

    // Click Rename in the context menu
    await page.locator('.file-context-menu-item', { hasText: 'Rename' }).click();

    // The context menu switches to an inline rename input
    const renameInput = page.locator('.rename-input');
    await expect(renameInput).toBeVisible({ timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

    // Clear the input and type the new name
    await renameInput.fill('renamed.md');
    await renameInput.press('Enter');

    // Wait for rename to process - the file tree should show the new name
    await expect(page.locator('.file-tree-name', { hasText: 'renamed.md' })).toBeVisible({ timeout: 5000 });

    // The tab should show the new name
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('renamed.md', { timeout: 5000 });

    // The old file should not exist on disk
    const oldExists = await fs.access(path.join(workspaceDir, 'original.md')).then(() => true).catch(() => false);
    expect(oldExists).toBe(false);

    // The new file should exist on disk
    const newExists = await fs.access(path.join(workspaceDir, 'renamed.md')).then(() => true).catch(() => false);
    expect(newExists).toBe(true);

    // Content should be preserved in the editor
    await expect(editor).toContainText('Some content');
  });
});
