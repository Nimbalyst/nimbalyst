/**
 * E2E tests for the Find/Replace Bar in the fixed tab header
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
} from '../helpers';
import { PLAYWRIGHT_TEST_SELECTORS } from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.beforeEach(async () => {
  // Create temporary workspace directory
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'test.md');

  // CRITICAL: Create test file BEFORE launching app
  await fs.writeFile(
    testFilePath,
    '# Test Document\n\nThis is a test document with some searchable content.\n\nThe word "test" appears multiple times.\n\nAnother test here.\n',
    'utf8'
  );

  // Launch Electron app with workspace
  electronApp = await launchElectronApp({ workspace: workspaceDir });

  // Get the first window and wait for app to be ready
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Wait for workspace to be ready
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.workspaceSidebar, {
    timeout: TEST_TIMEOUTS.SIDEBAR_LOAD,
  });

  // Open the test file
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'test.md' }).click();

  // Wait for tab to be active
  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.tab).filter({ hasText: 'test.md' })
  ).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  // Wait for editor to be ready
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, {
    timeout: TEST_TIMEOUTS.EDITOR_LOAD,
  });
});

test.afterEach(async () => {
  // Clean up: close app and remove temp files
  if (electronApp) {
    await electronApp.close();
  }
  if (workspaceDir) {
    try {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore errors if directory doesn't exist
    }
  }
});

test('should open search/replace bar with Cmd+F and close with Escape', async () => {
  // Initially, search bar should not be visible
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.searchReplaceBar)).not.toBeVisible();

  // Open search bar with Cmd+F keyboard shortcut (simulates menu command)
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('toggle-search-replace');
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
});

test('should allow typing multiple characters in search box without losing focus', async () => {
  // Open search bar
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('toggle-search-replace');
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
});
