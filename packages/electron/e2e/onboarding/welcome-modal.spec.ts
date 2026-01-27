/**
 * Tests for the welcome/onboarding modal
 * Verifies that first-time users see onboarding flow
 */

import { test, expect, Page, ElectronApplication } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, waitForAppReady } from '../helpers';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Welcome Modal', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspacePath: string;

  test.beforeEach(async () => {
    // Create a fresh temporary workspace for each test
    workspacePath = await createTempWorkspace();
  });

  test.afterEach(async () => {
    // Clean up
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('should show welcome modal on first workspace open', async () => {
    // Launch app with the new workspace
    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Welcome modal should be visible
    const modal = page.locator('.welcome-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Should show welcome step first
    const welcomeStep = page.locator('.welcome-step');
    await expect(welcomeStep).toBeVisible();

    // Should show "Welcome to Nimbalyst" heading
    const heading = page.locator('.welcome-modal-header h2');
    await expect(heading).toHaveText('Welcome to Nimbalyst');

    // Should show progress bar at ~16.67% (step 1 of 6)
    const progressBar = page.locator('.welcome-modal-progress-bar');
    const width = await progressBar.evaluate((el) => el.style.width);
    expect(parseFloat(width)).toBeCloseTo(16.67, 1);
  });

  test('should navigate through onboarding steps', async () => {
    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const heading = page.locator('.welcome-modal-header h2');

    // Click Next to go to Plans Location step
    await page.click('.welcome-modal-button.primary');
    await page.waitForTimeout(500);

    // Should show Plans Location configuration step
    await expect(heading).toHaveText('Configure Plans Location');

    // Click Next to go to Claude Code step
    await page.click('.welcome-modal-button.primary');
    await page.waitForTimeout(500);

    // Should show Claude Code configuration step
    await expect(heading).toHaveText('Configure Claude Code Integration');

    // Click Next to skip Claude Code setup
    await page.click('.welcome-modal-button.primary');
    await page.waitForTimeout(500);

    // Should show first plan step
    await expect(heading).toHaveText('Create Your First Plan');

    // Click Next again
    await page.click('.welcome-modal-button.primary');
    await page.waitForTimeout(500);

    // Should show plan view step
    await expect(heading).toHaveText('Explore the Plan View');

    // Click Next again
    await page.click('.welcome-modal-button.primary');
    await page.waitForTimeout(500);

    // Should show complete step
    await expect(heading).toHaveText('All Set!');
  });

  test('should configure Claude Code integration', async () => {
    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Click Next to go to Plans Location step
    await page.click('.welcome-modal-button.primary');
    await page.waitForTimeout(500);

    // Click Next to go to Claude Code step
    await page.click('.welcome-modal-button.primary');
    await page.waitForTimeout(500);

    // Enable Claude Code integration
    const enableCheckbox = page.locator('input[type="checkbox"]').first();
    await enableCheckbox.check();
    await page.waitForTimeout(300);

    // Two options should be checked by default (track command and CLAUDE.md)
    const checkboxes = page.locator('.claude-code-options input[type="checkbox"]');
    expect(await checkboxes.count()).toBe(2);

    // Click Next to install
    await page.click('.welcome-modal-button.primary');
    await page.waitForTimeout(2000); // Wait for file operations

    // Verify files were created
    const claudeDir = path.join(workspacePath, '.claude', 'commands');
    expect(fs.existsSync(path.join(claudeDir, 'track.md'))).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, 'CLAUDE.md'))).toBe(true);

    // Verify config was saved
    const configPath = path.join(workspacePath, '.nimbalyst', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.claudeCodeIntegration.enabled).toBe(true);
    expect(config.claudeCodeIntegration.trackCommandInstalled).toBe(true);
    expect(config.claudeCodeIntegration.claudeMdConfigured).toBe(true);
  });

  test('should create example plan', async () => {
    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Navigate to first plan step
    await page.click('.welcome-modal-button.primary'); // Welcome -> Plans Location
    await page.waitForTimeout(500);
    await page.click('.welcome-modal-button.primary'); // Plans Location -> Claude Code
    await page.waitForTimeout(500);
    await page.click('.welcome-modal-button.primary'); // Claude Code -> First Plan
    await page.waitForTimeout(500);

    // Click "Create Example Plan" button
    const createExampleButton = page.locator('.plan-option-button').first();
    await createExampleButton.click();
    await page.waitForTimeout(2000); // Wait for file creation

    // Verify example plan was created
    const examplePlanPath = path.join(workspacePath, 'plans', 'example-feature.md');
    expect(fs.existsSync(examplePlanPath)).toBe(true);

    // Verify it has proper frontmatter
    const content = fs.readFileSync(examplePlanPath, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('planStatus:');
    expect(content).toContain('planId: plan-example-feature');
  });

  test('should skip onboarding', async () => {
    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Click Skip Setup button
    await page.click('.welcome-modal-button.secondary');
    await page.waitForTimeout(1000);

    // Modal should be gone
    const modal = page.locator('.welcome-modal-overlay');
    await expect(modal).not.toBeVisible();

    // Config should be saved with onboardingCompleted: true
    const configPath = path.join(workspacePath, '.nimbalyst', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.onboardingCompleted).toBe(true);
  });

  test('should complete onboarding', async () => {
    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Navigate through all steps (now 6 steps total, so 5 clicks to reach complete)
    for (let i = 0; i < 5; i++) {
      await page.click('.welcome-modal-button.primary');
      await page.waitForTimeout(500);
    }

    // Should be on complete step, click "Get Started"
    await page.click('.welcome-modal-button.primary');
    await page.waitForTimeout(1000);

    // Modal should be gone
    const modal = page.locator('.welcome-modal-overlay');
    await expect(modal).not.toBeVisible();

    // Config should be saved
    const configPath = path.join(workspacePath, '.nimbalyst', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.onboardingCompleted).toBe(true);
  });

  test('should not show modal on second workspace open', async () => {
    // First open - complete onboarding
    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
    await page.waitForTimeout(1000);

    // Skip onboarding
    await page.click('.welcome-modal-button.secondary');
    await page.waitForTimeout(1000);

    // Close app
    await electronApp.close();

    // Open app again with same workspace
    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
    await page.waitForTimeout(1000);

    // Modal should NOT be visible
    const modal = page.locator('.welcome-modal-overlay');
    await expect(modal).not.toBeVisible();
  });

  test('should allow going back through steps', async () => {
    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
    await page.waitForTimeout(1000);

    // Go to step 2
    await page.click('.welcome-modal-button.primary');
    await page.waitForTimeout(500);

    const heading = page.locator('.welcome-modal-header h2');
    await expect(heading).toHaveText('Configure Claude Code Integration');

    // Click Back button
    const backButton = page.locator('.welcome-modal-button.secondary').nth(1);
    await backButton.click();
    await page.waitForTimeout(500);

    // Should be back at welcome step
    await expect(heading).toHaveText('Welcome to Nimbalyst');
  });
});
