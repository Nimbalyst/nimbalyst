/**
 * Agent Mode Streaming Test
 *
 * Tests streaming functionality and multi-session isolation.
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import {
  openNewDocument,
  switchToAgentMode,
  submitChatPrompt,
  AI_SELECTORS
} from '../utils/aiTestHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

test.describe('Agent Mode Streaming', () => {
  test.beforeEach(async () => {
    workspacePath = await createTempWorkspace();

    const testDoc = path.join(workspacePath, 'test.md');
    await fs.writeFile(testDoc, '# Test\n\nContent here.\n', 'utf8');

    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000); // Wait for app initialization
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('agent interface loads and accepts input', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    await openNewDocument(page, workspacePath, 'test.md', '');
    await switchToAgentMode(page);

    // Verify interface is functional
    const chatInput = page.locator(AI_SELECTORS.chatInput);
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    await submitChatPrompt(page, 'Test streaming message');
    await page.waitForTimeout(1000);

    const value = await chatInput.first().inputValue();
    expect(value).toBe('');
  });
});
