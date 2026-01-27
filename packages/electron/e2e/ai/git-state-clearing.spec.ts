/**
 * E2E test for git state clearing after commit
 *
 * Verifies that after a commit is made via the GitOperationsPanel in smart mode,
 * the state clears properly and the UI returns to showing the "Commit with AI" button.
 *
 * This test simulates an AI commit proposal via IPC and tests the full commit flow.
 */

import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  switchToAgentMode,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Initialize a git repository in the workspace
  const { execSync } = await import('child_process');
  execSync('git init', { cwd: workspaceDir });
  execSync('git config user.email "test@example.com"', { cwd: workspaceDir });
  execSync('git config user.name "Test User"', { cwd: workspaceDir });

  // Create initial test file and commit it
  await fs.writeFile(path.join(workspaceDir, 'test.md'), '# Initial Content\n', 'utf8');
  execSync('git add test.md', { cwd: workspaceDir });
  execSync('git commit -m "Initial commit"', { cwd: workspaceDir });

  // Modify the file to create uncommitted changes
  await fs.writeFile(path.join(workspaceDir, 'test.md'), '# Modified Content\n\nSome changes here.\n', 'utf8');

  // Launch app with the workspace
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

test('should clear git state and show "Commit with AI" button after commit in smart mode', async () => {
  // Switch to agent mode
  await switchToAgentMode(page);
  await page.waitForTimeout(1000);

  // Click on the existing "Chat" session
  const existingSession = page.getByRole('button', { name: /Session:.*Chat/i });
  await existingSession.waitFor({ state: 'visible', timeout: 5000 });
  await existingSession.click();
  await page.waitForTimeout(1000);

  // Get session ID
  const sessionId = await page.evaluate(async ({ workspacePath }) => {
    if (!window.electronAPI) return null;
    try {
      const result = await window.electronAPI.invoke('sessions:list', workspacePath, { includeArchived: false });
      if (result.success && result.sessions?.length > 0) {
        const sorted = result.sessions.sort((a: any, b: any) =>
          new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
        );
        return sorted[0].id;
      }
    } catch (e) {
      console.error('[Test] Failed to list sessions:', e);
    }
    return null;
  }, { workspacePath: workspaceDir });

  console.log('[Test] Session ID:', sessionId);

  if (!sessionId) {
    await page.screenshot({ path: '/tmp/git-test-no-session.png' });
    throw new Error('Could not find session ID');
  }

  // Verify the git operations panel is visible
  const gitPanel = page.locator(PLAYWRIGHT_TEST_SELECTORS.gitOperationsPanel);
  await expect(gitPanel).toBeVisible({ timeout: 5000 });

  // Verify we start in smart mode with "Commit with AI" button
  const commitWithAiButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.gitOperationsCommitWithAiButton);
  await expect(commitWithAiButton).toBeVisible({ timeout: 5000 });

  // Take screenshot of initial state
  await page.screenshot({ path: '/tmp/git-test-initial-state.png' });

  // Simulate an AI commit proposal by sending an IPC event from main process
  // This mimics what happens when Claude calls the git_commit_proposal tool
  const proposalId = `test-proposal-${Date.now()}`;
  const testFilePath = path.join(workspaceDir, 'test.md');

  // Send the IPC event via Electron's BrowserWindow API
  await electronApp.evaluate(async ({ BrowserWindow }, { proposalId, workspacePath, sessionId, filePath }) => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].webContents.send('mcp:gitCommitProposal', {
        proposalId,
        workspacePath,
        sessionId,
        filesToStage: [filePath],
        commitMessage: 'Test commit from E2E\n\nThis tests the git state clearing functionality.',
        reasoning: 'Testing that git state clears after commit',
      });
    }
  }, { proposalId, workspacePath: workspaceDir, sessionId, filePath: testFilePath });

  // Wait for the proposal to be processed
  await page.waitForTimeout(1000);

  // Take screenshot after proposal
  await page.screenshot({ path: '/tmp/git-test-after-proposal.png' });

  // Verify the proposal UI appeared - commit message should be visible
  const commitMessageTextarea = page.locator(PLAYWRIGHT_TEST_SELECTORS.gitOperationsCommitMessage);
  await expect(commitMessageTextarea).toBeVisible({ timeout: 5000 });

  // Verify the commit message contains our test message
  const messageValue = await commitMessageTextarea.inputValue();
  expect(messageValue).toContain('Test commit from E2E');

  // Verify the commit button is visible (not the "Commit with AI" button)
  const commitButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.gitOperationsCommitButton);
  await expect(commitButton).toBeVisible({ timeout: 3000 });

  // The "Commit with AI" button should NOT be visible when proposal is active
  await expect(commitWithAiButton).not.toBeVisible({ timeout: 1000 });

  // Take screenshot before commit
  await page.screenshot({ path: '/tmp/git-test-before-commit.png' });

  // Click the commit button
  await commitButton.click();

  // Wait for commit to complete
  await page.waitForTimeout(3000);

  // Take screenshot after commit
  await page.screenshot({ path: '/tmp/git-test-after-commit.png' });

  // CRITICAL ASSERTION: After commit, the "Commit with AI" button should be visible again
  // This verifies the git state was properly cleared
  await expect(commitWithAiButton).toBeVisible({ timeout: 5000 });

  // The commit message textarea should NOT be visible (no active proposal)
  await expect(commitMessageTextarea).not.toBeVisible({ timeout: 3000 });

  // The commit button should NOT be visible (only shows when proposal is active)
  await expect(commitButton).not.toBeVisible({ timeout: 3000 });

  // Verify the git commit actually happened
  const { execSync } = await import('child_process');
  const gitLog = execSync('git log --oneline -1', { cwd: workspaceDir }).toString().trim();
  console.log('[Test] Latest commit:', gitLog);
  expect(gitLog).toContain('Test commit from E2E');
});
