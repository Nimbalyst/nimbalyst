/**
 * Comprehensive file save tests covering autosave, manual save, focus, and timing
 */

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
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('File Save (Autosave + Manual)', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    await fs.writeFile(
      path.join(workspaceDir, 'test-file.md'),
      '# Test File\n\nInitial content.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should autosave after inactivity and preserve focus/cursor position', async () => {
    const filePath = path.join(workspaceDir, 'test-file.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    const marker = `autosave-marker-${Date.now()}`;

    // Open file
    await page.locator('.file-tree-name', { hasText: 'test-file.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test-file.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Add content and position cursor
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker}\n\nLine 1\nLine 2\nLine 3`);

    // Move cursor to middle of Line 2
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('X');

    // Verify dirty state
    const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'test-file.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible({ timeout: 1000 });

    // Wait for autosave (2s interval + 200ms debounce + buffer)
    await page.waitForTimeout(3000);

    // Verify dirty indicator cleared
    await expect(tab.locator('.tab-dirty-indicator')).toHaveCount(0, { timeout: 1000 });

    // Verify file saved to disk
    const diskContent = await fs.readFile(filePath, 'utf8');
    expect(diskContent).toContain(marker);

    // Verify focus maintained - can still type
    await page.keyboard.type('Y');
    const content = await editor.innerText();
    expect(content).toContain('LinXYe 2'); // Cursor position preserved
  });

  test('should debounce during rapid edits without excessive saves', async () => {
    const filePath = path.join(workspaceDir, 'test-file.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    await page.locator('.file-tree-name', { hasText: 'test-file.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test-file.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Get initial mtime
    const initialStats = await fs.stat(filePath);
    const initialMtime = initialStats.mtimeMs;

    // Type rapidly (continuous typing within debounce window)
    await editor.click();
    await page.keyboard.press('End');
    for (let i = 0; i < 20; i++) {
      await page.keyboard.type('x');
      await page.waitForTimeout(50); // Very fast typing
    }

    // Wait 500ms (not enough for autosave)
    await page.waitForTimeout(500);

    // File should NOT be saved yet (debounce prevents it)
    const duringStats = await fs.stat(filePath);
    expect(duringStats.mtimeMs).toBe(initialMtime);

    // Verify still dirty
    const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'test-file.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible();

    // Stop typing, wait for autosave
    await page.waitForTimeout(3000);

    // Now file should be saved (only once)
    const afterStats = await fs.stat(filePath);
    expect(afterStats.mtimeMs).toBeGreaterThan(initialMtime);
    await expect(tab.locator('.tab-dirty-indicator')).toHaveCount(0);
  });

  test('should autosave multiple tabs independently', async () => {
    // Create second file
    await fs.writeFile(
      path.join(workspaceDir, 'second-file.md'),
      '# Second File\n\nInitial content.\n',
      'utf8'
    );

    const file1Path = path.join(workspaceDir, 'test-file.md');
    const file2Path = path.join(workspaceDir, 'second-file.md');
    const marker1 = `marker1-${Date.now()}`;
    const marker2 = `marker2-${Date.now()}`;
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open and edit first file
    await page.locator('.file-tree-name', { hasText: 'test-file.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test-file.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker1}\n`);

    const tab1 = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'test-file.md' }) });
    await expect(tab1.locator('.tab-dirty-indicator')).toBeVisible();

    // Open and edit second file
    await page.locator('.file-tree-name', { hasText: 'second-file.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('second-file.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker2}\n`);

    const tab2 = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'second-file.md' }) });
    await expect(tab2.locator('.tab-dirty-indicator')).toBeVisible();

    // Wait for both to autosave
    await page.waitForTimeout(3000);

    // Verify both clean
    await expect(tab1.locator('.tab-dirty-indicator')).toHaveCount(0);
    await expect(tab2.locator('.tab-dirty-indicator')).toHaveCount(0);

    // Verify both saved
    const content1 = await fs.readFile(file1Path, 'utf8');
    const content2 = await fs.readFile(file2Path, 'utf8');
    expect(content1).toContain(marker1);
    expect(content2).toContain(marker2);
  });

  test('should save immediately with manual save (Cmd+S) overriding autosave timer', async () => {
    const filePath = path.join(workspaceDir, 'test-file.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    const marker = `manual-save-${Date.now()}`;

    await page.locator('.file-tree-name', { hasText: 'test-file.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test-file.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Get initial mtime
    const initialStats = await fs.stat(filePath);
    const initialMtime = initialStats.mtimeMs;

    // Add content
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker}\n`);

    const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'test-file.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible({ timeout: 1000 });

    // Wait only 100ms (well before 2 second autosave timer)
    await page.waitForTimeout(100);

    // Trigger manual save via IPC (simulates Cmd+S menu action)
    await electronApp.evaluate(({ BrowserWindow }) => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) {
        focused.webContents.send('file-save');
      }
    });

    // Wait for save to process
    await page.waitForTimeout(300);

    // Verify file saved immediately (mtime changed)
    const afterStats = await fs.stat(filePath);
    expect(afterStats.mtimeMs).toBeGreaterThan(initialMtime);

    // Verify content saved
    const diskContent = await fs.readFile(filePath, 'utf8');
    expect(diskContent).toContain(marker);

    // Verify dirty indicator gone
    await expect(tab.locator('.tab-dirty-indicator')).toHaveCount(0, { timeout: 500 });
  });
});
