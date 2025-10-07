import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

const TEST_TIMEOUTS = {
  SHORT: 5000,
  MEDIUM: 10000,
  LONG: 20000,
  VERY_LONG: 60000
};

const ACTIVE_EDITOR_SELECTOR = '.editor [contenteditable="true"]';

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

test.describe('Agentic Coding Window', () => {
  test.beforeEach(async () => {
    workspacePath = await createTempWorkspace();

    // Create a plan document
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
- Test agentic coding window
`);

    // Launch app with workspace
    electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test' }
    });

    // Wait for window to be ready
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.LONG });

    // Open the plan document
    await page.evaluate(async (planPath) => {
      await window.electronAPI.invoke('workspace:open-file', {
        workspacePath: window.location.search.match(/workspacePath=([^&]+)/)?.[1],
        filePath: planPath
      });
    }, planPath);
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should open agentic coding window from menu', async ({ }, testInfo) => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Trigger the menu item via keyboard shortcut
    await page.keyboard.press('Meta+Alt+A'); // Cmd+Alt+A on Mac

    // Wait for new window to open
    await page.waitForTimeout(2000);

    const windows = electronApp.windows();
    expect(windows.length).toBeGreaterThan(1);

    // Find the agentic coding window
    const agenticWindow = windows.find(w =>
      w.url().includes('mode=agentic-coding')
    );

    expect(agenticWindow).toBeDefined();
    if (!agenticWindow) return;

    // Wait for window to load
    await agenticWindow.waitForLoadState('domcontentloaded');

    // Check for header
    const header = agenticWindow.locator('h1:has-text("Agentic Coding Session")');
    await expect(header).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });

    // Check for plan document reference
    const planRef = agenticWindow.locator('text=/Plan:.*plan\\.md/');
    await expect(planRef).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });
  });

  test('should create new session on window load', async ({ }, testInfo) => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Open agentic coding window via IPC
    const planPath = path.join(workspacePath, 'plan.md');
    const result = await page.evaluate(async ({ workspacePath, planPath }) => {
      return await window.electronAPI.invoke('agentic-coding:create-window', {
        workspacePath,
        planDocumentPath: planPath
      });
    }, { workspacePath, planPath });

    expect(result.success).toBe(true);
    expect(result.windowId).toBeDefined();

    // Get the new window
    await page.waitForTimeout(2000);
    const windows = electronApp.windows();
    const agenticWindow = windows.find(w =>
      w.url().includes('mode=agentic-coding')
    );

    expect(agenticWindow).toBeDefined();
    if (!agenticWindow) return;

    await agenticWindow.waitForLoadState('domcontentloaded');

    // Check that session was created (no error message)
    const errorMessage = agenticWindow.locator('text=/Failed to load session/');
    await expect(errorMessage).not.toBeVisible({ timeout: TEST_TIMEOUTS.SHORT });

    // Check for transcript panel
    const transcript = agenticWindow.locator('[class*="transcript"]').first();
    await expect(transcript).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });
  });

  test('should show sidebar tabs', async ({ }, testInfo) => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Open agentic coding window via IPC
    const planPath = path.join(workspacePath, 'plan.md');
    await page.evaluate(async ({ workspacePath, planPath }) => {
      return await window.electronAPI.invoke('agentic-coding:create-window', {
        workspacePath,
        planDocumentPath: planPath
      });
    }, { workspacePath, planPath });

    await page.waitForTimeout(2000);
    const windows = electronApp.windows();
    const agenticWindow = windows.find(w =>
      w.url().includes('mode=agentic-coding')
    );

    if (!agenticWindow) {
      throw new Error('Agentic coding window not found');
    }

    await agenticWindow.waitForLoadState('domcontentloaded');

    // Check for sidebar tabs
    const promptsTab = agenticWindow.locator('button:has-text("Prompts")');
    const filesTab = agenticWindow.locator('button:has-text("Files")');
    const tasksTab = agenticWindow.locator('button:has-text("Tasks")');

    await expect(promptsTab).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });
    await expect(filesTab).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });
    await expect(tasksTab).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });

    // Click on Files tab
    await filesTab.click();
    await expect(filesTab).toHaveClass(/border-interactive/, { timeout: TEST_TIMEOUTS.SHORT });

    // Click on Tasks tab
    await tasksTab.click();
    await expect(tasksTab).toHaveClass(/border-interactive/, { timeout: TEST_TIMEOUTS.SHORT });
  });

  test('should show error when no workspace is open', async ({ }, testInfo) => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Try to open agentic coding window without workspace via IPC
    const result = await page.evaluate(async () => {
      return await window.electronAPI.invoke('agentic-coding:create-window', {
        workspacePath: '',
        planDocumentPath: undefined
      });
    });

    expect(result.success).toBe(true);

    // Window should still be created but show error message
    await page.waitForTimeout(1000);
    const windows = electronApp.windows();
    const agenticWindow = windows.find(w =>
      w.url().includes('mode=agentic-coding')
    );

    if (agenticWindow) {
      await agenticWindow.waitForLoadState('domcontentloaded');
      const errorMessage = agenticWindow.locator('text=/Missing workspace path/');
      await expect(errorMessage).toBeVisible({ timeout: TEST_TIMEOUTS.MEDIUM });
    }
  });
});
