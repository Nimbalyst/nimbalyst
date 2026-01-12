/**
 * Monaco Editor Dirty Close E2E Test
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

// Selector for the VISIBLE Monaco editor (inside the visible tab wrapper)
const VISIBLE_MONACO_SELECTOR = '.file-tabs-container .tab-editor-wrapper:not([style*="display: none"]) .monaco-code-editor';

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a TypeScript file
  const tsPath = path.join(workspaceDir, 'test.ts');
  await fs.writeFile(tsPath, '// Original content\nconst x = 1;\n', 'utf8');

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
  const tsPath = path.join(workspaceDir, 'test.ts');
  const marker = `// edited-marker-${Date.now()}`;

  // Open the TypeScript file
  await openFileFromTree(page, 'test.ts');

  // Wait for Monaco editor to load
  await page.waitForSelector(VISIBLE_MONACO_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Click in the Monaco editor and type at the end
  await page.click(`${VISIBLE_MONACO_SELECTOR} .monaco-editor .view-lines`);
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('End'); // Go to end of file
  await page.keyboard.press('Enter');
  await page.keyboard.type(marker, { delay: 5 });

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'test.ts');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Close the tab using helper (clicks close button, waits for tab to disappear)
  await closeTabByFileName(page, 'test.ts');

  // Wait for save to complete (async save via IPC)
  await page.waitForTimeout(500);

  // Read the file and check the content
  const savedContent = await fs.readFile(tsPath, 'utf-8');

  // Verify the content was saved
  expect(savedContent).toContain(marker);
});
