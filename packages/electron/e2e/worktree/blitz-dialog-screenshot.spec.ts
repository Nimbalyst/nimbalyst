/**
 * E2E Test: Blitz Dialog Screenshot
 *
 * Opens the New Blitz dialog and captures a screenshot for UI review.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  switchToAgentMode,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

const screenshotDir = path.resolve(__dirname, '../../../../e2e_test_output/screenshots');
const screenshotPath = path.join(screenshotDir, 'blitz-dialog.png');

async function enableDeveloperWorktrees(app: ElectronApplication, page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.electronAPI.invoke('developer-mode:set', true);
    await window.electronAPI.invoke('developer-features:set', { worktrees: true });
  });

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await dismissAPIKeyDialog(page);
  await waitForWorkspaceReady(page);
}

test.describe('Blitz Dialog Screenshot', () => {
  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    execSync('git init', { cwd: workspaceDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: workspaceDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: workspaceDir, stdio: 'pipe' });

    const testFilePath = path.join(workspaceDir, 'test.md');
    await fs.writeFile(testFilePath, '# Test Document\n\nInitial content.\n', 'utf8');
    execSync('git add .', { cwd: workspaceDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: workspaceDir, stdio: 'pipe' });

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      recordVideo: false,
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await dismissAPIKeyDialog(page);
    await waitForWorkspaceReady(page);
    await enableDeveloperWorktrees(electronApp, page);
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test('captures the New Blitz dialog', async () => {
    await switchToAgentMode(page);

    const sessionHistory = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory);
    await expect(sessionHistory).toBeVisible({ timeout: 10000 });

    const newDropdownButton = page.locator('[data-testid="new-dropdown-button"]');
    await expect(newDropdownButton).toBeVisible({ timeout: 5000 });
    await newDropdownButton.click();

    const newBlitzButton = page.locator('[data-testid="new-blitz-button"]');
    await expect(newBlitzButton).toBeVisible({ timeout: 3000 });
    await newBlitzButton.click();

    const dialogModal = page.locator('.nim-modal');
    await expect(dialogModal).toBeVisible({ timeout: 3000 });

    await fs.mkdir(screenshotDir, { recursive: true });
    await page.waitForTimeout(500);
    await dialogModal.screenshot({ path: screenshotPath });

    console.log('[Blitz Screenshot] Saved to:', screenshotPath);
  });
});
