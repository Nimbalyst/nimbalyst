import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS } from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  trustWorkspaceSmartPermissions,
  switchToAgentMode,
  submitChatPrompt,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * E2E test for outside path permission checks.
 *
 * Tests that in Smart Permissions mode, when the agent tries to access
 * a file outside the workspace directory, a permission confirmation dialog appears.
 */

// Increase timeout for AI-related tests
test.setTimeout(60000);

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let outsideDir: string;
let outsideFilePath: string;

test.beforeEach(async () => {
  // Create two separate temp directories:
  // 1. workspaceDir - the "project" directory
  // 2. outsideDir - a directory outside the project (simulating /tmp or another project)
  workspaceDir = await createTempWorkspace();
  outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimbalyst-outside-'));

  // Create a test file in the workspace
  const testFilePath = path.join(workspaceDir, 'test.md');
  await fs.writeFile(testFilePath, '# Test Document\n\nTest content.\n', 'utf8');

  // Create a file OUTSIDE the workspace that we'll try to access
  outsideFilePath = path.join(outsideDir, 'secret.txt');
  await fs.writeFile(outsideFilePath, 'This is a secret file outside the workspace.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir, permissionMode: 'none' });
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
  await fs.rm(outsideDir, { recursive: true, force: true }).catch(() => {});
});

test('smart permissions: accessing file outside workspace triggers permission request', async () => {
  // Switch to agent mode
  await switchToAgentMode(page);
  await page.waitForTimeout(1000);

  // Ask the agent to read a file outside the workspace
  // This should trigger a permission request
  await submitChatPrompt(page, `Read the file at ${outsideFilePath} and tell me what it says`);

  // Wait for the permission confirmation dialog to appear
  // The agent will try to use Read or Bash to access the file, which should trigger permission check
  const permissionConfirmation = page.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmation);
  await expect(permissionConfirmation).toBeVisible({ timeout: TEST_TIMEOUTS.VERY_LONG });

  // Verify the dialog shows the correct info
  await expect(permissionConfirmation.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationTitle))
    .toContainText('permission');

  // Verify the command/path is shown
  const commandText = await permissionConfirmation.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationCommand).textContent();
  expect(commandText).toBeTruthy();

  // Verify the action buttons are available
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationDenyButton)).toBeVisible();
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationAllowOnceButton)).toBeVisible();
});
