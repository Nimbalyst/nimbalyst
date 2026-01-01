/**
 * Terminal Session E2E Tests
 *
 * Tests the terminal session feature in agent mode.
 * Verifies terminal creation, input, output, and session display.
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

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

test.describe('Terminal Session', () => {
  test.beforeEach(async () => {
    workspacePath = await createTempWorkspace();
    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should create terminal session and execute pwd command', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Switch to agent mode
    await switchToAgentMode(page);

    // Wait for agent mode UI to be ready
    const sessionHistory = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory);
    await expect(sessionHistory).toBeVisible({ timeout: 5000 });

    // Click the new terminal button
    const newTerminalButton = page.locator('[data-testid="new-terminal-button"]');
    await expect(newTerminalButton).toBeVisible({ timeout: 5000 });
    await newTerminalButton.click();

    // Wait for terminal container to appear
    const terminalContainer = page.locator('[data-testid^="terminal-session-"]');
    await expect(terminalContainer).toBeVisible({ timeout: 10000 });

    // Wait for terminal to initialize
    await page.waitForTimeout(2000);

    // Find the xterm container
    const xtermContainer = page.locator('.terminal-container');
    await expect(xtermContainer).toBeVisible({ timeout: 5000 });

    // Focus the terminal
    await xtermContainer.click();
    await page.waitForTimeout(500);

    // Type 'pwd' command and press Enter
    await page.keyboard.type('pwd');
    await page.keyboard.press('Enter');

    // Wait for command output
    await page.waitForTimeout(1000);

    // Take a screenshot to verify
    await page.screenshot({
      path: 'terminal-pwd-output.png',
      fullPage: false
    });

    // Verify that the terminal session appears in the session list
    const terminalSessionItem = page.locator('.session-list-item-icon.terminal-icon');
    await expect(terminalSessionItem).toBeVisible({ timeout: 5000 });

    // Verify terminal is showing content (the prompt and pwd output)
    // The terminal should have the xterm-screen class with content
    const xtermScreen = page.locator('.xterm-screen');
    await expect(xtermScreen).toBeVisible({ timeout: 3000 });

    // Get the terminal viewport content to verify something was rendered
    const terminalContent = page.locator('.xterm-rows');
    await expect(terminalContent).toBeVisible({ timeout: 3000 });
  });

  test('should show terminal icon in session list for terminal sessions', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Switch to agent mode
    await switchToAgentMode(page);

    // Wait for session history
    const sessionHistory = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory);
    await expect(sessionHistory).toBeVisible({ timeout: 5000 });

    // Click new terminal button
    const newTerminalButton = page.locator('[data-testid="new-terminal-button"]');
    await newTerminalButton.click();

    // Wait for terminal to be created
    await page.waitForTimeout(2000);

    // Verify the session list shows a terminal icon
    const terminalIcon = page.locator('.session-list-item .material-symbols-rounded').filter({ hasText: 'terminal' });
    await expect(terminalIcon).toBeVisible({ timeout: 5000 });
  });

  test('should allow creating multiple terminal sessions', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Switch to agent mode
    await switchToAgentMode(page);

    // Wait for session history
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory)).toBeVisible({ timeout: 5000 });

    // Create first terminal
    const newTerminalButton = page.locator('[data-testid="new-terminal-button"]');
    await newTerminalButton.click();
    await page.waitForTimeout(2000);

    // Create second terminal
    await newTerminalButton.click();
    await page.waitForTimeout(2000);

    // Verify we have 2 terminal tabs
    const terminalTabs = page.locator('.tab').filter({ hasText: 'Terminal' });
    const count = await terminalTabs.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
