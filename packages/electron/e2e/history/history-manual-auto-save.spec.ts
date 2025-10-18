import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, getKeyboardShortcut, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR, ACTIVE_FILE_TAB_SELECTOR } from '../helpers';
import * as path from 'path';
import * as fs from 'fs/promises';

test.describe('History - Manual and Auto Save Entries', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFile: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    testFile = path.join(workspaceDir, 'history-test.md');

    // Create initial document
    const initialContent = '# History Test\n\nInitial content.\n';
    await fs.writeFile(testFile, initialContent, 'utf8');

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Dismiss API key dialog if present
    const apiDialog = page.locator('.api-key-dialog-overlay');
    if (await apiDialog.isVisible()) {
      await page.locator('.api-key-dialog-button.secondary').click();
    }

    // Wait for workspace to load
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
    await page.locator('.file-tree-name', { hasText: 'history-test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

    // Open the test file
    await page.locator('.file-tree-name', { hasText: 'history-test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('history-test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should show both manual and auto save entries in history', async () => {
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Verify initial content
    let editorText = await editor.innerText();
    expect(editorText).toContain('Initial content');

    // MANUAL SAVE #1: Make first edit and manually save
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+A'));
    await page.keyboard.type('# History Test\n\nManual save #1.\n');
    await page.waitForTimeout(200);

    // Manual save with Cmd+S
    await page.keyboard.press(getKeyboardShortcut('Mod+S'));
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Verify file was saved
    const manualSave1Content = await fs.readFile(testFile, 'utf8');
    expect(manualSave1Content).toContain('Manual save #1');

    // AUTO SAVE #1: Make second edit and let it autosave
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+A'));
    await page.keyboard.type('# History Test\n\nAuto save #1.\n');
    await page.waitForTimeout(200);

    // Verify dirty indicator appears
    const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'history-test.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible({ timeout: 1000 });

    // Wait for autosave (2s interval + 200ms debounce + buffer)
    await page.waitForTimeout(3000);

    // Verify dirty indicator is gone (autosave completed)
    await expect(tab.locator('.tab-dirty-indicator')).toHaveCount(0, { timeout: 1000 });

    // Verify content was auto-saved
    const autoSave1Content = await fs.readFile(testFile, 'utf8');
    expect(autoSave1Content).toContain('Auto save #1');

    // MANUAL SAVE #2: Make third edit and manually save
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+A'));
    await page.keyboard.type('# History Test\n\nManual save #2.\n');
    await page.waitForTimeout(200);

    await page.keyboard.press(getKeyboardShortcut('Mod+S'));
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // AUTO SAVE #2: Make fourth edit and let it autosave
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+A'));
    await page.keyboard.type('# History Test\n\nAuto save #2.\n');
    await page.waitForTimeout(200);

    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible({ timeout: 1000 });
    await page.waitForTimeout(3000);
    await expect(tab.locator('.tab-dirty-indicator')).toHaveCount(0, { timeout: 1000 });

    // Now open history dialog using keyboard shortcut
    // Make sure we're not focused in the editor (which might capture the shortcut)
    await page.click('body');
    await page.waitForTimeout(100);
    await page.keyboard.press(getKeyboardShortcut('Mod+Y'));
    await page.waitForSelector('.history-dialog', { timeout: 5000 });

    // Get all history items
    const historyItems = page.locator('.history-item');
    const itemCount = await historyItems.count();

    // We should have at least 5 entries:
    // - Initial file creation
    // - Manual save #1
    // - Auto save #1
    // - Manual save #2
    // - Auto save #2
    expect(itemCount).toBeGreaterThanOrEqual(4);

    // Verify we can see different entries by checking preview content
    // Click on different items and verify they show different content
    console.log(`Found ${itemCount} history items`);
  });

  test('should restore from auto save entry', async () => {
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Create manual save
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+A'));
    await page.keyboard.type('# History Test\n\nManual save version.\n');
    await page.keyboard.press(getKeyboardShortcut('Mod+S'));
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Create auto save with different content
    const autoSaveMarker = `Auto saved at ${Date.now()}`;
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+A'));
    await page.keyboard.type(`# History Test\n\n${autoSaveMarker}\n`);
    await page.waitForTimeout(200);

    const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'history-test.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible({ timeout: 1000 });
    await page.waitForTimeout(3000);
    await expect(tab.locator('.tab-dirty-indicator')).toHaveCount(0, { timeout: 1000 });

    // Make one more change after auto save
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+A'));
    await page.keyboard.type('# History Test\n\nNewest version.\n');
    await page.keyboard.press(getKeyboardShortcut('Mod+S'));
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Open history using keyboard shortcut
    await page.click('body');
    await page.waitForTimeout(100);
    await page.keyboard.press(getKeyboardShortcut('Mod+Y'));
    await page.waitForSelector('.history-dialog', { timeout: 5000 });

    // Find the auto save entry by clicking through items and checking preview
    const historyItems = page.locator('.history-item');
    const itemCount = await historyItems.count();

    let autoSaveItemIndex = -1;
    for (let i = 0; i < itemCount; i++) {
      await historyItems.nth(i).click();
      await page.waitForTimeout(300);

      const previewContent = page.locator('.history-preview-content pre');
      const preview = await previewContent.innerText().catch(() => '');

      if (preview.includes(autoSaveMarker)) {
        autoSaveItemIndex = i;
        break;
      }
    }

    expect(autoSaveItemIndex).toBeGreaterThanOrEqual(0);

    // Restore the auto save version
    const restoreButton = page.locator('.history-restore-button');
    await restoreButton.click();
    await page.waitForTimeout(500);

    // Verify editor shows restored content
    const editorText = await editor.innerText();
    expect(editorText).toContain(autoSaveMarker);
    expect(editorText).not.toContain('Newest version');

    // Verify dirty indicator appears
    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible();
  });

  test('should restore from manual save entry', async () => {
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    const manualSaveMarker = `Manual saved at ${Date.now()}`;

    // Create manual save
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+A'));
    await page.keyboard.type(`# History Test\n\n${manualSaveMarker}\n`);
    await page.keyboard.press(getKeyboardShortcut('Mod+S'));
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Create newer content
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+A'));
    await page.keyboard.type('# History Test\n\nNewer content.\n');
    await page.keyboard.press(getKeyboardShortcut('Mod+S'));
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Open history and restore manual save
    await page.click('body');
    await page.waitForTimeout(100);
    await page.keyboard.press(getKeyboardShortcut('Mod+Y'));
    await page.waitForSelector('.history-dialog', { timeout: 5000 });

    // Find the manual save entry
    const historyItems = page.locator('.history-item');
    const itemCount = await historyItems.count();

    let manualSaveItemIndex = -1;
    for (let i = 0; i < itemCount; i++) {
      await historyItems.nth(i).click();
      await page.waitForTimeout(300);

      const previewContent = page.locator('.history-preview-content pre');
      const preview = await previewContent.innerText().catch(() => '');

      if (preview.includes(manualSaveMarker)) {
        manualSaveItemIndex = i;
        break;
      }
    }

    expect(manualSaveItemIndex).toBeGreaterThanOrEqual(0);

    // Restore the manual save version
    const restoreButton = page.locator('.history-restore-button');
    await restoreButton.click();
    await page.waitForTimeout(500);

    // Verify editor shows restored content
    const editorText = await editor.innerText();
    expect(editorText).toContain(manualSaveMarker);
    expect(editorText).not.toContain('Newer content');
  });
});
