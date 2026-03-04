/**
 * Mode Switching E2E Tests
 *
 * Consolidated from:
 * - agent-mode-menu.spec.ts (Agent mode menu switching, Cmd+K/Cmd+E)
 * - bottom-panel-mode-switching.spec.ts (Bottom panel layout stability during mode switches)
 *
 * All tests share a single Electron app instance for performance.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, waitForAppReady } from '../helpers';
import { openFileFromTree, switchToAgentMode, PLAYWRIGHT_TEST_SELECTORS } from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  await fs.writeFile(
    path.join(workspaceDir, 'test.md'),
    '# Test Document\n\nThis is a test document with some content.\n',
    'utf8'
  );

  electronApp = await launchElectronApp({
    workspace: workspaceDir,
    env: { NODE_ENV: 'test' }
  });

  page = await electronApp.firstWindow();
  await waitForAppReady(page);
});

test.afterAll(async () => {
  await electronApp?.close();
  await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
});

// --- Agent Mode Menu tests ---

test('Agent Mode button should switch to agent mode', async () => {
  // Start in files mode - verify we can see the file tree
  const fileTree = page.locator('.workspace-sidebar');
  await expect(fileTree).toBeVisible({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

  // Click the Agent button to switch
  await switchToAgentMode(page);

  // Verify agent mode is active
  const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
  await expect(agentMode).toBeVisible({ timeout: 3000 });

  // The file tree should be hidden in agent mode
  const sidebar = page.locator(PLAYWRIGHT_TEST_SELECTORS.workspaceSidebar);
  await expect(sidebar).not.toBeVisible();

  // Verify the agent nav button is pressed
  const agentBtn = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentModeButton);
  await expect(agentBtn).toHaveAttribute('aria-pressed', 'true');
});

test('Agent Mode should show AgenticPanel when workspace is open', async () => {
  // Should still be in agent mode from previous test
  await switchToAgentMode(page);

  const agentModeWrapper = page.locator('[data-layout="agent-mode-wrapper"]');
  await expect(agentModeWrapper).toBeVisible();

  // Should show the AgenticPanel, not the "requires workspace" message
  const fallbackMessage = page.locator('text=Agent mode requires a workspace');
  await expect(fallbackMessage).not.toBeVisible();
});

test('Switching back to Files mode should restore file tree', async () => {
  // Ensure we start in agent mode
  await switchToAgentMode(page);

  const agentModeWrapper = page.locator('[data-layout="agent-mode-wrapper"]');
  await expect(agentModeWrapper).toBeVisible();

  // Switch back to files mode
  const filesButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.filesModeButton);
  await filesButton.click();
  await page.waitForTimeout(500);

  // Verify we're back in files mode
  const fileTree = page.locator('.workspace-sidebar');
  await expect(fileTree).toBeVisible();

  // Agent mode wrapper should be hidden
  await expect(agentModeWrapper).not.toBeVisible();

  // Verify the files nav button is active
  await expect(filesButton).toHaveAttribute('aria-pressed', 'true');
});

// Bottom panel layout tests removed - the "Plans" bottom panel has been
// replaced with a full Tracker mode. The layout stability tests would need
// to be rewritten for the current UI architecture.
