import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  waitForAppReady,
  ACTIVE_EDITOR_SELECTOR,
  ACTIVE_FILE_TAB_SELECTOR
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Manual Save (Cmd+S)', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create initial test file
    await fs.writeFile(
      path.join(workspaceDir, 'manual-save-test.md'),
      '# Manual Save Test\n\nInitial content.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should save immediately when Cmd+S is pressed', async () => {
    const filePath = path.join(workspaceDir, 'manual-save-test.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    const marker = `manual-save-marker-${Date.now()}`;

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'manual-save-test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('manual-save-test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Click in editor and add content
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker}\n`);

    // Verify dirty state appears
    const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'manual-save-test.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible({ timeout: 1000 });

    // Listen for console messages to see if save is being triggered
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

    // Manually trigger the file-save IPC event (simulating what the menu does)
    // The keyboard shortcut Cmd+S triggers the menu, which sends this IPC event
    await electronApp.evaluate(({ BrowserWindow }) => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) {
        focused.webContents.send('file-save');
      }
    });

    // Give it a moment to process
    await page.waitForTimeout(500);

    // Verify dirty indicator is gone immediately (not after 2 seconds)
    await expect(tab.locator('.tab-dirty-indicator')).toHaveCount(0, { timeout: 500 });

    // Verify content was saved to disk immediately
    const diskContent = await fs.readFile(filePath, 'utf8');
    expect(diskContent).toContain(marker);
  });

  test('should save even if pressed before autosave timer', async () => {
    const filePath = path.join(workspaceDir, 'manual-save-test.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    const marker = `quick-save-marker-${Date.now()}`;

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'manual-save-test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('manual-save-test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Get initial mtime
    const initialStats = await fs.stat(filePath);
    const initialMtime = initialStats.mtimeMs;

    // Click in editor and add content
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker}\n`);

    // Wait only 100ms (well before the 2 second autosave)
    await page.waitForTimeout(100);

    // Manually trigger the file-save IPC event (simulating what the menu does)
    await electronApp.evaluate(({ BrowserWindow }) => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) {
        focused.webContents.send('file-save');
      }
    });

    // Wait a tiny bit for the save to process
    await page.waitForTimeout(300);

    // Verify file was saved (mtime changed)
    const afterStats = await fs.stat(filePath);
    expect(afterStats.mtimeMs).toBeGreaterThan(initialMtime);

    // Verify content was saved
    const diskContent = await fs.readFile(filePath, 'utf8');
    expect(diskContent).toContain(marker);

    // Verify dirty indicator is gone
    const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'manual-save-test.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toHaveCount(0, { timeout: 500 });
  });
});
