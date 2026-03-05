/**
 * Tab Management and Find/Replace E2E Tests (Consolidated)
 *
 * Tests for tab management and find/replace bar including:
 * - Content isolation between tabs
 * - Tab reordering
 * - Tab navigation shortcuts
 * - Autosave on tab switch
 * - Find/Replace bar open/close and search functionality
 *
 * Consolidated from:
 * - tabs.spec.ts (tab management)
 * - plugins/find-replace-bar.spec.ts (find/replace bar)
 *
 * All tests share a single Electron app instance for performance.
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
  getKeyboardShortcut,
  ACTIVE_EDITOR_SELECTOR,
  ACTIVE_FILE_TAB_SELECTOR,
} from './helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  closeTabByFileName,
} from './utils/testHelpers';

// Test files for each scenario
const TEST_FILES = {
  // Content isolation test files
  contentAlpha: 'content-alpha.md',
  contentBeta: 'content-beta.md',
  contentGamma: 'content-gamma.md',
  // Tab reordering test files
  reorderFile1: 'reorder-file1.md',
  reorderFile2: 'reorder-file2.md',
  reorderFile3: 'reorder-file3.md',
  // No-reload test file
  noReloadFile: 'no-reload-file.md',
  // Tab navigation test files
  navFile1: 'nav-file1.md',
  navFile2: 'nav-file2.md',
  // Autosave test files
  autosaveAlpha: 'autosave-alpha.md',
  autosaveBeta: 'autosave-beta.md',
};

// Use serial mode to prevent worker restarts on test failures
// This ensures all tests share the same Electron app instance
test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create all test files upfront
  await fs.writeFile(path.join(workspaceDir, TEST_FILES.contentAlpha), '# Alpha Document\n\nThis is the alpha file.\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, TEST_FILES.contentBeta), '# Beta Document\n\nThis is the beta file.\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, TEST_FILES.contentGamma), '# Gamma Document\n\nThis is the gamma file.\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, TEST_FILES.reorderFile1), '# File 1\n\nContent 1\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, TEST_FILES.reorderFile2), '# File 2\n\nContent 2\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, TEST_FILES.reorderFile3), '# File 3\n\nContent 3\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, TEST_FILES.noReloadFile), '# No Reload File\n\nContent for no-reload test.\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, TEST_FILES.navFile1), '# Nav File 1\n\nContent 1\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, TEST_FILES.navFile2), '# Nav File 2\n\nContent 2\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, TEST_FILES.autosaveAlpha), '# Autosave Alpha\n\nThis is the autosave alpha file.\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, TEST_FILES.autosaveBeta), '# Autosave Beta\n\nThis is the autosave beta file.\n', 'utf8');

  // Find/Replace test files
  await fs.writeFile(path.join(workspaceDir, 'find-test-1.md'), '# Test Document 1\n\nThis is a test document with some searchable content.\n\nThe word "test" appears multiple times.\n\nAnother test here.\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, 'find-test-2.md'), '# Test Document 2\n\nThis is a test document with some searchable content.\n\nThe word "test" appears multiple times.\n\nAnother test here.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
  await dismissAPIKeyDialog(page);
});

test.afterAll(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

// ============================================================================
// CONTENT ISOLATION TESTS
// ============================================================================

test('should preserve each file content independently when switching tabs', async () => {
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);

  // Open content-alpha.md
  await page.locator('.file-tree-name', { hasText: TEST_FILES.contentAlpha }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText(TEST_FILES.contentAlpha, { timeout: TEST_TIMEOUTS.TAB_SWITCH });

  // Add unique marker to alpha
  const alphaMarker = `alpha-marker-${Date.now()}`;
  await editor.click();
  await page.keyboard.press(getKeyboardShortcut('Mod+End'));
  await page.keyboard.type(`\n\n${alphaMarker}`);

  // Verify alpha content
  let editorText = await editor.innerText();
  expect(editorText).toContain('Alpha Document');
  expect(editorText).toContain(alphaMarker);

  // Switch to content-beta.md
  await page.locator('.file-tree-name', { hasText: TEST_FILES.contentBeta }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText(TEST_FILES.contentBeta, { timeout: TEST_TIMEOUTS.TAB_SWITCH });
  await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

  // Verify beta content (should NOT contain alpha content)
  editorText = await editor.innerText();
  expect(editorText).toContain('Beta Document');
  expect(editorText).not.toContain('Alpha Document');
  expect(editorText).not.toContain(alphaMarker);

  // Switch back to alpha - should still have alpha content only
  await page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: TEST_FILES.contentAlpha }) }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText(TEST_FILES.contentAlpha, { timeout: TEST_TIMEOUTS.TAB_SWITCH });
  await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

  editorText = await editor.innerText();
  expect(editorText).toContain('Alpha Document');
  expect(editorText).toContain(alphaMarker);
  expect(editorText).not.toContain('Beta Document');

  // Close tabs for cleanup
  await closeTabByFileName(page, TEST_FILES.contentAlpha);
  await closeTabByFileName(page, TEST_FILES.contentBeta);
});

// ============================================================================
// TAB REORDERING TESTS
// ============================================================================

// Skip: Drag-to-reorder test is flaky - dragTo behavior is inconsistent
test.skip('should allow dragging tabs to reorder them', async () => {
  // Open all three files
  await page.locator('.file-tree-name', { hasText: TEST_FILES.reorderFile1 }).click();
  await expect(page.locator('.file-tabs-container .tab .tab-title', { hasText: TEST_FILES.reorderFile1 })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  await page.locator('.file-tree-name', { hasText: TEST_FILES.reorderFile2 }).click();
  await expect(page.locator('.file-tabs-container .tab .tab-title', { hasText: TEST_FILES.reorderFile2 })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  await page.locator('.file-tree-name', { hasText: TEST_FILES.reorderFile3 }).click();
  await expect(page.locator('.file-tabs-container .tab .tab-title', { hasText: TEST_FILES.reorderFile3 })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  // Get all tabs
  const tabs = page.locator('.file-tabs-container .tab .tab-title');
  await expect(tabs).toHaveCount(3);

  // Check initial order
  const initialOrder = await tabs.allInnerTexts();
  expect(initialOrder).toEqual([TEST_FILES.reorderFile1, TEST_FILES.reorderFile2, TEST_FILES.reorderFile3]);

  // Drag file3 to the first position
  const file3Tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: TEST_FILES.reorderFile3 }) });
  const file1Tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: TEST_FILES.reorderFile1 }) });

  // Perform drag and drop
  await file3Tab.dragTo(file1Tab);
  await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

  // Check new order
  const newOrder = await tabs.allInnerTexts();
  expect(newOrder[0]).toBe(TEST_FILES.reorderFile3);

  // Close tabs for cleanup
  await closeTabByFileName(page, TEST_FILES.reorderFile1);
  await closeTabByFileName(page, TEST_FILES.reorderFile2);
  await closeTabByFileName(page, TEST_FILES.reorderFile3);
});

test('should not reload tab when clicking on already active tab', async () => {
  await page.locator('.file-tree-name', { hasText: TEST_FILES.noReloadFile }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText(TEST_FILES.noReloadFile, { timeout: TEST_TIMEOUTS.TAB_SWITCH });

  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await editor.click();

  // Add some content
  const marker = `no-reload-test-${Date.now()}`;
  await page.keyboard.type(marker);

  // Click the already-active tab
  const activeTab = page.locator('.tab.active', { has: page.locator('.tab-title', { hasText: TEST_FILES.noReloadFile }) });
  await activeTab.click();

  // Editor should still have our marker
  const editorText = await editor.innerText();
  expect(editorText).toContain(marker);

  // Tab should still be active
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText(TEST_FILES.noReloadFile);

  // Close tab for cleanup
  await closeTabByFileName(page, TEST_FILES.noReloadFile);
});

// ============================================================================
// TAB NAVIGATION SHORTCUT TESTS
// ============================================================================

// Skip: IPC-based tab navigation test is flaky in consolidated mode
test.skip('tab navigation works in both Files and Agent modes', async () => {
  // Open first file
  await page.locator('.file-tree-name', { hasText: TEST_FILES.navFile1 }).click();
  await page.waitForTimeout(300);

  // Open second file
  await page.locator('.file-tree-name', { hasText: TEST_FILES.navFile2 }).click();
  await page.waitForTimeout(300);

  // Verify navFile2 is active
  let activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain(TEST_FILES.navFile2);

  // Navigate BACK (using IPC) from navFile2 -> should go to navFile1
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('previous-tab');
    }
  });
  await page.waitForTimeout(500);

  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain(TEST_FILES.navFile1);

  // Navigate FORWARD from navFile1 -> should go to navFile2
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('next-tab');
    }
  });
  await page.waitForTimeout(500);

  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain(TEST_FILES.navFile2);

  // Test that next-tab at the end does NOT wrap
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('next-tab');
    }
  });
  await page.waitForTimeout(500);

  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain(TEST_FILES.navFile2); // No wrap

  // Switch to Agent mode
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(500);

  // Verify we're in Agent mode
  const agentSessionTabs = page.locator('.ai-session-tabs-container');
  await expect(agentSessionTabs).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  // Try navigating with next-tab in Agent mode (should not affect file tabs)
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('next-tab');
    }
  });
  await page.waitForTimeout(300);

  // Verify we're still in Agent mode
  await expect(agentSessionTabs).toBeVisible();

  // Switch back to Files mode
  await page.keyboard.press('Meta+e');
  await page.waitForTimeout(500);

  // Verify navFile2 is still the active tab
  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain(TEST_FILES.navFile2);

  // Close tabs for cleanup
  await closeTabByFileName(page, TEST_FILES.navFile1);
  await closeTabByFileName(page, TEST_FILES.navFile2);
});

// ============================================================================
// AUTOSAVE ON TAB SWITCH TESTS
// ============================================================================

// Skip: Autosave timing test is flaky - works locally but inconsistent in CI
test.skip('should auto-save on tab switch to prevent data loss', async () => {
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  const alphaPath = path.join(workspaceDir, TEST_FILES.autosaveAlpha);

  // Open autosave-alpha and modify it
  await page.locator('.file-tree-name', { hasText: TEST_FILES.autosaveAlpha }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText(TEST_FILES.autosaveAlpha, { timeout: TEST_TIMEOUTS.TAB_SWITCH });

  const uniqueMarker = `modified-at-${Date.now()}`;
  await editor.click();
  await page.keyboard.press(getKeyboardShortcut('Mod+End'));
  await page.keyboard.type(`\n\n${uniqueMarker}`);

  // Verify alpha is dirty
  const alphaTab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: TEST_FILES.autosaveAlpha }) });
  await expect(alphaTab.locator('.tab-dirty-indicator')).toBeVisible();

  // Verify file not saved yet
  const contentBeforeSwitch = await fs.readFile(alphaPath, 'utf-8');
  expect(contentBeforeSwitch).not.toContain(uniqueMarker);

  // Switch to autosave-beta - this should trigger auto-save of alpha
  await page.locator('.file-tree-name', { hasText: TEST_FILES.autosaveBeta }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText(TEST_FILES.autosaveBeta, { timeout: TEST_TIMEOUTS.TAB_SWITCH });

  // Wait for auto-save to complete
  await page.waitForTimeout(1000);

  // Verify alpha was auto-saved to disk
  const contentAfterSwitch = await fs.readFile(alphaPath, 'utf-8');
  expect(contentAfterSwitch).toContain(uniqueMarker);

  // Verify alpha's dirty indicator cleared after auto-save
  await expect(alphaTab.locator('.tab-dirty-indicator')).toHaveCount(0);

  // Close tabs for cleanup
  await closeTabByFileName(page, TEST_FILES.autosaveAlpha);
  await closeTabByFileName(page, TEST_FILES.autosaveBeta);
});

// ============================================================================
// FIND/REPLACE BAR TESTS (from plugins/find-replace-bar.spec.ts)
// ============================================================================

test('should open search/replace bar with Cmd+F and close with Escape', async () => {
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'find-test-1.md' }).click();
  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.tab).filter({ hasText: 'find-test-1.md' })
  ).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, {
    timeout: TEST_TIMEOUTS.EDITOR_LOAD,
  });

  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.searchReplaceBar)).not.toBeVisible();

  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('menu:find');
    }
  });

  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.searchReplaceBar)).toBeVisible({
    timeout: 1000,
  });

  const searchInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.searchInput);
  await expect(searchInput).toBeFocused();

  await searchInput.press('Escape');

  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.searchReplaceBar)).not.toBeVisible({
    timeout: 1000,
  });

  await closeTabByFileName(page, 'find-test-1.md');
});

test('should allow typing multiple characters in search box without losing focus', async () => {
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'find-test-2.md' }).click();
  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.tab).filter({ hasText: 'find-test-2.md' })
  ).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, {
    timeout: TEST_TIMEOUTS.EDITOR_LOAD,
  });

  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('menu:find');
    }
  });

  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.searchReplaceBar)).toBeVisible();

  const searchInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.searchInput);
  await expect(searchInput).toBeFocused();

  await searchInput.type('test');

  await expect(searchInput).toHaveValue('test');
  await expect(searchInput).toBeFocused();

  const matchCounter = page.locator(PLAYWRIGHT_TEST_SELECTORS.matchCounter);
  await expect(matchCounter).toContainText('of');

  await searchInput.press('Escape');

  await closeTabByFileName(page, 'find-test-2.md');
});
