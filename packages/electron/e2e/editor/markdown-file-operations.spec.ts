/**
 * Markdown File Operations E2E Tests
 *
 * Consolidated test suite for markdown editor file operations:
 * - File loading and display
 * - Autosave and manual save
 * - External file changes (file watcher)
 * - File deletion handling
 * - Multiple tabs
 *
 * These tests use a SINGLE app launch per describe block to minimize
 * test execution time while still providing comprehensive coverage.
 */

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
import {
  PLAYWRIGHT_TEST_SELECTORS,
  openFileFromTree,
  waitForAutosave
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Markdown File Operations', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeAll(async () => {
    workspaceDir = await createTempWorkspace();

    // Create test files BEFORE launching the app
    await fs.writeFile(
      path.join(workspaceDir, 'main.md'),
      '# Main Document\n\nThis is the main test document.\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceDir, 'secondary.md'),
      '# Secondary Document\n\nThis is a secondary document.\n',
      'utf8'
    );

    // Create a subdirectory with a file
    await fs.mkdir(path.join(workspaceDir, 'subdir'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, 'subdir', 'nested.md'),
      '# Nested Document\n\nThis document is in a subdirectory.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterAll(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('loads file content correctly when opened from file tree', async () => {
    // Open main.md from file tree
    await openFileFromTree(page, 'main.md');

    // Verify tab is active
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('main.md');

    // Verify editor content
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toContainText('Main Document');
    await expect(editor).toContainText('This is the main test document');
  });

  test('autosaves after editing and shows dirty indicator', async () => {
    const filePath = path.join(workspaceDir, 'main.md');
    const marker = `autosave-marker-${Date.now()}`;

    // Ensure main.md is open
    await openFileFromTree(page, 'main.md');

    // Get editor and add content
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker}`);

    // Verify dirty indicator appears
    const tab = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer)
      .locator(PLAYWRIGHT_TEST_SELECTORS.tab, {
        has: page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: 'main.md' })
      });
    await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toBeVisible({ timeout: 1000 });

    // Wait for autosave (2s interval + buffer)
    await page.waitForTimeout(3000);

    // Verify dirty indicator gone
    await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toHaveCount(0, { timeout: 1000 });

    // Verify file saved to disk
    const diskContent = await fs.readFile(filePath, 'utf8');
    expect(diskContent).toContain(marker);
  });

  test('manual save with Cmd+S saves immediately', async () => {
    // Create a fresh file for this test to avoid interference from autosave test
    const testFileName = `manual-save-test-${Date.now()}.md`;
    const filePath = path.join(workspaceDir, testFileName);
    const marker = `manual-save-${Date.now()}`;

    // Create fresh file
    await fs.writeFile(filePath, '# Manual Save Test\n\nInitial content.\n', 'utf8');

    // Get initial mtime BEFORE opening (opening doesn't modify file)
    const initialStats = await fs.stat(filePath);
    const initialMtime = initialStats.mtimeMs;

    // Wait for file to appear in file tree (file watcher needs time)
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: testFileName }))
      .toBeVisible({ timeout: 5000 });

    // Open the fresh file
    await openFileFromTree(page, testFileName);

    // Wait for the new tab to become the active one (tab text should show the new filename)
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer)
      .locator('.tab.active', { hasText: testFileName }))
      .toBeVisible({ timeout: 3000 });

    // Small wait for editor to fully initialize after tab switch
    await page.waitForTimeout(500);

    // Get the editor (use single visible one now that we fixed the .active class bug)
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toContainText('Manual Save Test', { timeout: 3000 });

    // Focus and type at end (same approach as working autosave test)
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker}`);

    // Verify marker was typed
    await expect(editor).toContainText(marker, { timeout: 3000 });

    // Verify dirty
    const tab = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer)
      .locator(PLAYWRIGHT_TEST_SELECTORS.tab, {
        has: page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: testFileName })
      });
    await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toBeVisible({ timeout: 1000 });

    // Trigger manual save via keyboard shortcut (more reliable than IPC)
    await page.keyboard.press('Meta+s');

    // Wait for save to complete and verify dirty indicator gone
    await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toHaveCount(0, { timeout: 3000 });

    // Verify file saved (mtime changed)
    const afterStats = await fs.stat(filePath);
    expect(afterStats.mtimeMs).toBeGreaterThan(initialMtime);

    // Verify content saved
    const diskContent = await fs.readFile(filePath, 'utf8');
    expect(diskContent).toContain(marker);
  });

  // Skip: File watcher tests are flaky - see file-watcher-updates.spec.ts for dedicated tests
  // The file watcher infrastructure may need investigation separately
  test.skip('detects external file changes and updates editor when clean', async () => {
    // Create fresh file for this test
    const testFileName = `external-changes-${Date.now()}.md`;
    const filePath = path.join(workspaceDir, testFileName);
    const externalEdit = `External edit at ${Date.now()}`;

    // Create fresh file
    await fs.writeFile(filePath, '# External Changes Test\n\nInitial content.\n', 'utf8');
    await page.waitForTimeout(500); // Wait for file tree to update

    // Open the fresh file
    await openFileFromTree(page, testFileName);

    // Verify initial content and wait for file to be fully loaded (no dirty state)
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toContainText('External Changes Test');

    // Wait to ensure no pending saves
    await page.waitForTimeout(500);

    // Modify file externally (simulating AI agent edit) - editor is CLEAN so should auto-reload
    const newContent = `# External Changes Test\n\nThis is external content.\n\n${externalEdit}\n`;
    await fs.writeFile(filePath, newContent, 'utf8');

    // Wait for file watcher to detect change and auto-reload
    // File watcher has debounce (~100ms) + processing time, so give it ample time
    await expect(editor).toContainText(externalEdit, { timeout: 5000 });
  });

  test('handles multiple tabs with independent autosave', async () => {
    // Create fresh files for this test
    const ts = Date.now();
    const file1Name = `multi-tab-1-${ts}.md`;
    const file2Name = `multi-tab-2-${ts}.md`;
    const file1Path = path.join(workspaceDir, file1Name);
    const file2Path = path.join(workspaceDir, file2Name);
    const marker1 = `marker-1-${ts}`;
    const marker2 = `marker-2-${ts}`;

    // Create fresh files
    await fs.writeFile(file1Path, '# Multi Tab Test 1\n\nInitial content.\n', 'utf8');
    await fs.writeFile(file2Path, '# Multi Tab Test 2\n\nInitial content.\n', 'utf8');
    await page.waitForTimeout(500); // Wait for file tree to update

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open and edit first file
    await openFileFromTree(page, file1Name);
    await expect(editor).toContainText('Multi Tab Test 1', { timeout: 3000 });
    await editor.click();
    await page.waitForTimeout(500);
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker1}`);
    await expect(editor).toContainText(marker1, { timeout: 3000 });

    const tab1 = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer)
      .locator(PLAYWRIGHT_TEST_SELECTORS.tab, {
        has: page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: file1Name })
      });
    await expect(tab1.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toBeVisible();

    // Open and edit second file
    await openFileFromTree(page, file2Name);
    await expect(editor).toContainText('Multi Tab Test 2', { timeout: 3000 });
    await editor.click();
    await page.waitForTimeout(500);
    await page.keyboard.press('End');
    await page.keyboard.type(`\n\n${marker2}`);
    await expect(editor).toContainText(marker2, { timeout: 3000 });

    const tab2 = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer)
      .locator(PLAYWRIGHT_TEST_SELECTORS.tab, {
        has: page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: file2Name })
      });
    await expect(tab2.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toBeVisible();

    // Wait for both to autosave
    await page.waitForTimeout(3500);

    // Verify both clean
    await expect(tab1.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toHaveCount(0);
    await expect(tab2.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toHaveCount(0);

    // Verify both saved to disk
    const content1 = await fs.readFile(file1Path, 'utf8');
    const content2 = await fs.readFile(file2Path, 'utf8');
    expect(content1).toContain(marker1);
    expect(content2).toContain(marker2);
  });

  test('shows conflict dialog when dirty file changes externally', async () => {
    // Create fresh file for this test
    const testFileName = `conflict-test-${Date.now()}.md`;
    const filePath = path.join(workspaceDir, testFileName);
    const externalEdit = `Conflict edit at ${Date.now()}`;

    // Create fresh file
    await fs.writeFile(filePath, '# Conflict Test\n\nInitial content.\n', 'utf8');
    await page.waitForTimeout(500); // Wait for file tree to update

    // Open the fresh file
    await openFileFromTree(page, testFileName);

    // Make a local edit to make the editor dirty
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type('\n\nLocal unsaved edit');

    // Verify dirty
    const tab = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer)
      .locator(PLAYWRIGHT_TEST_SELECTORS.tab, {
        has: page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: testFileName })
      });
    await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toBeVisible();

    // Modify file externally while dirty - should trigger conflict dialog
    const newContent = `# Conflict Test\n\n${externalEdit}\n`;
    await fs.writeFile(filePath, newContent, 'utf8');

    // Wait for file watcher and conflict dialog
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Verify conflict dialog appears
    const conflictDialog = page.locator('text="File Changed on Disk"');
    await expect(conflictDialog).toBeVisible({ timeout: 3000 });

    // Click "Reload from Disk" to accept external changes
    await page.locator('button', { hasText: 'Reload from Disk' }).click();

    // Verify editor now shows external content
    await expect(editor).toContainText(externalEdit, { timeout: 2000 });
  });

  // Skip: File watcher tests are flaky - see file-watcher-updates.spec.ts for dedicated tests
  test.skip('handles rapid external edits correctly', async () => {
    // Create fresh file for this test
    const testFileName = `rapid-edits-${Date.now()}.md`;
    const filePath = path.join(workspaceDir, testFileName);

    // Create fresh file
    await fs.writeFile(filePath, '# Rapid Edits Test\n\nInitial content.\n', 'utf8');
    await page.waitForTimeout(500); // Wait for file tree to update

    // Open the fresh file
    await openFileFromTree(page, testFileName);

    // Verify initial content loaded
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toContainText('Rapid Edits Test');

    // Make rapid successive external edits (file is CLEAN so should auto-reload)
    const baseContent = '# Rapid Edits Test\n\n';
    const edits = ['First edit.', 'Second edit.', 'Third and final edit.'];

    for (let i = 0; i < edits.length; i++) {
      const content = baseContent + edits.slice(0, i + 1).join('\n\n');
      await fs.writeFile(filePath, content, 'utf8');
      await page.waitForTimeout(300); // Small delay between edits
    }

    // Wait for file watcher to settle and verify final state
    // File watcher has debounce + coalescing, so give it ample time
    await expect(editor).toContainText('Third and final edit', { timeout: 5000 });
  });

  test('opens file from subdirectory correctly', async () => {
    // Expand the subdir folder
    const folderItem = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem)
      .filter({ hasText: 'subdir' }).first();
    await folderItem.click();
    await page.waitForTimeout(300);

    // Open nested.md
    await openFileFromTree(page, 'nested.md');

    // Verify tab and content
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('nested.md');

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toContainText('Nested Document');
    await expect(editor).toContainText('document is in a subdirectory');
  });
});

test.describe('File Deletion Handling', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create test file
    await fs.writeFile(
      path.join(workspaceDir, 'to-delete.md'),
      '# File to Delete\n\nThis file will be deleted.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);

    // Override window.confirm to auto-accept
    await page.evaluate(() => {
      window.confirm = () => true;
    });
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('closes tab and removes file when deleted via context menu', async () => {
    const testFile = path.join(workspaceDir, 'to-delete.md');

    // Open the file
    await openFileFromTree(page, 'to-delete.md');
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('to-delete.md');

    // Make edits (to ensure autosave doesn't recreate the file)
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.click();
    await page.keyboard.type('\n\nUnsaved content.');

    // Verify dirty
    const tab = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer)
      .locator(PLAYWRIGHT_TEST_SELECTORS.tab, {
        has: page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: 'to-delete.md' })
      });
    await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toBeVisible();

    // Right-click on file in tree and delete
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'to-delete.md' })
      .click({ button: 'right' });
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.fileContextMenu, { timeout: 1000 });

    // Click delete
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileContextMenuDelete).click();

    // Wait for deletion to complete
    await page.waitForTimeout(2000);

    // Verify tab is closed
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer)
      .locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: 'to-delete.md' }))
      .toHaveCount(0);

    // Verify file is deleted and not recreated
    await expect.poll(async () => {
      try {
        await fs.access(testFile);
        return false;
      } catch {
        return true;
      }
    }, {
      timeout: 3000,
      message: 'Expected file to remain deleted'
    }).toBe(true);
  });
});
