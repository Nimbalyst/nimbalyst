/**
 * Test tracker inline item behavior
 * - Conversion to tracker items should happen in lists
 * - Deleting content should not delete the tracker node
 * - Enter key should create next list item
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, createTempWorkspace } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Tracker Inline Behavior', () => {
  test('should create tracker in list and allow deleting all text', async () => {
    const tempWorkspace = await createTempWorkspace();

    // Create a test file before launching app
    const testFile = path.join(tempWorkspace, 'test.md');
    await fs.writeFile(testFile, '# Test\n\n', 'utf8');

    const electronApp = await launchElectronApp({ workspace: tempWorkspace });
    const page = await electronApp.firstWindow();

    // Wait for app to be ready
    await page.waitForSelector('.workspace-sidebar', { timeout: 5000 });

    // Open the file
    const fileTreeItem = page.locator('.file-tree-item').filter({ hasText: 'test.md' });
    await fileTreeItem.click();
    await page.waitForTimeout(500);

    // Click in editor
    const editor = page.locator('.editor [contenteditable="true"]');
    await editor.click();

    // Move to end of document
    await page.keyboard.press('Meta+ArrowDown');

    // Type some text and then #bug
    await page.keyboard.type('Fix the login issue');
    await page.keyboard.type(' #bug');

    // Wait for typeahead menu
    await page.waitForTimeout(300);

    // Press Enter to accept the typeahead
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Check if tracker item was created
    const trackerItem = page.locator('.tracker-item-container');
    await expect(trackerItem).toBeVisible({ timeout: 2000 });

    // Check if it's in a list
    const listItem = page.locator('li:has(.tracker-item-container)');
    await expect(listItem).toBeVisible({ timeout: 1000 });

    console.log('[TEST] ✓ Tracker item created in list!');

    // Now delete all the text from the bug title
    const trackerContent = page.locator('.tracker-content');
    const textContent = await trackerContent.textContent();
    const textLength = textContent?.length || 0;

    console.log('[TEST] Deleting', textLength, 'characters from bug title');

    // Delete all characters with backspace - add small delay to avoid overwhelming the app
    for (let i = 0; i < textLength && i < 20; i++) {  // Cap at 20 to avoid infinite loops
      await page.keyboard.press('Backspace');
      if (i % 3 === 0) {
        await page.waitForTimeout(10);  // Small delay every 3 chars
      }
    }

    await page.waitForTimeout(300);

    // Verify tracker item STILL EXISTS
    await expect(trackerItem).toBeVisible({ timeout: 1000 });

    console.log('[TEST] ✓ Tracker node still exists after deleting all text!');

    // NOW TYPE - cursor should be INSIDE the tracker node
    await page.keyboard.type('New bug text');
    await page.waitForTimeout(300);

    const newText = await trackerContent.textContent();
    console.log('[TEST] Text after typing:', newText);

    // This MUST contain the new text - proving cursor stayed in tracker
    expect(newText).toContain('New bug text');

    console.log('[TEST] ✓ Can type into empty tracker node!');

    // Test pressing Enter at end of tracker creates new list item
    await page.keyboard.press('End');
    await page.waitForTimeout(100);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Check that a new list item was created
    const listItems = page.locator('li');
    const count = await listItems.count();

    // Should have at least 2 list items (original + new)
    expect(count).toBeGreaterThanOrEqual(2);

    console.log('[TEST] ✓ Pressing Enter creates new list item!');

    await electronApp.close();
  });

});
