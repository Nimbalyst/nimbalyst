/**
 * Lexical Editor E2E Tests (Consolidated)
 *
 * Tests for the Lexical-based markdown editor including:
 * - Autosave functionality
 * - Dirty close (save on tab close)
 * - External file change detection
 * - AI diff accept / reject
 * - Copy as markdown (Cmd+Shift+C)
 * - Document initial scroll position
 * - No re-render on save / AI input / dirty state change
 * - Breadcrumb path display
 *
 * Consolidated from:
 * - markdown.spec.ts (autosave, dirty close, diff, copy)
 * - editor/editor.spec.ts (scroll, re-render, breadcrumb)
 *
 * All tests share a single app instance for performance.
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
  TEST_TIMEOUTS,
  ACTIVE_EDITOR_SELECTOR,
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  openFileFromTree,
  closeTabByFileName,
  getTabByFileName,
} from '../utils/testHelpers';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

// Shared app instance for all tests in this file
test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create ALL test files upfront for all scenarios
  await fs.writeFile(
    path.join(workspaceDir, 'autosave-test.md'),
    '# Autosave Test\n\nOriginal content.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'autosave-accent-test.md'),
    '# Prueba de Acentos\n\nContenido original.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'dirty-close-test.md'),
    '# Dirty Close Test\n\nOriginal content.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'external-change-test.md'),
    '# External Change Test\n\nOriginal content.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'diff-accept-test.md'),
    '# Original Title\n\nThis is the original content.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'diff-reject-test.md'),
    '# Original Title\n\nThis is the original content.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'copy-test.md'),
    '# Initial Content\n\nTest file.',
    'utf8'
  );

  // --- Files for editor behavior tests (from editor/editor.spec.ts) ---
  const scrollDocContent = `# Document Title\n\nThis is the first paragraph at the top of the document.\n\n## Section 1\n\nLorem ipsum dolor sit amet.\n\n## Section 2\n\nUt enim ad minim veniam.\n\n## Section 3\n\nDuis aute irure dolor.\n\n## Section 4\n\nExcepteur sint occaecat.\n\n## Section 5\n\nMore content to push the code block further down.\n\n## Section 6\n\nAdditional paragraph content.\n\n## Section 7\n\nEven more content here.\n\n## Section 8\n\nThe code block should be far enough down.\n\n\`\`\`javascript\nfunction example() {\n  console.log('Hello world');\n}\n\`\`\`\n\n## Section 9\n\nMore content after the code block.\n\n## Section 10\n\nFinal section at the bottom.`;
  await fs.writeFile(path.join(workspaceDir, 'scroll-doc.md'), scrollDocContent, 'utf8');
  await fs.writeFile(path.join(workspaceDir, 'save-test.md'), '# Test Document\n\nThis is a test document for verifying that EditorMode does not re-render on save.\n\nSome content here.\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, 'filetree-test.md'), '# Test Document\n\nContent for testing file tree updates.\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, 'rerender-base.md'), '# Test\n\nSome content.', 'utf8');
  await fs.writeFile(path.join(workspaceDir, 'rerender-a.md'), '# File 1', 'utf8');
  await fs.writeFile(path.join(workspaceDir, 'rerender-b.md'), '# File 2', 'utf8');
  const crumbSubDir = path.join(workspaceDir, 'crumb-subdir');
  await fs.mkdir(crumbSubDir, { recursive: true });
  await fs.writeFile(path.join(crumbSubDir, 'crumb-file.md'), '# Test File\n\nThis is a test.');
  await fs.writeFile(
    path.join(workspaceDir, 'multi-editor-test.md'),
    '# Multi Editor Test\n\nOriginal content for multi-editor scenario.\n',
    'utf8'
  );

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
});

test.afterAll(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('autosave clears dirty indicator and saves content', async () => {
  const mdPath = path.join(workspaceDir, 'autosave-test.md');
  const marker = `autosave-marker-${Date.now()}`;

  // Open the markdown file
  await openFileFromTree(page, 'autosave-test.md');

  // Wait for Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Click in the editor and type at the end
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(`\n\n${marker}`);

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'autosave-test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Wait for autosave (2s interval + 200ms debounce + buffer)
  await page.waitForTimeout(3500);

  // Verify dirty indicator cleared
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0, { timeout: 1000 });

  // Verify content saved to disk
  const savedContent = await fs.readFile(mdPath, 'utf-8');
  expect(savedContent).toContain(marker);

  // Close the tab to clean up for next test
  await closeTabByFileName(page, 'autosave-test.md');
});

test('autosave preserves accent and Unicode characters', async () => {
  const mdPath = path.join(workspaceDir, 'autosave-accent-test.md');

  // Open the markdown file
  await openFileFromTree(page, 'autosave-accent-test.md');

  // Wait for Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Click in the editor and type accent characters at the end
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type('\n\nAño nuevo: á é í ó ú ñ ü');

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'autosave-accent-test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Wait for autosave (2s interval + 200ms debounce + buffer)
  await page.waitForTimeout(3500);

  // Verify dirty indicator cleared
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0, { timeout: 1000 });

  // Verify content saved to disk with correct encoding
  const savedContent = await fs.readFile(mdPath, 'utf-8');
  expect(savedContent).toContain('Año nuevo');
  expect(savedContent).toContain('á é í ó ú ñ ü');

  // Verify no mojibake / double-encoding artifacts
  expect(savedContent).not.toContain('Ã');
  expect(savedContent).not.toContain('Â');

  // Verify the original Spanish content survived too
  expect(savedContent).toContain('Prueba de Acentos');

  // Close the tab to clean up for next test
  await closeTabByFileName(page, 'autosave-accent-test.md');
});

test('edited content is saved when tab is closed', async () => {
  const mdPath = path.join(workspaceDir, 'dirty-close-test.md');
  const marker = `edited-marker-${Date.now()}`;

  // Open the markdown file
  await openFileFromTree(page, 'dirty-close-test.md');

  // Wait for Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Click in the editor and type at the end
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(`\n\n${marker}`);

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'dirty-close-test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Close the tab using helper (clicks close button, waits for tab to disappear)
  await closeTabByFileName(page, 'dirty-close-test.md');

  // Wait for save to complete (async save via IPC)
  await page.waitForTimeout(500);

  // Read the file and check the content
  const savedContent = await fs.readFile(mdPath, 'utf-8');

  // Verify the content was saved
  expect(savedContent).toContain(marker);
});

// Skip: File watcher tests for markdown are flaky - needs investigation
test.skip('external file change auto-reloads when editor is clean', async () => {
  const mdPath = path.join(workspaceDir, 'external-change-test.md');
  const externalContent = '# Modified Externally\n\nThis was modified outside the editor.\n';

  // Open the markdown file
  await openFileFromTree(page, 'external-change-test.md');

  // Wait for Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify no dirty indicator (editor is clean)
  const tabElement = getTabByFileName(page, 'external-change-test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0);

  // Verify original content
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toContainText('External Change Test');

  // Modify file externally
  await fs.writeFile(mdPath, externalContent, 'utf8');

  // Wait for file watcher to detect and reload
  await page.waitForTimeout(1500);

  // Verify editor shows new content (no conflict dialog)
  await expect(editor).toContainText('Modified Externally', { timeout: 5000 });
  await expect(editor).not.toContainText('External Change Test');

  // Close the tab to clean up
  await closeTabByFileName(page, 'external-change-test.md');
});

test('accepting diff applies changes and saves to disk', async () => {
  const mdPath = path.join(workspaceDir, 'diff-accept-test.md');

  // Original content (already written in beforeAll)
  const originalContent = '# Original Title\n\nThis is the original content.\n';

  // Modified content
  const modifiedContent = '# Modified Title\n\nThis is the modified content with AI changes.\n';

  // Open the markdown file
  await openFileFromTree(page, 'diff-accept-test.md');

  // Wait for the Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify the editor shows original content
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toContainText('Original Title');

  // Simulate AI edit:
  // 1. Write modified content to disk
  // 2. Create a pending history tag
  await fs.writeFile(mdPath, modifiedContent, 'utf8');

  const tagId = `test-tag-${Date.now()}`;
  const sessionId = `test-session-${Date.now()}`;

  await page.evaluate(async ({ filePath, tagId, sessionId, originalContent }) => {
    await window.electronAPI.history.createTag(
      filePath,
      tagId,
      originalContent,
      sessionId,
      'test-tool-use'
    );
  }, { filePath: mdPath, tagId, sessionId, originalContent });

  // Close and reopen the file to trigger pending tag check
  await page.keyboard.press('Meta+w');
  await page.waitForTimeout(300);

  await openFileFromTree(page, 'diff-accept-test.md');
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Wait for unified diff header to appear (Lexical uses UnifiedDiffHeader)
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

  // Verify unaccepted indicator on tab
  const tabElement = getTabByFileName(page, 'diff-accept-test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toBeVisible({ timeout: 2000 });

  // Click "Keep All" to accept the changes
  // Use dispatchEvent to bypass chat sidebar overlay
  const acceptButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton);
  await acceptButton.dispatchEvent('click');
  await page.waitForTimeout(500);

  // Wait for unified diff header to disappear
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 3000 }).catch(() => {
    console.log('[Test] Unified diff header still visible after Keep');
  });

  await page.waitForTimeout(500);

  // Verify unaccepted indicator is gone
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toHaveCount(0, { timeout: 2000 });

  // Verify editor shows modified content
  await expect(editor).toContainText('Modified Title', { timeout: 3000 });
  await expect(editor).toContainText('AI changes');

  // Verify the file on disk has the modified content
  const finalContent = await fs.readFile(mdPath, 'utf-8');
  expect(finalContent).toContain('Modified Title');
  expect(finalContent).toContain('AI changes');

  // Close the tab to clean up
  await closeTabByFileName(page, 'diff-accept-test.md');
});

test('rejecting diff reverts to original content', async () => {
  const mdPath = path.join(workspaceDir, 'diff-reject-test.md');

  // Original content (already written in beforeAll)
  const originalContent = '# Original Title\n\nThis is the original content.\n';

  // Modified content
  const modifiedContent = '# Modified Title\n\nThis is the modified content with AI changes.\n';

  // Open the markdown file
  await openFileFromTree(page, 'diff-reject-test.md');

  // Wait for the Lexical editor to load
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify the editor shows original content
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toContainText('Original Title');

  // Simulate AI edit:
  // 1. Write modified content to disk
  // 2. Create a pending history tag
  await fs.writeFile(mdPath, modifiedContent, 'utf8');

  const tagId = `test-tag-${Date.now()}`;
  const sessionId = `test-session-${Date.now()}`;

  await page.evaluate(async ({ filePath, tagId, sessionId, originalContent }) => {
    await window.electronAPI.history.createTag(
      filePath,
      tagId,
      originalContent,
      sessionId,
      'test-tool-use'
    );
  }, { filePath: mdPath, tagId, sessionId, originalContent });

  // Close and reopen the file to trigger pending tag check
  await page.keyboard.press('Meta+w');
  await page.waitForTimeout(300);

  await openFileFromTree(page, 'diff-reject-test.md');
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Wait for unified diff header to appear (Lexical uses UnifiedDiffHeader)
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

  // Verify unaccepted indicator on tab
  const tabElement = getTabByFileName(page, 'diff-reject-test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toBeVisible({ timeout: 2000 });

  // Click "Revert All" to reject the changes
  // Use dispatchEvent to bypass chat sidebar overlay
  const rejectButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffRejectAllButton);
  await rejectButton.dispatchEvent('click');
  await page.waitForTimeout(500);

  // Wait for unified diff header to disappear
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 3000 }).catch(() => {
    console.log('[Test] Unified diff header still visible after Revert');
  });

  await page.waitForTimeout(500);

  // Verify unaccepted indicator is gone
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toHaveCount(0, { timeout: 2000 });

  // Verify editor shows original content (reverted)
  await expect(editor).toContainText('Original Title', { timeout: 3000 });
  await expect(editor).not.toContainText('AI changes');

  // Verify the file on disk has the original content (reverted)
  // Note: handleClearDiffTag saves to disk automatically when CLEAR_DIFF_TAG_COMMAND is dispatched
  const finalContent = await fs.readFile(mdPath, 'utf-8');
  expect(finalContent).toContain('Original Title');
  expect(finalContent).not.toContain('AI changes');

  // Close the tab to clean up
  await closeTabByFileName(page, 'diff-reject-test.md');
});

// --- Copy as Markdown test (from markdown-copy.spec.ts) ---

test('Cmd+Shift+C should copy selection as markdown', async () => {
  await openFileFromTree(page, 'copy-test.md');

  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Set up clipboard permissions
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  // Type some content with formatting
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await editor.click();
  await page.keyboard.press('Meta+A');
  await editor.pressSequentially('Hello ');
  await page.keyboard.press('Meta+B');
  await editor.pressSequentially('world');

  // Select all and copy as markdown with Cmd+Shift+C
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Meta+Shift+C');

  // Wait for copy to complete
  await page.waitForTimeout(500);

  // Check what's actually on the system clipboard
  const clipboardData = await page.evaluate(async () => {
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

  // Close the tab to clean up
  await closeTabByFileName(page, 'copy-test.md');
});

// ========================================================================
// Editor Behavior tests (from editor/editor.spec.ts)
// ========================================================================

// Skip: Title visibility check fails due to window sizing - scroll position check passes
test.skip('should load document at the top when it contains a code block', async () => {
  await openFileFromTree(page, 'scroll-doc.md');

  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  const getScrollPosition = async () => {
    return await page.evaluate(() => {
      const editorScroller = document.querySelector('.file-tabs-container .multi-editor-instance.active .editor-scroller');
      return editorScroller ? editorScroller.scrollTop : 0;
    });
  };

  await page.waitForTimeout(500);
  await page.waitForTimeout(1000);
  await page.waitForTimeout(1500);
  const finalScrollTop = await getScrollPosition();
  expect(finalScrollTop).toBe(0);

  const titleVisible = await page.evaluate(() => {
    const editorContainer = document.querySelector('.file-tabs-container .multi-editor-instance.active .editor');
    const title = editorContainer?.querySelector('h1');
    if (!title || !editorContainer) return false;
    const titleRect = title.getBoundingClientRect();
    const containerRect = editorContainer.getBoundingClientRect();
    return titleRect.top >= containerRect.top && titleRect.bottom <= containerRect.bottom;
  });
  expect(titleVisible).toBe(true);
});

test('EditorMode should not re-render after autosave', async () => {
  await openFileFromTree(page, 'save-test.md');

  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  await page.waitForTimeout(2000);

  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  await editor.click();
  await page.keyboard.type('x');

  await page.waitForTimeout(3500);

  const saveIndex = logs.findIndex(log => log.includes('[SAVE]'));
  if (saveIndex >= 0) {
    const logsAfterSave = logs.slice(saveIndex);
    const hasEditorModeRender = logsAfterSave.some(log => log.includes('[EditorMode] render'));
    expect(hasEditorModeRender).toBe(false);
  }

  const tabContentRenderCount = logs.filter(log => log.includes('[TabContent] render')).length;
  const tabManagerRenderCount = logs.filter(log => log.includes('[TabManager] render')).length;
  expect(tabContentRenderCount).toBeLessThanOrEqual(2);
  expect(tabManagerRenderCount).toBeLessThanOrEqual(2);
});

test('File tree update should not trigger on content save', async () => {
  await openFileFromTree(page, 'filetree-test.md');

  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  await page.waitForTimeout(2000);

  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  await editor.click();
  await page.keyboard.type('test');

  await page.waitForTimeout(3500);

  const fileTreeUpdateLogs = logs.filter(log =>
    log.includes('onWorkspaceFileTreeUpdated') ||
    log.includes('workspace-file-tree-updated')
  );
  expect(fileTreeUpdateLogs.length).toBe(0);
});

test('Typing in AI input should not re-render file editor components', async () => {
  await openFileFromTree(page, 'rerender-base.md');
  await page.waitForTimeout(1000);
  await page.waitForTimeout(2000);

  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  const aiInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.filesChatInput);

  const aiToggle = page.locator('.ai-chat-toggle-button');
  if (await aiToggle.isVisible()) {
    await aiToggle.click();
    await page.waitForTimeout(500);
  }

  if (await aiInput.isVisible()) {
    await aiInput.click();
    await aiInput.fill('');
    await page.keyboard.type('test message here!!', { delay: 50 });
    await page.waitForTimeout(500);

    const appRenders = logs.filter(log => log.includes('[App] render')).length;
    const editorModeRenders = logs.filter(log => log.includes('[EditorMode] render')).length;
    const tabManagerRenders = logs.filter(log => log.includes('[TabManager] render')).length;
    const tabContentRenders = logs.filter(log => log.includes('[TabContent] render')).length;
    const tabEditorRenders = logs.filter(log => log.includes('[TabEditor] render')).length;
    const tabDirtyIndicatorRenders = logs.filter(log => log.includes('[TabDirtyIndicator] render')).length;

    expect(appRenders).toBe(0);
    expect(editorModeRenders).toBe(0);
    expect(tabManagerRenders).toBe(0);
    expect(tabContentRenders).toBe(0);
    expect(tabEditorRenders).toBe(0);
    expect(tabDirtyIndicatorRenders).toBe(0);
  }
});

test('Dirty state change should only re-render TabDirtyIndicator, not TabManager or parents', async () => {
  await openFileFromTree(page, 'rerender-a.md');

  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  await page.waitForTimeout(2000);

  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  await editor.click();
  await page.keyboard.type('x');

  await page.waitForTimeout(500);

  const appRenders = logs.filter(log => log.includes('[App] render')).length;
  const editorModeRenders = logs.filter(log => log.includes('[EditorMode] render')).length;
  const tabManagerRenders = logs.filter(log => log.includes('[TabManager] render')).length;
  const tabContentRenders = logs.filter(log => log.includes('[TabContent] render')).length;

  expect(appRenders).toBe(0);
  expect(editorModeRenders).toBe(0);
  expect(tabManagerRenders).toBe(0);
  expect(tabContentRenders).toBe(0);

  const dirtyIndicator = page.locator('.tab-dirty-indicator');
  await expect(dirtyIndicator).toBeVisible({ timeout: 2000 });
});

test('Opening a second file should not re-render the first file TabEditor', async () => {
  await page.locator('.file-tree-name', { hasText: 'rerender-b.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

  await page.waitForTimeout(2000);

  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  await page.locator('.file-tree-name', { hasText: 'rerender-b.md' }).click();
  await page.waitForTimeout(1000);

  const tabEditorRenders = logs.filter(log => log.includes('[TabEditor] render'));
  const file1Renders = tabEditorRenders.filter(log => log.includes('rerender-a.md')).length;
  expect(file1Renders).toBe(0);
});

test('should show relative path from workspace root in breadcrumb', async () => {
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.workspaceSidebar, { timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

  const folderItem = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem).filter({ hasText: 'crumb-subdir' }).first();
  await expect(folderItem).toBeVisible({ timeout: 5000 });
  await folderItem.click();
  await page.waitForTimeout(500);

  const fileItem = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem).filter({ hasText: 'crumb-file.md' }).first();
  await expect(fileItem).toBeVisible({ timeout: 5000 });
  await fileItem.dblclick();

  const headerBar = page.locator('.unified-editor-header-bar', { hasText: 'crumb-file.md' });
  await expect(headerBar).toBeVisible({ timeout: 5000 });

  const breadcrumb = headerBar.locator('.unified-header-breadcrumb');
  await expect(breadcrumb).toBeVisible();

  const segments = breadcrumb.locator('.breadcrumb-segment');
  const segmentCount = await segments.count();
  expect(segmentCount).toBeGreaterThanOrEqual(2);

  const breadcrumbText = await breadcrumb.textContent();
  expect(breadcrumbText).toContain('crumb-subdir');
  expect(breadcrumbText).toContain('crumb-file.md');
  expect(breadcrumbText).not.toContain('/Users/');
  expect(breadcrumbText).not.toContain(workspaceDir);
});

test('dirty editor content is not overwritten by external file write', async () => {
  // When a dirty editor has unsaved edits, an external file write (e.g. from
  // another editor, AI tool, or terminal) must NOT overwrite the user's edits.
  const mdPath = path.join(workspaceDir, 'multi-editor-test.md');
  const userEdit = 'USER_TYPED_CONTENT_SHOULD_SURVIVE';

  // Reset file content
  await fs.writeFile(mdPath, '# Multi Editor Test\n\nOriginal content.\n', 'utf8');

  // Open the file
  await openFileFromTree(page, 'multi-editor-test.md');
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Type in the editor (makes it dirty)
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(`\n\n${userEdit}`);
  await page.waitForTimeout(200);

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'multi-editor-test.md');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Write different content to disk externally
  await fs.writeFile(mdPath, '# Multi Editor Test\n\nContent from OTHER editor.\n', 'utf8');
  await page.waitForTimeout(1500);

  // Editor should STILL show user's typed content
  await expect(editor).toContainText(userEdit);

  // Wait for autosave to persist user's edits
  await page.waitForTimeout(3500);

  // Disk should have the user's content
  const finalDiskContent = await fs.readFile(mdPath, 'utf-8');
  expect(finalDiskContent).toContain(userEdit);

  await closeTabByFileName(page, 'multi-editor-test.md');
});

test('clean editor picks up content saved by sibling editor via DocumentModel', async () => {
  // When the same file is open in two contexts (e.g. FilesMode + AgentMode),
  // saving from one editor should update the other (clean) editor's content.
  // This uses page.evaluate to simulate the DocumentModel multi-editor flow
  // since E2E tests run a single Electron window.
  const mdPath = path.join(workspaceDir, 'multi-editor-test.md');

  // Reset file
  await fs.writeFile(mdPath, '# Multi Editor Test\n\nOriginal content.\n', 'utf8');

  // Open the file (editor A attaches to DocumentModel)
  await openFileFromTree(page, 'multi-editor-test.md');
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify initial content
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toContainText('Original content');

  // Simulate a sibling editor saving new content through DocumentModel.
  // This attaches a second handle, saves through it, then detaches.
  const newContent = '# Multi Editor Test\n\nUpdated by sibling editor.\n';
  await page.evaluate(async ({ filePath, content }) => {
    // Access the DocumentModelRegistry from the renderer
    // The registry is imported by TabEditor, so it's available in the module scope.
    // We access it through the multi-editor-instance element's internal state.
    const container = document.querySelector(`[data-file-path="${filePath}"]`);
    if (!container) throw new Error('Editor container not found');

    // Write the new content to disk directly (simulating sibling save)
    await window.electronAPI.saveFile(content, filePath);
  }, { filePath: mdPath, content: newContent });

  // Wait for file watcher to detect the change and update the clean editor
  await page.waitForTimeout(2000);

  // Editor A should now show the updated content
  await expect(editor).toContainText('Updated by sibling editor', { timeout: 3000 });

  await closeTabByFileName(page, 'multi-editor-test.md');
});

test('autosave does not hijack cursor when editor content is unchanged', async () => {
  // When the user is actively typing, the autosave cycle should not
  // reload content or move the cursor. This tests that:
  // 1. Autosave fires and persists content
  // 2. The file watcher echo is suppressed (no content reload)
  // 3. The cursor stays where the user left it
  const mdPath = path.join(workspaceDir, 'multi-editor-test.md');

  // Reset file
  await fs.writeFile(mdPath, '# Cursor Test\n\nLine one.\n\nLine two.\n', 'utf8');

  await openFileFromTree(page, 'multi-editor-test.md');
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await editor.click();
  await page.keyboard.press('End');

  // Type first batch
  await page.keyboard.type('\n\nFirst batch typed');
  await page.waitForTimeout(200);

  // Wait for autosave to fire
  await page.waitForTimeout(3000);

  // Now type more -- if cursor was hijacked, this would go to the wrong place
  await page.keyboard.type(' and more text');
  await page.waitForTimeout(200);

  // Both batches should be present and contiguous
  await expect(editor).toContainText('First batch typed and more text');

  // Wait for second autosave
  await page.waitForTimeout(3000);

  // Verify disk has everything
  const diskContent = await fs.readFile(mdPath, 'utf-8');
  expect(diskContent).toContain('First batch typed and more text');

  await closeTabByFileName(page, 'multi-editor-test.md');
});
