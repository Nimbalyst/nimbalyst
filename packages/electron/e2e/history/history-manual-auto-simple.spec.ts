import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, getKeyboardShortcut, pressKeyboardShortcut, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR, ACTIVE_FILE_TAB_SELECTOR } from '../helpers';
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
      const apiDialog = page.locator('.api-key-dialog-overlay');
      if (await apiDialog.isVisible()) {
        await page.locator('.api-key-dialog-button.secondary').click();
      }

      // Wait for workspace
      await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
      await page.locator('.file-tree-name', { hasText: 'simple-test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

      // Open file
      await page.locator('.file-tree-name', { hasText: 'simple-test.md' }).click();
      await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('simple-test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

      const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
      await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });

      // Make edit and manually save
      await editor.click();
      await page.keyboard.press(getKeyboardShortcut('Mod+A'));
      await page.keyboard.type('# Test\n\nManual save.\n');
      await page.keyboard.press(getKeyboardShortcut('Mod+S'));
      await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

      // Verify save worked
      const savedContent = await fs.readFile(testFile, 'utf8');
      expect(savedContent).toContain('Manual save');

      console.log('[TEST] Saved content verified, attempting to open history dialog');

      // Open file history dialog using Cmd+Y keyboard shortcut
      await page.click('body');
      await page.waitForTimeout(200);
      console.log('[TEST] Pressing Mod+Y to open file history');
      await pressKeyboardShortcut(page, 'Mod+Y');

      // Wait for dialog
      await page.waitForSelector('.history-dialog', { timeout: 5000 });

      console.log('[TEST] History dialog opened successfully');

      // Just verify dialog opened - don't test complex restoration yet
      const historyItems = page.locator('.history-item');
      const count = await historyItems.count();
      expect(count).toBeGreaterThanOrEqual(1);

      console.log(`[TEST] Found ${count} history items`);

    } finally {
      await electronApp.close().catch(() => undefined);
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
