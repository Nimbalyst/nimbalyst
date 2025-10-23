import { test, expect, Page, ElectronApplication } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR } from '../helpers';
import * as path from 'path';
import * as fs from 'fs/promises';

test('Cmd+Shift+C should copy selection as markdown', async () => {
  const workspaceDir = await createTempWorkspace();
  const testFilePath = path.join(workspaceDir, 'test.md');
  await fs.writeFile(testFilePath, '# Initial Content\n\nTest file.', 'utf8');

  const electronApp = await launchElectronApp({ workspace: workspaceDir });
  const appWindow = await electronApp.firstWindow();

  // Handle unsaved changes dialog
  appWindow.on('dialog', dialog => {
    dialog.dismiss().catch(() => {});
  });


  try {
    // Wait for workspace to load and open the test file
    await appWindow.waitForSelector('.file-tree-name:has-text("test.md")', { timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });
    await appWindow.locator('.file-tree-name:has-text("test.md")').click();
    await appWindow.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Set up clipboard permissions
    await appWindow.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Type some content with formatting
    const editor = appWindow.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.click();
    await appWindow.keyboard.press('Meta+A');
    await editor.type('Hello ');
    await appWindow.keyboard.press('Meta+B');
    await editor.type('world');

    // Select all and copy as markdown with Cmd+Shift+C
    await appWindow.keyboard.press('Meta+A');
    await appWindow.keyboard.press('Meta+Shift+C');

    // Wait for copy to complete
    await appWindow.waitForTimeout(500);

    // Check what's actually on the system clipboard
    const clipboardData = await appWindow.evaluate(async () => {
      try {
        const items = await navigator.clipboard.read();
        const result: any = {
          types: [],
          textContent: '',
          htmlContent: ''
        };

        for (const item of items) {
          result.types.push(...item.types);

          if (item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain');
            result.textContent = await blob.text();
          }

          if (item.types.includes('text/html')) {
            const blob = await item.getType('text/html');
            result.htmlContent = await blob.text();
          }
        }

        return result;
      } catch (error) {
        return { error: String(error), types: [] };
      }
    });

    // text/plain should contain markdown
    expect(clipboardData.textContent).toContain('**world**');
    // Should be a heading in markdown
    expect(clipboardData.textContent).toMatch(/^# /m);
  } finally {
    await electronApp.close();
  }
});
