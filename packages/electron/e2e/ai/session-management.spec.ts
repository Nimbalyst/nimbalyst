/**
 * Session Management E2E Tests
 *
 * Consolidated tests for AI session lifecycle including:
 * - Agent mode UI, session creation, sidebar
 * - Concurrent sessions and state isolation
 * - Cross-mode session visibility
 * - Session status indicators (Jotai atoms)
 * - Workstream session creation
 * - Child session persistence across refresh
 * - Worktree session persistence
 *
 * Consolidated from:
 *   agent-mode-comprehensive.spec.ts
 *   concurrent-sessions.spec.ts
 *   session-state-cross-mode.spec.ts
 *   session-status-indicators.spec.ts
 *   session-workstreams.spec.ts
 *   child-session-persistence.spec.ts
 *   worktree-session-persistence.spec.ts
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
} from '../helpers';
import {
  switchToAgentMode,
  switchToEditorMode,
  switchToFilesMode,
  submitChatPrompt,
  createNewAgentSession,
  switchToSessionTab,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
  PLAYWRIGHT_TEST_SELECTORS,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================================================
// SECTION 1: Agent Mode UI & Session Basics
// Tests that share a single app instance for agent mode UI interactions
// ============================================================================

test.describe('Agent Mode UI', () => {
  test.describe.configure({ mode: 'serial' });

  let electronApp: ElectronApplication;
  let page: Page;
  let workspacePath: string;

  test.beforeAll(async () => {
    workspacePath = await createTempWorkspace();

    // Create test files
    await fs.writeFile(
      path.join(workspacePath, 'test.md'),
      '# Test\n\nContent.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({ workspace: workspacePath });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
    await dismissProjectTrustToast(page);
    await dismissAPIKeyDialog(page);
  });

  test.afterAll(async () => {
    await electronApp?.close();
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should switch to agent mode and auto-select session', async () => {
    await openFileFromTree(page, 'test.md');
    await switchToAgentMode(page);

    // Session from Files mode should be auto-selected
    // Scope to .agent-mode to avoid strict mode violation (Files mode also has a chat input)
    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentChatInput);
    await expect(chatInput).toBeVisible({ timeout: 2000 });

    const sessionHistory = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory);
    await expect(sessionHistory).toBeVisible({ timeout: 2000 });
  });

  test('should submit message and clear input', async () => {
    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentChatInput);
    await expect(chatInput).toBeVisible({ timeout: 2000 });

    await submitChatPrompt(page, 'Test message');
    await page.waitForTimeout(500);

    const value = await chatInput.inputValue();
    expect(value).toBe('');
  });

  test('should create multiple sessions and show them in history', async () => {
    await createNewAgentSession(page);
    await page.waitForTimeout(300);

    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const sessionItems = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem);
    const sessionCount = await sessionItems.count();
    expect(sessionCount).toBeGreaterThanOrEqual(2);
  });

  test('should switch between sessions via sidebar', async () => {
    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const sessionItems = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem);
    const sessionCount = await sessionItems.count();
    expect(sessionCount).toBeGreaterThanOrEqual(2);

    await sessionItems.first().click();

    // Verify chat input is visible after session switch
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentChatInput);
    await expect(chatInput).toBeVisible({ timeout: 2000 });
  });

  test('should persist chat input across mode switches', async () => {
    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentChatInput);
    await chatInput.fill('Unsent message for persistence test');
    await page.waitForTimeout(200);

    await switchToEditorMode(page);
    await page.waitForTimeout(300);

    await switchToAgentMode(page);
    await page.waitForTimeout(300);

    const value = await chatInput.inputValue();
    expect(value).toContain('Unsent message for persistence test');
    await chatInput.clear();
  });

  test('should show all agent mode interface elements', async () => {
    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentChatInput);
    const sessionHistory = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory);
    const newSessionButton = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistoryNewButton);

    await expect(chatInput).toBeVisible({ timeout: 2000 });
    await expect(sessionHistory).toBeVisible({ timeout: 2000 });
    await expect(newSessionButton).toBeVisible({ timeout: 2000 });
  });
});

// ============================================================================
// SECTION 2: Concurrent Sessions
// Tests multi-session creation and state isolation
// ============================================================================

test.describe('Concurrent Sessions', () => {
  test.describe.configure({ mode: 'serial' });

  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeAll(async () => {
    workspaceDir = await createTempWorkspace();
    await fs.writeFile(
      path.join(workspaceDir, 'test.md'),
      '# Test\n\nContent.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
    await dismissProjectTrustToast(page);
  });

  test.afterAll(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should support multiple concurrent sessions without conflicts', async () => {
    await switchToAgentMode(page);

    // Create 2 additional sessions
    await createNewAgentSession(page);
    await page.waitForTimeout(300);
    await createNewAgentSession(page);
    await page.waitForTimeout(300);

    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const sessionCount = await agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem).count();
    expect(sessionCount).toBe(3);
  });

  test('should maintain separate message history per session', async () => {
    await switchToAgentMode(page);

    await createNewAgentSession(page);
    await page.waitForTimeout(500);

    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const sessionHistory = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory);

    // Send message to session 1
    await sessionHistory.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem).nth(0).click();
    await page.waitForTimeout(300);
    const chatInput1 = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentChatInput);
    await chatInput1.fill('Message only in session 1');
    await page.keyboard.press('Meta+Enter');
    await page.waitForTimeout(500);

    // Send message to session 2
    await sessionHistory.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem).nth(1).click();
    await page.waitForTimeout(300);
    const chatInput2 = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentChatInput);
    await chatInput2.fill('Message only in session 2');
    await page.keyboard.press('Meta+Enter');
    await page.waitForTimeout(500);

    // Verify session 1 doesn't have session 2's message
    await sessionHistory.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem).nth(0).click();
    await page.waitForTimeout(300);
    const activeSession1 = page.locator(PLAYWRIGHT_TEST_SELECTORS.activeSession);
    const session2MessageInSession1 = activeSession1.locator('text="Message only in session 2"');
    await expect(session2MessageInSession1).toHaveCount(0);

    // Verify session 2 doesn't have session 1's message
    await sessionHistory.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem).nth(1).click();
    await page.waitForTimeout(300);
    const activeSession2 = page.locator(PLAYWRIGHT_TEST_SELECTORS.activeSession);
    const session1MessageInSession2 = activeSession2.locator('text="Message only in session 1"');
    await expect(session1MessageInSession2).toHaveCount(0);
  });

  test('should support rapid session switching', async () => {
    await switchToAgentMode(page);

    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const sessionHistory = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory);

    // Get initial session count (from previous tests in serial mode)
    const initialCount = await agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem).count();

    await createNewAgentSession(page);
    await page.waitForTimeout(300);
    await createNewAgentSession(page);
    await page.waitForTimeout(300);

    // Verify we added 2 sessions
    const newCount = await agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem).count();
    expect(newCount).toBe(initialCount + 2);

    // Rapidly switch between the 3 most recent sessions
    const totalSessions = newCount;
    for (let i = 0; i < 10; i++) {
      const index = (totalSessions - 3) + (i % 3);
      await sessionHistory.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem).nth(index).click();
      await page.waitForTimeout(50);
    }
  });
});

// ============================================================================
// SECTION 3: Cross-Mode Session Visibility
// Tests that sessions created in one mode appear in another
// ============================================================================

test.describe('Cross-Mode Session Visibility', () => {
  test.describe.configure({ mode: 'serial' });

  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeAll(async () => {
    workspaceDir = await createTempWorkspace();
    await fs.writeFile(
      path.join(workspaceDir, 'test.md'),
      '# Test\n\nContent.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
    await dismissProjectTrustToast(page);
    await dismissAPIKeyDialog(page);
    await waitForWorkspaceReady(page);
  });

  test.afterAll(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('session created in files-mode appears in agent-mode history', async () => {
    // Start in files mode
    await switchToFilesMode(page);
    await page.waitForTimeout(500);

    await openFileFromTree(page, 'test.md');
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 2000 });

    // Open AI chat panel
    await page.keyboard.press('Meta+Shift+a');
    await page.waitForTimeout(500);

    // Start a new conversation
    const newButton = page.locator('button[title="Start new conversation"]');
    await newButton.waitFor({ state: 'visible', timeout: 2000 });
    await newButton.click();

    // Wait for session creation
    let sessionCreated = false;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(300);
      const sessions = await page.evaluate((workspace) => {
        return (window as any).electronAPI?.invoke('sessions:list', workspace);
      }, workspaceDir);
      if (sessions?.sessions?.length > 0) {
        sessionCreated = true;
        break;
      }
    }

    // Send a message in files-mode chat
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.filesChatInput);
    await chatInput.waitFor({ state: 'visible', timeout: 2000 });
    await chatInput.fill('Test message in files mode');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    // Switch to agent mode
    await switchToAgentMode(page);
    await page.waitForTimeout(1000);

    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    await agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistoryList).waitFor({ state: 'visible', timeout: 2000 });

    // Check the session appears in agent-mode history
    const sessionItems = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem);
    const sessionCount = await sessionItems.count();
    expect(sessionCount).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// SECTION 4: Session Status Indicators
// Tests Jotai atom-based session status indicators
// ============================================================================

test.describe('Session Status Indicators', () => {
  test.describe.configure({ mode: 'serial' });

  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeAll(async () => {
    workspaceDir = await createTempWorkspace();
    await fs.writeFile(
      path.join(workspaceDir, 'test.md'),
      '# Test\n\nContent.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
    await dismissProjectTrustToast(page);
    await dismissAPIKeyDialog(page);
  });

  test.afterAll(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('SessionHistory should not re-render excessively when processing state changes', async () => {
    await switchToAgentMode(page);
    await page.waitForTimeout(500);

    const sessionHistory = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory);
    await expect(sessionHistory).toBeVisible({ timeout: 2000 });
    await page.waitForTimeout(1000);

    // Capture render logs
    const logs: string[] = [];
    page.on('console', msg => logs.push(msg.text()));

    const newSessionButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistoryNewButton).first();
    if (await newSessionButton.isVisible()) {
      await newSessionButton.click();
      await page.waitForTimeout(300);
    }

    const sessionHistoryRenders = logs.filter(log => log.includes('[SessionHistory] render')).length;
    expect(sessionHistoryRenders).toBeLessThanOrEqual(2);
  });

  test('multiple sessions should have independent status indicators', async () => {
    const sessionHistory = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory);
    await expect(sessionHistory).toBeVisible({ timeout: 2000 });

    const sessionItems = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem);
    const count = await sessionItems.count();

    if (count > 0) {
      const firstItem = sessionItems.first();
      await expect(firstItem.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItemRight)).toBeVisible();
    }
  });

  test('switching sessions should clear unread indicator', async () => {
    const sessionHistory = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistory);
    await expect(sessionHistory).toBeVisible({ timeout: 2000 });

    const sessionItems = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem);
    const count = await sessionItems.count();

    if (count >= 2) {
      const secondSession = sessionItems.nth(1);
      await secondSession.click();
      await page.waitForTimeout(300);

      const unreadIndicator = secondSession.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItemStatusUnread);
      await expect(unreadIndicator).not.toBeVisible();
    }
  });
});

// ============================================================================
// SECTION 5: Workstream Sessions
// Tests workstream creation and UI
// ============================================================================

test.describe('Workstream Sessions', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspacePath: string;

  test.beforeAll(async () => {
    workspacePath = await createTempWorkspace();
    await fs.writeFile(
      path.join(workspacePath, 'test.md'),
      '# Test\n\nContent.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspacePath,
      permissionMode: 'allow-all',
    });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterAll(async () => {
    await electronApp?.close();
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should create workstream session and show workstream tabs', async () => {
    await switchToAgentMode(page);

    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentChatInput);
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Wait for session tab bar to appear (auto-selected session)
    const sessionTabBar = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabBar);
    await expect(sessionTabBar).toBeVisible({ timeout: 5000 });

    // Create a child session (converts to workstream)
    const addButton = sessionTabBar.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabNew);
    await expect(addButton).toBeVisible({ timeout: 3000 });
    await addButton.click();
    await page.waitForTimeout(1000);

    // Session list should show 1 session (parent only, children filtered out)
    const sessionItem = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionListItem);
    expect(await sessionItem.count()).toBe(1);

    // Session tabs should now show 2 tabs (parent + child)
    const sessionTabs = sessionTabBar.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabInWorkstream);
    await expect(sessionTabs).toHaveCount(2, { timeout: 5000 });
  });
});

// ============================================================================
// SECTION 6: Child Session Persistence
// Tests that selected child session persists across page refresh
// Requires its own app instance due to page.reload()
// ============================================================================

test.describe('Child Session Persistence', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspacePath: string;

  test.beforeAll(async () => {
    workspacePath = await createTempWorkspace();
    await fs.writeFile(
      path.join(workspacePath, 'test.md'),
      '# Test\n\nContent.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspacePath,
      permissionMode: 'allow-all',
    });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterAll(async () => {
    await electronApp?.close();
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should persist selected child session across page refresh', async () => {
    await switchToAgentMode(page);

    // Create a fresh session
    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    await createNewAgentSession(page);
    await page.waitForTimeout(1000);

    const sessionTabBar = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabBar);
    await expect(sessionTabBar).toBeVisible({ timeout: 10000 });

    const sessionTabs = sessionTabBar.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabInWorkstream);
    await expect(sessionTabs).toHaveCount(1, { timeout: 5000 });

    // Create 2 child sessions (converts to workstream)
    const addButton = sessionTabBar.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabNew);
    await expect(addButton).toBeVisible({ timeout: 3000 });
    await addButton.click();
    await page.waitForTimeout(2000);
    await expect(sessionTabs).toHaveCount(2, { timeout: 5000 });

    await addButton.click();
    await page.waitForTimeout(1500);
    await expect(sessionTabs).toHaveCount(3, { timeout: 5000 });

    // Verify children appear in sidebar
    const workstreamChildren = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistoryList).locator(PLAYWRIGHT_TEST_SELECTORS.workstreamSessionItem);
    await expect(workstreamChildren).toHaveCount(3, { timeout: 5000 });

    // Select the second tab
    const secondTab = sessionTabs.nth(1);
    const secondTabTitle = await secondTab.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabTitle).textContent();
    await secondTab.click();
    await page.waitForTimeout(500);
    await expect(secondTab).toHaveClass(/active/, { timeout: 3000 });

    // Wait for persistence
    await page.waitForTimeout(2000);

    // Reload the page
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Verify state was restored
    await expect(sessionTabBar).toBeVisible({ timeout: 10000 });

    const tabsAfterReload = sessionTabBar.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabInWorkstream);
    await expect(tabsAfterReload).toHaveCount(3, { timeout: 5000 });

    // The second tab should still be active
    const activeTab = sessionTabBar.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabActive);
    await expect(activeTab).toBeVisible({ timeout: 5000 });

    if (secondTabTitle) {
      const activeTabTitle = await activeTab.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTabTitle).textContent();
      expect(activeTabTitle).toBe(secondTabTitle);
    } else {
      const secondTabAfterReload = tabsAfterReload.nth(1);
      await expect(secondTabAfterReload).toHaveClass(/active/, { timeout: 3000 });
    }
  });
});

// ============================================================================
// SECTION 7: Worktree Session Persistence
// Tests worktree creation and persistence after app relaunch
// Requires git init + separate app lifecycle
// ============================================================================

test.describe('Worktree Session Persistence', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspacePath: string;

  test.beforeAll(async () => {
    workspacePath = await createTempWorkspace();

    // Initialize git repo (required for worktrees)
    const { execSync } = await import('child_process');
    execSync('git init', { cwd: workspacePath });
    execSync('git config user.email "test@test.com"', { cwd: workspacePath });
    execSync('git config user.name "Test User"', { cwd: workspacePath });

    await fs.writeFile(
      path.join(workspacePath, 'test.md'),
      '# Test\n\nContent.\n',
      'utf8'
    );
    execSync('git add .', { cwd: workspacePath });
    execSync('git commit -m "Initial commit"', { cwd: workspacePath });

    electronApp = await launchElectronApp({
      workspace: workspacePath,
      permissionMode: 'allow-all',
    });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterAll(async () => {
    await electronApp?.close();
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
    const worktreeDir = `${workspacePath}_worktrees`;
    await fs.rm(worktreeDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should create worktree session and persist after relaunch', async () => {
    test.setTimeout(60000);

    await switchToAgentMode(page);
    await page.waitForTimeout(500);

    // Open dropdown to create worktree session
    const agentMode = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const newButton = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistoryNewButton);
    await expect(newButton).toBeVisible({ timeout: 3000 });
    await newButton.click();

    const dropdownMenu = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.sessionHistoryNewMenu);
    await expect(dropdownMenu).toBeVisible({ timeout: 3000 });

    const newWorktreeButton = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.newWorktreeSessionButton);
    await expect(newWorktreeButton).toBeVisible({ timeout: 3000 });
    await newWorktreeButton.click();

    await page.waitForTimeout(3000);

    // Verify worktree session was created
    const worktreeGroup = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.worktreeGroup);
    const worktreeSingle = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.worktreeSingle);
    const worktreeElement = worktreeGroup.or(worktreeSingle);
    await expect(worktreeElement).toBeVisible({ timeout: 5000 });

    // Get the worktree name
    const workstreamGroupName = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.workstreamGroupName);
    const worktreeSingleName = agentMode.locator(PLAYWRIGHT_TEST_SELECTORS.worktreeSingleNameRow);
    const worktreeNameElement = workstreamGroupName.or(worktreeSingleName);
    const worktreeName = await worktreeNameElement.textContent();
    expect(worktreeName).toBeTruthy();

    // Relaunch app
    await electronApp.close();
    electronApp = await launchElectronApp({
      workspace: workspacePath,
      permissionMode: 'allow-all',
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    await switchToAgentMode(page);
    await page.waitForTimeout(2000);

    // Verify the worktree session persisted
    const agentModeAfterReload = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentMode);
    const worktreeGroupAfterReload = agentModeAfterReload.locator(PLAYWRIGHT_TEST_SELECTORS.worktreeGroup);
    const worktreeSingleAfterReload = agentModeAfterReload.locator(PLAYWRIGHT_TEST_SELECTORS.worktreeSingle);
    const worktreeElementAfterReload = worktreeGroupAfterReload.or(worktreeSingleAfterReload);
    await expect(worktreeElementAfterReload).toBeVisible({ timeout: 5000 });

    // Verify the name is the same
    const workstreamGroupNameAfterReload = agentModeAfterReload.locator(PLAYWRIGHT_TEST_SELECTORS.workstreamGroupName);
    const worktreeSingleNameAfterReload = agentModeAfterReload.locator(PLAYWRIGHT_TEST_SELECTORS.worktreeSingleNameRow);
    const worktreeNameElementAfterReload = workstreamGroupNameAfterReload.or(worktreeSingleNameAfterReload);
    const nameAfterReload = await worktreeNameElementAfterReload.textContent();
    expect(nameAfterReload).toBe(worktreeName);

    // Verify clicking loads the session
    await worktreeElementAfterReload.click();
    await page.waitForTimeout(1000);

    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentChatInput);
    await expect(chatInput).toBeVisible({ timeout: 5000 });
  });
});
