import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, waitForAppReady, TEST_TIMEOUTS } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();
  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();

  // Wait for page to load (we don't need workspace sidebar for settings tests)
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000); // Give app time to initialize
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('should open project settings and show action cards', async () => {
  // Ensure we're in files mode and set sidebarView to settings
  const result = await page.evaluate(() => {
    try {
      if ((window as any).__testHelpers) {
        // Ensure activeMode is 'files' for settings to be visible
        (window as any).__testHelpers.setActiveMode('files');
        (window as any).__testHelpers.setSidebarView('settings');
        return { success: true, mode: (window as any).__testHelpers.getActiveMode(), view: (window as any).__testHelpers.getSidebarView() };
      }
      return { success: false, error: 'no helpers' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
  console.log('Set settings view result:', result);

  // Wait for settings to render
  await page.waitForTimeout(500);

  // Check if settings screen is visible
  const settingsHeader = page.locator('.settings-header h2');
  await expect(settingsHeader).toContainText('Claude Code Setup', { timeout: 5000 });

  // Check that we have action cards
  const actionCards = page.locator('.action-card');
  const cardCount = await actionCards.count();

  // Should have 7 action cards (3 commands + 4 trackers)
  expect(cardCount).toBe(7);

  // Check that Install All button is visible
  const installAllButton = page.locator('.install-all-button');
  await expect(installAllButton).toBeVisible();
  await expect(installAllButton).toContainText('Install All');
});

test('should install /plan command when clicked', async () => {
  // Open settings via test helper
  await page.evaluate(() => {
    (window as any).__testHelpers?.setActiveMode('files');
    (window as any).__testHelpers?.setSidebarView('settings');
  });

  await page.waitForTimeout(500);

  // Find the "Install /plan command" card
  const planCard = page.locator('.action-card', {
    has: page.locator('h4:has-text("Install /plan command")')
  });

  await expect(planCard).toBeVisible();

  // Check that it's not completed initially
  const checkbox = planCard.locator('input[type="checkbox"]');
  await expect(checkbox).not.toBeChecked();

  // Click the Install button
  const installButton = planCard.locator('button:has-text("Install")');
  await expect(installButton).toBeVisible();
  await installButton.click();

  // Wait for success message
  await page.waitForSelector('.settings-message.success', { timeout: 5000 });
  const successMessage = page.locator('.settings-message.success');
  await expect(successMessage).toContainText('Install /plan command completed!');

  // Verify file was actually created (this is the important part)
  const planCommandPath = path.join(workspaceDir, '.claude', 'commands', 'plan.md');

  // Wait for file to exist (gives file system time to sync)
  let fileExists = false;
  for (let i = 0; i < 10; i++) {
    fileExists = await fs.access(planCommandPath).then(() => true).catch(() => false);
    if (fileExists) break;
    await page.waitForTimeout(100);
  }
  expect(fileExists).toBe(true);

  // Verify file content
  const content = await fs.readFile(planCommandPath, 'utf-8');
  expect(content).toContain('Create a new plan document');
  expect(content).toContain('File Naming and Location');

  // UI should eventually update to show completion
  // Note: We already verified the file was created, which is the critical part
  const completedBadge = planCard.locator('.action-completed-badge');
  await expect(completedBadge).toBeVisible({ timeout: 3000 });
  await expect(completedBadge).toContainText('Installed');
});
