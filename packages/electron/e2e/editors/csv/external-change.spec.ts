/**
 * CSV Spreadsheet External Change E2E Test
 *
 * Tests that external file changes auto-reload when editor is clean.
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
  await fs.writeFile(csvPath, 'Name,Value\nOriginal,100\n', 'utf8');

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

test('external file change auto-reloads when editor is clean', async () => {
  const csvPath = path.join(workspaceDir, 'test.csv');

  // Open the CSV file
  await openFileFromTree(page, 'test.csv');

  // Wait for the CSV extension to load
  await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify no dirty indicator (editor is clean)
  const tabElement = getTabByFileName(page, 'test.csv');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0);

  // Verify original content is visible
  const originalCell = await page.evaluate(() => {
    const cells = document.querySelectorAll('revogr-data [role="gridcell"]');
    for (const cell of cells) {
      if ((cell as HTMLElement).textContent?.trim() === 'Original') {
        return true;
      }
    }
    return false;
  });
  expect(originalCell).toBe(true);

  // Modify file externally
  await fs.writeFile(csvPath, 'Name,Value\nExternal,200\n', 'utf8');

  // Wait for file watcher to detect and reload
  await page.waitForTimeout(1500);

  // Verify editor shows new content
  const externalCell = await page.evaluate(() => {
    const cells = document.querySelectorAll('revogr-data [role="gridcell"]');
    for (const cell of cells) {
      if ((cell as HTMLElement).textContent?.trim() === 'External') {
        return true;
      }
    }
    return false;
  });
  expect(externalCell).toBe(true);

  // Verify original content is gone
  const originalGone = await page.evaluate(() => {
    const cells = document.querySelectorAll('revogr-data [role="gridcell"]');
    for (const cell of cells) {
      if ((cell as HTMLElement).textContent?.trim() === 'Original') {
        return true;
      }
    }
    return false;
  });
  expect(originalGone).toBe(false);
});
