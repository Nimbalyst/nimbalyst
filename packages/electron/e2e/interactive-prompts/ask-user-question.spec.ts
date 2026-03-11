/**
 * E2E Tests for AskUserQuestion Widget
 *
 * Tests the AskUserQuestion interactive prompt widget without invoking the actual AI agent.
 * Uses the test harness to insert mock messages directly into the database.
 *
 * Follows Playwright guidelines:
 * - Uses beforeAll to launch app once
 * - Uses the session auto-created by switchToAgentMode
 * - Tests run sequentially to share app instance
 * - Cleans up in afterAll
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
  createTestSession,
  insertUserPrompt,
  insertPendingAskUserQuestion,
  insertAskUserQuestionResult,
  cleanupTestSessions,
  INTERACTIVE_PROMPT_SELECTORS
} from '../utils/interactivePromptTestHelpers';
import { switchToAgentMode } from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let workspacePath: string;

test.describe('AskUserQuestion Widget', () => {
  test.beforeAll(async () => {
    workspacePath = await createTempWorkspace();

    // Create test file before launching app (required for app to function properly)
    await fs.writeFile(
      path.join(workspacePath, 'test.md'),
      '# Test Document\n\nContent for testing.\n',
      'utf8'
    );

    app = await launchElectronApp({
      workspace: workspacePath,
      permissionMode: 'allow-all'
    });
    page = await app.firstWindow();
    await waitForAppReady(page);

    // Switch to agent mode - this auto-creates a session
    await switchToAgentMode(page);
    await page.waitForTimeout(500);
  });

  test.afterAll(async () => {
    if (page) {
      await cleanupTestSessions(page, workspacePath);
    }
    if (app) {
      await app.close();
    }
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('renders pending question with options and validates submit button state', async () => {
    // Create a new test session
    const sessionId = await createTestSession(page, workspacePath, {
      title: 'Test AskUserQuestion Pending'
    });

    // Insert a user prompt first (to simulate conversation)
    await insertUserPrompt(page, sessionId, 'Help me choose a framework');

    // Insert the pending AskUserQuestion (no result yet)
    await insertPendingAskUserQuestion(page, sessionId, [{
      question: 'Which framework do you prefer?',
      header: 'Framework Selection',
      options: [
        { label: 'React', description: 'A JavaScript library for building UIs' },
        { label: 'Vue', description: 'A progressive JavaScript framework' },
        { label: 'Svelte', description: 'A radical new approach to building UIs' }
      ],
      multiSelect: false
    }]);

    // Wait for session list to refresh (IPC event triggers refresh)
    await page.waitForTimeout(1000);

    // Click on the new test session to load it (this triggers loadSession which reads from DB)
    const sessionItem = page.locator(`#session-list-item-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });
    await sessionItem.click();
    await page.waitForTimeout(1000);

    // Wait for the widget to render
    const widget = page.locator(INTERACTIVE_PROMPT_SELECTORS.askUserQuestionWidget);
    await expect(widget).toBeVisible({ timeout: TEST_TIMEOUTS.VERY_LONG });

    // Verify widget is in pending state
    await expect(widget).toHaveAttribute('data-state', 'pending');

    // Verify question text is visible
    await expect(page.locator('text=Which framework do you prefer?')).toBeVisible();

    // Verify all options are visible
    await expect(page.locator('text=React')).toBeVisible();
    await expect(page.locator('text=Vue')).toBeVisible();
    await expect(page.locator('text=Svelte')).toBeVisible();

    // Verify submit button is disabled (no selection yet)
    const submitButton = page.locator(INTERACTIVE_PROMPT_SELECTORS.askUserQuestionSubmitButton);
    await expect(submitButton).toBeDisabled();

    // Select an option and verify submit is enabled
    const reactOption = widget.locator('[data-option-label="React"]');
    await reactOption.click();
    await expect(reactOption).toHaveAttribute('data-selected', 'true');
    await expect(submitButton).toBeEnabled();
  });

  test('shows completed state for answered question', async () => {
    // Create a new test session
    const sessionId = await createTestSession(page, workspacePath, {
      title: 'Test AskUserQuestion Completed'
    });

    // Insert user prompt
    await insertUserPrompt(page, sessionId, 'Help me choose');

    // Insert pending question
    const { id: questionId } = await insertPendingAskUserQuestion(page, sessionId, [{
      question: 'Pick one option',
      header: 'Selection',
      options: [
        { label: 'Option A', description: 'First option' },
        { label: 'Option B', description: 'Second option' }
      ],
      multiSelect: false
    }]);

    // Insert the result (question was already answered) - insert BEFORE viewing
    await insertAskUserQuestionResult(page, sessionId, questionId, {
      'Pick one option': 'Option A'
    });

    // Wait for session list to refresh
    await page.waitForTimeout(1000);

    // Click on the session to load it
    const sessionItem = page.locator(`#session-list-item-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });
    await sessionItem.click();
    await page.waitForTimeout(1000);

    // Wait for widget
    const widget = page.locator(INTERACTIVE_PROMPT_SELECTORS.askUserQuestionWidget);
    await expect(widget).toBeVisible({ timeout: TEST_TIMEOUTS.VERY_LONG });

    // Verify widget is in completed state
    await expect(widget).toHaveAttribute('data-state', 'completed');

    // Verify completed indicator is visible
    const completedIndicator = page.locator(INTERACTIVE_PROMPT_SELECTORS.askUserQuestionCompletedState);
    await expect(completedIndicator).toBeVisible();
  });

  test('shows cancelled state for cancelled question', async () => {
    // Create a new test session
    const sessionId = await createTestSession(page, workspacePath, {
      title: 'Test AskUserQuestion Cancelled'
    });

    // Insert user prompt
    await insertUserPrompt(page, sessionId, 'Help me');

    // Insert pending question
    const { id: questionId } = await insertPendingAskUserQuestion(page, sessionId, [{
      question: 'Which one?',
      header: 'Choice',
      options: [
        { label: 'Yes', description: 'Affirmative' },
        { label: 'No', description: 'Negative' }
      ],
      multiSelect: false
    }]);

    // Insert cancelled result immediately
    await insertAskUserQuestionResult(page, sessionId, questionId, {}, true);

    // Wait for session list to refresh
    await page.waitForTimeout(1000);

    // Click on the session to load it
    const sessionItem = page.locator(`#session-list-item-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });
    await sessionItem.click();
    await page.waitForTimeout(1000);

    // Wait for widget
    const widget = page.locator(INTERACTIVE_PROMPT_SELECTORS.askUserQuestionWidget);
    await expect(widget).toBeVisible({ timeout: TEST_TIMEOUTS.VERY_LONG });

    // Verify widget is in cancelled state
    await expect(widget).toHaveAttribute('data-state', 'cancelled');

    // Verify cancelled indicator is visible within the widget
    await expect(widget.locator('[data-testid="ask-user-question-cancelled"]')).toBeVisible();
  });

  test('multi-select question allows multiple selections', async () => {
    // Create a new test session
    const sessionId = await createTestSession(page, workspacePath, {
      title: 'Test AskUserQuestion MultiSelect'
    });

    // Insert user prompt
    await insertUserPrompt(page, sessionId, 'Select features');

    // Insert pending multi-select question (no result yet)
    await insertPendingAskUserQuestion(page, sessionId, [{
      question: 'Which features do you want?',
      header: 'Feature Selection',
      options: [
        { label: 'Dark Mode', description: 'Dark theme support' },
        { label: 'Notifications', description: 'Push notifications' },
        { label: 'Sync', description: 'Cloud sync' }
      ],
      multiSelect: true
    }]);

    // Wait for session list to refresh
    await page.waitForTimeout(1000);

    // Click on the session to load it
    const sessionItem = page.locator(`#session-list-item-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });
    await sessionItem.click();
    await page.waitForTimeout(1000);

    // Wait for widget
    const widget = page.locator(INTERACTIVE_PROMPT_SELECTORS.askUserQuestionWidget);
    await expect(widget).toBeVisible({ timeout: TEST_TIMEOUTS.VERY_LONG });
    await expect(widget).toHaveAttribute('data-state', 'pending');

    // Verify "Select multiple" hint is visible
    await expect(widget.locator('text=Select multiple')).toBeVisible();

    // Select multiple options
    const darkModeOption = widget.locator('[data-option-label="Dark Mode"]');
    const notificationsOption = widget.locator('[data-option-label="Notifications"]');

    await darkModeOption.click();
    await notificationsOption.click();

    // Verify both are selected
    await expect(darkModeOption).toHaveAttribute('data-selected', 'true');
    await expect(notificationsOption).toHaveAttribute('data-selected', 'true');

    // Submit should now be enabled
    await expect(widget.locator('[data-testid="ask-user-question-submit"]')).toBeEnabled();
  });
});
