import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, waitForAppReady } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Agent Mode Menu', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create a test markdown file
    await fs.writeFile(
      path.join(workspaceDir, 'test.md'),
      '# Test Document\n\nThis is a test document.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('Agent Mode menu item should switch to agent mode', async () => {
    // Start in files mode - verify we can see the file tree
    const fileTree = page.locator('.workspace-sidebar');
    await expect(fileTree).toBeVisible({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

    // Click on View menu and then Agent Mode
    // Note: In Electron, we need to trigger the menu via keyboard or IPC
    // For now, let's use the keyboard shortcut which should be Cmd+K
    await page.keyboard.press('Meta+K');
    await page.waitForTimeout(500);

    // Verify agent mode is active
    // The agent mode wrapper should be visible
    const agentModeWrapper = page.locator('[data-layout="agent-mode-wrapper"]');
    await expect(agentModeWrapper).toBeVisible({ timeout: 3000 });

    // The file tree should be hidden in agent mode
    const filesModeWrapper = page.locator('[data-layout="files-mode-wrapper"]');
    await expect(filesModeWrapper).not.toBeVisible();

    // Verify the agent nav button is active
    const agentButton = page.locator('button[aria-label="Agent (Cmd+K)"]');
    await expect(agentButton).toHaveClass(/active/);
  });

  test('Agent Mode should show AgenticPanel when workspace is open', async () => {
    // Switch to agent mode
    await page.keyboard.press('Meta+K');
    await page.waitForTimeout(500);

    // Verify agent mode wrapper is visible
    const agentModeWrapper = page.locator('[data-layout="agent-mode-wrapper"]');
    await expect(agentModeWrapper).toBeVisible();

    // Should show the AgenticPanel, not the "requires workspace" message
    // Check that we don't see the fallback message
    const fallbackMessage = page.locator('text=Agent mode requires a workspace');
    await expect(fallbackMessage).not.toBeVisible();

    // Should see agent-related UI components
    // (Exact selectors depend on AgenticPanel implementation)
  });

  test('Switching back to Files mode should restore file tree', async () => {
    // Switch to agent mode
    await page.keyboard.press('Meta+K');
    await page.waitForTimeout(500);

    // Verify we're in agent mode
    const agentModeWrapper = page.locator('[data-layout="agent-mode-wrapper"]');
    await expect(agentModeWrapper).toBeVisible();

    // Switch back to files mode using Cmd+E
    await page.keyboard.press('Meta+E');
    await page.waitForTimeout(500);

    // Verify we're back in files mode
    const fileTree = page.locator('.workspace-sidebar');
    await expect(fileTree).toBeVisible();

    // Agent mode wrapper should be hidden
    await expect(agentModeWrapper).not.toBeVisible();

    // Verify the files nav button is active
    const filesButton = page.locator('button[aria-label="Files (Cmd+E)"]');
    await expect(filesButton).toHaveClass(/active/);
  });
});
