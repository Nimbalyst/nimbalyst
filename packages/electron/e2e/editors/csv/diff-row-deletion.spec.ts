/**
 * CSV Diff Row Deletion E2E Test
 *
 * Tests that when accepting AI edits that delete rows in a CSV file,
 * the deleted rows are properly removed from the grid display.
 *
 * Bug reproduction: When diff mode shows a deleted row (with strikethrough),
 * clicking "Keep" should remove that row from the grid. Previously, the
 * phantom row remained visible without the strikethrough styling.
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

test('deleted rows should be removed from grid after accepting diff', async () => {
  const csvPath = path.join(workspaceDir, 'fruits.csv');

  // Original content: header + 5 data rows
  const originalContent = `Name,Color,Price
Apple,Red,1.50
Banana,Yellow,0.75
Cherry,Red,2.00
Date,Brown,3.50
Elderberry,Purple,4.00
`;

  // Modified content: delete Cherry row (row 3), add Fig at the end
  const modifiedContent = `Name,Color,Price
Apple,Red,1.50
Banana,Yellow,0.75
Date,Brown,3.50
Elderberry,Purple,4.00
Fig,Green,2.50
`;

  // Create the original file first
  await fs.writeFile(csvPath, originalContent, 'utf8');

  // Open the CSV file
  await page.locator('.file-tree-name', { hasText: 'fruits.csv' }).click();

  // Wait for the CSV extension to load
  await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify initial row count - should have header row + 5 data rows visible
  // (plus buffer rows, but we only care about content rows)
  const initialRows = await page.evaluate(() => {
    const cells = document.querySelectorAll('revogr-data [role="gridcell"]');
    const rowData: string[] = [];
    cells.forEach((cell, idx) => {
      // First column of each row (Name column)
      if (idx % 3 === 0) {
        const text = (cell as HTMLElement).textContent?.trim() || '';
        if (text && text !== '') {
          rowData.push(text);
        }
      }
    });
    return rowData;
  });

  console.log('[Test] Initial rows (first column):', initialRows);
  expect(initialRows).toContain('Apple');
  expect(initialRows).toContain('Cherry');
  expect(initialRows).toContain('Elderberry');

  // Now simulate an AI edit:
  // 1. Write the modified content to disk
  // 2. Create a pending history tag to trigger diff mode
  await fs.writeFile(csvPath, modifiedContent, 'utf8');

  // Create a pending tag to simulate an AI edit
  const tagId = `test-tag-${Date.now()}`;
  const sessionId = `test-session-${Date.now()}`;

  await page.evaluate(async ({ filePath, tagId, sessionId, originalContent }) => {
    // Create the history tag with original content as baseline
    await window.electronAPI.history.createTag(
      filePath,
      tagId,
      originalContent,
      sessionId,
      'test-tool-use'
    );
  }, { filePath: csvPath, tagId, sessionId, originalContent });

  // Trigger file change notification to apply diff mode
  await page.evaluate(async ({ filePath }) => {
    // Dispatch a file-changed event to trigger the diff mode
    window.dispatchEvent(new CustomEvent('file-changed', {
      detail: { path: filePath }
    }));
  }, { filePath: csvPath });

  // Wait for diff mode to be applied
  // The unified diff header should appear with "Keep" and "Revert" buttons
  await page.waitForSelector('.unified-diff-header', { timeout: 5000 }).catch(() => {
    console.log('[Test] Unified diff header did not appear, trying alternative approach');
  });

  // Alternative: Check if the file was reloaded and triggers diff via file watcher
  await page.waitForTimeout(1000);

  // If diff header didn't appear, try clicking away and back to trigger the pending tag check
  const diffHeader = await page.locator('.unified-diff-header').isVisible().catch(() => false);
  if (!diffHeader) {
    console.log('[Test] No diff header, triggering reload by re-opening file');

    // Close and reopen the file to trigger pending tag check
    await page.keyboard.press('Meta+w');
    await page.waitForTimeout(300);

    await page.locator('.file-tree-name', { hasText: 'fruits.csv' }).click();
    await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Wait for diff header
    await page.waitForSelector('.unified-diff-header', { timeout: 5000 });
  }

  // Verify diff mode is active - should see deleted row styling and/or diff header
  const hasDiffHeader = await page.locator('.unified-diff-header').isVisible();
  console.log('[Test] Diff header visible:', hasDiffHeader);
  expect(hasDiffHeader).toBe(true);

  // Check for deleted row styling (phantom row with strikethrough)
  const deletedRowExists = await page.evaluate(() => {
    const deletedRows = document.querySelectorAll('.row-diff-deleted, .cell-diff-deleted');
    return deletedRows.length > 0;
  });
  console.log('[Test] Deleted row styling present:', deletedRowExists);

  // The grid should show Cherry with deleted styling since it's being removed
  const gridBeforeAccept = await page.evaluate(() => {
    const cells = document.querySelectorAll('revogr-data [role="gridcell"]');
    const rowData: { text: string; hasDeleted: boolean }[] = [];
    cells.forEach((cell, idx) => {
      if (idx % 3 === 0) {
        const text = (cell as HTMLElement).textContent?.trim() || '';
        const hasDeleted = cell.classList.contains('cell-diff-deleted') ||
                          (cell as HTMLElement).closest('.row-diff-deleted') !== null;
        if (text && text !== '') {
          rowData.push({ text, hasDeleted });
        }
      }
    });
    return rowData;
  });
  console.log('[Test] Grid rows before accept:', gridBeforeAccept);

  // Click "Keep" to accept the changes
  const keepButton = page.locator('.unified-diff-header button', { hasText: 'Keep' });
  await keepButton.click();
  await page.waitForTimeout(500);

  // Wait for diff mode to clear
  await page.waitForSelector('.unified-diff-header', { state: 'hidden', timeout: 3000 }).catch(() => {
    console.log('[Test] Diff header still visible after Keep');
  });

  // Verify the grid content after accepting
  const gridAfterAccept = await page.evaluate(() => {
    const cells = document.querySelectorAll('revogr-data [role="gridcell"]');
    const rowData: string[] = [];
    cells.forEach((cell, idx) => {
      if (idx % 3 === 0) {
        const text = (cell as HTMLElement).textContent?.trim() || '';
        if (text && text !== '') {
          rowData.push(text);
        }
      }
    });
    return rowData;
  });
  console.log('[Test] Grid rows after accept:', gridAfterAccept);

  // Cherry should NOT be in the grid anymore
  expect(gridAfterAccept).not.toContain('Cherry');

  // Apple, Banana, Date, Elderberry should still be there
  expect(gridAfterAccept).toContain('Apple');
  expect(gridAfterAccept).toContain('Banana');
  expect(gridAfterAccept).toContain('Date');
  expect(gridAfterAccept).toContain('Elderberry');

  // Fig should be added
  expect(gridAfterAccept).toContain('Fig');

  // Verify the file content matches the grid
  const finalFileContent = await fs.readFile(csvPath, 'utf-8');
  console.log('[Test] Final file content:', finalFileContent);
  expect(finalFileContent).not.toContain('Cherry');
  expect(finalFileContent).toContain('Fig');
});

test('deleted row in middle should not leave phantom row after accepting', async () => {
  const csvPath = path.join(workspaceDir, 'data.csv');

  // Original: A, B, C, D, E
  const originalContent = `ID,Value
A,100
B,200
C,300
D,400
E,500
`;

  // Modified: Delete C (middle row)
  const modifiedContent = `ID,Value
A,100
B,200
D,400
E,500
`;

  await fs.writeFile(csvPath, originalContent, 'utf8');

  // Open the CSV file
  await page.locator('.file-tree-name', { hasText: 'data.csv' }).click();
  await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Simulate AI edit
  await fs.writeFile(csvPath, modifiedContent, 'utf8');

  const tagId = `test-tag-${Date.now()}`;
  const sessionId = `test-session-${Date.now()}`;

  await page.evaluate(async ({ filePath, tagId, sessionId, originalContent }) => {
    await window.electronAPI.history.createTag(
      filePath,
      tagId,
      originalContent,
      sessionId,
      'test-tool-use'
    );
  }, { filePath: csvPath, tagId, sessionId, originalContent });

  // Close and reopen to trigger pending tag check
  await page.keyboard.press('Meta+w');
  await page.waitForTimeout(300);

  await page.locator('.file-tree-name', { hasText: 'data.csv' }).click();
  await page.waitForSelector('revo-grid', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Wait for diff header
  await page.waitForSelector('.unified-diff-header', { timeout: 5000 });

  // Count data rows before accepting (should include phantom row C)
  const rowCountBefore = await page.evaluate(() => {
    const cells = document.querySelectorAll('revogr-data [role="gridcell"]');
    let count = 0;
    cells.forEach((cell, idx) => {
      if (idx % 2 === 0) { // ID column
        const text = (cell as HTMLElement).textContent?.trim() || '';
        if (text && ['A', 'B', 'C', 'D', 'E'].includes(text)) {
          count++;
        }
      }
    });
    return count;
  });
  console.log('[Test] Row count before accept (including phantom):', rowCountBefore);
  // Should have A, B, C (phantom), D, E = 5 rows visible
  expect(rowCountBefore).toBe(5);

  // Accept changes
  const keepButton = page.locator('.unified-diff-header button', { hasText: 'Keep' });
  await keepButton.click();
  await page.waitForTimeout(500);

  // Count data rows after accepting
  const rowCountAfter = await page.evaluate(() => {
    const cells = document.querySelectorAll('revogr-data [role="gridcell"]');
    let count = 0;
    cells.forEach((cell, idx) => {
      if (idx % 2 === 0) { // ID column
        const text = (cell as HTMLElement).textContent?.trim() || '';
        if (text && ['A', 'B', 'C', 'D', 'E'].includes(text)) {
          count++;
        }
      }
    });
    return count;
  });
  console.log('[Test] Row count after accept:', rowCountAfter);

  // Should now have only A, B, D, E = 4 rows (C removed)
  expect(rowCountAfter).toBe(4);

  // Explicitly check C is not in the grid
  const hasC = await page.evaluate(() => {
    const cells = document.querySelectorAll('revogr-data [role="gridcell"]');
    for (const cell of cells) {
      if ((cell as HTMLElement).textContent?.trim() === 'C') {
        return true;
      }
    }
    return false;
  });
  expect(hasC).toBe(false);
});
