/**
 * CSV Spreadsheet Trailing Empty Columns E2E Test
 *
 * Tests that trailing empty columns are trimmed when saving CSV files.
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

test('trailing empty columns are trimmed when saving', async () => {
  // Create a CSV file with trailing empty columns (commas at end)
  const csvPath = path.join(workspaceDir, 'test.csv');
  await fs.writeFile(csvPath, 'A,B,,,\n1,2,,,\n', 'utf8');

  // Open the CSV file
  await page.locator('.file-tree-name', { hasText: 'test.csv' }).click();

  // Wait for the CSV extension to load
  await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Make an edit to trigger dirty state, then save
  // Double-click on a cell to start editing
  const dataCells = page.locator('revogr-data [role="gridcell"]');
  const targetCell = dataCells.nth(0); // First cell (A)
  await targetCell.dblclick();

  // Wait for edit input
  const editInput = page.locator('revo-grid input');
  await editInput.waitFor({ state: 'visible', timeout: 2000 });

  // Type the same value to keep data the same but trigger dirty
  await editInput.clear();
  await page.keyboard.type('A');
  await page.keyboard.press('Enter');

  // Wait for edit to complete
  await editInput.waitFor({ state: 'hidden', timeout: 2000 });
  await page.waitForTimeout(200);

  // Save the file with Cmd+S
  await page.keyboard.press('Meta+s');

  // Wait for save to complete (async save via IPC)
  await page.waitForTimeout(1000);

  // Read the file and check the content
  const savedContent = await fs.readFile(csvPath, 'utf-8');
  console.log('Saved content:', JSON.stringify(savedContent));

  // Verify trailing empty columns were trimmed
  // Original was "A,B,,,\n1,2,,,\n" - should now be "A,B\n1,2\n" or "A,B\n1,2"
  expect(savedContent).not.toContain(',,,');
  expect(savedContent.trim()).toBe('A,B\n1,2');
});

test('sparse data in later rows is preserved', async () => {
  // Create a CSV file with data in column A and sparse data in column E on a later row
  // This tests that when data is added far to the right, it's preserved on save
  const csvPath = path.join(workspaceDir, 'sparse.csv');
  // Row 0: A=Name (header)
  // Row 1: A=1
  // Row 2: A=2, E=SPARSE (sparse data in column E)
  await fs.writeFile(csvPath, 'Name,,,,\n1,,,,\n2,,,,SPARSE\n', 'utf8');

  // Open the CSV file
  await page.locator('.file-tree-name', { hasText: 'sparse.csv' }).click();

  // Wait for the CSV extension to load
  await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Make a small edit to trigger dirty state (edit first data cell)
  const dataCells = page.locator('revogr-data [role="gridcell"]');
  const targetCell = dataCells.nth(0); // First cell
  await targetCell.dblclick();

  // Wait for edit input
  const editInput = page.locator('revo-grid input');
  await editInput.waitFor({ state: 'visible', timeout: 2000 });

  // Type same value to keep data but trigger dirty
  await editInput.clear();
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');

  // Wait for edit to complete
  await editInput.waitFor({ state: 'hidden', timeout: 2000 });
  await page.waitForTimeout(200);

  // Save with Cmd+S
  await page.keyboard.press('Meta+s');

  // Wait for save to complete (async save via IPC)
  await page.waitForTimeout(1000);

  // Read the file and check the content
  const savedContent = await fs.readFile(csvPath, 'utf-8');
  console.log('Saved content:', JSON.stringify(savedContent));

  // Verify the sparse data was saved - should include columns up to E
  expect(savedContent).toContain('SPARSE');

  // The file should have 5 columns (A through E) in at least one row
  const lines = savedContent.trim().split('\n');
  const rowWithSparse = lines.find(line => line.includes('SPARSE'));
  expect(rowWithSparse).toBeTruthy();

  // Count commas - should have 4 commas for 5 columns (A,B,C,D,E)
  const commaCount = (rowWithSparse!.match(/,/g) || []).length;
  expect(commaCount).toBe(4);
});
