/**
 * Terminal E2E Tests
 *
 * Consolidated from:
 * - terminal-session.spec.ts (Terminal creation, commands, session list)
 * - terminal-reopen.spec.ts (Terminal close/reopen, cursor position after scrollback)
 *
 * All tests share a single Electron app instance for performance.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import {
  switchToAgentMode,
  PLAYWRIGHT_TEST_SELECTORS
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

test.beforeAll(async () => {
  workspacePath = await createTempWorkspace();
  electronApp = await launchElectronApp({ workspace: workspacePath });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
});

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close();
  }
  await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
});

// --- Terminal Session tests (from terminal-session.spec.ts) ---

test.describe('Terminal Sessions', () => {
  test('should create terminal session and execute pwd command', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    await switchToAgentMode(page);

    const sessionHistory = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory);
    await expect(sessionHistory).toBeVisible({ timeout: 5000 });

    // Click the new terminal button
    const newTerminalButton = page.locator('[data-testid="new-terminal-button"]');
    await expect(newTerminalButton).toBeVisible({ timeout: 5000 });
    await newTerminalButton.click();

    // Wait for terminal container to appear
    const terminalContainer = page.locator('[data-testid^="terminal-session-"]');
    await expect(terminalContainer).toBeVisible({ timeout: 10000 });

    await page.waitForTimeout(2000);

    // Find the xterm container
    const xtermContainer = page.locator('.terminal-container');
    await expect(xtermContainer).toBeVisible({ timeout: 5000 });

    // Focus and type pwd
    await xtermContainer.click();
    await page.waitForTimeout(500);
    await page.keyboard.type('pwd');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Verify terminal session appears in the session list
    const terminalSessionItem = page.locator('.session-list-item-icon.terminal-icon');
    await expect(terminalSessionItem).toBeVisible({ timeout: 5000 });

    // Verify terminal is showing content
    const xtermScreen = page.locator('.xterm-screen');
    await expect(xtermScreen).toBeVisible({ timeout: 3000 });

    const terminalContent = page.locator('.xterm-rows');
    await expect(terminalContent).toBeVisible({ timeout: 3000 });
  });

  test('should show terminal icon in session list for terminal sessions', async () => {
    // Terminal should already exist from previous test
    const terminalIcon = page.locator('.session-list-item .material-symbols-rounded').filter({ hasText: 'terminal' });
    await expect(terminalIcon).toBeVisible({ timeout: 5000 });
  });

  test('should allow creating multiple terminal sessions', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Create another terminal (one already exists from previous tests)
    const newTerminalButton = page.locator('[data-testid="new-terminal-button"]');
    await newTerminalButton.click();
    await page.waitForTimeout(2000);

    // Verify we have 2+ terminal tabs
    const terminalTabs = page.locator('.tab').filter({ hasText: 'Terminal' });
    const count = await terminalTabs.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// --- Terminal Close/Reopen tests (from terminal-reopen.spec.ts) ---

test.describe('Terminal Panel - Close and Reopen', () => {
  test('terminal should function correctly after close and reopen', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Switch to files mode first so we can use the bottom panel terminal
    await page.keyboard.press('Meta+E');
    await page.waitForTimeout(500);

    // Open terminal panel via custom event
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('terminal:show')));
    await page.waitForTimeout(500);

    // Panel is open
    const panelContainer = page.locator('.terminal-bottom-panel-container');
    await expect(panelContainer).toBeVisible({ timeout: 5000 });

    // Click "New Terminal" button if terminal isn't already running
    const emptyButton = page.locator('.terminal-bottom-panel-empty button');
    if (await emptyButton.isVisible().catch(() => false)) {
      await emptyButton.click();
    }

    // Wait for terminal to be ready
    const terminalContainer = page.locator('[data-testid="terminal-container"]');
    await expect(terminalContainer).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Focus the terminal
    await terminalContainer.click();
    await page.waitForTimeout(500);

    // Run a command that produces a file
    const testFileBefore = path.join(workspacePath, 'before.txt');
    await page.keyboard.type(`echo BEFORE_CLOSE > "${testFileBefore}"`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Verify the first command worked
    const beforeContent = await fs.readFile(testFileBefore, 'utf8').catch(() => '');
    expect(beforeContent.trim()).toBe('BEFORE_CLOSE');

    // Close the terminal panel via the X button
    const closeButton = page.locator('.terminal-bottom-panel-close');
    await closeButton.click();
    await page.waitForTimeout(500);

    // Verify panel is hidden
    await expect(panelContainer).not.toBeVisible();

    // Reopen the terminal panel
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('terminal:show')));
    await page.waitForTimeout(500);

    // The terminal should still exist with scrollback restored
    await expect(terminalContainer).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Focus the terminal again
    await terminalContainer.click();
    await page.waitForTimeout(500);

    // Run a command after reopening
    const testFileAfter = path.join(workspacePath, 'after.txt');
    await page.keyboard.type(`echo AFTER_REOPEN > "${testFileAfter}"`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Verify the file was created (proves cursor was at prompt, not at 0,0)
    const afterContent = await fs.readFile(testFileAfter, 'utf8').catch(() => '');
    expect(afterContent.trim()).toBe('AFTER_REOPEN');
  });
});
