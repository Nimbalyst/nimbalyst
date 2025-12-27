import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS } from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  trustWorkspaceSmartPermissions,
  dismissTrustToast,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * E2E tests for the Agent Permissions trust UI.
 *
 * Two focused tests:
 * 1. Trust workflow: Trust via toast -> verify trusted state -> verify settings
 * 2. Dismiss toast: Click outside dismisses without trusting
 */

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a test file so the workspace has content
  const testFilePath = path.join(workspaceDir, 'test.md');
  await fs.writeFile(testFilePath, '# Test Document\n\nTest content.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir, permissionMode: 'none' });
  page = await electronApp.firstWindow();

  // Wait for page to load
  await page.waitForLoadState('domcontentloaded');

  // Dismiss API key dialog if it appears
  await dismissAPIKeyDialog(page);

  // Wait for workspace sidebar to be ready
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.workspaceSidebar))
    .toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('trust workflow: trust via toast -> verify trusted state -> verify settings', async () => {
  // 1. Trust toast should appear for new workspace
  const trustToast = page.locator(PLAYWRIGHT_TEST_SELECTORS.trustToast);
  await expect(trustToast).toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

  // 2. Verify Smart Permissions option is available
  const smartPermissionsOption = page.locator(PLAYWRIGHT_TEST_SELECTORS.trustToastSmartPermissions);
  await expect(smartPermissionsOption).toBeVisible();

  // 3. Click Smart Permissions to trust the workspace
  await smartPermissionsOption.click();
  await page.waitForTimeout(500);

  // 4. Toast should dismiss after selection
  await expect(trustToast).not.toBeVisible({ timeout: 3000 });

  // 5. Trust indicator should now show trusted state
  const trustIndicator = page.locator(PLAYWRIGHT_TEST_SELECTORS.trustIndicator);
  await expect(trustIndicator).toBeVisible();
  await expect(trustIndicator).toHaveClass(/trusted/);

  // 6. Click indicator to open menu and verify trusted status
  await trustIndicator.click();
  const trustMenu = page.locator(PLAYWRIGHT_TEST_SELECTORS.trustMenu);
  await expect(trustMenu).toBeVisible();
  await expect(trustMenu).toContainText('Smart Permissions');
  await expect(trustMenu).toContainText('Trusted');

  // 7. Navigate to permissions settings via menu
  await trustMenu.locator('text=Permission settings').click();
  await page.waitForTimeout(500);

  // 8. Verify settings panel shows trusted state and permission mode options
  await expect(page.locator('.permissions-trust-label:has-text("trusted")')).toBeVisible();
  await expect(page.locator('.permissions-section-header:has-text("Permission Mode")')).toBeVisible();

  // 9. Verify Revoke Trust button is available
  await expect(page.locator('.permissions-trust-card button:has-text("Revoke Trust")')).toBeVisible();
});

test('dismiss toast: click outside dismisses without trusting', async () => {
  // 1. Trust toast should appear for new workspace
  const trustToast = page.locator(PLAYWRIGHT_TEST_SELECTORS.trustToast);
  await expect(trustToast).toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

  // 2. Click outside the toast (on the overlay) to dismiss
  const overlay = page.locator(PLAYWRIGHT_TEST_SELECTORS.trustToastOverlay);
  await overlay.click({ position: { x: 10, y: 10 } }); // Click corner of overlay
  await page.waitForTimeout(500);

  // 3. Toast should dismiss
  await expect(trustToast).not.toBeVisible({ timeout: 3000 });

  // 4. Trust indicator should still show UNtrusted state
  const trustIndicator = page.locator(PLAYWRIGHT_TEST_SELECTORS.trustIndicator);
  await expect(trustIndicator).toBeVisible();
  await expect(trustIndicator).toHaveClass(/untrusted/);
});
