/**
 * Terminal Reopen E2E Tests
 *
 * Tests that the terminal panel works correctly after being closed and reopened.
 * Specifically verifies that the cursor is positioned correctly (not stuck at 0,0)
 * after scrollback restoration, which was a bug caused by DECSTR reset.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

/**
 * Wait for a terminal to be initialized and ready for input.
 */
async function waitForTerminalReady(page: Page): Promise<void> {
  // Wait for the terminal panel container to be visible
  const terminalPanel = page.locator('.terminal-bottom-panel-container');
  await expect(terminalPanel).toBeVisible({ timeout: 5000 });

  // Wait for terminal container (ghostty-web renders here)
  const terminalContainer = page.locator('[data-testid="terminal-container"]');
  await expect(terminalContainer).toBeVisible({ timeout: 10000 });

  // Wait for terminal to initialize
  await page.waitForTimeout(2000);
}

test.describe('Terminal Panel - Close and Reopen', () => {
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

  test('terminal should function correctly after close and reopen', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Open terminal panel via the terminal:show custom event (listened by App.tsx)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('terminal:show')));
    await page.waitForTimeout(500);

    // Panel is open but empty - click "New Terminal" button
    const panelContainer = page.locator('.terminal-bottom-panel-container');
    await expect(panelContainer).toBeVisible({ timeout: 5000 });

    const newTerminalButton = page.locator('.terminal-bottom-panel-empty button');
    await expect(newTerminalButton).toBeVisible({ timeout: 3000 });
    await newTerminalButton.click();

    // Wait for terminal to be ready
    await waitForTerminalReady(page);

    // Focus the terminal
    const terminalContainer = page.locator('[data-testid="terminal-container"]');
    await terminalContainer.click();
    await page.waitForTimeout(500);

    // Run a command that produces a file (proves terminal is functional)
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
    await waitForTerminalReady(page);

    // Focus the terminal again
    await terminalContainer.click();
    await page.waitForTimeout(500);

    // Run a command after reopening. If the cursor was stuck at (0,0),
    // the typed text would overlap with scrollback content and the
    // command would fail or produce wrong output.
    const testFileAfter = path.join(workspacePath, 'after.txt');
    await page.keyboard.type(`echo AFTER_REOPEN > "${testFileAfter}"`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Verify the file was created (proves cursor was at prompt, not at 0,0)
    const afterContent = await fs.readFile(testFileAfter, 'utf8').catch(() => '');
    expect(afterContent.trim()).toBe('AFTER_REOPEN');
  });
});
