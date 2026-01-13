/**
 * Markdown Editor Dirty Close E2E Test
 *
 * Tests that edited content is saved when closing the tab.
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
  TEST_TIMEOUTS,
  ACTIVE_EDITOR_SELECTOR,
} from '../../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  openFileFromTree,
  closeTabByFileName,
  getTabByFileName,
} from '../../utils/testHelpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a markdown file
  const mdPath = path.join(workspaceDir, 'test.md');
  await fs.writeFile(mdPath, '# Original Title\n\nOriginal content.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
});

test.afterEach(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('edited content is saved when tab is closed', async () => {
  const mdPath = path.join(workspaceDir, 'test.md');
  const marker = `edited-marker-${Date.now()}`;

  // Open the markdown file
  await openFileFromTree(page, 'test.md');

  // Wait for Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Click in the editor and type at the end
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(`\n\n${marker}`);

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Close the tab using helper (clicks close button, waits for tab to disappear)
  await closeTabByFileName(page, 'test.md');

  // Wait for save to complete (async save via IPC)
  await page.waitForTimeout(500);

  // Read the file and check the content
  const savedContent = await fs.readFile(mdPath, 'utf-8');

  // Verify the content was saved
  expect(savedContent).toContain(marker);
});
