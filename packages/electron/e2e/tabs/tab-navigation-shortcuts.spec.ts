import { test, expect } from '@playwright/test';
import { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import { launchElectronApp, createTempWorkspace, waitForAppReady, TEST_TIMEOUTS, getKeyboardShortcut } from '../helpers';
import { dismissAPIKeyDialog, waitForWorkspaceReady, PLAYWRIGHT_TEST_SELECTORS } from '../utils/testHelpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  // Create temporary workspace with test files BEFORE launching app
  workspaceDir = await createTempWorkspace();

  const file1Path = path.join(workspaceDir, 'file1.md');
  const file2Path = path.join(workspaceDir, 'file2.md');

  await fs.writeFile(file1Path, '# File 1\n\nContent for file 1.\n', 'utf8');
  await fs.writeFile(file2Path, '# File 2\n\nContent for file 2.\n', 'utf8');

  // NOW launch the app
  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('tab navigation works in both Files and Agent modes', async () => {
  // Capture all console messages
  const consoleLogs: string[] = [];
  page.on('console', msg => {
    consoleLogs.push(msg.text());
    console.log(`[BROWSER] ${msg.text()}`);
  });

  await dismissAPIKeyDialog(page);
  await waitForWorkspaceReady(page);

  // ============================================
  // PART 1: Test tab navigation in Files mode (linear, no wrap)
  // ============================================

  // Open first file
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'file1.md' }).click();
  await page.waitForTimeout(300);

  // Open second file
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'file2.md' }).click();
  await page.waitForTimeout(300);

  // Verify file2 is active
  let activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  console.log('\n>>> Starting state: active tab:', activeTab);
  expect(activeTab).toContain('file2.md');

  // Navigate BACK (Cmd+Option+Left) from file2 -> should go to file1
  // Using IPC directly since Playwright's keyboard.press() doesn't trigger Electron menu accelerators
  console.log('\n>>> Cmd+Option+Left: file2 -> file1');
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('previous-tab');
    }
  });
  await page.waitForTimeout(500);

  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  console.log('>>> AFTER prev-tab, active tab:', activeTab);
  expect(activeTab).toContain('file1.md');
  console.log('✓ Cmd+Option+Left: navigated from file2.md to file1.md');

  // Navigate FORWARD (Cmd+Option+Right) from file1 -> should go to file2
  console.log('\n>>> Cmd+Option+Right: file1 -> file2');
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('next-tab');
    }
  });
  await page.waitForTimeout(500);

  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  console.log('>>> AFTER next-tab, active tab:', activeTab);
  expect(activeTab).toContain('file2.md');
  console.log('✓ Cmd+Option+Right: navigated from file1.md to file2.md');

  // Test that Cmd+Option+Right at the end does NOT wrap
  console.log('\n>>> Cmd+Option+Right at end (should NOT wrap)');
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('next-tab');
    }
  });
  await page.waitForTimeout(500);

  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  console.log('>>> AFTER next-tab (at end), active tab:', activeTab);
  expect(activeTab).toContain('file2.md');
  console.log('✓ no wrap: at end stays on file2.md');

  // ============================================
  // PART 2: Test tab navigation in Agent mode
  // ============================================

  // Switch to Agent mode
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(500);

  // Verify we're in Agent mode by checking for the agent session tabs container
  const agentSessionTabs = page.locator('.ai-session-tabs-container');
  await expect(agentSessionTabs).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });
  console.log('✓ Switched to Agent mode');

  // Try navigating with next-tab in Agent mode
  // This should navigate agent session tabs (not file tabs)
  console.log('\n>>> next-tab in Agent mode (should not affect file tabs)');
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('next-tab');
    }
  });
  await page.waitForTimeout(300);

  // Since we only have one session by default, this shouldn't crash
  // Just verify we're still in Agent mode
  await expect(agentSessionTabs).toBeVisible();
  console.log('✓ Agent mode: next-tab handled without affecting file tabs');

  // ============================================
  // PART 3: Verify file tabs unchanged when returning to Files mode
  // ============================================

  // Switch back to Files mode
  await page.keyboard.press('Meta+e');
  await page.waitForTimeout(500);

  // Verify file2 is still the active tab (unchanged from Agent mode navigation)
  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain('file2.md');
  console.log('✓ Back in Files mode: file2.md is still active (tab nav in Agent mode was properly isolated)');

  // Test file tab navigation one more time to prove it still works
  console.log('\n>>> prev-tab in Files mode (back to file1)');
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.webContents.send('previous-tab');
    }
  });
  await page.waitForTimeout(300);

  activeTab = await page.locator(`${PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer} .tab.active ${PLAYWRIGHT_TEST_SELECTORS.tabTitle}`).textContent();
  expect(activeTab).toContain('file1.md');
  console.log('✓ Files mode (again): prev-tab still works correctly');
});
