import { test, expect } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS } from '../helpers';
import type { ElectronApplication, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const ACTIVE_EDITOR_SELECTOR = '.editor [contenteditable="true"]';

test.describe('Slash Command Typeahead', () => {
  let electronApp: ElectronApplication;
  let mainWindow: Page;
  let tempDir: string;

  test.beforeEach(async () => {
    tempDir = await createTempWorkspace();

    // Create .claude/commands directory with test commands
    const commandsDir = path.join(tempDir, '.claude', 'commands');
    fs.mkdirSync(commandsDir, { recursive: true });

    // Create test custom commands
    fs.writeFileSync(
      path.join(commandsDir, 'test-analyze.md'),
      `---
name: analyze
description: Analyze code for issues
---

Analyze the code for quality, performance, and security issues.`
    );

    fs.writeFileSync(
      path.join(commandsDir, 'test-refactor.md'),
      `---
name: refactor
description: Refactor code to improve structure
---

Refactor the selected code to improve its structure and maintainability.`
    );

    electronApp = await launchElectronApp({ workspace: tempDir });
    mainWindow = await electronApp.firstWindow();
    await mainWindow.waitForLoadState('domcontentloaded');
    await mainWindow.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should show slash command typeahead when typing "/" in agentic coding', async () => {
    test.setTimeout(60000);

    // Open a plan document to access agentic coding
    // First, create a test plan document
    const plansDir = path.join(tempDir, 'plans');
    fs.mkdirSync(plansDir, { recursive: true });
    const planPath = path.join(plansDir, 'test-plan.md');
    fs.writeFileSync(planPath, `---
planStatus:
  planId: test-plan
  title: Test Plan
  status: draft
  planType: feature
  priority: medium
  owner: test
  stakeholders: []
  tags: []
  created: "2025-10-12"
  updated: "2025-10-12T00:00:00.000Z"
  progress: 0
---

# Test Plan

Test plan document.
`);

    // Open the plan document in the editor
    await mainWindow.click(`text=test-plan.md`);
    await mainWindow.waitForTimeout(1000);

    // Open agentic coding via the plan status widget
    // Look for the "Open Agentic Coding" button in the plan status widget
    const agenticButton = mainWindow.locator('button:has-text("Open Agentic Coding")');
    await agenticButton.waitFor({ state: 'visible', timeout: 5000 });
    await agenticButton.click();
    await mainWindow.waitForTimeout(2000);

    // Get the agentic coding window
    const windows = electronApp.windows();
    const agenticWindow = windows.find(w => w.url().includes('agentic-coding'));
    expect(agenticWindow).toBeDefined();

    // Wait for the input field to be available
    const inputSelector = '.ai-chat-input-field';
    await agenticWindow!.waitForSelector(inputSelector, { timeout: 10000 });

    // Type "/" to trigger slash command typeahead
    await agenticWindow!.fill(inputSelector, '/');
    await agenticWindow!.waitForTimeout(500);

    // Verify typeahead appears
    const typeaheadSelector = '.generic-typeahead';
    await agenticWindow!.waitForSelector(typeaheadSelector, { timeout: 5000 });

    // Verify typeahead is visible
    const isVisible = await agenticWindow!.isVisible(typeaheadSelector);
    expect(isVisible).toBe(true);

    // Verify at least some commands are shown
    const menuItems = await agenticWindow!.locator('.generic-typeahead-option').count();
    expect(menuItems).toBeGreaterThan(0);
  });

  test('should show built-in slash commands', async () => {
    test.setTimeout(TEST_TIMEOUTS.AI_INTERACTION);

    // Open agentic coding window
    await mainWindow.click('text=Open Agentic Coding');
    await mainWindow.waitForTimeout(2000);

    const windows = electronApp.windows();
    const agenticWindow = windows.find(w => w.url().includes('agentic-coding'));

    const inputSelector = '.ai-chat-input-field';
    await agenticWindow!.waitForSelector(inputSelector);

    // Type "/" to trigger slash command typeahead
    await agenticWindow!.fill(inputSelector, '/');
    await agenticWindow!.waitForTimeout(500);

    const typeaheadSelector = '.typeahead-menu';
    await agenticWindow!.waitForSelector(typeaheadSelector);

    // Verify built-in commands are present
    const menuText = await agenticWindow!.locator('.typeahead-menu').textContent();
    expect(menuText).toContain('compact');
    expect(menuText).toContain('Built-in Commands');
  });

  test('should show custom project commands', async () => {
    test.setTimeout(TEST_TIMEOUTS.AI_INTERACTION);

    // Open agentic coding window
    await mainWindow.click('text=Open Agentic Coding');
    await mainWindow.waitForTimeout(2000);

    const windows = electronApp.windows();
    const agenticWindow = windows.find(w => w.url().includes('agentic-coding'));

    const inputSelector = '.ai-chat-input-field';
    await agenticWindow!.waitForSelector(inputSelector);

    // Type "/" to trigger slash command typeahead
    await agenticWindow!.fill(inputSelector, '/');
    await agenticWindow!.waitForTimeout(500);

    const typeaheadSelector = '.typeahead-menu';
    await agenticWindow!.waitForSelector(typeaheadSelector);

    // Verify custom commands are present
    const menuText = await agenticWindow!.locator('.typeahead-menu').textContent();
    expect(menuText).toContain('analyze');
    expect(menuText).toContain('refactor');
    expect(menuText).toContain('Project Commands');
  });

  test('should filter commands based on query', async () => {
    test.setTimeout(TEST_TIMEOUTS.AI_INTERACTION);

    // Open agentic coding window
    await mainWindow.click('text=Open Agentic Coding');
    await mainWindow.waitForTimeout(2000);

    const windows = electronApp.windows();
    const agenticWindow = windows.find(w => w.url().includes('agentic-coding'));

    const inputSelector = '.ai-chat-input-field';
    await agenticWindow!.waitForSelector(inputSelector);

    // Type "/ana" to filter commands
    await agenticWindow!.fill(inputSelector, '/ana');
    await agenticWindow!.waitForTimeout(500);

    const typeaheadSelector = '.typeahead-menu';
    await agenticWindow!.waitForSelector(typeaheadSelector);

    // Verify only matching commands are shown
    const menuText = await agenticWindow!.locator('.typeahead-menu').textContent();
    expect(menuText).toContain('analyze');
    expect(menuText).not.toContain('refactor');
  });

  test('should insert command when selected', async () => {
    test.setTimeout(TEST_TIMEOUTS.AI_INTERACTION);

    // Open agentic coding window
    await mainWindow.click('text=Open Agentic Coding');
    await mainWindow.waitForTimeout(2000);

    const windows = electronApp.windows();
    const agenticWindow = windows.find(w => w.url().includes('agentic-coding'));

    const inputSelector = '.ai-chat-input-field';
    await agenticWindow!.waitForSelector(inputSelector);

    // Type "/" to trigger slash command typeahead
    await agenticWindow!.fill(inputSelector, '/');
    await agenticWindow!.waitForTimeout(500);

    const typeaheadSelector = '.typeahead-menu';
    await agenticWindow!.waitForSelector(typeaheadSelector);

    // Press Enter to select first command
    await agenticWindow!.press(inputSelector, 'Enter');
    await agenticWindow!.waitForTimeout(300);

    // Verify command was inserted
    const inputValue = await agenticWindow!.inputValue(inputSelector);
    expect(inputValue).toMatch(/^\/\w+\s/); // Should start with /command followed by space
  });

  test('should navigate commands with arrow keys', async () => {
    test.setTimeout(TEST_TIMEOUTS.AI_INTERACTION);

    // Open agentic coding window
    await mainWindow.click('text=Open Agentic Coding');
    await mainWindow.waitForTimeout(2000);

    const windows = electronApp.windows();
    const agenticWindow = windows.find(w => w.url().includes('agentic-coding'));

    const inputSelector = '.ai-chat-input-field';
    await agenticWindow!.waitForSelector(inputSelector);

    // Type "/" to trigger slash command typeahead
    await agenticWindow!.fill(inputSelector, '/');
    await agenticWindow!.waitForTimeout(500);

    const typeaheadSelector = '.typeahead-menu';
    await agenticWindow!.waitForSelector(typeaheadSelector);

    // Press arrow down to select next command
    await agenticWindow!.press(inputSelector, 'ArrowDown');
    await agenticWindow!.waitForTimeout(200);

    // Verify a command is highlighted
    const selectedOption = await agenticWindow!.locator('.typeahead-option.selected');
    expect(await selectedOption.count()).toBeGreaterThan(0);
  });

  test('should close typeahead on Escape', async () => {
    test.setTimeout(TEST_TIMEOUTS.AI_INTERACTION);

    // Open agentic coding window
    await mainWindow.click('text=Open Agentic Coding');
    await mainWindow.waitForTimeout(2000);

    const windows = electronApp.windows();
    const agenticWindow = windows.find(w => w.url().includes('agentic-coding'));

    const inputSelector = '.ai-chat-input-field';
    await agenticWindow!.waitForSelector(inputSelector);

    // Type "/" to trigger slash command typeahead
    await agenticWindow!.fill(inputSelector, '/');
    await agenticWindow!.waitForTimeout(500);

    const typeaheadSelector = '.typeahead-menu';
    await agenticWindow!.waitForSelector(typeaheadSelector);

    // Press Escape to close
    await agenticWindow!.press(inputSelector, 'Escape');
    await agenticWindow!.waitForTimeout(300);

    // Verify typeahead is closed
    const isVisible = await agenticWindow!.isVisible(typeaheadSelector);
    expect(isVisible).toBe(false);
  });
});
