import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR, waitForAppReady } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('App Startup - Core Smoke Tests', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    await fs.writeFile(path.join(workspaceDir, 'test.md'), '# Test Document\n\nTest content\n', 'utf8');

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

  test('should launch the app and show workspace sidebar', async () => {
    const sidebar = page.locator('.workspace-sidebar');
    await expect(sidebar).toBeVisible();
  });

  test('should show file tree with test file', async () => {
    await page.locator('.file-tree-name', { hasText: 'test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

    const testFile = page.locator('.file-tree-name', { hasText: 'test.md' });
    await expect(testFile.first()).toBeVisible();
  });

  test('should open file when clicked in sidebar', async () => {
    await page.locator('.file-tree-name', { hasText: 'test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();

    // Wait for tab to appear
    await expect(page.locator('.tab.active .tab-title')).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Wait for editor to load
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Check editor has content
    const editorText = await editor.innerText();
    expect(editorText).toContain('Test Document');
  });

  test('should allow basic text editing', async () => {
    await page.locator('.file-tree-name', { hasText: 'test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.click();
    await page.keyboard.type(' - edited');

    // Check for dirty indicator
    await expect(page.locator('.tab.active .tab-dirty-indicator')).toBeVisible();
  });

  test('should save file with Cmd+S', async () => {
    await page.locator('.file-tree-name', { hasText: 'test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.click();

    // Move to end of document and add a newline
    await page.keyboard.press('Meta+ArrowDown');
    await page.keyboard.press('Enter');

    const marker = `save-test-${Date.now()}`;
    await page.keyboard.type(marker);

    await expect(page.locator('.tab.active .tab-dirty-indicator')).toBeVisible();

    // Save
    await page.keyboard.press('Meta+S');

    // Wait for save to complete
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Verify file on disk
    const content = await fs.readFile(path.join(workspaceDir, 'test.md'), 'utf8');
    expect(content).toContain(marker);
  });
});