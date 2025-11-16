import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  waitForAppReady
} from '../helpers';
import { PLAYWRIGHT_TEST_SELECTORS } from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('File Tree Filtering', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create a variety of test files BEFORE launching the app
    await fs.writeFile(path.join(workspaceDir, 'test.md'), '# Test Markdown\n\nContent.\n', 'utf8');
    await fs.writeFile(path.join(workspaceDir, 'notes.md'), '# Notes\n\nMore content.\n', 'utf8');
    await fs.writeFile(path.join(workspaceDir, 'script.js'), 'console.log("hello");\n', 'utf8');
    await fs.writeFile(path.join(workspaceDir, 'app.ts'), 'const x: number = 42;\n', 'utf8');
    await fs.writeFile(path.join(workspaceDir, 'data.json'), '{"test": true}\n', 'utf8');
    await fs.writeFile(path.join(workspaceDir, 'readme.txt'), 'Plain text file\n', 'utf8');
    await fs.writeFile(path.join(workspaceDir, 'image.png'), Buffer.from('fake-png-data'), 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should filter files and toggle icon visibility', async () => {
    // Verify all files initially visible
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'test.md' })).toBeVisible();
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'script.js' })).toBeVisible();
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'image.png' })).toBeVisible();

    // Test Markdown Only filter
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeFilterButton).click();
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.filterMenuMarkdownOnly).click();
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'test.md' })).toBeVisible();
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'notes.md' })).toBeVisible();
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'script.js' })).toHaveCount(0);
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'app.ts' })).toHaveCount(0);

    // Test Known Files filter
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeFilterButton).click();
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.filterMenuKnownFiles).click();
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'test.md' })).toBeVisible();
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'script.js' })).toBeVisible();
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'readme.txt' })).toBeVisible();
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'image.png' })).toHaveCount(0);

    // Test All Files filter
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeFilterButton).click();
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.filterMenuAllFiles).click();
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'test.md' })).toBeVisible();
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'script.js' })).toBeVisible();
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'image.png' })).toBeVisible();

    // Test icon visibility toggle
    const fileTreeItem = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'test.md' }).first();
    const iconBefore = fileTreeItem.locator('.material-symbols-outlined');
    const iconCountBefore = await iconBefore.count();

    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeFilterButton).click();
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.filterMenuShowIcons).click();
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    expect(await iconBefore.count()).not.toBe(iconCountBefore);

    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeFilterButton).click();
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.filterMenuShowIcons).click();
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    expect(await iconBefore.count()).toBe(iconCountBefore);
  });

  test('should persist filter settings after closing and reopening app', async () => {
    // Set filter to Markdown Only
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeFilterButton).click();
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.filterMenuMarkdownOnly).click();
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'test.md' })).toBeVisible();
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'script.js' })).toHaveCount(0);

    // Close and reopen
    await electronApp.close();
    await new Promise(resolve => setTimeout(resolve, 1500));

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
    await page.waitForTimeout(2000);

    // Verify filter persisted
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'test.md' })).toBeVisible();
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'script.js' })).toHaveCount(0);
  });
});
