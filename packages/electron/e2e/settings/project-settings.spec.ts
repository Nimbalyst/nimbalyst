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

  // Should have 6 action cards (2 commands + 4 trackers)
  expect(cardCount).toBe(6);

  // Check that Install All button is visible
  const installAllButton = page.locator('.install-all-button');
  await expect(installAllButton).toBeVisible();
  await expect(installAllButton).toContainText('Install All');
});

