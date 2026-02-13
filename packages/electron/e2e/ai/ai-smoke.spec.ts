/**
 * AI Smoke Test
 *
 * Single integration test that verifies the Claude Code agent SDK integration
 * is working end-to-end. Sends one real prompt and confirms a response appears.
 *
 * All other AI tests use synthetic/simulated approaches and don't require API keys.
 * This test requires ANTHROPIC_API_KEY to be set.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
} from '../helpers';
import {
  switchToAgentMode,
  submitChatPrompt,
  getActiveSession,
  PLAYWRIGHT_TEST_SELECTORS
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

test.describe('AI Smoke Test', () => {
  test.beforeAll(async () => {
    workspacePath = await createTempWorkspace();

    await fs.writeFile(
      path.join(workspacePath, 'test.md'),
      '# Test Document\n\nHello world.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspacePath,
      permissionMode: 'allow-all'
    });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should send a prompt and receive a response from Claude Code', async () => {
    test.setTimeout(60000);

    // Skip if no API key
    if (!process.env.ANTHROPIC_API_KEY) {
      test.skip();
    }

    // Switch to agent mode - session from Files mode will be auto-selected
    await switchToAgentMode(page);

    // Verify chat input is ready
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentChatInput);
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Send a simple prompt that requires minimal processing
    await submitChatPrompt(page, 'What is 2 + 2? Reply with just the number.');

    // Wait for a response to appear in the transcript
    const activeSession = getActiveSession(page);
    const messages = activeSession.locator(PLAYWRIGHT_TEST_SELECTORS.richTranscriptMessage);

    // Should see at least one message (the AI response)
    await expect(messages.first()).toBeVisible({ timeout: 30000 });

    // Verify the transcript has content (not just empty)
    const transcriptText = await activeSession.textContent();
    expect(transcriptText!.length).toBeGreaterThan(0);
  });
});
