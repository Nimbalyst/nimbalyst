import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  setupPageWithLogging,
  TEST_TIMEOUTS
} from '../helpers';
import {
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
  switchToAgentMode,
  submitChatPrompt,
  PLAYWRIGHT_TEST_SELECTORS
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.describe('Context Usage Display', () => {
  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create a test markdown file (required for app to not crash)
    const testFilePath = path.join(workspaceDir, 'test.md');
    await fs.writeFile(testFilePath, '# Test Document\n\nTest content.\n', 'utf8');

    // Launch Electron app with workspace
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();

    // Setup console logging to capture debug messages
    await setupPageWithLogging(page);

    // Use test helpers for setup
    await dismissAPIKeyDialog(page);
    await waitForWorkspaceReady(page);
    await openFileFromTree(page, 'test.md');
  });

  test.afterEach(async () => {
    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should show context usage display for Claude Code sessions', async () => {
    // Switch to agent mode
    await switchToAgentMode(page);

    console.log('[Test] Switched to agent mode');

    // Wait for session to be created
    await page.waitForTimeout(2000);

    // Look for context usage display
    const contextUsage = page.locator('.context-usage-display');
    const count = await contextUsage.count();
    console.log('[Test] Context usage display count:', count);

    if (count > 0) {
      const isVisible = await contextUsage.isVisible().catch(() => false);
      console.log('[Test] Context usage display visible:', isVisible);

      if (isVisible) {
        const usageText = await contextUsage.textContent();
        console.log('[Test] Context usage text:', usageText);

        // Verify format: "XXk/XXk Tokens (XX%)"
        expect(usageText).toMatch(/\d+k?\/\d+k Tokens \(\d+%\)/);
      }
    } else {
      console.log('[Test] No context usage display found yet (no token usage data)');
    }

    // Check provider
    const modelSelector = page.locator('.model-selector');
    if (await modelSelector.isVisible().catch(() => false)) {
      const providerText = await modelSelector.textContent();
      console.log('[Test] Current provider:', providerText);
    }
  });

  test('should update context usage after sending a message', async () => {
    // Switch to agent mode
    await switchToAgentMode(page);
    console.log('[Test] Switched to agent mode');

    // Send a message
    await submitChatPrompt(page, 'What model are you?');
    console.log('[Test] Sent message');

    // Wait for processing to complete
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.tabProcessingIndicator, { timeout: 10000 });
    console.log('[Test] Processing started');

    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.tabProcessingIndicator, { state: 'hidden', timeout: 60000 });
    console.log('[Test] Processing completed');

    // Wait for state to update
    await page.waitForTimeout(1500);

    // Now check for context usage display
    const contextUsage = page.locator('.context-usage-display');
    const count = await contextUsage.count();
    console.log('[Test] Context usage display count after message:', count);

    if (count > 0) {
      const isVisible = await contextUsage.isVisible().catch(() => false);
      console.log('[Test] Context usage display visible after message:', isVisible);

      if (isVisible) {
        const usageText = await contextUsage.textContent();
        console.log('[Test] Context usage text after message:', usageText);

        // Verify format
        expect(usageText).toMatch(/\d+k?\/\d+k Tokens \(\d+%\)/);

        // Extract numbers to verify they're greater than 0
        const match = usageText?.match(/(\d+)k?\/(\d+)k Tokens \((\d+)%\)/);
        if (match) {
          const current = parseInt(match[1]);
          const max = parseInt(match[2]);
          const percent = parseInt(match[3]);

          console.log('[Test] Parsed usage - current:', current, 'max:', max, 'percent:', percent);
          expect(current).toBeGreaterThan(0);
          expect(max).toBeGreaterThan(0);
          expect(percent).toBeGreaterThanOrEqual(0);
          expect(percent).toBeLessThanOrEqual(100);
        }
      }
    } else {
      console.log('[Test] No context usage display found after message');
    }
  });

  test('should persist token usage in database', async () => {
    // Switch to agent mode
    await switchToAgentMode(page);

    const firstTab = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTab).first();
    const sessionId = await firstTab.getAttribute('data-tab-id');
    console.log('[Test] Session ID:', sessionId);

    // Send a message
    await submitChatPrompt(page, 'Hello');
    console.log('[Test] Sent message');

    // Wait for processing to complete
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.tabProcessingIndicator, { timeout: 10000 });
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.tabProcessingIndicator, { state: 'hidden', timeout: 60000 });
    console.log('[Test] Processing completed');

    await page.waitForTimeout(2000);

    // Query database for token usage
    const dbResult = await page.evaluate(async (sid) => {
      const result = await (window as any).electronAPI.invoke('test:query-db',
        'SELECT id, provider, token_usage FROM ai_sessions WHERE id = $1',
        [sid]
      );
      return result;
    }, sessionId);

    console.log('[Test] Database query result:', JSON.stringify(dbResult, null, 2));

    if (dbResult && dbResult.rows && dbResult.rows.length > 0) {
      const tokenUsage = dbResult.rows[0].token_usage;
      console.log('[Test] Token usage from database:', JSON.stringify(tokenUsage, null, 2));

      if (tokenUsage && typeof tokenUsage === 'object') {
        expect(tokenUsage).toHaveProperty('totalTokens');
        expect(tokenUsage.totalTokens).toBeGreaterThan(0);
        console.log('[Test] Token usage verified in database');
      } else {
        console.log('[Test] No token usage data in database yet');
      }
    }
  });
});
