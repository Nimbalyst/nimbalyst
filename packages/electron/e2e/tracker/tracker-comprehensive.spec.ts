/**
 * Comprehensive tracker system tests
 * Tests tracker item creation, storage, and display in bottom panel
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR } from '../helpers';
import {
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
  waitForAutosave
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Tracker System', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.afterEach(async () => {
    await electronApp?.close();
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test('should create tracker item and display in bottom panel', async () => {
    workspaceDir = await createTempWorkspace();
    const testFile = path.join(workspaceDir, 'test.md');
    await fs.writeFile(testFile, '# Test\n\n', 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();

    await dismissAPIKeyDialog(page);
    await waitForWorkspaceReady(page);
    await openFileFromTree(page, 'test.md');

    // Type tracker item in editor
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.click();
    await page.keyboard.press('Meta+ArrowDown');
    await page.keyboard.type('- Fix authentication bug #bug');
    await page.keyboard.press('Enter');

    // Wait for autosave
    await waitForAutosave(page, 'test.md');

    // Open bottom panel
    const plansNavButton = page.locator('.nav-button[aria-label*="Plans"]');
    await plansNavButton.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.DEFAULT_WAIT });
    await plansNavButton.click();

    // Click Bugs tab
    const bugsTab = page.locator('.bottom-panel-tab').filter({ hasText: 'Bugs' });
    await bugsTab.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.DEFAULT_WAIT });
    await bugsTab.click();

    // Verify tracker item appears in table
    const trackerRow = page.locator('.tracker-table-row');
    await expect(trackerRow).toBeVisible({ timeout: 2000 });
    await expect(trackerRow).toHaveCount(1);

    // Verify tab count shows at least 1
    const tabCount = bugsTab.locator('.tab-count');
    await expect(tabCount).toBeVisible();
    const countText = await tabCount.textContent();
    expect(parseInt(countText || '0')).toBeGreaterThan(0);
  });

  test('should load pre-existing tracker items from file', async () => {
    workspaceDir = await createTempWorkspace();
    const testFile = path.join(workspaceDir, 'test.md');

    // Create file with tracker item already in it
    const testContent = '# Test Document\n\nFix authentication bug #bug[id:bug_test123 status:to-do]\n';
    await fs.writeFile(testFile, testContent, 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();

    await dismissAPIKeyDialog(page);
    await waitForWorkspaceReady(page);
    await openFileFromTree(page, 'test.md');

    // Wait for file to load and be indexed
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Wait for document service to index (brief wait for polling cycle)
    await page.waitForTimeout(3000);

    // Open bottom panel
    const plansNavButton = page.locator('.nav-button[aria-label*="Plans"]');
    await plansNavButton.click();

    // Click Bugs tab
    const bugsTab = page.locator('.bottom-panel-tab').filter({ hasText: 'Bugs' });
    await bugsTab.waitFor({ state: 'visible', timeout: 5000 });
    await bugsTab.click();

    // Verify bottom panel shows the bug
    const bottomPanel = page.locator('.bottom-panel');
    await expect(bottomPanel).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });

    // Verify bug count is at least 1
    const tabCount = bugsTab.locator('.tab-count');
    await expect(tabCount).toBeVisible();
    const countText = await tabCount.textContent();
    expect(parseInt(countText || '0')).toBeGreaterThan(0);
  });
});
