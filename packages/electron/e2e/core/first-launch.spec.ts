import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, TEST_TIMEOUTS } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

test.describe('First Launch Experience', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let testDataDir: string;

  test.beforeEach(async () => {
    // Create a temp directory for test app data
    testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimbalyst-first-launch-'));

    // Launch with forced first launch mode
    electronApp = await launchElectronApp({
      env: {
        // Force first launch mode for testing
        FORCE_FIRST_LAUNCH: '1',
      }
    });

    // Wait for window to be ready
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await electronApp.close();
    // Clean up test data
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  test('should show AI Models window with Getting Started on first launch', async () => {
    // Verify we're on the AI Models screen
    await expect(page.locator('h2:has-text("AI Provider Configuration")')).toBeVisible({ timeout: TEST_TIMEOUTS.APP_LAUNCH });

    // Verify Getting Started panel is active
    await expect(page.locator('.nav-item.active:has-text("Getting Started")')).toBeVisible();

    // Verify the Getting Started content is visible
    await expect(page.locator('h2:has-text("Getting Started with Nimbalyst")')).toBeVisible();

    // Verify Agents and Models explanation is visible
    await expect(page.locator('text=Understanding Agents and Models')).toBeVisible();

    // Verify Claude Code status section is visible
    await expect(page.locator('text=Claude Code Status')).toBeVisible();
  });

  test('should display Claude Code status', async () => {
    // Wait for AI Models to load
    await expect(page.locator('h2:has-text("AI Provider Configuration")')).toBeVisible({ timeout: TEST_TIMEOUTS.APP_LAUNCH });

    // Wait for status to load (give it time to check installation)
    await page.waitForTimeout(1000);

    // Should show either "ready" or "not ready" status
    const statusElement = page.locator('.claude-code-status');
    await expect(statusElement).toBeVisible();

    // Check for either success or setup needed message
    const hasSuccessMessage = await page.locator('text=Claude Code is ready').count() > 0;
    const hasSetupMessage = await page.locator('text=Claude Code setup needed').count() > 0;

    expect(hasSuccessMessage || hasSetupMessage).toBe(true);
  });

  test('should have navigation to other AI provider panels', async () => {
    // Wait for AI Models to load
    await expect(page.locator('h2:has-text("AI Provider Configuration")')).toBeVisible({ timeout: TEST_TIMEOUTS.APP_LAUNCH });

    // Verify all navigation items exist
    await expect(page.locator('.nav-item:has-text("Getting Started")')).toBeVisible();
    await expect(page.locator('.nav-item .nav-item-title:has-text("Claude Code")')).toBeVisible();
    await expect(page.locator('.nav-item .nav-item-title:text-is("Claude")')).toBeVisible();
    await expect(page.locator('.nav-item .nav-item-title:has-text("OpenAI")')).toBeVisible();
    await expect(page.locator('.nav-item .nav-item-title:has-text("LM Studio")')).toBeVisible();
  });

  test('should be able to navigate between provider panels', async () => {
    // Wait for AI Models to load
    await expect(page.locator('h2:has-text("AI Provider Configuration")')).toBeVisible({ timeout: TEST_TIMEOUTS.APP_LAUNCH });

    // Getting Started should be active by default
    await expect(page.locator('.nav-item.active .nav-item-title:has-text("Getting Started")')).toBeVisible();

    // Click on Claude panel (exact match to avoid "Claude Code")
    await page.locator('.nav-item .nav-item-title:text-is("Claude")').click();
    await page.waitForTimeout(200);

    // Click on Claude Code panel
    await page.locator('.nav-item .nav-item-title:has-text("Claude Code")').click();
    await page.waitForTimeout(200);

    // Navigate back to Getting Started
    await page.locator('.nav-item .nav-item-title:has-text("Getting Started")').click();
    await expect(page.locator('.nav-item.active .nav-item-title:has-text("Getting Started")')).toBeVisible();
  });

  test('should be able to close AI Models window', async () => {
    // Wait for AI Models to load
    await expect(page.locator('h2:has-text("AI Provider Configuration")')).toBeVisible({ timeout: TEST_TIMEOUTS.APP_LAUNCH });

    // Just verify we can close it without errors
    await page.close();
  });

  test('should have Check Again button that refreshes status', async () => {
    // Wait for AI Models to load
    await expect(page.locator('h2:has-text("AI Provider Configuration")')).toBeVisible({ timeout: TEST_TIMEOUTS.APP_LAUNCH });

    // Wait for initial status check
    await page.waitForTimeout(1000);

    // Find the Check Again button (it may be in different states)
    const checkAgainButton = page.locator('button:has-text("Check Again")');

    // Only test if the button is visible (it appears when Claude Code is not installed)
    const buttonCount = await checkAgainButton.count();
    if (buttonCount > 0) {
      await expect(checkAgainButton).toBeVisible();

      // Click the button
      await checkAgainButton.click();

      // Should show loading state briefly
      await page.waitForTimeout(500);

      // Status should still be visible after refresh
      await expect(page.locator('.claude-code-status')).toBeVisible();
    }
  });

  test('should have link to Claude Code documentation', async () => {
    // Wait for AI Models to load
    await expect(page.locator('h2:has-text("AI Provider Configuration")')).toBeVisible({ timeout: TEST_TIMEOUTS.APP_LAUNCH });

    // Wait for status check
    await page.waitForTimeout(1000);

    // The documentation button may only appear when Claude Code is not ready
    const docButton = page.locator('button:has-text("View Claude Code Documentation"), button:has-text("Install Claude Code")');
    const buttonCount = await docButton.count();

    if (buttonCount > 0) {
      await expect(docButton.first()).toBeVisible();
    }
  });
});
