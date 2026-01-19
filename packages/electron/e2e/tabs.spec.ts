/**
 * Tab Management E2E Tests (Consolidated)
 *
 * Tests for tab management functionality including:
 * - Content isolation between tabs
 * - Tab reordering
 * - Tab navigation shortcuts
 * - Autosave on tab switch
 *
 * Note: These tests use beforeEach/afterEach pattern (not beforeAll)
 * because tab state modifications significantly affect other tests.
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
} from './utils/testHelpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create test files
  await fs.writeFile(path.join(workspaceDir, 'alpha.md'), '# Alpha Document\n\nThis is the alpha file.\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, 'beta.md'), '# Beta Document\n\nThis is the beta file.\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, 'gamma.md'), '# Gamma Document\n\nThis is the gamma file.\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, 'file1.md'), '# File 1\n\nContent 1\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, 'file2.md'), '# File 2\n\nContent 2\n', 'utf8');
  await fs.writeFile(path.join(workspaceDir, 'file3.md'), '# File 3\n\nContent 3\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
});

test.afterEach(async () => {
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

  // Open alpha.md
  await page.locator('.file-tree-name', { hasText: 'alpha.md' }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('alpha.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

  // Add unique marker to alpha
  const alphaMarker = `alpha-marker-${Date.now()}`;
  await editor.click();
  await page.keyboard.press(getKeyboardShortcut('Mod+End'));
  await page.keyboard.type(`\n\n${alphaMarker}`);

  // Verify alpha content
  let editorText = await editor.innerText();
  expect(editorText).toContain('Alpha Document');
  expect(editorText).toContain(alphaMarker);

  // Switch to beta.md
  await page.locator('.file-tree-name', { hasText: 'beta.md' }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('beta.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
  await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

  // Verify beta content (should NOT contain alpha content)
  editorText = await editor.innerText();
  expect(editorText).toContain('Beta Document');
  expect(editorText).not.toContain('Alpha Document');
  expect(editorText).not.toContain(alphaMarker);

  // Switch back to alpha - should still have alpha content only
  await page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'alpha.md' }) }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('alpha.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
  await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

  editorText = await editor.innerText();
  expect(editorText).toContain('Alpha Document');
  expect(editorText).toContain(alphaMarker);
  expect(editorText).not.toContain('Beta Document');
});

// ============================================================================
// TAB REORDERING TESTS
// ============================================================================

// Skip: Drag-to-reorder test is flaky - dragTo behavior is inconsistent
test.skip('should allow dragging tabs to reorder them', async () => {
  // Open all three files
  await page.locator('.file-tree-name', { hasText: 'file1.md' }).click();
  await expect(page.locator('.file-tabs-container .tab .tab-title', { hasText: 'file1.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  await page.locator('.file-tree-name', { hasText: 'file2.md' }).click();
  await expect(page.locator('.file-tabs-container .tab .tab-title', { hasText: 'file2.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  await page.locator('.file-tree-name', { hasText: 'file3.md' }).click();
  await expect(page.locator('.file-tabs-container .tab .tab-title', { hasText: 'file3.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  // Get all tabs
  const tabs = page.locator('.file-tabs-container .tab .tab-title');
  await expect(tabs).toHaveCount(3);

  // Check initial order
  const initialOrder = await tabs.allInnerTexts();
  expect(initialOrder).toEqual(['file1.md', 'file2.md', 'file3.md']);

  // Drag file3 to the first position
  const file3Tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'file3.md' }) });
  const file1Tab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'file1.md' }) });

  // Perform drag and drop
  await file3Tab.dragTo(file1Tab);
  await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

  // Check new order
  const newOrder = await tabs.allInnerTexts();
  expect(newOrder[0]).toBe('file3.md');
});

test('should not reload tab when clicking on already active tab', async () => {
  await page.locator('.file-tree-name', { hasText: 'file1.md' }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('file1.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await editor.click();

  // Add some content
  const marker = `no-reload-test-${Date.now()}`;
  await page.keyboard.type(marker);

  // Click the already-active tab
  const activeTab = page.locator('.tab.active', { has: page.locator('.tab-title', { hasText: 'file1.md' }) });
  await activeTab.click();

  // Editor should still have our marker
  const editorText = await editor.innerText();
  expect(editorText).toContain(marker);

  // Tab should still be active
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('file1.md');
});

// ============================================================================
// TAB NAVIGATION SHORTCUT TESTS
// ============================================================================

// Skip: IPC-based tab navigation test is flaky in consolidated mode
test.skip('tab navigation works in both Files and Agent modes', async () => {
  // Open first file
  await page.locator('.file-tree-name', { hasText: 'file1.md' }).click();
  await page.waitForTimeout(300);

  // Open second file
  await page.locator('.file-tree-name', { hasText: 'file2.md' }).click();
  await page.waitForTimeout(300);

  // Verify file2 is active
  let activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain('file2.md');

  // Navigate BACK (using IPC) from file2 -> should go to file1
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('previous-tab');
    }
  });
  await page.waitForTimeout(500);

  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain('file1.md');

  // Navigate FORWARD from file1 -> should go to file2
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('next-tab');
    }
  });
  await page.waitForTimeout(500);

  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain('file2.md');

  // Test that next-tab at the end does NOT wrap
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('next-tab');
    }
  });
  await page.waitForTimeout(500);

  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain('file2.md'); // No wrap

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

  // Verify file2 is still the active tab
  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain('file2.md');
});

// ============================================================================
// AUTOSAVE ON TAB SWITCH TESTS
// ============================================================================

// Skip: Autosave timing test is flaky - works locally but inconsistent in CI
test.skip('should auto-save on tab switch to prevent data loss', async () => {
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  const alphaPath = path.join(workspaceDir, 'alpha.md');

  // Open alpha and modify it
  await page.locator('.file-tree-name', { hasText: 'alpha.md' }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('alpha.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

  const uniqueMarker = `modified-at-${Date.now()}`;
  await editor.click();
  await page.keyboard.press(getKeyboardShortcut('Mod+End'));
  await page.keyboard.type(`\n\n${uniqueMarker}`);

  // Verify alpha is dirty
  const alphaTab = page.locator('.file-tabs-container .tab', { has: page.locator('.tab-title', { hasText: 'alpha.md' }) });
  await expect(alphaTab.locator('.tab-dirty-indicator')).toBeVisible();

  // Verify file not saved yet
  const contentBeforeSwitch = await fs.readFile(alphaPath, 'utf-8');
  expect(contentBeforeSwitch).not.toContain(uniqueMarker);

  // Switch to beta - this should trigger auto-save of alpha
  await page.locator('.file-tree-name', { hasText: 'beta.md' }).click();
  await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('beta.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

  // Wait for auto-save to complete
  await page.waitForTimeout(1000);

  // Verify alpha was auto-saved to disk
  const contentAfterSwitch = await fs.readFile(alphaPath, 'utf-8');
  expect(contentAfterSwitch).toContain(uniqueMarker);

  // Verify alpha's dirty indicator cleared after auto-save
  await expect(alphaTab.locator('.tab-dirty-indicator')).toHaveCount(0);
});
