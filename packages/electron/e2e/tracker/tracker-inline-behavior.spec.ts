/**
 * Test tracker inline item behavior
 * - Conversion to tracker items should happen in lists
 * - Deleting content should not delete the tracker node
 * - Enter key should create next list item
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR } from '../helpers';
import { dismissAPIKeyDialog, waitForWorkspaceReady, openFileFromTree } from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Tracker Inline Behavior', () => {
  test('should create tracker in list, delete text, and press Enter to create new item', async () => {
    const workspaceDir = await createTempWorkspace();
    const testFile = path.join(workspaceDir, 'test.md');
    await fs.writeFile(testFile, '# Test\n\n', 'utf8');

    const electronApp = await launchElectronApp({ workspace: workspaceDir });
    const page = await electronApp.firstWindow();

    await dismissAPIKeyDialog(page);
    await waitForWorkspaceReady(page);
    await openFileFromTree(page, 'test.md');

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.click();
    await page.keyboard.press('Meta+ArrowDown');

    // Type text and create tracker with #bug
    await page.keyboard.type('Fix the login issue #bug');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Verify tracker item was created in a list
    const trackerItem = page.locator('.tracker-item-container');
    await expect(trackerItem).toBeVisible({ timeout: 2000 });
    const listItem = page.locator('li:has(.tracker-item-container)');
    await expect(listItem).toBeVisible({ timeout: 1000 });

    // Delete all text from the bug title
    const trackerContent = page.locator('.tracker-content');
    const textLength = (await trackerContent.textContent())?.length || 0;

    // Delete all characters with backspace
    for (let i = 0; i < Math.min(textLength, 20); i++) {
      await page.keyboard.press('Backspace');
      if (i % 3 === 0) await page.waitForTimeout(10);
    }

    await page.waitForTimeout(200);

    // Verify tracker item still exists after deleting all text
    await expect(trackerItem).toBeVisible({ timeout: 1000 });

    // Type new text - cursor should be inside the tracker node
    await page.keyboard.type('New bug text');
    await page.waitForTimeout(200);

    const newText = await trackerContent.textContent();
    expect(newText).toContain('New bug text');

    // Press Enter at end of tracker to create new list item
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Verify a new list item was created
    const listItems = page.locator('li');
    const count = await listItems.count();
    expect(count).toBeGreaterThanOrEqual(2);

    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should create new list item when pressing Enter at end of pre-existing tracker', async () => {
    const workspaceDir = await createTempWorkspace();
    const content = `# Test Document

- Fix login issue @bug[id:bug_test status:to-do]
`;
    await fs.writeFile(path.join(workspaceDir, 'test.md'), content, 'utf8');

    const electronApp = await launchElectronApp({ workspace: workspaceDir, env: { NODE_ENV: 'test' } });
    const page = await electronApp.firstWindow();

    await dismissAPIKeyDialog(page);
    await waitForWorkspaceReady(page);
    await openFileFromTree(page, 'test.md');

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Move to end of document
    await editor.click();
    await page.keyboard.press('Meta+ArrowDown');

    // Verify tracker item is visible
    const trackerContainer = page.locator('.tracker-item-container');
    await expect(trackerContainer).toBeVisible({ timeout: 2000 });

    // Click at end and press Enter
    await trackerContainer.click();
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    // Verify new list item was created
    const listItems = page.locator('.editor li');
    await expect(listItems).toHaveCount(2);

    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });
});
