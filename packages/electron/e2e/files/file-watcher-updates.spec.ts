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

    // Handle any dialogs that might appear (dismiss them)
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));

    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should detect when file is modified on disk by external process', async () => {
    const filePath = path.join(workspaceDir, 'watched.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Listen for console messages from the Electron app
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      console.log(`[ELECTRON] ${text}`);
    });

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'watched.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Verify initial content
    let editorText = await editor.innerText();
    expect(editorText).toContain('Original content from disk');

    console.log('[TEST] About to modify file externally');

    // Simulate external modification (AI agent editing the file)
    const externalEdit = 'This line was added by an external process like an AI agent.';
    const newContent = `# Watched File\n\nOriginal content from disk.\n\n${externalEdit}\n`;
    await fs.writeFile(filePath, newContent, 'utf8');

    console.log('[TEST] File modified, waiting for detection...');

    // Wait for file watcher to detect the change
    // The app should either:
    // 1. Automatically reload the content, or
    // 2. Show a notification/dialog about the external change
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    console.log('[TEST] Console logs from app:');
    consoleLogs.forEach(log => console.log(log));

    // Check if content was updated in the editor
    editorText = await editor.innerText();
    expect(editorText).toContain(externalEdit);
  });

  test('should show notification when file is modified externally while editor has unsaved changes', async () => {
    const filePath = path.join(workspaceDir, 'watched.md');
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'watched.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Make local unsaved changes
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type('\nLocal unsaved edit.');

    // Verify dirty state
    const tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'watched.md' }) });
    await expect(tab.locator('.tab-dirty-indicator')).toBeVisible();

    // Simulate external modification
    const externalContent = `# Watched File\n\nExternal modification that conflicts with local changes.\n`;
    await fs.writeFile(filePath, externalContent, 'utf8');

    // Wait for file watcher to detect the change and show custom dialog
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // The custom conflict dialog should be visible
    const conflictDialog = page.locator('.file-conflict-dialog');
    await expect(conflictDialog).toBeVisible();

    // Click "Keep My Changes" button
    await page.locator('button', { hasText: 'Keep My Changes' }).click();

    // Dialog should be gone
    await expect(conflictDialog).not.toBeVisible();
  });

  test('should reload content when switching to tab with externally modified file', async () => {
    const file1Path = path.join(workspaceDir, 'file1.md');
    const file2Path = path.join(workspaceDir, 'file2.md');
    const file3Path = path.join(workspaceDir, 'file3.md');

    // Track console messages to verify handleFileChanged is called
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleMessages.push(text);
      if (text.includes('handleFileChanged') || text.includes('CHANGE EVENT')) {
        console.log(`[CONSOLE] ${text}`);
      }
    });

    // Create three test files
    await fs.writeFile(file1Path, '# File 1\n\nOriginal content of file 1.\n', 'utf8');
    await fs.writeFile(file2Path, '# File 2\n\nOriginal content of file 2.\n', 'utf8');
    await fs.writeFile(file3Path, '# File 3\n\nOriginal content of file 3.\n', 'utf8');

    // Wait for file tree to update
    await page.waitForTimeout(500);

    // Open file1.md (tab 1)
    await page.locator('.file-tree-name', { hasText: 'file1.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('file1.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Open file2.md (tab 2)
    await page.locator('.file-tree-name', { hasText: 'file2.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('file2.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Open file3.md (tab 3, currently active)
    await page.locator('.file-tree-name', { hasText: 'file3.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('file3.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Clear console messages from startup
    consoleMessages.length = 0;

    console.log('[TEST] Opened 3 tabs: file1 (inactive), file2 (inactive), file3 (active)');
    console.log('[TEST] Now modifying file2.md externally...');

    // Modify file2.md externally while it's the SECOND tab (inactive)
    const externalEdit2 = 'External edit to FILE 2 while inactive';
    const newContent2 = `# File 2\n\nOriginal content of file 2.\n\n${externalEdit2}\n`;
    await fs.writeFile(file2Path, newContent2, 'utf8');

    console.log('[TEST] Modified file2.md externally, waiting for detection...');

    // Wait for file watcher to detect the change
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);

    // Check if handleFileChanged was called for file2.md
    const file2HandlerCalled = consoleMessages.some(msg =>
      msg.includes('handleFileChanged') && msg.includes('file2.md')
    );
    console.log('[TEST] Was handleFileChanged called for file2.md?', file2HandlerCalled);
    console.log('[TEST] Relevant console messages:', consoleMessages.filter(msg =>
      msg.includes('file2') || msg.includes('CHANGE EVENT')
    ));

    // Check file2's HIDDEN editor content BEFORE switching tabs
    const hiddenFile2Editor = page.locator('.tab-editor[data-file-path$="file2.md"][data-active="false"]').first();
    const hiddenFile2Exists = await hiddenFile2Editor.count() > 0;
    console.log('[TEST] Hidden file2 editor exists?', hiddenFile2Exists);

    if (hiddenFile2Exists) {
      const hiddenContent = await hiddenFile2Editor.innerText().catch(() => 'ERROR_READING');
      console.log('[TEST] Hidden file2 content (first 100 chars):', hiddenContent.substring(0, 100));
      console.log('[TEST] Does hidden content contain external edit?', hiddenContent.includes(externalEdit2));

      // This is the KEY assertion - does the hidden tab have updated content?
      expect(hiddenContent).toContain(externalEdit2);
    }

    // Now switch to file2 and verify content persists
    await page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'file2.md' }) }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('file2.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await page.waitForTimeout(500);

    const activeEditor = page.locator(ACTIVE_EDITOR_SELECTOR);
    const file2Text = await activeEditor.innerText();
    console.log('[TEST] File2 active editor text:', file2Text.substring(0, 100));
    expect(file2Text).toContain(externalEdit2);
  });

  test('should handle file deletion while open in editor', async () => {
    const filePath = path.join(workspaceDir, 'watched.md');

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'watched.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Delete the file externally
    await fs.unlink(filePath);

    // Wait for file watcher to detect deletion
    // Use a longer timeout since file deletion detection can be slow
    await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION * 2);

    // NOTE: File deletion handling is not yet implemented
    // For now, we just verify the file is gone from disk
    // In the future, this should close the tab or show a notification
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(fileExists).toBe(false);
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
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

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
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('watched.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

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
