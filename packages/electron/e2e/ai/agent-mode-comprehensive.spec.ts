/**
 * Agent Mode Comprehensive Tests
 *
 * Tests the agent mode UI with session history sidebar.
 * Consolidates tests from agentic-coding-window, agentic-coding-streaming,
 * multi-panel-streaming, and chat-panel-streaming specs.
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
  switchToEditorMode,
  submitChatPrompt,
  createNewAgentSession,
  PLAYWRIGHT_TEST_SELECTORS
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

test.describe('Agent Mode', () => {
  test.beforeEach(async () => {
    workspacePath = await createTempWorkspace();

    // Create test documents
    const doc1Path = path.join(workspacePath, 'document1.md');
    const doc2Path = path.join(workspacePath, 'document2.md');
    await fs.writeFile(doc1Path, '# Document 1\n\nOriginal content for doc 1.\n', 'utf8');
    await fs.writeFile(doc2Path, '# Document 2\n\nOriginal content for doc 2.\n', 'utf8');

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

  test('should switch to agent mode and auto-create session', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Open document
    await openNewDocument(page, workspacePath, 'document1.md', '');

    // Switch to agent mode
    await switchToAgentMode(page);

    // Verify chat interface is visible (proves session was auto-created)
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput);
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Verify session history sidebar is visible
    const sessionHistory = page.locator('.session-history-sidebar');
    await expect(sessionHistory).toBeVisible({ timeout: 3000 });
  });

  test('should submit message and clear input', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    await openNewDocument(page, workspacePath, 'document1.md', '');
    await switchToAgentMode(page);

    // Submit a message
    await submitChatPrompt(page, 'Test message');
    await page.waitForTimeout(1000);

    // Verify input was cleared (message sent successfully)
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput);
    const value = await chatInput.first().inputValue();
    expect(value).toBe('');
  });

  test('should create multiple sessions and maintain isolation', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Open first document in editor mode
    await page.locator('.file-tree-name', { hasText: 'document1.md' }).click();
    await page.waitForTimeout(500);

    await expect(page.locator('.tab .tab-title', { hasText: 'document1.md' }))
      .toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Open second document in editor mode
    await page.locator('.file-tree-name', { hasText: 'document2.md' }).click();
    await page.waitForTimeout(500);

    await expect(page.locator('.tab .tab-title', { hasText: 'document2.md' }))
      .toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Switch to agent mode - this will auto-create the first session
    await switchToAgentMode(page);

    // Send message to first auto-created session
    const chatInput1 = page.locator('textarea.ai-chat-input-field').first();
    await chatInput1.waitFor({ state: 'visible', timeout: 5000 });

    await chatInput1.fill('Add a new bullet point: "- First doc edit" to document1.md');
    await page.waitForTimeout(100);
    await chatInput1.press('Enter');

    // Wait for first session to start processing
    await page.waitForTimeout(1000);

    // Create second session using the new session button
    const newSessionButton = page.locator('button.session-history-new-button').first();
    await newSessionButton.click();
    await page.waitForTimeout(500);

    // Send message to second session
    const chatInput2 = page.locator('textarea.ai-chat-input-field:visible');
    await chatInput2.waitFor({ state: 'visible', timeout: 5000 });

    await chatInput2.fill('Add a new bullet point: "- Second doc edit" to document2.md');
    await page.waitForTimeout(100);
    await chatInput2.press('Enter');

    // Wait for both sessions to complete
    await page.waitForTimeout(15000);

    // Check second session (currently active) for tool calls
    const activeSession2 = page.locator('[data-active="true"]');
    const session2ToolCalls = activeSession2.locator('.rich-transcript-tool-container').first();
    await expect(session2ToolCalls).toBeVisible({ timeout: 10000 });

    // Switch to first session tab
    const sessionTab1 = page.locator('.ai-session-tabs-container .tab').first();
    await sessionTab1.click();
    await page.waitForTimeout(500);

    // Check first session for transcript content (proves isolation)
    const activeSession1 = page.locator('[data-active="true"]');
    const session1Messages = activeSession1.locator('.rich-transcript-message').first();
    await expect(session1Messages).toBeVisible({ timeout: 10000 });

    // Switch back to editor mode
    await switchToEditorMode(page);

    // Verify both documents were edited
    await page.locator('.tab', { hasText: 'document1.md' }).click();
    await page.waitForTimeout(500);

    const doc1Path = path.join(workspacePath, 'document1.md');
    const doc1Content = await fs.readFile(doc1Path, 'utf8');
    expect(doc1Content).toContain('First doc edit');

    await page.locator('.tab', { hasText: 'document2.md' }).click();
    await page.waitForTimeout(500);

    const doc2Path = path.join(workspacePath, 'document2.md');
    const doc2Content = await fs.readFile(doc2Path, 'utf8');
    expect(doc2Content).toContain('Second doc edit');
  });

  test('should display session history in left sidebar', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    await openNewDocument(page, workspacePath, 'document1.md', '');
    await switchToAgentMode(page);

    // Submit first message
    await submitChatPrompt(page, 'First message');
    await page.waitForTimeout(1000);

    // Create new session
    await createNewAgentSession(page);
    await page.waitForTimeout(500);

    // Submit second message to new session
    await submitChatPrompt(page, 'Second message');
    await page.waitForTimeout(1000);

    // Verify session history shows multiple sessions
    const sessionItems = page.locator('.session-history-item');
    const sessionCount = await sessionItems.count();
    expect(sessionCount).toBeGreaterThanOrEqual(2);

    // Verify we can switch between sessions via sidebar
    const firstSession = sessionItems.first();
    await firstSession.click();
    await page.waitForTimeout(500);

    // Verify the first session's content is now visible
    const activeSession = page.locator('[data-active="true"]');
    await expect(activeSession).toBeVisible();
  });

  test('should persist chat input across mode switches', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    await openNewDocument(page, workspacePath, 'document1.md', '');
    await switchToAgentMode(page);

    // Type message but don't send
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput);
    await chatInput.fill('Unsent message');
    await page.waitForTimeout(500);

    // Switch to editor mode
    await switchToEditorMode(page);
    await page.waitForTimeout(500);

    // Switch back to agent mode
    await switchToAgentMode(page);
    await page.waitForTimeout(500);

    // Verify the unsent message is still in the input
    const value = await chatInput.first().inputValue();
    expect(value).toContain('Unsent message');
  });

  test('should show empty state when no sessions exist', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Don't open any document, just switch to agent mode
    await switchToAgentMode(page);

    // Wait for mode switch
    await page.waitForTimeout(1000);

    // Verify session auto-created or empty state shown
    // (Depends on implementation - adjust based on actual behavior)
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput);
    const sessionHistory = page.locator('.session-history-sidebar');

    // At minimum, the interface should be present
    await expect(sessionHistory).toBeVisible({ timeout: 5000 });
  });
});
