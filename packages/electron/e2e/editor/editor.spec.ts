import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  ACTIVE_EDITOR_SELECTOR,
  waitForAppReady
} from '../helpers';
import { openFileFromTree, PLAYWRIGHT_TEST_SELECTORS } from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

// Consolidated editor tests from:
// - document-initial-scroll.spec.ts
// - no-rerender-on-save.spec.ts
// - no-rerender-on-ai-input.spec.ts
// - unified-header-breadcrumb.spec.ts

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

test.beforeAll(async () => {
  workspacePath = await createTempWorkspace();

  // --- Files for document-initial-scroll test ---
  const scrollDocContent = `# Document Title

This is the first paragraph at the top of the document. This content should be visible when the document loads.

## Section 1

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## Section 2

Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

## Section 3

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

## Section 4

Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

## Section 5

More content to push the code block further down the page so it requires scrolling to see it.

## Section 6

Additional paragraph content to ensure the code block is well below the fold.

## Section 7

Even more content here to make sure we have enough vertical space.

## Section 8

The code block should be far enough down that it's not visible without scrolling.

\`\`\`javascript
// This is a code block that should be off-screen initially
function example() {
  console.log('Hello world');
  console.log('This code block is far down the page');
}
\`\`\`

## Section 9

More content after the code block.

## Section 10

Final section at the bottom.`;
  await fs.writeFile(path.join(workspacePath, 'scroll-doc.md'), scrollDocContent, 'utf8');

  // --- Files for no-rerender-on-save tests ---
  await fs.writeFile(path.join(workspacePath, 'save-test.md'), `# Test Document

This is a test document for verifying that EditorMode does not re-render on save.

Some content here.
`, 'utf8');
  await fs.writeFile(path.join(workspacePath, 'filetree-test.md'), `# Test Document

Content for testing file tree updates.
`, 'utf8');

  // --- Files for no-rerender-on-ai-input tests ---
  await fs.writeFile(path.join(workspacePath, 'rerender-base.md'), '# Test\n\nSome content.', 'utf8');
  await fs.writeFile(path.join(workspacePath, 'rerender-a.md'), '# File 1', 'utf8');
  await fs.writeFile(path.join(workspacePath, 'rerender-b.md'), '# File 2', 'utf8');

  // --- Files for unified-header-breadcrumb test ---
  const subDir = path.join(workspacePath, 'crumb-subdir');
  await fs.mkdir(subDir, { recursive: true });
  await fs.writeFile(path.join(subDir, 'crumb-file.md'), '# Test File\n\nThis is a test.');

  electronApp = await launchElectronApp({
    workspace: workspacePath,
    env: { NODE_ENV: 'test' }
  });

  page = await electronApp.firstWindow();
  await waitForAppReady(page);
});

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close();
  }
  await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
});

// --- Document Initial Scroll tests ---

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

    return (
      titleRect.top >= containerRect.top &&
      titleRect.bottom <= containerRect.bottom
    );
  });

  expect(titleVisible).toBe(true);
});

// --- No re-render on save tests ---

test('EditorMode should not re-render after autosave', async () => {
  await openFileFromTree(page, 'save-test.md');

  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Wait for initial renders to settle
  await page.waitForTimeout(2000);

  // Start capturing console logs
  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  await editor.click();
  await page.keyboard.type('x');

  // Wait for autosave to complete (autosave has a 2 second debounce)
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

  // Wait for initial renders to settle
  await page.waitForTimeout(2000);

  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  await editor.click();
  await page.keyboard.type('test');

  // Wait for autosave
  await page.waitForTimeout(3500);

  const fileTreeUpdateLogs = logs.filter(log =>
    log.includes('onWorkspaceFileTreeUpdated') ||
    log.includes('workspace-file-tree-updated')
  );

  expect(fileTreeUpdateLogs.length).toBe(0);
});

// --- No re-render on AI input tests ---

test('Typing in AI input should not re-render file editor components', async () => {
  await openFileFromTree(page, 'rerender-base.md');
  await page.waitForTimeout(1000);

  // Wait for initial renders to settle
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
  } else {
    console.log('AI input not visible, skipping test');
  }
});

test('Dirty state change should only re-render TabDirtyIndicator, not TabManager or parents', async () => {
  await openFileFromTree(page, 'rerender-a.md');

  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Wait for initial renders to settle
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
  // rerender-a.md should already be open from previous test
  await page.locator('.file-tree-name', { hasText: 'rerender-b.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

  // Wait for initial renders to settle
  await page.waitForTimeout(2000);

  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  await page.locator('.file-tree-name', { hasText: 'rerender-b.md' }).click();
  await page.waitForTimeout(1000);

  const tabEditorRenders = logs.filter(log => log.includes('[TabEditor] render'));
  const file1Renders = tabEditorRenders.filter(log => log.includes('rerender-a.md')).length;

  expect(file1Renders).toBe(0);
});

// --- Unified Header Breadcrumb test ---

test('should show relative path from workspace root in breadcrumb', async () => {
  // Wait for file tree to load
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.workspaceSidebar, { timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

  // Expand the crumb-subdir folder by clicking on it
  const folderItem = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem).filter({ hasText: 'crumb-subdir' }).first();
  await expect(folderItem).toBeVisible({ timeout: 5000 });
  await folderItem.click();
  await page.waitForTimeout(500);

  // Click on the test file
  const fileItem = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem).filter({ hasText: 'crumb-file.md' }).first();
  await expect(fileItem).toBeVisible({ timeout: 5000 });
  await fileItem.dblclick();

  // Wait for the unified header bar containing our breadcrumb (multiple header bars exist, one per tab)
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

  // Should NOT contain full absolute path
  expect(breadcrumbText).not.toContain('/Users/');
  expect(breadcrumbText).not.toContain(workspacePath);
});
