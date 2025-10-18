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

test.describe('Autosave Timing', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create initial test file
    await fs.writeFile(
      path.join(workspaceDir, 'autosave-test.md'),
      '# Autosave Test\n\nInitial content.\n',
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

  test('should autosave after 2 seconds of inactivity', async () => {
    const filePath = path.join(workspaceDir, 'autosave-test.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    const marker = `autosave-marker-${Date.now()}`;

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'autosave-test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('autosave-test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Click in editor and add content
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker}\n`);

    // Verify dirty state appears
    const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'autosave-test.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible({ timeout: 1000 });

    // Wait for autosave (2s interval + 200ms debounce + buffer)
    await page.waitForTimeout(3000);

    // Verify dirty indicator is gone
    await expect(tab.locator('.tab-dirty-indicator')).toHaveCount(0, { timeout: 1000 });

    // Verify content was saved to disk
    const diskContent = await fs.readFile(filePath, 'utf8');
    expect(diskContent).toContain(marker);
  });

  test('should not autosave while user is actively typing', async () => {
    const filePath = path.join(workspaceDir, 'autosave-test.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'autosave-test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('autosave-test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Get initial file modification time
    const initialStats = await fs.stat(filePath);
    const initialMtime = initialStats.mtimeMs;

    // Click in editor
    await editor.click();
    await page.keyboard.press('End');

    // Type continuously (simulating active typing)
    for (let i = 0; i < 10; i++) {
      await page.keyboard.type(`Line ${i}\n`);
      await page.waitForTimeout(150); // Type every 150ms (within debounce window)
    }

    // Verify file hasn't been saved yet (still within debounce window)
    const duringStats = await fs.stat(filePath);
    expect(duringStats.mtimeMs).toBe(initialMtime);

    // Verify dirty indicator is still visible
    const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'autosave-test.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible();

    // Stop typing and wait for autosave
    await page.waitForTimeout(3000);

    // Now verify file was saved
    const afterStats = await fs.stat(filePath);
    expect(afterStats.mtimeMs).toBeGreaterThan(initialMtime);

    // Dirty indicator should be gone
    await expect(tab.locator('.tab-dirty-indicator')).toHaveCount(0);
  });

  test('should autosave multiple tabs independently', async () => {
    // Create second file
    await fs.writeFile(
      path.join(workspaceDir, 'second-file.md'),
      '# Second File\n\nInitial content.\n',
      'utf8'
    );

    const file1Path = path.join(workspaceDir, 'autosave-test.md');
    const file2Path = path.join(workspaceDir, 'second-file.md');
    const marker1 = `marker1-${Date.now()}`;
    const marker2 = `marker2-${Date.now()}`;

    // Open first file
    await page.locator('.file-tree-name', { hasText: 'autosave-test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('autosave-test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Edit first file
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker1}\n`);

    // Verify first file is dirty
    const tab1 = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'autosave-test.md' }) });
    await expect(tab1.locator('.tab-dirty-indicator')).toBeVisible();

    // Open second file
    await page.locator('.file-tree-name', { hasText: 'second-file.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('second-file.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Edit second file
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker2}\n`);

    // Verify second file is dirty
    const tab2 = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'second-file.md' }) });
    await expect(tab2.locator('.tab-dirty-indicator')).toBeVisible();

    // Wait for both files to autosave
    await page.waitForTimeout(3000);

    // Verify both files are clean
    await expect(tab1.locator('.tab-dirty-indicator')).toHaveCount(0);
    await expect(tab2.locator('.tab-dirty-indicator')).toHaveCount(0);

    // Verify both files were saved to disk
    const content1 = await fs.readFile(file1Path, 'utf8');
    const content2 = await fs.readFile(file2Path, 'utf8');
    expect(content1).toContain(marker1);
    expect(content2).toContain(marker2);
  });

  test('should handle rapid edits without excessive saves', async () => {
    const filePath = path.join(workspaceDir, 'autosave-test.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'autosave-test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('autosave-test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Get initial mtime
    const initialStats = await fs.stat(filePath);
    const initialMtime = initialStats.mtimeMs;

    // Click in editor
    await editor.click();
    await page.keyboard.press('End');

    // Make rapid edits
    for (let i = 0; i < 20; i++) {
      await page.keyboard.type('x');
      await page.waitForTimeout(50); // Very fast typing
    }

    // Wait a bit (but not enough for autosave)
    await page.waitForTimeout(500);

    // File should not have been saved yet (debounce should prevent it)
    const duringStats = await fs.stat(filePath);
    expect(duringStats.mtimeMs).toBe(initialMtime);

    // Wait for autosave to kick in
    await page.waitForTimeout(3000);

    // Now file should be saved (only once)
    const afterStats = await fs.stat(filePath);
    expect(afterStats.mtimeMs).toBeGreaterThan(initialMtime);

    // Verify dirty indicator is gone
    const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'autosave-test.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toHaveCount(0);
  });
});
