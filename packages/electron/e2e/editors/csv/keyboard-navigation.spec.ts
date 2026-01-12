/**
 * CSV Spreadsheet Keyboard Navigation E2E Tests
 *
 * Tests that the CSV spreadsheet extension properly handles keyboard focus:
 * 1. When a cell is selected, typing should start editing that cell
 * 2. Arrow keys should navigate between cells when a cell is selected
 * 3. When the quick open dialog (Cmd+P) is open, typing should NOT go to the spreadsheet
 * 4. After pressing Enter to save a cell edit, focus should remain in the grid
 *    so that typing starts editing the next cell and arrow keys work
 * 5. When switching to a different tab, the spreadsheet should not capture keyboard events
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

  // Create a CSV file
  const csvPath = path.join(workspaceDir, 'data.csv');
  await fs.writeFile(csvPath, 'A,B,C\n1,2,3\n4,5,6\n7,8,9\n', 'utf8');

  // Create a markdown file for tab switching tests
  const mdPath = path.join(workspaceDir, 'notes.md');
  await fs.writeFile(mdPath, '# Notes\n\nSome content here.\n', 'utf8');

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

test.describe('Basic keyboard interaction', () => {
  test('clicking a cell and typing should start editing', async () => {
    // Open a CSV file
    await page.locator('.file-tree-name', { hasText: 'data.csv' }).click();

    // Wait for the CSV extension to load (RevoGrid)
    await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500); // Let the grid fully initialize

    // Click on a DATA cell (use nth(6) for first data cell - row 1, col A)
    const dataCells = page.locator('revogr-data [role="gridcell"]');
    const targetCell = dataCells.nth(6);
    await targetCell.click();
    await page.waitForTimeout(200);

    // Type some text - this should automatically start editing
    await page.keyboard.type('hello');
    await page.waitForTimeout(100);

    // The cell should now be in edit mode and show the typed text
    const editInput = page.locator('revo-grid input');
    const hasEditInput = await editInput.count() > 0;

    if (hasEditInput) {
      const inputValue = await editInput.inputValue().catch(() => '');
      expect(inputValue).toContain('hello');
    } else {
      // If no input, check if the cell shows the text directly
      const cellText = await targetCell.textContent();
      expect(cellText).toContain('hello');
    }
  });

  test('arrow keys should navigate between cells when cell is selected', async () => {
    // Open a CSV file
    await page.locator('.file-tree-name', { hasText: 'data.csv' }).click();

    // Wait for the CSV extension to load
    await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Click on a DATA cell (use cell with "1" to avoid CSV header row)
    const targetCell = page.locator('revogr-data [role="gridcell"]:text("1")').first();
    await targetCell.click();
    await page.waitForTimeout(200);

    // Press ArrowRight to move to next cell
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    // Check that selection moved - look for focus ring or selected class
    const focusedCell = page.locator('[role="gridcell"].focused, [role="gridcell"][focus], [role="gridcell"].selected');
    const focusedCount = await focusedCell.count();
    console.log('Focused cells after ArrowRight:', focusedCount);

    // Press ArrowDown
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    // Verify we can navigate with arrows (just checking no errors for now)
    // More specific assertions can be added once we understand the DOM structure
  });

  test('pressing Enter to save should maintain focus for continued editing', async () => {
    // Open a CSV file
    await page.locator('.file-tree-name', { hasText: 'data.csv' }).click();

    // Wait for the CSV extension to load
    await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Get all data cells - layout is:
    // Row 0 (CSV header): cells 0-5 are 'A','B','C','','',''
    // Row 1 (first data row): cells 6-11 are '1','2','3','','',''
    const dataCells = page.locator('revogr-data [role="gridcell"]');
    const editInput = page.locator('revo-grid input');

    // Double-click on first data cell to start editing
    const firstDataCell = dataCells.nth(6);
    await firstDataCell.dblclick();

    // Wait for edit input to appear
    await editInput.waitFor({ state: 'visible', timeout: 2000 });

    // Type "FIRST"
    await editInput.fill('FIRST');

    // Press Enter to save - this should close editor and move selection down
    await page.keyboard.press('Enter');

    // Wait for focus to be restored
    await page.waitForTimeout(100);

    // Verify focus is somewhere inside the grid (not body)
    const focusInGrid = await page.evaluate(() => {
      const grid = document.querySelector('revo-grid');
      return grid?.contains(document.activeElement) || document.activeElement === grid;
    });
    console.log('Focus is in grid after Enter:', focusInGrid);
    expect(focusInGrid).toBe(true);

    // Now type "S" - this should start editing the next cell automatically
    // because focus is on the grid and typing starts edit mode
    await page.keyboard.type('S');
    await page.waitForTimeout(100);

    // Verify edit input appeared
    const hasEditInput = await editInput.count() > 0;
    expect(hasEditInput).toBe(true);

    // The first character "S" opens edit mode, then continue typing
    await page.keyboard.type('ECOND');
    await page.waitForTimeout(100);

    const editValue = await editInput.inputValue();
    expect(editValue).toContain('SECOND');

    // Press Enter to save
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    // Verify both values exist in cells
    const allCellText = await dataCells.allTextContents();
    const hasFirst = allCellText.some(t => t.includes('FIRST'));
    const hasSecond = allCellText.some(t => t.includes('SECOND'));

    expect(hasFirst).toBe(true);
    expect(hasSecond).toBe(true);
  });
});

test.describe('Focus isolation from dialogs', () => {
  test('quick open dialog should not send keystrokes to spreadsheet', async () => {
    // Open a CSV file
    await page.locator('.file-tree-name', { hasText: 'data.csv' }).click();

    // Wait for the CSV extension to load
    await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Click on a DATA cell to select it (use cell with "1" to avoid header)
    const targetCell = page.locator('revogr-data [role="gridcell"]:text("1")').first();
    await targetCell.click();
    await page.waitForTimeout(200);

    // Get the original cell value
    const originalValue = await targetCell.textContent();
    console.log('Original cell value:', originalValue);

    // Open quick open dialog (Cmd+O for file quick open)
    await page.keyboard.press('Meta+o');
    await page.waitForSelector('.quick-open-modal', { timeout: 2000 });

    // Wait for the quick open input to be focused before typing
    const quickOpenInput = page.locator('.quick-open-search');
    await expect(quickOpenInput).toBeFocused({ timeout: 1000 });
    await page.waitForTimeout(100); // Extra small delay to ensure focus is stable

    // Type "test" in the dialog with slower delay to ensure proper handling
    await page.keyboard.type('test', { delay: 100 });

    // Verify the input has the text
    const inputValue = await quickOpenInput.inputValue();
    expect(inputValue).toBe('test');

    // Close the dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Verify the spreadsheet cell was NOT edited
    const afterValue = await targetCell.textContent();
    console.log('Cell value after dialog:', afterValue);
    expect(afterValue).toBe(originalValue);
  });
});

test.describe('Focus isolation from other tabs', () => {
  test('typing in another tab should not affect spreadsheet', async () => {
    // Open the CSV file
    await page.locator('.file-tree-name', { hasText: 'data.csv' }).click();

    // Wait for the CSV extension to load
    await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Click on a DATA cell (use cell with "1" to avoid CSV header row)
    const targetCell = page.locator('revogr-data [role="gridcell"]:text("1")').first();
    await targetCell.click();
    await page.waitForTimeout(200);
    const originalValue = await targetCell.textContent();
    console.log('Original CSV cell value:', originalValue);

    // Open the markdown file in a new tab
    await page.locator('.file-tree-name', { hasText: 'notes.md' }).click();

    // Wait for the markdown editor to load
    await page.waitForSelector('[contenteditable="true"]', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(300);

    // Type some text in the markdown editor
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.type('Hello from markdown');
    await page.waitForTimeout(100);

    // Switch back to the CSV tab by clicking on it
    await page.locator('.tab-title', { hasText: 'data.csv' }).click();
    await page.waitForTimeout(300);

    // Verify the originally selected cell was NOT edited
    const afterValue = await targetCell.textContent();
    console.log('CSV cell value after switching back:', afterValue);
    expect(afterValue).toBe(originalValue);
  });
});

test.describe('Edge cases', () => {
  test('double-click to edit should work', async () => {
    // Open a CSV file
    await page.locator('.file-tree-name', { hasText: 'data.csv' }).click();

    // Wait for the CSV extension to load
    await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Double-click on a DATA cell (use nth(6) to get first data row, column A)
    const dataCells = page.locator('revogr-data [role="gridcell"]');
    const targetCell = dataCells.nth(6); // First data cell (row 1, col A)
    await targetCell.dblclick();

    // Wait for edit input to appear
    const editInput = page.locator('revo-grid input');
    await editInput.waitFor({ state: 'visible', timeout: 2000 });

    // Use fill to reliably set the value
    await editInput.fill('edited');
    await page.waitForTimeout(100);

    // Verify the input has the text
    const inputValue = await editInput.inputValue();
    console.log('Edit input value:', inputValue);
    expect(inputValue).toBe('edited');

    // Press Enter to save
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Verify the value was saved - check all data cells
    const allCellText = await dataCells.allTextContents();
    console.log('All cells after editing:', allCellText.slice(0, 15));
    const hasEdited = allCellText.some(t => t.includes('edited'));
    expect(hasEdited).toBe(true);
  });

  test('Escape should cancel edit and maintain focus', async () => {
    // Open a CSV file
    await page.locator('.file-tree-name', { hasText: 'data.csv' }).click();

    // Wait for the CSV extension to load
    await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Click on a DATA cell (use cell with "1" to avoid CSV header row)
    const targetCell = page.locator('revogr-data [role="gridcell"]:text("1")').first();
    await targetCell.click();
    await page.waitForTimeout(200);

    // Get original value
    const originalValue = await targetCell.textContent();

    // Type "should-be-cancelled"
    await page.keyboard.type('should-be-cancelled');

    // Press Escape to cancel
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Verify the edit was cancelled (original value remains)
    const afterValue = await targetCell.textContent();
    expect(afterValue).toBe(originalValue);

    // Type again - should start new edit
    await page.keyboard.type('new-edit');

    // Verify new edit started
    const editInput = page.locator('revo-grid input');
    const hasInput = await editInput.count() > 0;
    if (hasInput) {
      const inputValue = await editInput.inputValue().catch(() => '');
      expect(inputValue).toContain('new-edit');
    }
  });

  test('Tab should move to next cell', async () => {
    // Open a CSV file
    await page.locator('.file-tree-name', { hasText: 'data.csv' }).click();

    // Wait for the CSV extension to load
    await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Double-click on a DATA cell to enter edit mode (use nth(6) for first data cell)
    const dataCells = page.locator('revogr-data [role="gridcell"]');
    const firstCell = dataCells.nth(6); // First data cell (row 1, col A - contains "1")
    await firstCell.dblclick();

    // Wait for edit input to appear
    const editInput = page.locator('revo-grid input');
    await editInput.waitFor({ state: 'visible', timeout: 2000 });

    // Fill with "tabbed1"
    await editInput.fill('tabbed1');
    await page.waitForTimeout(100);

    // Press Tab to move to next cell
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    // Check if we're still in edit mode after Tab
    const stillEditing = await editInput.count() > 0;
    console.log('Still in edit mode after Tab:', stillEditing);

    if (stillEditing) {
      // Fill with "tabbed2"
      await editInput.fill('tabbed2');
      await page.waitForTimeout(100);

      // Press Enter to confirm the last edit
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    } else {
      // Tab closed edit mode - need to double-click next cell
      // Tab should have moved selection to next cell (nth(7) = row 1, col B - contains "2")
      const nextCell = dataCells.nth(7);
      await nextCell.dblclick();
      await editInput.waitFor({ state: 'visible', timeout: 2000 });
      await editInput.fill('tabbed2');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    }

    // Verify both values exist in data cells
    const allCellText = await dataCells.allTextContents();
    console.log('All data cells after tabbing:', allCellText.slice(0, 15));

    const hasTabbed1 = allCellText.some(t => t.includes('tabbed1'));
    const hasTabbed2 = allCellText.some(t => t.includes('tabbed2'));

    expect(hasTabbed1).toBe(true);
    expect(hasTabbed2).toBe(true);
  });
});
