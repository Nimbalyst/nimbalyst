/**
 * CSV Spreadsheet Dirty Close E2E Test
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

  // Dismiss project trust toast if it appears
  await dismissProjectTrustToast(page);
});

test.afterEach(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('edited content is saved when tab is closed', async () => {
  const csvPath = path.join(workspaceDir, 'test.csv');

  // Open the CSV file using helper
  await openFileFromTree(page, 'test.csv');

  // Wait for the CSV extension to load
  await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Double-click on a data cell to start editing
  const dataCells = page.locator('revogr-data [role="gridcell"]');
  const targetCell = dataCells.nth(6); // First data cell
  await targetCell.dblclick();

  // Wait for edit input
  const editInput = page.locator('revo-grid input');
  await editInput.waitFor({ state: 'visible', timeout: 2000 });

  // Type a new value using keyboard (not fill, so events fire properly)
  await editInput.clear();
  await page.keyboard.type('NEWVALUE');
  await page.waitForTimeout(100);

  // Press Enter to confirm the edit
  await page.keyboard.press('Enter');

  // Wait for the edit to be committed and dirty flag to be set
  await page.waitForTimeout(500);

  // Verify tab exists and shows dirty indicator before close
  const tabElement = getTabByFileName(page, 'test.csv');
  await expect(tabElement).toBeVisible();
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Close the tab using helper (clicks close button, waits for tab to disappear)
  await closeTabByFileName(page, 'test.csv');

  // Wait for save to complete (async save via IPC)
  await page.waitForTimeout(500);

  // Read the file and check the content
  const savedContent = await fs.readFile(csvPath, 'utf-8');

  // Verify the content was saved
  expect(savedContent).toContain('NEWVALUE');
});
