import { test, expect } from '@playwright/test';
import type { ElectronApplication } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Workspace Tabs Basic Persistence', () => {
  let workspacePath: string;

  test.beforeEach(async () => {
    workspacePath = await createTempWorkspace();

    // Create test files
    await fs.writeFile(path.join(workspacePath, 'file1.md'), '# File 1\n', 'utf8');
    await fs.writeFile(path.join(workspacePath, 'file2.md'), '# File 2\n', 'utf8');
    await fs.writeFile(path.join(workspacePath, 'file3.md'), '# File 3\n', 'utf8');
  });

  test.afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should persist workspace tabs across app restart', async () => {
    test.setTimeout(20000);

    // Launch app
    let electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' }
    });

    let page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Open files
    await page.locator('.file-tree-name', { hasText: 'file1.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });
    await page.locator('.file-tree-name', { hasText: 'file1.md' }).click();
    await page.waitForTimeout(500);

    await page.locator('.file-tree-name', { hasText: 'file2.md' }).click();
    await page.waitForTimeout(500);

    await page.locator('.file-tree-name', { hasText: 'file3.md' }).click();
    await page.waitForTimeout(500);

    // Verify we have 3 tabs
    const tabCount = await page.locator('.file-tabs-container .tab').count();
    console.log('[TEST] Tabs before close:', tabCount);
    expect(tabCount).toBe(3);

    // Wait a bit for tabs to be saved
    await page.waitForTimeout(1000);

    // Close app
    await electronApp.close();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Reopen
    console.log('[TEST] Reopening app...');
    electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' }
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    const windows = electronApp.windows();
    const workspaceWindow = windows[0];
    await workspaceWindow.waitForLoadState('domcontentloaded');
    await workspaceWindow.waitForTimeout(2000);

    // Check tabs are restored
    const restoredTabCount = await workspaceWindow.locator('.file-tabs-container .tab').count();
    console.log('[TEST] Tabs after reopen:', restoredTabCount);
    expect(restoredTabCount).toBe(3);

    // Verify tab names
    const tabTexts = await workspaceWindow.locator('.file-tabs-container .tab').allTextContents();
    console.log('[TEST] Tab texts:', tabTexts);
    expect(tabTexts.some(t => t.includes('file1.md'))).toBe(true);
    expect(tabTexts.some(t => t.includes('file2.md'))).toBe(true);
    expect(tabTexts.some(t => t.includes('file3.md'))).toBe(true);

    await electronApp.close();
  });
});
