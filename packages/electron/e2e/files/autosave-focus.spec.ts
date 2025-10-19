import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  waitForAppReady,
  ACTIVE_EDITOR_SELECTOR,
  ACTIVE_FILE_TAB_SELECTOR
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Autosave Focus Preservation', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create initial test file
    await fs.writeFile(
      path.join(workspaceDir, 'focus-test.md'),
      '# Focus Test\n\nInitial content.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();

    // Handle any dialogs that might appear (dismiss them)
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));

    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should maintain editor focus after autosave', async () => {
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'focus-test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('focus-test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Click in editor to focus it
    await editor.click();
    await page.keyboard.press('End');

    // Type some content
    const testText = '\n\nTesting autosave focus';
    await page.keyboard.type(testText);

    // Wait for autosave to complete (2s interval + 200ms debounce + buffer)
    await page.waitForTimeout(4000);

    // Try to type more - if editor lost focus, this won't work
    const additionalText = ' - still typing!';
    await page.keyboard.type(additionalText);

    // Small wait for the text to appear
    await page.waitForTimeout(500);

    // Verify both texts were added (which proves focus was maintained)
    const editorContent = await editor.innerText();
    expect(editorContent).toContain(testText);
    expect(editorContent).toContain(additionalText);
  });

  test('should preserve cursor position after autosave', async () => {
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'focus-test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('focus-test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Click in editor and position cursor
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type('\n\nLine 1\nLine 2\nLine 3');

    // Move cursor to middle of Line 2
    await page.keyboard.press('ArrowUp'); // Move up to Line 2
    await page.keyboard.press('Home'); // Move to start of Line 2
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    // Mark dirty
    await page.keyboard.type('X');

    // Wait for autosave
    await page.waitForTimeout(3000);

    // Verify we're still in the middle of Line 2 by typing more
    await page.keyboard.type('Y');

    const content = await editor.innerText();
    // Should have "LinXYe 2" if cursor position was preserved
    expect(content).toContain('LinXYe 2');
  });
});
