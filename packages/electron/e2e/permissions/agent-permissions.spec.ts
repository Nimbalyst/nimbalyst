/**
 * E2E tests for the Agent Permissions trust UI.
 *
 * These tests share a single Electron app instance for efficiency.
 * Tests run serially and each uses a separate test file to avoid interference.
 *
 * Two focused tests:
 * 1. Trust workflow: Trust via toast -> verify trusted state -> verify settings
 * 2. Dismiss toast: Click outside dismisses without trusting
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, waitForAppReady, dismissProjectTrustToast } from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  closeTabByFileName,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

// Test file paths
let trustWorkflowFile: string;
let dismissToastFile: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create test files upfront - each test uses a separate file
  trustWorkflowFile = path.join(workspaceDir, 'trust-workflow.md');
  dismissToastFile = path.join(workspaceDir, 'dismiss-toast.md');

  await fs.writeFile(trustWorkflowFile, '# Trust Workflow Test\n\nTest content.\n', 'utf8');
  await fs.writeFile(dismissToastFile, '# Dismiss Toast Test\n\nTest content.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir, permissionMode: 'none' });
  page = await electronApp.firstWindow();

  await waitForAppReady(page);
  await dismissAPIKeyDialog(page);

  // Wait for workspace sidebar to be ready
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.workspaceSidebar))
    .toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
});

test.afterAll(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('trust workflow: trust via toast -> verify trusted state -> verify settings', async () => {
  // 1. Trust toast should appear for new workspace - look for the trust heading
  const trustToast = page.getByRole('heading', { name: /^Trust .+\?$/ });
  await expect(trustToast).toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

  // 2. Verify permission options are available - new UI has Ask, Allow Edits, Allow All
  const allowEditsOption = page.getByRole('button', { name: /Allow Edits/ });
  await expect(allowEditsOption).toBeVisible();

  // 3. Click Allow Edits to trust the workspace
  await allowEditsOption.click();
  await page.waitForTimeout(300);

  // 4. Click Save to confirm
  const saveButton = page.getByRole('button', { name: 'Save' });
  await saveButton.click();
  await page.waitForTimeout(500);

  // 5. Toast should dismiss after selection
  await expect(trustToast).not.toBeVisible({ timeout: 3000 });

  // 6. Trust indicator should now show trusted state (shield icon)
  const trustIndicator = page.getByRole('button', { name: /Allow Edits mode|trusted/i }).first();
  await expect(trustIndicator).toBeVisible({ timeout: 3000 });
});

test('dismiss toast: click Cancel dismisses without trusting', async () => {
  // Revoke trust first so the toast appears again
  await page.evaluate(async (wsDir) => {
    await window.electronAPI.invoke('permissions:revokeWorkspaceTrust', wsDir);
  }, workspaceDir);
  await page.waitForTimeout(500);

  // 1. Trust toast should appear for now-untrusted workspace
  const trustToast = page.getByRole('heading', { name: /^Trust .+\?$/ });
  await expect(trustToast).toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

  // 2. Click "Cancel" button to dismiss without trusting
  const cancelButton = page.getByRole('button', { name: 'Cancel' });
  await cancelButton.click();
  await page.waitForTimeout(500);

  // 3. Toast should dismiss
  await expect(trustToast).not.toBeVisible({ timeout: 3000 });

  // 4. Trust indicator should still show UNtrusted state (gpp_maybe icon)
  const trustIndicator = page.getByRole('button', { name: /not trusted|untrusted/i }).first();
  await expect(trustIndicator).toBeVisible();
});
