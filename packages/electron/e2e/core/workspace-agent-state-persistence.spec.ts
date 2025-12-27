import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Workspace-Agent Window State Persistence', () => {
  let workspacePath: string;

  test.beforeEach(async () => {
    workspacePath = await createTempWorkspace();

    // Create test files
    await fs.writeFile(
      path.join(workspacePath, 'test1.md'),
      '# Test Document 1\n\nContent for test 1\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(workspacePath, 'test2.md'),
      '# Test Document 2\n\nContent for test 2\n',
      'utf8'
    );

    // Create a plan document for agentic coding window
    const planPath = path.join(workspacePath, 'plan.md');
    await fs.writeFile(planPath, `---
planStatus:
  planId: test-plan
  title: Test Plan
  status: draft
  planType: feature
  priority: high
---
# Test Plan

## Goals
- Test workspace-agent state persistence
`);
  });

  test.afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should preserve workspace tabs after opening agent window and reopening', async () => {
    test.setTimeout(30000);

    // Launch app
    let electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' }    });

    let page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Open test1.md
    await page.locator('.file-tree-name', { hasText: 'test1.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });
    await page.locator('.file-tree-name', { hasText: 'test1.md' }).click();
    await page.waitForTimeout(1000);

    // Open test2.md in a new tab
    await page.locator('.file-tree-name', { hasText: 'test2.md' }).click();
    await page.waitForTimeout(1000);

    // Verify we have 2 tabs
    const tabs = await page.locator('.file-tabs-container .tab').count();
    expect(tabs).toBe(2);

    // Open the plan document
    await page.locator('.file-tree-name', { hasText: 'plan.md' }).click();
    await page.waitForTimeout(1000);

    // Now we should have 3 tabs
    const tabsAfterPlan = await page.locator('.file-tabs-container .tab').count();
    expect(tabsAfterPlan).toBe(3);

    // Open agentic coding window via IPC
    const planPath = path.join(workspacePath, 'plan.md');
    await page.evaluate(async ({ workspacePath, planDocumentPath }) => {
      await window.electronAPI.invoke('agentic-coding:create-window', {
        workspacePath,
        planDocumentPath
      });
    }, { workspacePath, planDocumentPath: planPath });

    await page.waitForTimeout(2000);

    // Verify we have 2 windows
    let windows = electronApp.windows();
    expect(windows.length).toBe(2);

    // Find the agentic window
    const agenticWindow = windows.find(w => w.url().includes('mode=agentic-coding'));
    expect(agenticWindow).toBeDefined();
    if (!agenticWindow) throw new Error('Agentic window not found');

    await agenticWindow.waitForLoadState('domcontentloaded');
    await agenticWindow.waitForTimeout(1000);

    // Focus the workspace window
    await page.evaluate(() => window.electronAPI.invoke('window:force-focus'));
    await page.waitForTimeout(500);

    // Close the app
    await electronApp.close();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // FIRST REOPEN - This is where tabs might disappear
    console.log('[TEST] First reopen - checking for disappearing tabs bug');
    electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' }    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    windows = electronApp.windows();
    const firstReopenWorkspace = windows.find(w => w.url().includes('mode=workspace') || !w.url().includes('mode='));
    expect(firstReopenWorkspace).toBeDefined();
    if (!firstReopenWorkspace) throw new Error('Workspace window not found on first reopen');

    await firstReopenWorkspace.waitForLoadState('domcontentloaded');
    await firstReopenWorkspace.waitForTimeout(2000);

    // CRITICAL: Check that tabs are present on first reopen
    const tabsOnFirstReopen = await firstReopenWorkspace.locator('.file-tabs-container .tab').count();
    console.log('[TEST] Tabs on first reopen:', tabsOnFirstReopen);
    expect(tabsOnFirstReopen).toBeGreaterThanOrEqual(3);

    // Verify tab content is correct
    const tabTexts = await firstReopenWorkspace.locator('.file-tabs-container .tab').allTextContents();
    console.log('[TEST] Tab texts on first reopen:', tabTexts);
    expect(tabTexts.some(t => t.includes('test1.md'))).toBe(true);
    expect(tabTexts.some(t => t.includes('test2.md'))).toBe(true);
    expect(tabTexts.some(t => t.includes('plan.md'))).toBe(true);

    // Close and reopen AGAIN
    await electronApp.close();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // SECOND REOPEN - This is where agent session might appear in workspace
    console.log('[TEST] Second reopen - checking for agent session in workspace bug');
    electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' }    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    windows = electronApp.windows();
    const secondReopenWorkspace = windows.find(w => w.url().includes('mode=workspace') || !w.url().includes('mode='));
    expect(secondReopenWorkspace).toBeDefined();
    if (!secondReopenWorkspace) throw new Error('Workspace window not found on second reopen');

    await secondReopenWorkspace.waitForLoadState('domcontentloaded');
    await secondReopenWorkspace.waitForTimeout(2000);

    // CRITICAL: Verify this is still a workspace window, not an agent window
    const url = secondReopenWorkspace.url();
    console.log('[TEST] Second reopen workspace URL:', url);
    expect(url).not.toContain('mode=agentic-coding');
    expect(url).toMatch(/mode=workspace|localhost:\d+\/?$/);

    // Verify workspace sidebar is present (not agent UI)
    const workspaceSidebar = await secondReopenWorkspace.locator('.workspace-sidebar').isVisible().catch(() => false);
    expect(workspaceSidebar).toBe(true);

    // Verify we DON'T have agent UI elements
    const agenticHeader = await secondReopenWorkspace.locator('h1:has-text("Agentic Coding Session")').isVisible().catch(() => false);
    expect(agenticHeader).toBe(false);

    // Verify tabs are still present on second reopen
    const tabsOnSecondReopen = await secondReopenWorkspace.locator('.file-tabs-container .tab').count();
    console.log('[TEST] Tabs on second reopen:', tabsOnSecondReopen);
    expect(tabsOnSecondReopen).toBeGreaterThanOrEqual(3);

    await electronApp.close();
  });

  test('should maintain separate state for workspace and agent windows across multiple reopens', async () => {
    test.setTimeout(30000);

    // Launch app
    let electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' }    });

    let page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Open files in workspace
    await page.locator('.file-tree-name', { hasText: 'test1.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });
    await page.locator('.file-tree-name', { hasText: 'test1.md' }).click();
    await page.waitForTimeout(500);

    // Open agent window
    const planPath = path.join(workspacePath, 'plan.md');
    await page.evaluate(async ({ workspacePath, planDocumentPath }) => {
      await window.electronAPI.invoke('agentic-coding:create-window', {
        workspacePath,
        planDocumentPath
      });
    }, { workspacePath, planDocumentPath: planPath });

    await page.waitForTimeout(2000);

    let windows = electronApp.windows();
    let agenticWindow = windows.find(w => w.url().includes('mode=agentic-coding'));
    expect(agenticWindow).toBeDefined();
    if (!agenticWindow) throw new Error('Agentic window not found');

    await agenticWindow.waitForLoadState('domcontentloaded');
    await agenticWindow.waitForTimeout(1000);

    // Verify agent window has correct UI
    const agenticHeader = await agenticWindow.locator('h1:has-text("Agentic Coding Session")').isVisible();
    expect(agenticHeader).toBe(true);

    // Close both windows
    await electronApp.close();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Reopen and verify both windows restore correctly
    for (let i = 0; i < 3; i++) {
      console.log(`[TEST] Reopen iteration ${i + 1}`);

      electronApp = await launchElectronApp({
        workspace: workspacePath,
        env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' }
      });

      await new Promise(resolve => setTimeout(resolve, 3000));

      windows = electronApp.windows();

      // Find workspace window
      const workspaceWindow = windows.find(w => w.url().includes('mode=workspace') || (!w.url().includes('mode=agentic-coding') && !w.url().includes('agent')));
      expect(workspaceWindow).toBeDefined();
      if (!workspaceWindow) throw new Error(`Workspace window not found on iteration ${i + 1}`);

      await workspaceWindow.waitForLoadState('domcontentloaded');
      await workspaceWindow.waitForTimeout(1000);

      // Verify workspace window characteristics
      const hasSidebar = await workspaceWindow.locator('.workspace-sidebar').isVisible().catch(() => false);
      const hasAgentHeader = await workspaceWindow.locator('h1:has-text("Agentic Coding Session")').isVisible().catch(() => false);

      console.log(`[TEST] Iteration ${i + 1}: hasSidebar=${hasSidebar}, hasAgentHeader=${hasAgentHeader}`);

      expect(hasSidebar).toBe(true);
      expect(hasAgentHeader).toBe(false);

      // Verify URL doesn't contain agent mode
      const wsUrl = workspaceWindow.url();
      console.log(`[TEST] Iteration ${i + 1}: workspace URL=${wsUrl}`);
      expect(wsUrl).not.toContain('mode=agentic-coding');

      // Find agent window
      agenticWindow = windows.find(w => w.url().includes('mode=agentic-coding'));
      if (agenticWindow) {
        await agenticWindow.waitForLoadState('domcontentloaded');
        await agenticWindow.waitForTimeout(1000);

        // Verify agent window characteristics
        const agUrl = agenticWindow.url();
        console.log(`[TEST] Iteration ${i + 1}: agent URL=${agUrl}`);
        expect(agUrl).toContain('mode=agentic-coding');

        const agHasHeader = await agenticWindow.locator('h1:has-text("Agentic Coding Session")').isVisible().catch(() => false);
        const agHasSidebar = await agenticWindow.locator('.workspace-sidebar').isVisible().catch(() => false);

        console.log(`[TEST] Iteration ${i + 1}: agent hasHeader=${agHasHeader}, hasSidebar=${agHasSidebar}`);

        expect(agHasHeader).toBe(true);
        expect(agHasSidebar).toBe(false);
      }

      await electronApp.close();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  test('should not mix workspace and agent state when switching between windows', async () => {
    test.setTimeout(30000);

    // Launch app
    let electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' }    });

    let page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Open multiple files in workspace
    await page.locator('.file-tree-name', { hasText: 'test1.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });
    await page.locator('.file-tree-name', { hasText: 'test1.md' }).click();
    await page.waitForTimeout(500);

    await page.locator('.file-tree-name', { hasText: 'test2.md' }).click();
    await page.waitForTimeout(500);

    const workspaceTabCount = await page.locator('.file-tabs-container .tab').count();
    console.log('[TEST] Workspace tab count before opening agent:', workspaceTabCount);
    expect(workspaceTabCount).toBeGreaterThanOrEqual(2);

    // Open agent window
    const planPath = path.join(workspacePath, 'plan.md');
    await page.evaluate(async ({ workspacePath, planDocumentPath }) => {
      await window.electronAPI.invoke('agentic-coding:create-window', {
        workspacePath,
        planDocumentPath
      });
    }, { workspacePath, planDocumentPath: planPath });

    await page.waitForTimeout(2000);

    let windows = electronApp.windows();
    const agenticWindow = windows.find(w => w.url().includes('mode=agentic-coding'));
    expect(agenticWindow).toBeDefined();
    if (!agenticWindow) throw new Error('Agentic window not found');

    await agenticWindow.waitForLoadState('domcontentloaded');
    await agenticWindow.waitForTimeout(1000);

    // Switch focus between windows multiple times
    for (let i = 0; i < 3; i++) {
      console.log(`[TEST] Focus switch iteration ${i + 1}`);

      // Focus workspace
      await page.evaluate(() => window.electronAPI.invoke('window:force-focus'));
      await page.waitForTimeout(500);

      // Verify workspace still has workspace UI
      const wsSidebar = await page.locator('.workspace-sidebar').isVisible().catch(() => false);
      const wsAgentHeader = await page.locator('h1:has-text("Agentic Coding Session")').isVisible().catch(() => false);

      console.log(`[TEST] Workspace after focus ${i + 1}: hasSidebar=${wsSidebar}, hasAgentHeader=${wsAgentHeader}`);
      expect(wsSidebar).toBe(true);
      expect(wsAgentHeader).toBe(false);

      // Focus agent
      await agenticWindow.evaluate(() => window.electronAPI.invoke('window:force-focus'));
      await agenticWindow.waitForTimeout(500);

      // Verify agent still has agent UI
      const agHeader = await agenticWindow.locator('h1:has-text("Agentic Coding Session")').isVisible().catch(() => false);
      const agSidebar = await agenticWindow.locator('.workspace-sidebar').isVisible().catch(() => false);

      console.log(`[TEST] Agent after focus ${i + 1}: hasHeader=${agHeader}, hasSidebar=${agSidebar}`);
      expect(agHeader).toBe(true);
      expect(agSidebar).toBe(false);
    }

    // Final verification after switching - workspace tabs should still be present
    const finalTabCount = await page.locator('.file-tabs-container .tab').count();
    console.log('[TEST] Workspace tab count after focus switching:', finalTabCount);
    expect(finalTabCount).toBe(workspaceTabCount);

    await electronApp.close();
  });
});
