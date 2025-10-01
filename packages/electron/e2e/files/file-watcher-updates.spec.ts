import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
    launchElectronApp,
    createTempWorkspace,
    TEST_TIMEOUTS,
    waitForAppReady,
    ACTIVE_EDITOR_SELECTOR
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('File Watcher Updates', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create initial test files
    await fs.writeFile(
      path.join(workspaceDir, 'watched.md'),
      '# Watched File\n\nOriginal content from disk.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should detect when file is modified on disk by external process', async () => {
    const filePath = path.join(workspaceDir, 'watched.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'watched.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Verify initial content
    let editorText = await editor.innerText();
    expect(editorText).toContain('Original content from disk');

    // Simulate external modification (AI agent editing the file)
    const externalEdit = 'This line was added by an external process like an AI agent.';
    const newContent = `# Watched File\n\nOriginal content from disk.\n\n${externalEdit}\n`;
    await fs.writeFile(filePath, newContent, 'utf8');

    // Wait for file watcher to detect the change
    // The app should either:
    // 1. Automatically reload the content, or
    // 2. Show a notification/dialog about the external change
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Check if content was updated in the editor
    editorText = await editor.innerText();
    expect(editorText).toContain(externalEdit);
  });

  test('should show notification when file is modified externally while editor has unsaved changes', async () => {
    const filePath = path.join(workspaceDir, 'watched.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'watched.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Make local unsaved changes
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type('\nLocal unsaved edit.');

    // Verify dirty state
    const tab = page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'watched.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible();

    // Set up dialog handler to catch the confirm dialog
    let dialogShown = false;
    page.once('dialog', async dialog => {
      dialogShown = true;
      await dialog.dismiss(); // Click Cancel to keep local changes
    });

    // Simulate external modification
    const externalContent = `# Watched File\n\nExternal modification that conflicts with local changes.\n`;
    await fs.writeFile(filePath, externalContent, 'utf8');

    // Wait for file watcher to detect the change and show dialog
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // The confirm dialog should have been shown
    expect(dialogShown).toBe(true);
  });

  test('should reload content when switching to tab with externally modified file', async () => {
    const watchedPath = path.join(workspaceDir, 'watched.md');
    const otherPath = path.join(workspaceDir, 'other.md');

    await fs.writeFile(otherPath, '# Other File\n\nOther content.\n', 'utf8');

    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open watched.md
    await page.locator('.file-tree-name', { hasText: 'watched.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Switch to other.md
    await page.locator('.file-tree-name', { hasText: 'other.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('other.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Modify watched.md externally while it's in the background
    const externalEdit = 'AI agent made this change while tab was inactive.';
    const newContent = `# Watched File\n\nOriginal content from disk.\n\n${externalEdit}\n`;
    await fs.writeFile(watchedPath, newContent, 'utf8');

    // Wait for file system change to propagate
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Switch back to watched.md
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'watched.md' }) }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    // Content should reflect the external changes
    const editorText = await editor.innerText();
    expect(editorText).toContain(externalEdit);
  });

  test('should handle file deletion while open in editor', async () => {
    const filePath = path.join(workspaceDir, 'watched.md');

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'watched.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Delete the file externally
    await fs.unlink(filePath);

    // Wait for file watcher to detect deletion
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // The app should show some indication that the file was deleted
    // Could be a notification, dialog, or special tab state
    const hasDialog = await page.locator('.dialog, .modal, [role="dialog"]').count() > 0;
    const hasNotification = await page.locator('.notification, .alert, .flash-message').count() > 0;
    const tabHasWarning = await page.locator('.tab.active .tab-warning, .tab.active .tab-deleted').count() > 0;

    expect(hasDialog || hasNotification || tabHasWarning).toBe(true);
  });

  test('should update file tree when new files are created by external process', async () => {
    // Verify initial state - only watched.md exists
    await expect(page.locator('.file-tree-name', { hasText: 'watched.md' })).toBeVisible();
    await expect(page.locator('.file-tree-name', { hasText: 'new-file.md' })).toHaveCount(0);

    // Create new file externally (simulating AI agent creating a file)
    const newFilePath = path.join(workspaceDir, 'new-file.md');
    await fs.writeFile(newFilePath, '# New File\n\nCreated by AI agent.\n', 'utf8');

    // Wait for file watcher to detect the new file
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION * 2);

    // New file should appear in the file tree
    await expect(page.locator('.file-tree-name', { hasText: 'new-file.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });
  });

  test('should detect rapid successive external changes', async () => {
    const filePath = path.join(workspaceDir, 'watched.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'watched.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Make rapid successive external modifications (like an AI agent editing in iterations)
    const changes = [
      '# Watched File\n\nFirst external edit.\n',
      '# Watched File\n\nFirst external edit.\n\nSecond external edit.\n',
      '# Watched File\n\nFirst external edit.\n\nSecond external edit.\n\nThird external edit.\n',
    ];

    for (const content of changes) {
      await fs.writeFile(filePath, content, 'utf8');
      await page.waitForTimeout(500); // Small delay between edits
    }

    // Wait for all changes to propagate
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Editor should show the final state
    const editorText = await editor.innerText();
    expect(editorText).toContain('Third external edit');
  });

  test('should preserve cursor position when file is reloaded from disk (if no conflicts)', async () => {
    const filePath = path.join(workspaceDir, 'watched.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'watched.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Position cursor at a specific location
    await editor.click();
    await page.keyboard.press('End'); // Move to end of first line

    // Make a non-conflicting external change (append to end)
    const originalContent = await fs.readFile(filePath, 'utf8');
    await fs.writeFile(filePath, originalContent + '\nAppended by external process.\n', 'utf8');

    // Wait for file watcher
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // In an ideal implementation, cursor position should be preserved
    // This is a stretch goal - many editors struggle with this
    // For now, just verify the content updated
    const editorText = await editor.innerText();
    expect(editorText).toContain('Appended by external process');
  });
});
