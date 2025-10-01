import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
    launchElectronApp,
    createTempWorkspace,
    TEST_TIMEOUTS,
    waitForAppReady,
    ACTIVE_EDITOR_SELECTOR
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Tab Reordering', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create multiple test files
    await fs.writeFile(path.join(workspaceDir, 'file1.md'), '# File 1\n\nContent 1\n', 'utf8');
    await fs.writeFile(path.join(workspaceDir, 'file2.md'), '# File 2\n\nContent 2\n', 'utf8');
    await fs.writeFile(path.join(workspaceDir, 'file3.md'), '# File 3\n\nContent 3\n', 'utf8');

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

  test('should allow dragging tabs to reorder them', async () => {
    // Open all three files
    await page.locator('.file-tree-name', { hasText: 'file1.md' }).click();
    await expect(page.locator('.tab .tab-title', { hasText: 'file1.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    await page.locator('.file-tree-name', { hasText: 'file2.md' }).click();
    await expect(page.locator('.tab .tab-title', { hasText: 'file2.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    await page.locator('.file-tree-name', { hasText: 'file3.md' }).click();
    await expect(page.locator('.tab .tab-title', { hasText: 'file3.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Get all tabs
    const tabs = page.locator('.tab .tab-title');
    await expect(tabs).toHaveCount(3);

    // Check initial order
    const initialOrder = await tabs.allInnerTexts();
    expect(initialOrder).toEqual(['file1.md', 'file2.md', 'file3.md']);

    // Drag file3 to the first position
    const file3Tab = page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'file3.md' }) });
    const file1Tab = page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'file1.md' }) });

    // Perform drag and drop
    await file3Tab.dragTo(file1Tab);

    // Wait a bit for the reorder to complete
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    // Check new order
    const newOrder = await tabs.allInnerTexts();
    expect(newOrder[0]).toBe('file3.md');
  });

  test('should show visual feedback during drag', async () => {
    // Open two files
    await page.locator('.file-tree-name', { hasText: 'file1.md' }).click();
    await expect(page.locator('.tab .tab-title', { hasText: 'file1.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    await page.locator('.file-tree-name', { hasText: 'file2.md' }).click();
    await expect(page.locator('.tab .tab-title', { hasText: 'file2.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    const file2Tab = page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'file2.md' }) });

    // Start drag
    const box = await file2Tab.boundingBox();
    if (!box) throw new Error('Tab not found');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    // During drag, tab should have dragging class
    await page.mouse.move(box.x - 50, box.y + box.height / 2);

    // Check for dragging visual feedback
    const hasDraggingClass = await file2Tab.evaluate((el) => el.classList.contains('dragging'));
    expect(hasDraggingClass).toBe(true);

    await page.mouse.up();
  });

  test('should not reload tab when clicking on already active tab', async () => {
    await page.locator('.file-tree-name', { hasText: 'file1.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('file1.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.click();

    // Add some content
    const marker = `no-reload-test-${Date.now()}`;
    await page.keyboard.type(marker);

    // Click the already-active tab
    const activeTab = page.locator('.tab.active', { has: page.locator('.tab-title', { hasText: 'file1.md' }) });
    await activeTab.click();

    // Editor should still have our marker
    const editorText = await editor.innerText();
    expect(editorText).toContain(marker);

    // Tab should still be active
    await expect(page.locator('.tab.active .tab-title')).toContainText('file1.md');
  });
});
