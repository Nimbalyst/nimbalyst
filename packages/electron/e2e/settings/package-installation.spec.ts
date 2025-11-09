/**
 * E2E tests for Tool Package installation and version detection
 */

import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  // Create workspace
  workspaceDir = await createTempWorkspace();

  // Create a dummy markdown file so workspace loads properly
  await fs.writeFile(path.join(workspaceDir, 'test.md'), '# Test\n\nContent\n', 'utf8');

  // Launch app
  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test.describe('Package Installation', () => {
  test('should show available packages in settings', async () => {
    // Open settings (Cmd+Comma)
    await page.locator("button[aria-label=\"Settings\"]").click();

    // Wait for settings screen to load
    await page.waitForSelector('text=Tool Packages', { timeout: 5000 });

    // Should show both packages
    await expect(page.locator('text=Developer')).toBeVisible();
    await expect(page.locator('text=Product Manager')).toBeVisible();

    // Should show install buttons (not installed yet)
    const installButtons = page.locator('button:has-text("Install")');
    await expect(installButtons).toHaveCount(2);
  });

  test('should install Developer package and detect version', async () => {
    // Open settings
    await page.locator("button[aria-label=\"Settings\"]").click();
    await page.waitForSelector('text=Tool Packages', { timeout: 5000 });

    // Find and click Install button for Developer package
    const developerCard = page.locator('.action-card:has-text("Developer")');
    await expect(developerCard).toBeVisible();

    const installButton = developerCard.locator('button:has-text("Install")');
    await installButton.click();

    // Wait for success message
    await page.waitForSelector('text=installed successfully', { timeout: 10000 });

    // Wait a moment for UI to refresh
    await page.waitForTimeout(1000);

    // Should now show "Installed" status or "Uninstall" button
    await expect(developerCard.locator('button:has-text("Uninstall")')).toBeVisible({ timeout: 5000 });

    // Should show version badge
    await expect(developerCard.locator('text=v1.0.0')).toBeVisible();

    // Verify files were created
    const planCommandPath = path.join(workspaceDir, '.claude/commands/plan.md');
    const trackCommandPath = path.join(workspaceDir, '.claude/commands/track.md');
    const bugSchemaPath = path.join(workspaceDir, '.nimbalyst/trackers/bug.yaml');

    const planCommandExists = await fs.access(planCommandPath).then(() => true).catch(() => false);
    const trackCommandExists = await fs.access(trackCommandPath).then(() => true).catch(() => false);
    const bugSchemaExists = await fs.access(bugSchemaPath).then(() => true).catch(() => false);

    expect(planCommandExists).toBe(true);
    expect(trackCommandExists).toBe(true);
    expect(bugSchemaExists).toBe(true);

    // Verify version metadata in files
    const planContent = await fs.readFile(planCommandPath, 'utf8');
    expect(planContent).toContain('packageVersion: 1.0.0');
    expect(planContent).toContain('packageId: developer');

    const bugContent = await fs.readFile(bugSchemaPath, 'utf8');
    expect(bugContent).toContain('packageVersion: 1.0.0');
    expect(bugContent).toContain('packageId: developer');
  });

  test('should install Product Manager package', async () => {
    // Open settings
    await page.locator("button[aria-label=\"Settings\"]").click();
    await page.waitForSelector('text=Tool Packages', { timeout: 5000 });

    // Find and click Install button for Product Manager package
    const pmCard = page.locator('.action-card:has-text("Product Manager")');
    const installButton = pmCard.locator('button:has-text("Install")');
    await installButton.click();

    // Wait for success message
    await page.waitForSelector('text=installed successfully', { timeout: 10000 });

    // Wait for UI to refresh
    await page.waitForTimeout(1000);

    // Should show uninstall button
    await expect(pmCard.locator('button:has-text("Uninstall")')).toBeVisible({ timeout: 5000 });

    // Verify files were created
    const roadmapCommandPath = path.join(workspaceDir, '.claude/commands/roadmap.md');
    const featureSchemaPath = path.join(workspaceDir, '.nimbalyst/trackers/feature-request.yaml');

    const roadmapExists = await fs.access(roadmapCommandPath).then(() => true).catch(() => false);
    const featureSchemaExists = await fs.access(featureSchemaPath).then(() => true).catch(() => false);

    expect(roadmapExists).toBe(true);
    expect(featureSchemaExists).toBe(true);
  });

  test('should show expand/collapse details', async () => {
    // Open settings
    await page.locator("button[aria-label=\"Settings\"]").click();
    await page.waitForSelector('text=Tool Packages', { timeout: 5000 });

    const developerCard = page.locator('.action-card:has-text("Developer")');

    // Should have "Show details" button
    const showDetailsButton = developerCard.locator('button:has-text("Show details")');
    await expect(showDetailsButton).toBeVisible();

    // Click to expand
    await showDetailsButton.click();

    // Should show command list
    await expect(developerCard.locator('text=/plan')).toBeVisible();
    await expect(developerCard.locator('text=/track')).toBeVisible();
    await expect(developerCard.locator('text=/analyze-code')).toBeVisible();
    await expect(developerCard.locator('text=/write-tests')).toBeVisible();

    // Should show tracker schemas (use more specific selectors to avoid ambiguity)
    const trackerList = developerCard.locator('ul').nth(1); // Second list is tracker schemas
    await expect(trackerList.locator('li', { hasText: 'Bug' })).toBeVisible();
    await expect(trackerList.locator('li', { hasText: 'Task' })).toBeVisible();
    await expect(trackerList.locator('li', { hasText: 'Technical Debt' })).toBeVisible();

    // Should have "Hide details" button now
    await expect(developerCard.locator('button:has-text("Hide details")')).toBeVisible();

    // Click to collapse
    await developerCard.locator('button:has-text("Hide details")').click();

    // Commands should be hidden
    await expect(developerCard.locator('text=/analyze-code')).not.toBeVisible();
  });

  test('should allow uninstalling a package', async () => {
    // First install the package
    await page.locator("button[aria-label=\"Settings\"]").click();
    await page.waitForSelector('text=Tool Packages', { timeout: 5000 });

    const developerCard = page.locator('.action-card:has-text("Developer")');
    await developerCard.locator('button:has-text("Install")').click();
    await page.waitForSelector('text=installed successfully', { timeout: 10000 });

    // Wait for UI to refresh
    await page.waitForTimeout(1000);

    // Verify it's installed by checking for uninstall button
    await expect(developerCard.locator('button:has-text("Uninstall")')).toBeVisible({ timeout: 5000 });

    // Click uninstall button
    const uninstallButton = developerCard.locator('button:has-text("Uninstall")');
    await uninstallButton.click();

    // Wait for success message
    await page.waitForSelector('text=uninstalled successfully', { timeout: 5000 });

    // Should show Install button again
    await expect(developerCard.locator('button:has-text("Install")')).toBeVisible({ timeout: 3000 });

    // Verify files were removed
    const planCommandPath = path.join(workspaceDir, '.claude/commands/plan.md');
    const planCommandExists = await fs.access(planCommandPath).then(() => true).catch(() => false);
    expect(planCommandExists).toBe(false);
  });

  test('should persist installation across app restarts', async () => {
    // Install Developer package
    await page.locator("button[aria-label=\"Settings\"]").click();
    await page.waitForSelector('text=Tool Packages', { timeout: 5000 });

    const developerCard = page.locator('.action-card:has-text("Developer")');
    await developerCard.locator('button:has-text("Install")').click();
    await page.waitForSelector('text=installed successfully', { timeout: 10000 });

    // Close settings
    await page.keyboard.press('Escape');

    // Close and reopen app
    await electronApp.close();
    electronApp = await launchElectronApp({ workspace: workspaceDir, env: { ENABLE_SESSION_RESTORE: '1' } });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Open settings again
    await page.locator("button[aria-label=\"Settings\"]").click();
    await page.waitForSelector('text=Tool Packages', { timeout: 5000 });

    // Should still show as installed (check for uninstall button and version)
    const developerCardAfter = page.locator('.action-card:has-text("Developer")');
    await expect(developerCardAfter.locator('button:has-text("Uninstall")')).toBeVisible({ timeout: 5000 });
    await expect(developerCardAfter.locator('text=v1.0.0')).toBeVisible();
  });

  test('should install multiple packages without conflicts', async () => {
    // Open settings
    await page.locator("button[aria-label=\"Settings\"]").click();
    await page.waitForSelector('text=Tool Packages', { timeout: 5000 });

    // Install Developer package
    const developerCard = page.locator('.action-card:has-text("Developer")');
    await developerCard.locator('button:has-text("Install")').click();
    await page.waitForSelector('text=Developer package installed successfully', { timeout: 5000 });

    // Wait a moment for UI to update
    await page.waitForTimeout(500);

    // Install Product Manager package
    const pmCard = page.locator('.action-card:has-text("Product Manager")');
    await pmCard.locator('button:has-text("Install")').click();
    await page.waitForSelector('text=Product Manager package installed successfully', { timeout: 5000 });

    // Both should show as installed
    await expect(developerCard.locator('button:has-text("Uninstall")')).toBeVisible({ timeout: 5000 });
    await expect(pmCard.locator('button:has-text("Uninstall")')).toBeVisible({ timeout: 5000 });

    // Progress bar should show 2 of 2 installed
    await expect(page.locator('text=2 of 2 packages installed')).toBeVisible();

    // Verify both sets of files exist
    const devPlanPath = path.join(workspaceDir, '.claude/commands/plan.md');
    const pmRoadmapPath = path.join(workspaceDir, '.claude/commands/roadmap.md');

    const devPlanExists = await fs.access(devPlanPath).then(() => true).catch(() => false);
    const pmRoadmapExists = await fs.access(pmRoadmapPath).then(() => true).catch(() => false);

    expect(devPlanExists).toBe(true);
    expect(pmRoadmapExists).toBe(true);

    // Note: Both packages have /plan command - the Product Manager one should overwrite
    const planContent = await fs.readFile(devPlanPath, 'utf8');
    // Should be the Product Manager version (installed last)
    expect(planContent).toContain('packageId: product-manager');
  });
});

test.describe('Version Detection', () => {
  test('should detect installed version correctly', async () => {
    // Manually create a command file with version 0.9.0
    const claudeDir = path.join(workspaceDir, '.claude/commands');
    await fs.mkdir(claudeDir, { recursive: true });

    const oldVersionCommand = `---
packageVersion: 0.9.0
packageId: developer
---

# /plan Command

Old version of the command.
`;

    await fs.writeFile(path.join(claudeDir, 'plan.md'), oldVersionCommand, 'utf8');

    // Create tracker schema with old version
    const trackersDir = path.join(workspaceDir, '.nimbalyst/trackers');
    await fs.mkdir(trackersDir, { recursive: true });

    const oldVersionSchema = `# Package metadata
packageVersion: 0.9.0
packageId: developer

type: bug
displayName: Bug
displayNamePlural: Bugs
icon: bug_report
color: "#dc2626"

modes:
  inline: true
  fullDocument: false
`;

    await fs.writeFile(path.join(trackersDir, 'bug.yaml'), oldVersionSchema, 'utf8');

    // Mark as installed in workspace state (simulate previous installation)
    // This would normally be done by PackageService, but we're simulating it
    const stateUpdate = {
      installedPackages: [
        {
          packageId: 'developer',
          installedAt: new Date().toISOString(),
          enabled: true,
        },
      ],
    };

    // Update workspace state via IPC
    await page.evaluate(async (args) => {
      await (window as any).electronAPI.invoke('workspace:update-state', args.workspacePath, args.update);
    }, { workspacePath: workspaceDir, update: stateUpdate });

    // Open settings
    await page.locator("button[aria-label=\"Settings\"]").click();
    await page.waitForSelector('text=Tool Packages', { timeout: 5000 });

    const developerCard = page.locator('.action-card:has-text("Developer")');

    // Should show installed version 0.9.0
    await expect(developerCard.locator('text=v0.9.0')).toBeVisible({ timeout: 3000 });

    // Should show "Update to v1.0.0" button
    await expect(developerCard.locator('button:has-text("Update to v1.0.0")')).toBeVisible();

    // Should show "Update available" indicator
    await expect(page.locator('text=1 update available')).toBeVisible();
  });

  test('should update package to new version', async () => {
    // Manually create old version files
    const claudeDir = path.join(workspaceDir, '.claude/commands');
    await fs.mkdir(claudeDir, { recursive: true });

    const oldCommand = `---
packageVersion: 0.9.0
packageId: developer
---

# /plan Command

Old version.
`;

    await fs.writeFile(path.join(claudeDir, 'plan.md'), oldCommand, 'utf8');

    // Mark as installed
    const stateUpdate = {
      installedPackages: [
        {
          packageId: 'developer',
          installedAt: new Date().toISOString(),
          enabled: true,
        },
      ],
    };

    await page.evaluate(async (args) => {
      await (window as any).electronAPI.invoke("workspace:update-state", args.workspacePath, args.update);
    }, { workspacePath: workspaceDir, update: stateUpdate });

    // Open settings
    await page.locator("button[aria-label=\"Settings\"]").click();
    await page.waitForSelector('text=Tool Packages', { timeout: 5000 });

    const developerCard = page.locator('.action-card:has-text("Developer")');

    // Click update button
    const updateButton = developerCard.locator('button:has-text("Update to v1.0.0")');
    await updateButton.click();

    // Wait for success message
    await page.waitForSelector('text=installed successfully', { timeout: 5000 });

    // Should now show v1.0.0
    await expect(developerCard.locator('text=v1.0.0')).toBeVisible({ timeout: 3000 });

    // Should show "Installed" status (no update needed)
    await expect(developerCard.locator('button:has-text("Uninstall")')).toBeVisible();

    // Update button should be gone
    await expect(developerCard.locator('button:has-text("Update to")')).not.toBeVisible();

    // Verify file was updated
    const planPath = path.join(claudeDir, 'plan.md');
    const updatedContent = await fs.readFile(planPath, 'utf8');
    expect(updatedContent).toContain('packageVersion: 1.0.0');
    expect(updatedContent).not.toContain('Old version');
  });

  test('should handle missing version gracefully', async () => {
    // Create command without version metadata (old format)
    const claudeDir = path.join(workspaceDir, '.claude/commands');
    await fs.mkdir(claudeDir, { recursive: true });

    const noVersionCommand = `# /plan Command

Command without version metadata.
`;

    await fs.writeFile(path.join(claudeDir, 'plan.md'), noVersionCommand, 'utf8');

    // Mark as installed
    const stateUpdate = {
      installedPackages: [
        {
          packageId: 'developer',
          installedAt: new Date().toISOString(),
          enabled: true,
        },
      ],
    };

    await page.evaluate(async (args) => {
      await (window as any).electronAPI.invoke("workspace:update-state", args.workspacePath, args.update);
    }, { workspacePath: workspaceDir, update: stateUpdate });

    // Open settings
    await page.locator("button[aria-label=\"Settings\"]").click();
    await page.waitForSelector('text=Tool Packages', { timeout: 5000 });

    const developerCard = page.locator('.action-card:has-text("Developer")');

    // Should show as installed (even without version) - check for uninstall button
    await expect(developerCard.locator('button:has-text("Uninstall")')).toBeVisible({ timeout: 5000 });
  });
});
