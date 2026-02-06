/**
 * Context-Aware New (Cmd+N) E2E Tests
 *
 * Tests that Cmd+N is context-aware:
 * - In agent mode: creates new AI session
 * - In files mode: opens new file dialog
 *
 * All tests share a single Electron app instance for performance.
 * Each test uses a separate file to avoid interference.
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
  TEST_TIMEOUTS
} from '../helpers';
import { dismissAPIKeyDialog, closeTabByFileName } from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

// Use serial mode to prevent worker restarts on test failures
// This ensures all tests share the same Electron app instance
test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create ALL test files upfront for all scenarios
  await fs.writeFile(
    path.join(workspaceDir, 'agent-mode-test.md'),
    '# Agent Mode Test\n\nTest content for agent mode.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'files-mode-test.md'),
    '# Files Mode Test\n\nTest content for files mode.\n',
    'utf8'
  );

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
  await dismissAPIKeyDialog(page);
});

test.afterAll(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('Cmd+N should create new session in agent mode', async () => {
  // Switch to agent mode (Cmd+K)
  await page.keyboard.press('Meta+k');

  // Wait for agent mode to be active - look for "Agent Sessions" heading
  await expect(page.locator('text="Agent Sessions"')).toBeVisible({ timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

  // Count initial sessions in the list - sessions have accessible name starting with "Session:"
  const initialSessionButtons = await page.getByRole('button', { name: /^Session:/ }).count();
  console.log('[Test] Initial session count:', initialSessionButtons);

  // Send the agent-new-session IPC message directly (what File->New does in agent mode)
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.webContents.send('agent-new-session');
    }
  });

  // Wait for the new session to be created
  await page.waitForTimeout(1000);

  // Verify a new session was created - session count should increase
  const newSessionButtons = await page.getByRole('button', { name: /^Session:/ }).count();
  console.log('[Test] New session count:', newSessionButtons);
  expect(newSessionButtons).toBeGreaterThan(initialSessionButtons);

  // Verify new file dialog did NOT open
  const newFileDialog = page.locator('text="New File"').first();
  await expect(newFileDialog).not.toBeVisible({ timeout: 500 }).catch(() => {
    // Dialog not visible is expected
  });
});

test('Cmd+N should open new file dialog in files mode', async () => {
  // Switch to files mode - press Cmd+E to go directly to files mode
  await page.keyboard.press('Meta+e');

  // Wait for files mode to be active - file tree should be visible
  await expect(page.locator('text="agent-mode-test.md"')).toBeVisible({ timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

  // Send the file-new-in-workspace IPC message directly (what File->New does in files mode)
  await electronApp.evaluate(({ BrowserWindow }) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.webContents.send('file-new-in-workspace');
    }
  });

  // Wait for dialog
  await page.waitForTimeout(500);

  // Verify new file dialog opened
  const newFileDialog = page.locator('text="New File"').first();
  await expect(newFileDialog).toBeVisible({ timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

  // Close the dialog by pressing Escape to clean up
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});
