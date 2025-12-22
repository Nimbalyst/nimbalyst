import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS } from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  trustWorkspaceSmartPermissions,
  switchToAgentMode,
  submitChatPrompt,
  openAgentPermissionsSettings,
  getAllowedUrlPatterns,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * E2E test for WebFetch permission checks.
 *
 * Tests that in Smart Permissions mode, WebFetch requests trigger permission
 * confirmation and that "Always" properly saves the URL pattern.
 */

// Increase timeout for AI-related tests
test.setTimeout(90000);

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

  await page.waitForLoadState('domcontentloaded');
  await dismissAPIKeyDialog(page);

  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.workspaceSidebar))
    .toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

  // Trust with Smart Permissions (not Always Allow)
  await trustWorkspaceSmartPermissions(page);
});

test.afterEach(async () => {
  // Cancel any active AI request to avoid the "AI session running" quit dialog
  try {
    const cancelButton = page.locator('button.ai-cancel-button, [aria-label="Cancel"]');
    if (await cancelButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await cancelButton.click();
      await page.waitForTimeout(500);
    }
  } catch {
    // No cancel button visible, that's fine
  }

  // Force close - use evaluate to set a flag that bypasses the quit confirmation
  try {
    await electronApp.evaluate(async ({ app }) => {
      // Force quit without confirmation
      app.exit(0);
    });
  } catch {
    // App may already be closed
  }

  await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
});

test('webfetch: Allow Always saves pattern and subsequent requests pass without asking', async () => {
  // Switch to agent mode
  await switchToAgentMode(page);
  await page.waitForTimeout(1000);

  // First request: Ask the agent to fetch a web page
  await submitChatPrompt(page, 'Fetch https://example.com and tell me the page title');

  // Wait for the permission confirmation dialog to appear
  const permissionConfirmation = page.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmation);
  await expect(permissionConfirmation).toBeVisible({ timeout: 30000 });

  // Verify the dialog shows WebFetch-related info
  await expect(permissionConfirmation.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationTitle))
    .toContainText('permission');

  // Verify the command/URL is shown
  const commandText = await permissionConfirmation.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationCommand).textContent();
  expect(commandText).toBeTruthy();
  expect(commandText?.toLowerCase()).toContain('example.com');

  // Click "Allow Always" to save the pattern
  const allowAlwaysButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationAllowAlwaysButton);
  await expect(allowAlwaysButton).toBeVisible();
  await allowAlwaysButton.click();

  // Wait for the dialog to close and the request to complete
  await expect(permissionConfirmation).not.toBeVisible({ timeout: 5000 });

  // Wait for the AI to finish responding (look for the response to complete)
  // The AI should successfully fetch example.com now
  await page.waitForTimeout(3000);

  // Second request: Ask to fetch the same domain again - should NOT ask for permission
  await submitChatPrompt(page, 'Fetch https://example.com/about and summarize it');

  // Wait a bit for the request to be processed
  await page.waitForTimeout(5000);

  // The permission dialog should NOT appear this time since we clicked "Allow Always"
  // If it does appear within 3 seconds, the test fails
  const dialogAppeared = await permissionConfirmation.isVisible().catch(() => false);
  expect(dialogAppeared).toBe(false);

  // Navigate to Agent Permissions settings and verify the URL pattern was saved
  await openAgentPermissionsSettings(page);

  // Get all allowed URL patterns from the settings panel
  const allowedPatterns = await getAllowedUrlPatterns(page);
  console.log('Allowed URL patterns:', allowedPatterns);

  // Verify example.com is in the list
  const hasExampleDomain = allowedPatterns.some(pattern =>
    pattern.toLowerCase().includes('example.com')
  );
  expect(hasExampleDomain).toBe(true);
});
