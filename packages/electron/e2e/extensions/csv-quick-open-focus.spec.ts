/**
 * Test: CSV spreadsheet should not steal focus from quick open dialog
 *
 * Regression test for focus stealing issue where RevoGrid would capture
 * keyboard input even when quick open dialog was open.
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
} from '../helpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a CSV file before launching app
  const csvPath = path.join(workspaceDir, 'test.csv');
  await fs.writeFile(csvPath, 'Name,Value\nAlice,100\nBob,200\n', 'utf8');

  // Create a markdown file for quick open to find
  const mdPath = path.join(workspaceDir, 'document.md');
  await fs.writeFile(mdPath, '# Test Document\n\nHello world.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
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

test('CSV editor should not steal focus from quick open dialog', async () => {
  // Open the CSV file
  await page.locator('.file-tree-name', { hasText: 'test.csv' }).click();

  // Wait for the CSV extension to load (RevoGrid)
  await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Click on a cell to give the spreadsheet focus
  await page.locator('revo-grid').click();
  await page.waitForTimeout(300);

  // Open quick open with Cmd+O (file quick open)
  await page.keyboard.press('Meta+o');

  // Wait for quick open modal to appear
  await page.waitForSelector('.quick-open-modal', { timeout: 2000 });

  // The quick open input should have focus
  const quickOpenInput = page.locator('.quick-open-search');
  await expect(quickOpenInput).toBeFocused({ timeout: 1000 });

  // Type a search query
  await page.keyboard.type('document', { delay: 50 });

  // Verify the text went into the quick open input, not the spreadsheet
  const inputValue = await quickOpenInput.inputValue();
  expect(inputValue).toBe('document');

  // Also verify the quick open shows results (meaning the search worked)
  await expect(page.locator('.quick-open-item')).toBeVisible({ timeout: 2000 });
});

test('typing in quick open should not appear in CSV cells', async () => {
  // Open the CSV file
  await page.locator('.file-tree-name', { hasText: 'test.csv' }).click();

  // Wait for the CSV extension to load
  await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Click on a cell to give the spreadsheet focus
  const firstCell = page.locator('.rgCell').first();
  await firstCell.click();
  await page.waitForTimeout(300);

  // Get the initial cell content
  const initialCellText = await firstCell.textContent();

  // Open quick open with Cmd+O (file quick open)
  await page.keyboard.press('Meta+o');
  await page.waitForSelector('.quick-open-modal', { timeout: 2000 });

  // Type some characters
  await page.keyboard.type('xyz', { delay: 50 });

  // Close quick open
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Verify the cell content hasn't changed
  const afterCellText = await firstCell.textContent();
  expect(afterCellText).toBe(initialCellText);
});
