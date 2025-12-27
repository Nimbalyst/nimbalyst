import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Window Restore Order', () => {
  let workspacePath: string;

  test.beforeEach(async () => {
    workspacePath = await createTempWorkspace();

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
- Test window ordering
`);

    // Create a test file
    await fs.writeFile(path.join(workspacePath, 'test.md'), '# Test Document\n\nTest content\n', 'utf8');
  });

  test.afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should restore windows in correct focus order', async () => {
    test.setTimeout(20000);

    // Launch app with workspace - enable session restoration
    let electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' },
    });

    let page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Open the plan document to set up for agentic coding window
    await page.locator('.file-tree-name', { hasText: 'plan.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });
    await page.locator('.file-tree-name', { hasText: 'plan.md' }).click();

    // Wait for the file to open
    await page.waitForTimeout(1000);

    // Open agentic coding window via IPC
    const planPath = path.join(workspacePath, 'plan.md');
    await page.evaluate(async ({ workspacePath, planDocumentPath }) => {
      await window.electronAPI.invoke('agentic-coding:create-window', {
        workspacePath,
        planDocumentPath
      });
    }, { workspacePath, planDocumentPath: planPath });

    // Wait for new window to open
    await page.waitForTimeout(2000);

    // Verify we have 2 windows
    let windows = electronApp.windows();
    expect(windows.length).toBe(2);

    // Find the agentic coding window
    const agenticWindow = windows.find(w => w.url().includes('mode=agentic-coding'));
    expect(agenticWindow).toBeDefined();
    if (!agenticWindow) throw new Error('Agentic window not found');

    // Wait for agentic window to load
    await agenticWindow.waitForLoadState('domcontentloaded');
    await agenticWindow.waitForTimeout(1000);

    // Force focus the workspace window (make it the last focused)
    await page.evaluate(() => window.electronAPI.invoke('window:force-focus'));
    await page.waitForTimeout(500);

    // Verify workspace window has focus before closing
    const workspaceFocusedBeforeClose = await page.evaluate(() =>
      window.electronAPI.invoke('window:is-focused')
    );
    console.log('[TEST] Workspace BrowserWindow.isFocused() before close:', workspaceFocusedBeforeClose);

    // Close the app - this should trigger session save
    await electronApp.close();

    // Wait a bit to ensure session is saved
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Relaunch the app with session restoration enabled
    electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' },
    });

    // Wait for windows to be restored
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get all windows
    windows = electronApp.windows();
    console.log('[TEST] Restored windows count:', windows.length);
    console.log('[TEST] Window URLs:', windows.map(w => w.url()));

    // Filter out any non-app windows
    const appWindows = windows.filter(w =>
      w.url().includes('localhost') || w.url().includes('mode=')
    );
    console.log('[TEST] App windows count (after filtering):', appWindows.length);

    // Should have 2 windows restored (or more if there were previous session windows)
    // Filter to only the workspace and agentic windows for this test
    expect(windows.length).toBeGreaterThanOrEqual(2);

    // Find the windows
    const restoredWorkspace = windows.find(w => w.url().includes('mode=workspace') || !w.url().includes('mode='));
    const restoredAgentic = windows.find(w => w.url().includes('mode=agentic-coding'));

    expect(restoredWorkspace).toBeDefined();
    expect(restoredAgentic).toBeDefined();

    if (!restoredWorkspace || !restoredAgentic) {
      throw new Error('Windows not properly restored');
    }

    // Wait for windows to be fully loaded and focus to settle
    await restoredWorkspace.waitForLoadState('domcontentloaded');
    await restoredAgentic.waitForLoadState('domcontentloaded');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Longer wait for focus to settle

    // The critical test: verify which window is focused
    // Use Playwright's context to check which window is actually focused
    const workspaceTitle = await restoredWorkspace.title();
    const agenticTitle = await restoredAgentic.title();

    console.log('[TEST] Workspace title:', workspaceTitle);
    console.log('[TEST] Agentic title:', agenticTitle);

    // Check using Electron's isFocused() API (more reliable than document.hasFocus())
    const workspaceElectronFocused = await restoredWorkspace.evaluate(() =>
      window.electronAPI.invoke('window:is-focused')
    );
    const agenticElectronFocused = await restoredAgentic.evaluate(() =>
      window.electronAPI.invoke('window:is-focused')
    );

    console.log('[TEST] Workspace BrowserWindow.isFocused():', workspaceElectronFocused);
    console.log('[TEST] Agentic BrowserWindow.isFocused():', agenticElectronFocused);

    // The workspace window should be focused (it was the last one we focused)
    expect(workspaceElectronFocused).toBe(true);
    expect(agenticElectronFocused).toBe(false);

    // Clean up
    await electronApp.close();
  });

  test('should restore agentic window in front when it was last focused', async () => {
    test.setTimeout(20000);

    // Launch app with workspace - enable session restoration
    let electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' },
    });

    let page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Open the plan document
    await page.locator('.file-tree-name', { hasText: 'plan.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });
    await page.locator('.file-tree-name', { hasText: 'plan.md' }).click();
    await page.waitForTimeout(1000);

    // Open agentic coding window
    const planPath2 = path.join(workspacePath, 'plan.md');
    await page.evaluate(async ({ workspacePath, planDocumentPath }) => {
      await window.electronAPI.invoke('agentic-coding:create-window', {
        workspacePath,
        planDocumentPath
      });
    }, { workspacePath, planDocumentPath: planPath2 });
    await page.waitForTimeout(2000);

    let windows = electronApp.windows();
    const agenticWindow = windows.find(w => w.url().includes('mode=agentic-coding'));
    expect(agenticWindow).toBeDefined();
    if (!agenticWindow) throw new Error('Agentic window not found');

    await agenticWindow.waitForLoadState('domcontentloaded');
    await agenticWindow.waitForTimeout(1000);

    // Force focus the AGENTIC window (make it the last focused)
    await agenticWindow.evaluate(() => window.electronAPI.invoke('window:force-focus'));
    await agenticWindow.waitForTimeout(500);

    // Verify agentic window has focus before closing
    const agenticFocusedBeforeClose = await agenticWindow.evaluate(() =>
      window.electronAPI.invoke('window:is-focused')
    );
    console.log('[TEST] Agentic BrowserWindow.isFocused() before close:', agenticFocusedBeforeClose);

    // Close the app
    await electronApp.close();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Relaunch with session restoration
    electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test', ENABLE_SESSION_RESTORE: '1' },
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    windows = electronApp.windows();
    expect(windows.length).toBe(2);

    const restoredWorkspace = windows.find(w => w.url().includes('mode=workspace') || !w.url().includes('mode='));
    const restoredAgentic = windows.find(w => w.url().includes('mode=agentic-coding'));

    expect(restoredWorkspace).toBeDefined();
    expect(restoredAgentic).toBeDefined();

    if (!restoredWorkspace || !restoredAgentic) {
      throw new Error('Windows not properly restored');
    }

    await restoredWorkspace.waitForLoadState('domcontentloaded');
    await restoredAgentic.waitForLoadState('domcontentloaded');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // The agentic window should be focused (it was the last one we focused)
    const workspaceElectronFocused = await restoredWorkspace.evaluate(() =>
      window.electronAPI.invoke('window:is-focused')
    );
    const agenticElectronFocused = await restoredAgentic.evaluate(() =>
      window.electronAPI.invoke('window:is-focused')
    );

    console.log('[TEST] Workspace BrowserWindow.isFocused():', workspaceElectronFocused);
    console.log('[TEST] Agentic BrowserWindow.isFocused():', agenticElectronFocused);

    expect(workspaceElectronFocused).toBe(false);
    expect(agenticElectronFocused).toBe(true);

    await electronApp.close();
  });
});
