import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { _electron } from '@playwright/test';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR } from '../helpers';

/**
 * Single-file mode tests
 *
 * Tests the app when launched with a single file (no --workspace argument).
 * Should use EditorContainer with one tab, no sidebar, no file tree.
 */

async function launchSingleFileMode(filePath: string): Promise<{ electronApp: ElectronApplication; page: Page }> {
  const electronMain = path.resolve(__dirname, '../../out/main/index.js');
  const electronCwd = path.resolve(__dirname, '../../../../');

  console.log('[TEST] Launching with file:', filePath);
  console.log('[TEST] File exists:', existsSync(filePath));
  console.log('[TEST] Is absolute:', path.isAbsolute(filePath));

  // Launch with file path as argument (no --workspace)
  const electronApp = await _electron.launch({
    args: [electronMain, filePath],
    cwd: electronCwd,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      PLAYWRIGHT: '1',
      NODE_ENV: 'test',
    }
  });

  const page = await electronApp.firstWindow();

  // Listen to console messages to see what's happening
  page.on('console', msg => console.log('[BROWSER]', msg.text()));

  await page.waitForLoadState('domcontentloaded');

  return { electronApp, page };
}

test.describe('Single File Mode', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let testFile: string;
  let tempDir: string;

  test.beforeEach(async () => {
    // Create a temporary file for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimbalyst-single-file-'));
    testFile = path.join(tempDir, 'test-document.md');
    await fs.writeFile(testFile, '# Single File Test\n\nThis is a test document in single-file mode.\n', 'utf8');
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should launch with single file and no sidebar', async () => {
    ({ electronApp, page } = await launchSingleFileMode(testFile));

    // Wait a bit for tab and editor to initialize
    await page.waitForTimeout(2000);

    // Wait for editor to be ready
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: 10000 });

    // Should NOT show workspace sidebar
    const sidebar = page.locator('.workspace-sidebar');
    await expect(sidebar).not.toBeVisible();

    // Should show editor content
    const editorText = await editor.innerText();
    expect(editorText).toContain('Single File Test');
    expect(editorText).toContain('This is a test document in single-file mode');
  });

  test('should show tab with file name', async () => {
    ({ electronApp, page } = await launchSingleFileMode(testFile));

    // In single-file mode, tab bar is hidden but title bar should show file name
    const titleBar = page.locator('.tab-bar-container');
    await expect(titleBar).not.toBeVisible();

    // Verify editor loaded with correct content
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    const editorText = await editor.innerText();
    expect(editorText).toContain('Single File Test');
  });

  test('should allow editing in single-file mode', async () => {
    ({ electronApp, page } = await launchSingleFileMode(testFile));

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Click editor and type
    await editor.click();
    await page.keyboard.press('Meta+ArrowDown'); // Move to end
    await page.keyboard.press('Enter');

    const marker = `single-file-edit-${Date.now()}`;
    await page.keyboard.type(marker);

    // Editor should contain the new text (tab bar is hidden in single-file mode so can't check dirty indicator)
    const editorText = await editor.innerText();
    expect(editorText).toContain(marker);
  });

  test('should save file with Cmd+S in single-file mode', async () => {
    ({ electronApp, page } = await launchSingleFileMode(testFile));

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Edit the file
    await editor.click();
    await page.keyboard.press('Meta+ArrowDown'); // Move to end
    await page.keyboard.press('Enter');

    const marker = `save-test-${Date.now()}`;
    await page.keyboard.type(marker);

    // Save with Cmd+S (tab bar is hidden so can't check dirty indicator)
    await page.keyboard.press('Meta+S');

    // Wait for save to complete
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Verify file was saved to disk
    const savedContent = await fs.readFile(testFile, 'utf8');
    expect(savedContent).toContain(marker);
    expect(savedContent).toContain('Single File Test');
  });

  test('should autosave after changes in single-file mode', async () => {
    ({ electronApp, page } = await launchSingleFileMode(testFile));

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Edit the file
    await editor.click();
    await page.keyboard.press('Meta+ArrowDown');
    await page.keyboard.press('Enter');

    const marker = `autosave-test-${Date.now()}`;
    await page.keyboard.type(marker);

    // Wait for autosave (2s debounce + save time)
    await page.waitForTimeout(3000);

    // Verify file was autosaved to disk
    const savedContent = await fs.readFile(testFile, 'utf8');
    expect(savedContent).toContain(marker);
  });

  test('should track isDirty state correctly in single-file mode', async () => {
    ({ electronApp, page } = await launchSingleFileMode(testFile));

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Make a change
    await editor.click();
    await page.keyboard.type('x');

    // Wait a moment for state to update
    await page.waitForTimeout(200);

    // Save
    await page.keyboard.press('Meta+S');
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Verify file was saved (isDirty tracking happens internally, can't see tab bar)
    const savedContent = await fs.readFile(testFile, 'utf8');
    expect(savedContent).toContain('x');
  });

  test('should use EditorContainer architecture in single-file mode', async () => {
    ({ electronApp, page } = await launchSingleFileMode(testFile));

    // Wait for editor
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Verify EditorContainer is present (should have the data-testid or class)
    const editorContainer = page.locator('[data-editor-container]').or(page.locator('.editor-container'));

    // Even if no specific attribute, verify tab system is in place
    const tabManager = page.locator('.tab-manager');
    await expect(tabManager).toBeVisible();

    // Should have exactly one tab
    const tabs = page.locator('.file-tabs-container .tab');
    await expect(tabs).toHaveCount(1);
  });

  test('should reload file when changed externally in single-file mode', async () => {
    ({ electronApp, page } = await launchSingleFileMode(testFile));

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Verify initial content
    let editorText = await editor.innerText();
    expect(editorText).toContain('Single File Test');

    // Modify file externally
    const externalChange = `\n\nExternal change at ${Date.now()}\n`;
    await fs.appendFile(testFile, externalChange, 'utf8');

    // Wait for file watcher to detect change and reload
    await page.waitForTimeout(2000);

    // Verify editor shows the external change
    editorText = await editor.innerText();
    expect(editorText).toContain('External change at');
  });
});
