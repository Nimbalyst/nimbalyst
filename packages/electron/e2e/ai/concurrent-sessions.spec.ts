/**
 * E2E tests for concurrent AI session handling
 *
 * Verifies that multiple claude-code sessions can run simultaneously in agent mode
 * without cross-session state contamination or conflicts.
 */

import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  ACTIVE_EDITOR_SELECTOR,
} from '../helpers';
import {
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
  createNewAgentSession,
  switchToSessionTab,
  submitChatPrompt,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create test files for each session to work with
  await fs.writeFile(
    path.join(workspaceDir, 'session1.md'),
    '# Session 1 Document\n\nContent for session 1.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'session2.md'),
    '# Session 2 Document\n\nContent for session 2.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'session3.md'),
    '# Session 3 Document\n\nContent for session 3.\n',
    'utf8'
  );

  // Launch app in agent mode
  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();

  await dismissAPIKeyDialog(page);
  await waitForWorkspaceReady(page);
});

test.afterEach(async () => {
  if (electronApp) {
    await electronApp.close();
  }
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('should support multiple concurrent sessions without conflicts', async () => {
  // Switch to agent mode
  await page.click('[data-mode="agent"]');
  await page.waitForTimeout(500);

  // Session 1 should already exist from app launch
  const session1TabExists = await page.locator('.tab', { hasText: /Session/ }).count();
  expect(session1TabExists).toBeGreaterThan(0);

  // Create Session 2
  await createNewAgentSession(page);
  await page.waitForTimeout(500);

  // Create Session 3
  await createNewAgentSession(page);
  await page.waitForTimeout(500);

  // Verify we have 3 tabs
  const tabCount = await page.locator('.tab').count();
  expect(tabCount).toBe(3);
});

test('should track loading state per session independently', async () => {
  // Switch to agent mode
  await page.click('[data-mode="agent"]');
  await page.waitForTimeout(500);

  // Create 2 sessions
  await createNewAgentSession(page);
  await page.waitForTimeout(500);

  // Get tab IDs
  const tabs = await page.locator('.tab').all();
  expect(tabs.length).toBe(2);

  // Switch to first session tab (index 0)
  await switchToSessionTab(page, 0);
  await page.waitForTimeout(300);

  // Send a message to session 1 (this will fail without API key, but that's okay - we're testing state)
  const chatInput1 = page.locator('.ai-input-textarea').first();
  await chatInput1.fill('Test message for session 1');
  await page.keyboard.press('Meta+Enter');

  // The session should show as sending (loading spinner)
  // Note: This test verifies the UI state, not actual AI completion
  await page.waitForTimeout(200);

  // Switch to second session tab
  await switchToSessionTab(page, 1);
  await page.waitForTimeout(300);

  // Second session should NOT show loading state
  const session2View = page.locator('[data-session-id]').nth(1);
  const loadingIndicator = session2View.locator('[data-testid="loading-indicator"]');
  await expect(loadingIndicator).toHaveCount(0);
});

test('should allow canceling one session without affecting others', async () => {
  // Switch to agent mode
  await page.click('[data-mode="agent"]');
  await page.waitForTimeout(500);

  // Create second session
  await createNewAgentSession(page);
  await page.waitForTimeout(500);

  // Send messages to both sessions
  await switchToSessionTab(page, 0);
  const chatInput1 = page.locator('.ai-input-textarea').first();
  await chatInput1.fill('Long running task session 1');
  await page.keyboard.press('Meta+Enter');
  await page.waitForTimeout(200);

  await switchToSessionTab(page, 1);
  const chatInput2 = page.locator('.ai-input-textarea').first();
  await chatInput2.fill('Long running task session 2');
  await page.keyboard.press('Meta+Enter');
  await page.waitForTimeout(200);

  // Cancel first session
  await switchToSessionTab(page, 0);
  const cancelButton = page.locator('button', { hasText: 'Cancel' }).first();
  if (await cancelButton.isVisible()) {
    await cancelButton.click();
  }

  // Second session should still be running (if it was)
  await switchToSessionTab(page, 1);
  // Verify second session still exists and is functional
  const session2Exists = await page.locator('.tab').nth(1).isVisible();
  expect(session2Exists).toBe(true);
});

test('should maintain separate message history per session', async () => {
  // Switch to agent mode
  await page.click('[data-mode="agent"]');
  await page.waitForTimeout(500);

  // Create second session
  await createNewAgentSession(page);
  await page.waitForTimeout(500);

  // Add a message to session 1
  await switchToSessionTab(page, 0);
  const chatInput1 = page.locator('.ai-input-textarea').first();
  await chatInput1.fill('Message only in session 1');
  await page.keyboard.press('Meta+Enter');
  await page.waitForTimeout(500);

  // Switch to session 2
  await switchToSessionTab(page, 1);
  const chatInput2 = page.locator('.ai-input-textarea').first();
  await chatInput2.fill('Message only in session 2');
  await page.keyboard.press('Meta+Enter');
  await page.waitForTimeout(500);

  // Verify session 1 doesn't have session 2's message
  await switchToSessionTab(page, 0);
  const session1Messages = page.locator('[data-session-id]').first();
  const session2MessageInSession1 = session1Messages.locator('text="Message only in session 2"');
  await expect(session2MessageInSession1).toHaveCount(0);

  // Verify session 2 doesn't have session 1's message
  await switchToSessionTab(page, 1);
  const session2Messages = page.locator('[data-session-id]').nth(1);
  const session1MessageInSession2 = session2Messages.locator('text="Message only in session 1"');
  await expect(session1MessageInSession2).toHaveCount(0);
});

test('should support switching between sessions rapidly', async () => {
  // Switch to agent mode
  await page.click('[data-mode="agent"]');
  await page.waitForTimeout(500);

  // Create 2 more sessions (total 3)
  await createNewAgentSession(page);
  await page.waitForTimeout(300);
  await createNewAgentSession(page);
  await page.waitForTimeout(300);

  // Rapidly switch between sessions
  for (let i = 0; i < 10; i++) {
    const sessionIndex = i % 3;
    await switchToSessionTab(page, sessionIndex);
    await page.waitForTimeout(50);
  }

  // All tabs should still be present and functional
  const finalTabCount = await page.locator('.tab').count();
  expect(finalTabCount).toBe(3);
});

test.skip('should handle concurrent streaming responses in different sessions', async () => {
  // This test is skipped because it requires actual AI provider setup
  // and would make real API calls. It's here as documentation for manual testing.

  // Test outline:
  // 1. Set up API key for claude-code
  // 2. Create 3 sessions
  // 3. Send messages to all 3 sessions rapidly
  // 4. Verify all 3 sessions stream responses independently
  // 5. Verify responses appear in correct sessions
  // 6. Verify no cross-session contamination of messages or tool calls
});
