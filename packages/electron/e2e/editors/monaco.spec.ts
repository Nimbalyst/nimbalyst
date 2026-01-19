/**
 * Monaco Editor E2E Tests (Consolidated)
 *
 * Tests for the Monaco-based code editor including:
 * - Autosave functionality
 * - Dirty close (save on tab close)
 * - External file change detection
 * - AI diff accept
 * - AI diff reject
 * - History integration (edits persist through autosave cycles)
 *
 * This file consolidates tests that previously lived in separate files.
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
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  openFileFromTree,
  closeTabByFileName,
  getTabByFileName,
  openHistoryDialog,
  selectHistoryItem,
  getHistoryItemCount,
} from '../utils/testHelpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

// Selector for the VISIBLE Monaco editor (inside the visible tab wrapper)
const VISIBLE_MONACO_SELECTOR = '.file-tabs-container .tab-editor-wrapper:not([style*="display: none"]) .monaco-code-editor';

/**
 * Helper to get Monaco editor content
 * Uses multiple methods to find the editor content with retry logic
 */
async function getMonacoContent(page: Page, timeout = 5000): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await page.evaluate(() => {
      // Method 1: Try global monaco API
      const monaco = (window as any).monaco;
      const editors = monaco?.editor?.getEditors();
      if (editors && editors.length > 0) {
        return { source: 'monaco-api', content: editors[0].getValue() };
      }

      // Method 2: Try getting from view lines (fallback)
      // Note: view-lines use non-breaking spaces (charCode 160), need to normalize
      const monacoWrapper = document.querySelector('.monaco-code-editor');
      if (monacoWrapper) {
        const lines = monacoWrapper.querySelectorAll('.view-line');
        if (lines.length > 0) {
          const rawContent = Array.from(lines).map(l => l.textContent || '').join('\n');
          // Replace non-breaking spaces with regular spaces
          const normalizedContent = rawContent.replace(/\u00A0/g, ' ');
          return { source: 'view-lines', content: normalizedContent };
        }
      }

      return null;
    });

    if (result !== null && result.content.length > 0) {
      return result.content;
    }

    await page.waitForTimeout(200);
  }

  return '';
}

/**
 * Helper to type in Monaco editor (select all and replace)
 */
async function typeInMonaco(page: Page, text: string): Promise<void> {
  // Focus the Monaco editor
  await page.click(`${VISIBLE_MONACO_SELECTOR} .monaco-editor .view-lines`);
  await page.waitForTimeout(200);

  // Select all and replace
  const isMac = process.platform === 'darwin';
  await page.keyboard.press(isMac ? 'Meta+a' : 'Control+a');
  await page.waitForTimeout(100);

  // Delete selected content first
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);

  // Type new content
  await page.keyboard.type(text, { delay: 5 });
  await page.waitForTimeout(200);
}

/**
 * Helper to wait for dirty indicator to appear then disappear (autosave complete)
 */
async function waitForAutosaveComplete(page: Page, fileName: string): Promise<void> {
  const tab = getTabByFileName(page, fileName);

  // Wait for dirty indicator to appear (file was modified)
  await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Wait for autosave (default 2s interval + debounce + buffer)
  await page.waitForTimeout(3500);

  // Dirty indicator should be gone
  await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .not.toBeVisible({ timeout: 2000 });
}

// Shared app instance for all tests in this file
test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create ALL test files upfront for all scenarios
  await fs.writeFile(
    path.join(workspaceDir, 'autosave-test.ts'),
    '// Original content\nconst x = 1;\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'dirty-close-test.ts'),
    '// Original content\nconst x = 1;\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'external-change-test.ts'),
    '// Original content\nconst x = 1;\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'diff-accept-test.tsx'),
    `function hello() {
  console.log("Original content");
  return true;
}
`,
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'diff-reject-test.tsx'),
    `function hello() {
  console.log("Original content");
  return true;
}
`,
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'history-test.ts'),
    `// Initial content
function hello() {
  console.log("Hello");
}
`,
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
  const tsPath = path.join(workspaceDir, 'autosave-test.ts');
  const marker = `// autosave-marker-${Date.now()}`;

  // Open the TypeScript file
  await openFileFromTree(page, 'autosave-test.ts');

  // Wait for Monaco editor to load
  await page.waitForSelector(VISIBLE_MONACO_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Click in the Monaco editor and type at the end
  await page.click(`${VISIBLE_MONACO_SELECTOR} .monaco-editor .view-lines`);
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(marker, { delay: 5 });

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'autosave-test.ts');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Wait for autosave (2s interval + 200ms debounce + buffer)
  await page.waitForTimeout(3500);

  // Verify dirty indicator cleared
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0, { timeout: 1000 });

  // Verify content saved to disk
  const savedContent = await fs.readFile(tsPath, 'utf-8');
  expect(savedContent).toContain(marker);

  // Close the tab to clean up for next test
  await closeTabByFileName(page, 'autosave-test.ts');
});

test('edited content is saved when tab is closed', async () => {
  const tsPath = path.join(workspaceDir, 'dirty-close-test.ts');
  const marker = `// edited-marker-${Date.now()}`;

  // Open the TypeScript file
  await openFileFromTree(page, 'dirty-close-test.ts');

  // Wait for Monaco editor to load
  await page.waitForSelector(VISIBLE_MONACO_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Click in the Monaco editor and type at the end
  await page.click(`${VISIBLE_MONACO_SELECTOR} .monaco-editor .view-lines`);
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(marker, { delay: 5 });

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'dirty-close-test.ts');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Close the tab using helper (clicks close button, waits for tab to disappear)
  await closeTabByFileName(page, 'dirty-close-test.ts');

  // Wait for save to complete (async save via IPC)
  await page.waitForTimeout(500);

  // Read the file and check the content
  const savedContent = await fs.readFile(tsPath, 'utf-8');

  // Verify the content was saved
  expect(savedContent).toContain(marker);
});

test('external file change auto-reloads when editor is clean', async () => {
  const tsPath = path.join(workspaceDir, 'external-change-test.ts');
  const externalContent = '// Modified externally\nconst y = 2;\n';

  // Open the TypeScript file
  await openFileFromTree(page, 'external-change-test.ts');

  // Wait for Monaco editor to load
  await page.waitForSelector(VISIBLE_MONACO_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify no dirty indicator (editor is clean)
  const tabElement = getTabByFileName(page, 'external-change-test.ts');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0);

  // Verify original content
  const initialContent = await getMonacoContent(page);
  expect(initialContent).toContain('Original content');

  // Modify file externally
  await fs.writeFile(tsPath, externalContent, 'utf8');

  // Wait for file watcher to detect and reload
  await page.waitForTimeout(1500);

  // Verify editor shows new content (no conflict dialog)
  const updatedContent = await getMonacoContent(page);
  expect(updatedContent).toContain('Modified externally');
  expect(updatedContent).not.toContain('Original content');

  // Close the tab to clean up
  await closeTabByFileName(page, 'external-change-test.ts');
});

test('accepting diff applies changes and saves to disk', async () => {
  const tsxPath = path.join(workspaceDir, 'diff-accept-test.tsx');

  // Original content (already written in beforeAll)
  const originalContent = `function hello() {
  console.log("Original content");
  return true;
}
`;

  // Modified content
  const modifiedContent = `function hello() {
  console.log("Modified by AI");
  return false;
}
`;

  // Open the file
  await openFileFromTree(page, 'diff-accept-test.tsx');

  // Wait for Monaco editor to load
  await page.waitForSelector(VISIBLE_MONACO_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify original content loads
  const initialText = await getMonacoContent(page);
  expect(initialText).toContain('Original content');

  // Simulate AI edit:
  // 1. Create a pending history tag
  // 2. Write modified content to disk
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
  }, { filePath: tsxPath, tagId, sessionId, originalContent });

  // Write modified content to disk (triggers file watcher)
  await fs.writeFile(tsxPath, modifiedContent, 'utf8');

  // Wait for file watcher to detect change and show diff
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

  // Verify Monaco is in diff mode
  const hasDiffEditor = await page.evaluate(() => {
    const diffContainer = document.querySelector('.monaco-diff-editor');
    return !!diffContainer;
  });
  expect(hasDiffEditor).toBe(true);

  // Verify unaccepted indicator on tab
  const tabElement = getTabByFileName(page, 'diff-accept-test.tsx');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toBeVisible({ timeout: 2000 });

  // Click "Keep All" to accept the changes
  const acceptButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton);
  await acceptButton.click();
  await page.waitForTimeout(500);

  // Wait for unified diff header to disappear
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 3000 }).catch(() => {
    // Header may disappear quickly
  });

  // Verify unaccepted indicator is gone
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toHaveCount(0, { timeout: 2000 });

  // Verify editor shows modified content
  const finalEditorText = await getMonacoContent(page);
  expect(finalEditorText).toContain('Modified by AI');
  expect(finalEditorText).not.toContain('Original content');

  // Verify the file on disk has the modified content
  const finalContent = await fs.readFile(tsxPath, 'utf-8');
  expect(finalContent).toContain('Modified by AI');

  // Close the tab to clean up
  await closeTabByFileName(page, 'diff-accept-test.tsx');
});

test('rejecting diff reverts to original content', async () => {
  const tsxPath = path.join(workspaceDir, 'diff-reject-test.tsx');

  // Original content (already written in beforeAll)
  const originalContent = `function hello() {
  console.log("Original content");
  return true;
}
`;

  // Modified content
  const modifiedContent = `function hello() {
  console.log("Modified by AI");
  return false;
}
`;

  // Open the file
  await openFileFromTree(page, 'diff-reject-test.tsx');

  // Wait for Monaco editor to load
  await page.waitForSelector(VISIBLE_MONACO_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify original content loads
  const initialText = await getMonacoContent(page);
  expect(initialText).toContain('Original content');

  // Simulate AI edit:
  // 1. Create a pending history tag
  // 2. Write modified content to disk
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
  }, { filePath: tsxPath, tagId, sessionId, originalContent });

  // Write modified content to disk (triggers file watcher)
  await fs.writeFile(tsxPath, modifiedContent, 'utf8');

  // Wait for file watcher to detect change and show diff
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

  // Verify unaccepted indicator on tab
  const tabElement = getTabByFileName(page, 'diff-reject-test.tsx');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toBeVisible({ timeout: 2000 });

  // Click "Revert All" to reject the changes
  const rejectButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffRejectAllButton);
  await rejectButton.click();
  await page.waitForTimeout(500);

  // Wait for unified diff header to disappear
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 3000 }).catch(() => {
    // Header may disappear quickly
  });

  // Verify unaccepted indicator is gone
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabUnacceptedIndicator))
    .toHaveCount(0, { timeout: 2000 });

  // Verify editor shows original content (reverted)
  const finalEditorText = await getMonacoContent(page);
  expect(finalEditorText).toContain('Original content');
  expect(finalEditorText).not.toContain('Modified by AI');

  // Verify the file on disk has the original content (reverted)
  const finalContent = await fs.readFile(tsxPath, 'utf-8');
  expect(finalContent).toContain('Original content');
  expect(finalContent).not.toContain('Modified by AI');

  // Close the tab to clean up
  await closeTabByFileName(page, 'diff-reject-test.tsx');
});

test('user edits persist through autosave and appear in history', async () => {
  const tsPath = path.join(workspaceDir, 'history-test.ts');

  // Open the TypeScript file
  await openFileFromTree(page, 'history-test.ts');

  // Wait for Monaco editor to load
  await page.waitForSelector(VISIBLE_MONACO_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify initial content
  let content = await getMonacoContent(page);
  expect(content).toContain('Initial');

  // Make first edit
  const firstEdit = `// First edit
function hello() {
  console.log("First edit content");
}
`;
  await typeInMonaco(page, firstEdit);

  // Verify edit is in editor
  content = await getMonacoContent(page);
  expect(content).toContain('First');

  // Wait for autosave
  await waitForAutosaveComplete(page, 'history-test.ts');

  // Verify file on disk has the edit
  const diskContent1 = await fs.readFile(tsPath, 'utf8');
  expect(diskContent1).toContain('First edit content');

  // Make second edit (to verify history has multiple entries)
  const secondEdit = `// Second edit
function hello() {
  console.log("Second edit content");
}
`;
  await typeInMonaco(page, secondEdit);

  content = await getMonacoContent(page);
  expect(content).toContain('Second');

  // Wait for autosave
  await waitForAutosaveComplete(page, 'history-test.ts');

  const diskContent2 = await fs.readFile(tsPath, 'utf8');
  expect(diskContent2).toContain('Second edit');

  // Open history and verify we have at least 2 snapshots
  await openHistoryDialog(page);

  const historyCount = await getHistoryItemCount(page);
  expect(historyCount).toBeGreaterThanOrEqual(2);

  // Close history dialog (press Escape)
  await page.keyboard.press('Escape');
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.historyDialog)).not.toBeVisible();

  // Verify current editor still has the latest content
  content = await getMonacoContent(page);
  expect(content).toContain('Second');

  // Close the tab to clean up
  await closeTabByFileName(page, 'history-test.ts');
});
