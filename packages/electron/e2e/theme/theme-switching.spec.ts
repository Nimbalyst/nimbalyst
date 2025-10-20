import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  ACTIVE_EDITOR_SELECTOR,
  waitForAppReady
} from '../helpers';
import path from 'path';
import fs from 'fs/promises';

test.describe('Theme Switching', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspacePath: string;

  test.beforeEach(async () => {
    // Create a temporary workspace with a test file
    workspacePath = await createTempWorkspace();
    const testFilePath = path.join(workspacePath, 'test.md');
    await fs.writeFile(testFilePath, '# Test Document\n\nThis is a test.');

    // Launch app with workspace
    electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();

    // Listen to ALL console logs
    page.on('console', msg => {
      const text = msg.text();
      console.log(`[BROWSER ${msg.type()}]`, text);
    });

    await waitForAppReady(page);

    // Wait for file tree to load
    await page.locator('.file-tree-name', { hasText: 'test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

    // Open the test file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();

    // Wait for editor to be visible
    await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.medium });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should switch editor theme immediately when menu item is clicked', async () => {
    // Verify editor is loaded
    const editor = page.locator('.stravu-editor').first();
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.medium });

    // Check initial theme (should be light by default)
    console.log('[TEST] Checking initial theme...');
    const initialThemeAttr = await editor.getAttribute('data-theme');
    const initialClasses = await editor.getAttribute('class');
    console.log('[TEST] Initial data-theme:', initialThemeAttr);
    console.log('[TEST] Initial classes:', initialClasses);

    // Get current theme state
    let isDarkTheme = initialClasses?.includes('dark-theme') || false;
    console.log('[TEST] Initial isDarkTheme:', isDarkTheme);

    // Switch to dark theme via menu (simulate the theme-change event)
    console.log('[TEST] Switching to dark theme...');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('theme-change', 'dark');
      });
    });

    // Wait a bit for the theme change to propagate
    await page.waitForTimeout(1000);

    // Check that editor has dark theme applied
    console.log('[TEST] Checking if dark theme is applied...');
    const darkThemeAttr = await editor.getAttribute('data-theme');
    const darkClasses = await editor.getAttribute('class');
    console.log('[TEST] After dark switch - data-theme:', darkThemeAttr);
    console.log('[TEST] After dark switch - classes:', darkClasses);

    // The editor should have the dark-theme class
    expect(darkClasses).toContain('dark-theme');
    expect(darkThemeAttr).toBe('dark');

    // Switch to light theme
    console.log('[TEST] Switching to light theme...');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('theme-change', 'light');
      });
    });

    // Wait a bit for the theme change to propagate
    await page.waitForTimeout(1000);

    // Check that editor has light theme applied
    console.log('[TEST] Checking if light theme is applied...');
    const lightThemeAttr = await editor.getAttribute('data-theme');
    const lightClasses = await editor.getAttribute('class');
    console.log('[TEST] After light switch - data-theme:', lightThemeAttr);
    console.log('[TEST] After light switch - classes:', lightClasses);

    // The editor should NOT have the dark-theme class
    expect(lightClasses).not.toContain('dark-theme');
    expect(lightThemeAttr).toBe('light');

    // Switch to crystal dark theme
    console.log('[TEST] Switching to crystal-dark theme...');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('theme-change', 'crystal-dark');
      });
    });

    // Wait a bit for the theme change to propagate
    await page.waitForTimeout(1000);

    // Check that editor has crystal dark theme applied
    console.log('[TEST] Checking if crystal-dark theme is applied...');
    const crystalDarkThemeAttr = await editor.getAttribute('data-theme');
    const crystalDarkClasses = await editor.getAttribute('class');
    console.log('[TEST] After crystal-dark switch - data-theme:', crystalDarkThemeAttr);
    console.log('[TEST] After crystal-dark switch - classes:', crystalDarkClasses);

    // The editor should have the dark-theme class
    expect(crystalDarkClasses).toContain('dark-theme');
    expect(crystalDarkThemeAttr).toBe('crystal-dark');
  });

  test('should switch theme across multiple tabs', async () => {
    // Create and open a second file
    const testFile2Path = path.join(workspacePath, 'test2.md');
    await fs.writeFile(testFile2Path, '# Test Document 2\n\nAnother test.');

    await page.click(`text=test2.md`);
    await page.waitForTimeout(500);

    // Verify we have 2 tabs
    const tabs = page.locator('.file-tabs-container .tab');
    await expect(tabs).toHaveCount(2);

    // Switch to dark theme
    console.log('[TEST] Switching to dark theme with 2 tabs...');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('theme-change', 'dark');
      });
    });

    await page.waitForTimeout(1000);

    // Check all editor instances
    const editors = page.locator('.stravu-editor');
    const editorCount = await editors.count();
    console.log('[TEST] Found editors:', editorCount);

    for (let i = 0; i < editorCount; i++) {
      const editor = editors.nth(i);
      const classes = await editor.getAttribute('class');
      const themeAttr = await editor.getAttribute('data-theme');
      console.log(`[TEST] Editor ${i} - classes:`, classes);
      console.log(`[TEST] Editor ${i} - data-theme:`, themeAttr);

      // All editors should have dark theme
      expect(classes).toContain('dark-theme');
      expect(themeAttr).toBe('dark');
    }
  });

  test('should preserve edited content after theme switch', async () => {
    console.log('[TEST] Starting content preservation test...');

    // Wait for editor to be ready
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.medium });

    // Get initial content
    const initialContent = await editor.textContent();
    console.log('[TEST] Initial content:', initialContent?.substring(0, 50));

    // Edit the document - click and type new content
    await editor.click();
    await page.keyboard.press('End'); // Go to end
    await page.keyboard.press('Enter');
    await page.keyboard.type('This is new content added by the test.');

    console.log('[TEST] Typed new content, waiting for change to register...');
    await page.waitForTimeout(500);

    // Get content after edit
    const contentAfterEdit = await editor.textContent();
    console.log('[TEST] Content after edit:', contentAfterEdit?.substring(0, 100));

    // Verify content was actually changed
    expect(contentAfterEdit).toContain('This is new content added by the test.');

    // Wait for autosave to kick in (autosave interval is 2000ms by default)
    console.log('[TEST] Waiting for autosave...');
    await page.waitForTimeout(3000);

    // Read the file from disk to verify autosave worked
    const testFilePath = path.join(workspacePath, 'test.md');
    const diskContentAfterAutosave = await fs.readFile(testFilePath, 'utf-8');
    console.log('[TEST] Disk content after autosave:', diskContentAfterAutosave);
    expect(diskContentAfterAutosave).toContain('This is new content added by the test.');

    // Now switch theme from light to dark
    console.log('[TEST] Switching theme from light to dark...');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('theme-change', 'dark');
      });
    });

    // Wait for theme change to complete
    await page.waitForTimeout(2000);

    // Verify theme changed on the stravu-editor container (not the contenteditable)
    const stravuEditor = page.locator('.stravu-editor').first();
    const darkClasses = await stravuEditor.getAttribute('class');
    expect(darkClasses).toContain('dark-theme');

    // CRITICAL: Verify content is still there after theme switch
    const contentAfterThemeSwitch = await editor.textContent();
    console.log('[TEST] Content after theme switch:', contentAfterThemeSwitch);

    // This should NOT fail - content must be preserved
    expect(contentAfterThemeSwitch).toContain('This is new content added by the test.');

    // Also verify file on disk still has the content
    const diskContentAfterThemeSwitch = await fs.readFile(testFilePath, 'utf-8');
    console.log('[TEST] Disk content after theme switch:', diskContentAfterThemeSwitch);
    expect(diskContentAfterThemeSwitch).toContain('This is new content added by the test.');
  });
});
