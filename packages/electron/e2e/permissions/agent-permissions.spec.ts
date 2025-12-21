import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * E2E tests for the Agent Permissions system.
 *
 * Tests the following features:
 * 1. Trust Indicator in Navigation Gutter
 * 2. Permission Settings Panel
 * 3. Workspace trust management
 * 4. Permission mode switching
 */

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a test file so the workspace has content
  const testFilePath = path.join(workspaceDir, 'test.md');
  await fs.writeFile(testFilePath, '# Test Document\n\nTest content.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();

  // Wait for page to load
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test.describe('Trust Indicator', () => {
  test('should display trust indicator in navigation gutter', async () => {
    // Trust indicator should be visible in nav-settings section
    const trustIndicator = page.locator('.trust-indicator');
    await expect(trustIndicator).toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
  });

  test('should show untrusted status initially', async () => {
    // By default, workspace should not be trusted
    const trustIndicator = page.locator('.trust-indicator');
    await expect(trustIndicator).toHaveClass(/untrusted/);
  });

  test('should open menu when clicked', async () => {
    const trustIndicator = page.locator('.trust-indicator');
    await trustIndicator.click();

    // Menu should appear
    const trustMenu = page.locator('.trust-menu');
    await expect(trustMenu).toBeVisible();

    // Should show "Agent Permissions" title
    const menuTitle = trustMenu.locator('.trust-menu-title');
    await expect(menuTitle).toContainText('Agent Permissions');

    // Should show "Untrusted" badge
    const statusBadge = trustMenu.locator('.trust-status-badge');
    await expect(statusBadge).toContainText('Untrusted');
  });

  test('should trust workspace when clicking trust button', async () => {
    const trustIndicator = page.locator('.trust-indicator');
    await trustIndicator.click();

    // Click "Trust this workspace" button
    const trustButton = page.locator('.trust-menu-action:has-text("Trust this workspace")');
    await trustButton.click();

    // Wait for state update
    await page.waitForTimeout(500);

    // Re-open menu to verify status changed
    await trustIndicator.click();
    const statusBadge = page.locator('.trust-menu .trust-status-badge');
    await expect(statusBadge).not.toContainText('Untrusted');
  });

  test('should navigate to permissions settings when clicking settings button', async () => {
    const trustIndicator = page.locator('.trust-indicator');
    await trustIndicator.click();

    // Click "Permission settings" button
    const settingsButton = page.locator('.trust-menu-action:has-text("Permission settings")');
    await settingsButton.click();

    // Wait for settings to open
    await page.waitForTimeout(500);

    // Should now be in settings mode with agent-permissions panel
    const settingsView = page.locator('.settings-view');
    await expect(settingsView).toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Should show Agent Permissions heading
    const permissionsHeader = page.locator('.settings-panel-header h2:has-text("Agent Permissions")');
    await expect(permissionsHeader).toBeVisible();
  });
});

test.describe('Permissions Settings Panel', () => {
  async function navigateToPermissionsSettings() {
    const trustIndicator = page.locator('.trust-indicator');
    await trustIndicator.click();
    const settingsButton = page.locator('.trust-menu-action:has-text("Permission settings")');
    await settingsButton.click();
    await page.waitForTimeout(500);
  }

  test('should show workspace trust section', async () => {
    await navigateToPermissionsSettings();

    // Should show Workspace Trust section
    const trustSection = page.locator('.permissions-section-header:has-text("Workspace Trust")');
    await expect(trustSection).toBeVisible();

    // Should show "not trusted" message
    const untrustedLabel = page.locator('.permissions-trust-label:has-text("not trusted")');
    await expect(untrustedLabel).toBeVisible();
  });

  test('should show Trust Workspace button when untrusted', async () => {
    await navigateToPermissionsSettings();

    const trustButton = page.locator('.permissions-trust-card button:has-text("Trust Workspace")');
    await expect(trustButton).toBeVisible();
  });

  test('should trust workspace from settings panel', async () => {
    await navigateToPermissionsSettings();

    // Click Trust Workspace button
    const trustButton = page.locator('.permissions-trust-card button:has-text("Trust Workspace")');
    await trustButton.click();

    // Wait for success message
    await page.waitForTimeout(500);

    // Should now show trusted state
    const trustedLabel = page.locator('.permissions-trust-label:has-text("trusted")');
    await expect(trustedLabel).toBeVisible();

    // Should show Revoke Trust button
    const revokeButton = page.locator('.permissions-trust-card button:has-text("Revoke Trust")');
    await expect(revokeButton).toBeVisible();
  });

  test('should show permission mode options when trusted', async () => {
    await navigateToPermissionsSettings();

    // Trust the workspace first
    const trustButton = page.locator('.permissions-trust-card button:has-text("Trust Workspace")');
    await trustButton.click();
    await page.waitForTimeout(500);

    // Should show Permission Mode section
    const modeSection = page.locator('.permissions-section-header:has-text("Permission Mode")');
    await expect(modeSection).toBeVisible();

    // Should show both radio options
    const askOption = page.locator('.permissions-mode-option-title:has-text("Smart Permissions")');
    await expect(askOption).toBeVisible();

    const allowAllOption = page.locator('.permissions-mode-option-title:has-text("Allow all")');
    await expect(allowAllOption).toBeVisible();
  });

  test('should switch permission mode', async () => {
    await navigateToPermissionsSettings();

    // Trust workspace
    const trustButton = page.locator('.permissions-trust-card button:has-text("Trust Workspace")');
    await trustButton.click();
    await page.waitForTimeout(500);

    // Default should be "Smart Permissions"
    const askRadio = page.locator('input[value="ask"]');
    await expect(askRadio).toBeChecked();

    // Click "Allow all" option
    const allowAllLabel = page.locator('.permissions-mode-option:has-text("Allow all")');
    await allowAllLabel.click();
    await page.waitForTimeout(500);

    // Should now have allow-all selected
    const allowAllRadio = page.locator('input[value="allow-all"]');
    await expect(allowAllRadio).toBeChecked();
  });

  test('should show Additional Directories section when trusted', async () => {
    await navigateToPermissionsSettings();

    // Trust workspace
    const trustButton = page.locator('.permissions-trust-card button:has-text("Trust Workspace")');
    await trustButton.click();
    await page.waitForTimeout(500);

    // Should show Additional Directories section
    const dirsSection = page.locator('.permissions-section-header:has-text("Additional Directories")');
    await expect(dirsSection).toBeVisible();

    // Should show Add Directory button
    const addDirButton = page.locator('.permissions-add-directory-btn');
    await expect(addDirButton).toBeVisible();
  });

  test('should revoke trust', async () => {
    await navigateToPermissionsSettings();

    // Trust workspace
    const trustButton = page.locator('.permissions-trust-card button:has-text("Trust Workspace")');
    await trustButton.click();
    await page.waitForTimeout(500);

    // Click Revoke Trust
    const revokeButton = page.locator('.permissions-trust-card button:has-text("Revoke Trust")');
    await revokeButton.click();
    await page.waitForTimeout(500);

    // Should now show untrusted state
    const untrustedLabel = page.locator('.permissions-trust-label:has-text("not trusted")');
    await expect(untrustedLabel).toBeVisible();

    // Permission Mode section should be hidden
    const modeSection = page.locator('.permissions-section-header:has-text("Permission Mode")');
    await expect(modeSection).not.toBeVisible();
  });
});

test.describe('Trust Indicator State Sync', () => {
  test('should update trust indicator when trust changes in settings', async () => {
    // Initially untrusted
    const trustIndicator = page.locator('.trust-indicator');
    await expect(trustIndicator).toHaveClass(/untrusted/);

    // Navigate to settings and trust
    await trustIndicator.click();
    const settingsButton = page.locator('.trust-menu-action:has-text("Permission settings")');
    await settingsButton.click();
    await page.waitForTimeout(500);

    const trustButton = page.locator('.permissions-trust-card button:has-text("Trust Workspace")');
    await trustButton.click();
    await page.waitForTimeout(1000);

    // Go back to files mode
    await page.evaluate(() => {
      (window as any).__testHelpers?.setActiveMode('files');
    });
    await page.waitForTimeout(500);

    // Trust indicator should now show trusted state
    const updatedIndicator = page.locator('.trust-indicator');
    await expect(updatedIndicator).toHaveClass(/trusted/);
  });
});
