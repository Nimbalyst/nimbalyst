/**
 * CSV Spreadsheet Column Formatting E2E Test
 *
 * Tests that column formatting (number, currency, percentage, date) works correctly.
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

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a CSV file with numeric data in column B
  const csvPath = path.join(workspaceDir, 'numbers.csv');
  await fs.writeFile(csvPath, 'Name,Price\nApple,1.5\nBanana,2.25\nCherry,3.99\n', 'utf8');

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

test('should format column B as currency when format is applied', async () => {
  // Open the CSV file
  await page.locator('.file-tree-name', { hasText: 'numbers.csv' }).click();

  // Wait for the CSV extension to load (RevoGrid)
  await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500); // Let the grid fully initialize

  // Debug: Log what columns we see
  const headerCells = await page.locator('revogr-header .rgHeaderCell').allTextContents();
  console.log('Header cells found:', headerCells);

  // Debug: Log what data cells we see
  const dataCells = await page.locator('.rgCell').allTextContents();
  console.log('First 10 data cells:', dataCells.slice(0, 10));

  // Get the initial value of first Price cell (should be "1.5")
  // The cells are in row-major order, so we need to find the right one
  // Row 0: Name=Apple, Price=1.5
  // Looking for the B column cell in first data row
  const priceCellBefore = await page.locator('revogr-data .rgCell').nth(1).textContent();
  console.log('Price cell before formatting:', priceCellBefore);
  expect(priceCellBefore?.trim()).toBe('1.5');

  // Right-click on column B header to open context menu
  const columnBHeader = page.locator('revogr-header .rgHeaderCell', { hasText: 'B' });
  await columnBHeader.click({ button: 'right' });

  // Wait for context menu to appear
  await page.waitForSelector('.context-menu', { timeout: 2000 });

  // Debug: Log context menu items
  const menuItems = await page.locator('.context-menu-item').allTextContents();
  console.log('Context menu items:', menuItems);

  // Click on "Format Column (Text)..."
  await page.locator('.context-menu-item', { hasText: 'Format Column' }).click();

  // Wait for the format dialog to appear
  await page.waitForSelector('.column-format-dialog', { timeout: 2000 });

  // Debug: Log dialog state
  const dialogTitle = await page.locator('.column-format-dialog-header h3').textContent();
  console.log('Dialog title:', dialogTitle);

  // Select "Currency" from the type dropdown
  const typeSelect = page.locator('.column-format-dialog select').first();
  await typeSelect.selectOption('currency');

  // Click Apply button
  await page.locator('.dialog-button.primary', { hasText: 'Apply' }).click();

  // Wait for dialog to close
  await expect(page.locator('.column-format-dialog')).not.toBeVisible({ timeout: 2000 });

  // Wait for the grid to update
  await page.waitForTimeout(500);

  // Get the new value of first Price cell (should be formatted as currency like "$1.50")
  const priceCellAfter = await page.locator('revogr-data .rgCell').nth(1).textContent();
  console.log('Price cell after formatting:', priceCellAfter);

  // The value should now contain a currency symbol and be formatted
  expect(priceCellAfter).toMatch(/\$1\.50/);
});
