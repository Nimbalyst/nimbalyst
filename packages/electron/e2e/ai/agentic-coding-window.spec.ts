/**
 * Agent Mode Tests
 *
 * Consolidated tests for Agent mode functionality.
 * Tests complete workflows rather than individual steps.
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

test.describe('Agent Mode', () => {
  test.beforeEach(async () => {
    workspacePath = await createTempWorkspace();

    // Create a test document
    const planPath = path.join(workspacePath, 'plan.md');
    await fs.writeFile(planPath, '# Test Plan\n\nTest content.\n', 'utf8');

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

  test('complete agent workflow: switch mode, submit message, verify session created', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Open document
    await openNewDocument(page, workspacePath, 'plan.md', '');

    // Switch to agent mode
    await switchToAgentMode(page);

    // Verify chat interface is visible (proves session was auto-created)
    const chatInput = page.locator(AI_SELECTORS.chatInput);
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Submit a message
    await submitChatPrompt(page, 'Test message');
    await page.waitForTimeout(1000);

    // Verify input was cleared (message sent successfully)
    const value = await chatInput.first().inputValue();
    expect(value).toBe('');
  });

  // NOTE: Multi-session test disabled due to UI focus issues when creating new sessions
  // The multi-panel-streaming.spec.ts test covers this functionality more thoroughly
});
