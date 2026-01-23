/**
 * Agent Child Session Persistence E2E Test
 *
 * Verifies that when a user selects a child session within a workstream,
 * that selection persists across page refresh.
 *
 * Bug context: activeChildId in workstreamState was not persisting correctly.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
} from '../helpers';
import {
  switchToAgentMode,
  PLAYWRIGHT_TEST_SELECTORS
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

test.describe('Child Session Persistence', () => {
  test.beforeAll(async () => {
    workspacePath = await createTempWorkspace();

    // Create test file before launching app
    await fs.writeFile(
      path.join(workspacePath, 'test.md'),
      '# Test Document\n\nContent.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspacePath,
      permissionMode: 'allow-all'
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

  test('should persist selected child session across page refresh', async () => {
    // Switch to agent mode - this auto-creates a session
    await switchToAgentMode(page);

    // Click "New Session" to create a fresh session for testing
    // (In test mode, no session is auto-selected)
    const newSessionButton = page.locator('button:has-text("New Session")');
    await expect(newSessionButton).toBeVisible({ timeout: 5000 });
    await newSessionButton.click();
    await page.waitForTimeout(1000);

    // Wait for the agent mode UI to be fully loaded
    // Session tab bar should be visible (always shown even for single sessions)
    const sessionTabBar = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabBar);
    await expect(sessionTabBar).toBeVisible({ timeout: 10000 });

    // There should be one session tab initially
    const sessionTabs = sessionTabBar.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabInWorkstream);
    await expect(sessionTabs).toHaveCount(1, { timeout: 5000 });

    // Get the initial session tab and verify it's active
    const firstTab = sessionTabs.first();
    await expect(firstTab).toHaveClass(/active/, { timeout: 3000 });

    // Click the "+" button to create a new child session (converts to workstream)
    const addButton = sessionTabBar.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabNew);
    await expect(addButton).toBeVisible({ timeout: 3000 });
    await addButton.click();

    // Wait for conversion and new child to appear
    await page.waitForTimeout(2000);

    // Should now have 2 session tabs
    await expect(sessionTabs).toHaveCount(2, { timeout: 5000 });

    // Create a third session for more reliable testing
    await addButton.click();
    await page.waitForTimeout(1500);

    // Should now have 3 session tabs in the workstream panel
    await expect(sessionTabs).toHaveCount(3, { timeout: 5000 });

    // BUG FIX VERIFICATION: The workstream should also appear in the session-history-list
    // (left sidebar) with all 3 children visible WITHOUT needing to refresh.
    // This verifies that childCount is updated in the session registry when creating children.
    const sessionHistoryList = page.locator('.session-history-list');
    await expect(sessionHistoryList).toBeVisible({ timeout: 5000 });

    // The workstream should be expanded and show 3 child sessions in the sidebar
    // Child sessions within a workstream have the class .workstream-session-item
    const workstreamChildren = sessionHistoryList.locator('.workstream-session-item');
    // Should have 3 child sessions visible in the sidebar
    await expect(workstreamChildren).toHaveCount(3, { timeout: 5000 });

    // Click the second tab (not the first, not the last) to select it
    const secondTab = sessionTabs.nth(1);
    const secondTabTitle = await secondTab.locator('.session-tab-title').textContent();
    await secondTab.click();
    await page.waitForTimeout(500);

    // Verify the second tab is now active
    await expect(secondTab).toHaveClass(/active/, { timeout: 3000 });

    // Wait for persistence (debounced at 500ms + buffer)
    await page.waitForTimeout(2000);

    // Reload the page
    await page.reload();
    // Don't use waitForAppReady here - it expects workspace sidebar which is hidden in agent mode
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // Wait for app to initialize and auto-restore state

    // The workstream should be AUTO-SELECTED after reload - this is the core bug we're testing
    // DO NOT click on the workstream - the session tab bar should already be visible
    // with all 3 tabs because the workstream state should have been restored
    await expect(sessionTabBar).toBeVisible({ timeout: 10000 });

    // Session tabs should still exist after reload
    const tabsAfterReload = sessionTabBar.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabInWorkstream);
    await expect(tabsAfterReload).toHaveCount(3, { timeout: 5000 });

    // The second tab should still be active
    const activeTab = sessionTabBar.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabActive);
    await expect(activeTab).toBeVisible({ timeout: 5000 });

    // Verify it's the same tab (by title or position)
    if (secondTabTitle) {
      const activeTabTitle = await activeTab.locator('.session-tab-title').textContent();
      expect(activeTabTitle).toBe(secondTabTitle);
    } else {
      // Fallback: verify by position - the nth(1) tab should be active
      const secondTabAfterReload = tabsAfterReload.nth(1);
      await expect(secondTabAfterReload).toHaveClass(/active/, { timeout: 3000 });
    }
  });
});
