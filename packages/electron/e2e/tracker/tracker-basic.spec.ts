/**
 * Basic e2e test for unified tracker system
 */

import { test, expect, Page, ElectronApplication } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Tracker System', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let tempWorkspace: string;

  test.beforeAll(async () => {
    tempWorkspace = await createTempWorkspace();

    // Create a test markdown file with a bug tracker item
    const testFile = path.join(tempWorkspace, 'test.md');
    const testContent = 'Fix authentication bug #bug[id:bug_test123 status:to-do]\n';
    await fs.writeFile(testFile, testContent);

    // Verify file was created
    const exists = await fs.access(testFile).then(() => true).catch(() => false);
    console.log(`Test file created: ${exists}, path: ${testFile}`);
    const fileContent = await fs.readFile(testFile, 'utf-8');
    console.log(`Test file content: "${fileContent}"`);

    electronApp = await launchElectronApp({ workspace: tempWorkspace });

    // Get the first window/page
    const windows = electronApp.windows();
    page = windows.length > 0 ? windows[0] : await electronApp.firstWindow();

    // Wait for app to be ready and initial workspace scan
    await page.waitForTimeout(2000);

    // Open the test file
    const fileTreeItem = page.locator('.file-tree-item').filter({ hasText: 'test.md' });
    await fileTreeItem.waitFor({ state: 'visible', timeout: 10000 });
    await fileTreeItem.click();

    // Wait for the file to load
    await page.waitForTimeout(1000);

    // Wait for the document service to scan and index the file (polls every 2 seconds)
    // Give it plenty of time - wait for at least 3 polling cycles
    await page.waitForTimeout(15000);
  }, 60000); // Increase timeout to 60 seconds

  test.afterAll(async () => {
    await electronApp?.close();
  });

  test('should show bug in bottom tracker panel', async () => {
    // First, open the bottom panel by clicking the plans button in the navigation gutter
    // The button has aria-label "Plans (Cmd+Shift+P)" but displays only an icon
    const plansNavButton = page.locator('.nav-button[aria-label*="Plans"]');
    await plansNavButton.waitFor({ state: 'visible', timeout: 5000 });
    await plansNavButton.click();

    // Wait for bottom panel to appear
    await page.waitForTimeout(1000);

    // Debug: Check what tabs are available
    const allTabs = await page.locator('.bottom-panel-tab').count();
    console.log(`Found ${allTabs} bottom panel tabs`);

    if (allTabs > 0) {
      for (let i = 0; i < allTabs; i++) {
        const tab = page.locator('.bottom-panel-tab').nth(i);
        const text = await tab.textContent();
        console.log(`  Tab ${i}: ${text}`);
      }
    }

    // Look for the Bugs tab in the bottom panel
    const bugsTab = page.locator('.bottom-panel-tab').filter({ hasText: 'Bugs' });

    // Wait for the bugs tab to appear
    await expect(bugsTab).toBeVisible({ timeout: 5000 });

    // Click the bugs tab
    await bugsTab.click();
    await page.waitForTimeout(1000);

    // Verify bottom panel is visible
    const bottomPanel = page.locator('.bottom-panel');
    await expect(bottomPanel).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });

    // Check that the bug count is at least 1
    const tabCount = bugsTab.locator('.tab-count');
    await tabCount.waitFor({ state: 'visible', timeout: 5000 });
    const countText = await tabCount.textContent();
    const count = parseInt(countText || '0');

    console.log(`Bug count in panel: ${count}`);
    expect(count).toBeGreaterThan(0);
    console.log(`✓ Bottom panel shows ${count} bug(s)`);
  });
});
