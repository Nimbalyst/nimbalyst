import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, getKeyboardShortcut, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR, ACTIVE_FILE_TAB_SELECTOR } from '../helpers';
import * as path from 'path';
import * as fs from 'fs/promises';

test.describe('Autosave before navigation', () => {
  test('saves dirty document when navigating via document link', async () => {
    const workspaceDir = await createTempWorkspace();
    const sourceFile = path.join(workspaceDir, 'source.md');
    const targetFile = path.join(workspaceDir, 'target.md');

    await fs.writeFile(sourceFile, '# Source\n\nOriginal content before autosave.\n', 'utf8');
    await fs.writeFile(targetFile, '# Target\n\nThis is the target document.\n', 'utf8');

    const electronApp = await launchElectronApp({ workspace: workspaceDir });
    const marker = `autosave-marker-${Date.now()}`;

    try {
      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const apiDialog = page.locator('.api-key-dialog-overlay');
      if (await apiDialog.isVisible()) {
        await page.locator('.api-key-dialog-button.secondary').click();
      }

      await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
      await page.locator('.file-tree-name', { hasText: 'source.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });
      await page.locator('.file-tree-name', { hasText: 'target.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

      await page.locator('.file-tree-name', { hasText: 'source.md' }).click();
      await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('source.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

      const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
      await editor.click();
      await page.keyboard.press(getKeyboardShortcut('Mod+A'));
      await page.keyboard.type(`Autosave before navigation\n\nDirty section ${marker}\n\n[`);
      await page.keyboard.type('target');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');

      await page.waitForTimeout(200);

      const documentReference = page.locator('.document-reference', { hasText: 'target.md' });
      await expect(documentReference).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });
      await expect(page.locator('.file-tabs-container .tab.active .tab-dirty-indicator')).toBeVisible();

      // Click outside editor first to deselect
      await page.locator('.workspace-sidebar').click();
      await page.waitForTimeout(200);

      // Now click the document reference link directly
      // Use dispatchEvent to ensure the click is registered
      await documentReference.evaluate((el) => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      });

      // Wait for navigation to complete - tab should switch to target.md
      // Use a longer timeout since this involves autosave + navigation
      await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('target.md', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

      const sourceTabDirty = page.locator('.file-tabs-container .tab', {
        has: page.locator('.tab-title', { hasText: 'source.md' })
      }).locator('.tab-dirty-indicator');
      await expect(sourceTabDirty).toHaveCount(0);

      await expect.poll(async () => fs.readFile(sourceFile, 'utf8'), {
        timeout: TEST_TIMEOUTS.SAVE_OPERATION * 2,
        message: 'Expected source file to contain autosaved marker'
      }).toContain(marker);

      await page.locator('.tab-title', { hasText: 'source.md' }).click();
      await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('source.md');

      // Wait for editor to fully load and settle
      // The editor needs time to load content from disk and compare with initial state
      await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

      // The tab should not be dirty since it was autosaved
      await expect(page.locator('.tab.active .tab-dirty-indicator')).toHaveCount(0);

      const editorText = await editor.innerText();
      expect(editorText).toContain(marker);
    } finally {
      await electronApp.close().catch(() => undefined);
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
