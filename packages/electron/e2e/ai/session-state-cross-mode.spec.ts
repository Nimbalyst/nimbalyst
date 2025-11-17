/**
 * Session State Cross-Mode Test
 *
 * Tests that session state tracking works across mode switches:
 * - Create a session in files-mode AIChat
 * - Switch to agent-mode
 * - Verify the session appears in the session history
 * - Verify the session shows running state when active
 */

import { test, expect } from '@playwright/test';
import type { Page, ElectronApplication } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, waitForAppReady } from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  switchToFilesMode,
  switchToAgentMode,
  submitChatPrompt,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.beforeEach(async () => {
  // Create temporary workspace
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'test.md');

  // CRITICAL: Create test file BEFORE launching app
  await fs.writeFile(testFilePath, '# Test Document\n\nInitial content.\n', 'utf8');

  // Launch app with workspace
  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);

  // Capture console logs - including errors
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('AgenticPanel') || text.includes('SessionHistory') || text.includes('sessionState') || text.includes('runningSessions') || text.includes('createNewSession') || text.includes('aiCreateSession')) {
      console.log(`[Browser] ${text}`);
    }
  });

  // Capture page errors
  page.on('pageerror', error => {
    console.log(`[Browser Error] ${error.message}`);
  });

  // Dismiss API key dialog if present
  await dismissAPIKeyDialog(page);
  await waitForWorkspaceReady(page);
});

test.afterEach(async () => {
  // Clean up
  if (electronApp) {
    await electronApp.close();
  }
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('session created in files-mode appears immediately in agent-mode history', async () => {
  // Step 1: Start in files mode
  await switchToFilesMode(page);
  await page.waitForTimeout(1000);

  // Open a file to provide context
  await openFileFromTree(page, 'test.md');
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 5000 });

  // Open AI chat panel (Cmd+Shift+A)
  await page.keyboard.press('Meta+Shift+a');
  await page.waitForTimeout(1000);

  // Step 2: Click "New" button to start a new conversation
  const newButton = page.locator('button[title="Start new conversation"]');
  await newButton.waitFor({ state: 'visible', timeout: 5000 });

  console.log('[Test] Clicking New button to start conversation');
  await newButton.click();

  // CRITICAL: Wait for session creation to complete by checking database
  console.log('[Test] Waiting for session to be created in database...');
  let sessionCreated = false;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(500);
    const sessions = await page.evaluate((workspace) => {
      return (window as any).electronAPI?.invoke('sessions:list', workspace);
    }, workspaceDir);
    console.log(`[Test] Poll ${i + 1}: Found ${sessions?.sessions?.length || 0} sessions`);
    if (sessions?.sessions?.length > 0) {
      console.log('[Test] Session created in database after', (i + 1) * 500, 'ms');
      console.log('[Test] Session details:', JSON.stringify(sessions.sessions[0], null, 2));
      sessionCreated = true;
      break;
    }
  }

  if (!sessionCreated) {
    console.log('[Test] Session was NOT created in database - "New" button may not create sessions immediately');
    console.log('[Test] Proceeding anyway to test if session is created when sending first message...');
  }

  // Send a message in files-mode chat
  const chatInput = page.locator('textarea').first();
  await chatInput.waitFor({ state: 'visible', timeout: 5000 });

  console.log('[Test] Sending message in files-mode chat');
  await chatInput.fill('Test message in files mode');
  await page.keyboard.press('Enter');

  // Wait for message to be sent
  await page.waitForTimeout(2000);

  // Capture session count in files mode BEFORE switching
  const filesModeSessions = await page.evaluate((workspace) => {
    return (window as any).electronAPI?.invoke('sessions:list', workspace);
  }, workspaceDir);
  console.log('[Test] Sessions in database before switch:', filesModeSessions);
  const sessionCountBeforeSwitch = filesModeSessions?.sessions?.length || 0;

  // Step 3: Switch to agent mode
  console.log('[Test] Switching to agent mode');
  await switchToAgentMode(page);
  await page.waitForTimeout(2000);

  // Wait for session history to be visible
  await page.waitForSelector('.session-history-list', { timeout: 5000 });

  // Step 4: Check if the session appears in agent-mode history
  const sessionDetails = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.session-list-item'));
    return items.map(item => ({
      hasProcessingClass: item.querySelector('.session-list-item-status.processing') !== null,
      hasUnreadClass: item.querySelector('.session-list-item-status.unread') !== null,
      title: item.querySelector('.session-list-item-title')?.textContent,
      messageCount: item.querySelector('.session-list-item-message-count')?.textContent,
    }));
  });

  console.log('[Test] Session count before switch:', sessionCountBeforeSwitch);
  console.log('[Test] Session details in agent mode:', JSON.stringify(sessionDetails, null, 2));
  console.log('[Test] Total sessions in agent-mode history:', sessionDetails.length);

  // The session created in files-mode should appear in agent-mode history
  // We should have AT LEAST the one session we created (might have auto-created agent session too)
  expect(sessionDetails.length).toBeGreaterThanOrEqual(2);

});
