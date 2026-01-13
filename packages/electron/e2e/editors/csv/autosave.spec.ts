/**
 * CSV Spreadsheet Autosave E2E Test
 *
 * Tests that edited content is automatically saved after the autosave interval.
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

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a CSV file
  const csvPath = path.join(workspaceDir, 'test.csv');
  await fs.writeFile(csvPath, 'A,B,C\n1,2,3\n4,5,6\n', 'utf8');

  // Launch with alpha release channel so CSV extension loads
  electronApp = await launchElectronApp({
    workspace: workspaceDir,
    env: { NIMBALYST_RELEASE_CHANNEL: 'alpha' }
  });
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
  const csvPath = path.join(workspaceDir, 'test.csv');

  // Open the CSV file
  await openFileFromTree(page, 'test.csv');

  // Wait for the CSV extension to load
  await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Double-click on a data cell to start editing
  const dataCells = page.locator('revogr-data [role="gridcell"]');
  const targetCell = dataCells.nth(6); // First data cell in second row
  await targetCell.dblclick();

  // Wait for edit input
  const editInput = page.locator('revo-grid input');
  await editInput.waitFor({ state: 'visible', timeout: 2000 });

  // Type a new value
  await editInput.clear();
  await page.keyboard.type('AUTOSAVED');
  await page.waitForTimeout(100);

  // Press Enter to confirm the edit
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'test.csv');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Wait for autosave (2s interval + 200ms debounce + buffer)
  await page.waitForTimeout(3500);

  // Verify dirty indicator cleared
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0, { timeout: 1000 });

  // Verify content saved to disk
  const savedContent = await fs.readFile(csvPath, 'utf-8');
  expect(savedContent).toContain('AUTOSAVED');
});
