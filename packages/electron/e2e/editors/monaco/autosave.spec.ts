/**
 * Monaco Editor Autosave E2E Test
 *
 * Tests that autosave clears dirty indicator and saves content.
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

test('autosave clears dirty indicator and saves content', async () => {
  const tsPath = path.join(workspaceDir, 'test.ts');
  const marker = `// autosave-marker-${Date.now()}`;

  // Open the TypeScript file
  await openFileFromTree(page, 'test.ts');

  // Wait for Monaco editor to load
  await page.waitForSelector(VISIBLE_MONACO_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Click in the Monaco editor and type at the end
  await page.click(`${VISIBLE_MONACO_SELECTOR} .monaco-editor .view-lines`);
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(marker, { delay: 5 });

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'test.ts');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Wait for autosave (2s interval + 200ms debounce + buffer)
  await page.waitForTimeout(3500);

  // Verify dirty indicator cleared
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0, { timeout: 1000 });

  // Verify content saved to disk
  const savedContent = await fs.readFile(tsPath, 'utf-8');
  expect(savedContent).toContain(marker);
});
