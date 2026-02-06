/**
 * E2E tests for the Find/Replace Bar in the fixed tab header
 *
 * All tests share a single app instance for performance.
 * Tests run serially and each uses a separate file to avoid interference.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
  TEST_TIMEOUTS,
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  closeTabByFileName,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

// Use serial mode to ensure tests run in order with shared app instance
test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.describe('Find/Replace Bar', () => {
  test.beforeAll(async () => {
    workspaceDir = await createTempWorkspace();

    // Create test files for all scenarios upfront
    await fs.writeFile(
      path.join(workspaceDir, 'find-test-1.md'),
      '# Test Document 1\n\nThis is a test document with some searchable content.\n\nThe word "test" appears multiple times.\n\nAnother test here.\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceDir, 'find-test-2.md'),
      '# Test Document 2\n\nThis is a test document with some searchable content.\n\nThe word "test" appears multiple times.\n\nAnother test here.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' },
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await waitForAppReady(page);
    await dismissProjectTrustToast(page);
    await dismissAPIKeyDialog(page);
  });

  test.afterAll(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should open search/replace bar with Cmd+F and close with Escape', async () => {
    // Open test file
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'find-test-1.md' }).click();
    await expect(
      page.locator(PLAYWRIGHT_TEST_SELECTORS.tab).filter({ hasText: 'find-test-1.md' })
    ).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, {
      timeout: TEST_TIMEOUTS.EDITOR_LOAD,
    });

    // Initially, search bar should not be visible
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.searchReplaceBar)).not.toBeVisible();

    // Open search bar with Cmd+F keyboard shortcut (simulates menu command)
    await electronApp.evaluate(({ BrowserWindow }) => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) {
        focused.webContents.send('menu:find');
      }
    });

    // Wait for search bar to appear
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.searchReplaceBar)).toBeVisible({
      timeout: 1000,
    });

    // Search input should be focused
    const searchInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.searchInput);
    await expect(searchInput).toBeFocused();

    // Close with Escape key
    await searchInput.press('Escape');

    // Search bar should disappear
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.searchReplaceBar)).not.toBeVisible({
      timeout: 1000,
    });

    // Close the tab
    await closeTabByFileName(page, 'find-test-1.md');
  });

  test('should allow typing multiple characters in search box without losing focus', async () => {
    // Open test file
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'find-test-2.md' }).click();
    await expect(
      page.locator(PLAYWRIGHT_TEST_SELECTORS.tab).filter({ hasText: 'find-test-2.md' })
    ).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, {
      timeout: TEST_TIMEOUTS.EDITOR_LOAD,
    });

    // Open search bar
    await electronApp.evaluate(({ BrowserWindow }) => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) {
        focused.webContents.send('menu:find');
      }
    });

    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.searchReplaceBar)).toBeVisible();

    const searchInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.searchInput);
    await expect(searchInput).toBeFocused();

    // Type multiple characters - should remain focused
    await searchInput.type('test');

    // Verify the input has the text
    await expect(searchInput).toHaveValue('test');

    // Verify input still has focus
    await expect(searchInput).toBeFocused();

    // Verify match counter shows results
    const matchCounter = page.locator(PLAYWRIGHT_TEST_SELECTORS.matchCounter);
    await expect(matchCounter).toContainText('of');

    // Close search bar with Escape
    await searchInput.press('Escape');

    // Close the tab
    await closeTabByFileName(page, 'find-test-2.md');
  });
});
