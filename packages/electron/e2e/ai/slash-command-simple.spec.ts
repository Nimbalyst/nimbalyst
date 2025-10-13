/**
 * Simple Slash Command Typeahead Test
 * Tests basic "/" typeahead functionality
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Slash Command Typeahead - Simple', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    // Create temporary workspace
    workspaceDir = await createTempWorkspace();

    // Create .claude/commands directory with test commands
    const commandsDir = path.join(workspaceDir, '.claude', 'commands');
    fs.mkdirSync(commandsDir, { recursive: true });

    // Create test custom command
    fs.writeFileSync(
      path.join(commandsDir, 'test-command.md'),
      `---
name: test
description: A test command
---

This is a test command.`
    );

    // Launch app with workspace
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('should show slash command typeahead when typing "/" in Coding Mode', async () => {
    test.setTimeout(60000);

    // Click on "Coding Mode" icon in left nav gutter
    const codingModeButton = page.locator('[data-testid="coding-mode-button"], button[title="Coding Mode"], .nav-icon-coding-mode');
    await codingModeButton.waitFor({ state: 'visible', timeout: 10000 });
    await codingModeButton.click();
    await page.waitForTimeout(2000);

    // Get the agentic coding window
    const windows = electronApp.windows();
    console.log('Number of windows:', windows.length);

    const agenticWindow = windows.find(w => w.url().includes('agentic-coding'));

    if (!agenticWindow) {
      console.log('Available windows:', windows.map(w => w.url()));
      throw new Error('Agentic coding window not found');
    }

    // Debug: check what's in the agentic window
    await agenticWindow.waitForTimeout(3000);
    const htmlContent = await agenticWindow.content();
    console.log('Agentic window HTML contains .ai-chat-input-field:', htmlContent.includes('ai-chat-input-field'));
    console.log('Agentic window HTML contains textarea:', htmlContent.includes('<textarea'));

    // Try multiple possible selectors for the input
    const possibleSelectors = [
      '.ai-chat-input-field',
      'textarea',
      'textarea[placeholder*="Type"]',
      'textarea[placeholder*="message"]',
      'input[type="text"]',
      '.agentic-input textarea'
    ];

    let chatInput = null;
    for (const selector of possibleSelectors) {
      const elem = agenticWindow.locator(selector).first();
      const isVisible = await elem.isVisible().catch(() => false);
      console.log(`Selector "${selector}" visible:`, isVisible);
      if (isVisible) {
        chatInput = elem;
        break;
      }
    }

    if (!chatInput) {
      console.log('No input found, taking screenshot');
      await agenticWindow.screenshot({ path: 'agentic-window-no-input.png', fullPage: true });
      throw new Error('Could not find chat input in agentic window');
    }

    // Type "/" to trigger typeahead
    await chatInput.click();
    await chatInput.type('/');
    await agenticWindow.waitForTimeout(1000);

    // Check if typeahead menu appears
    const typeahead = agenticWindow.locator('.generic-typeahead');
    const isVisible = await typeahead.isVisible().catch(() => false);

    console.log('Typeahead visible:', isVisible);

    if (isVisible) {
      // Count options
      const options = await typeahead.locator('.generic-typeahead-option').count();
      console.log('Number of options:', options);

      // Get text of all options
      const optionTexts = await typeahead.locator('.generic-typeahead-option').allTextContents();
      console.log('Options:', optionTexts);

      expect(options).toBeGreaterThan(0);
    } else {
      console.log('Typeahead not visible - taking screenshot');
      await agenticWindow.screenshot({ path: 'typeahead-not-visible.png', fullPage: true });

      // Check what's actually in the DOM
      const hasInput = await chatInput.isVisible();
      console.log('Input visible:', hasInput);

      const inputValue = await chatInput.inputValue();
      console.log('Input value:', inputValue);

      // Fail with useful info
      throw new Error('Typeahead did not appear after typing "/"');
    }
  });

  test('should show custom command in typeahead', async () => {
    test.setTimeout(60000);

    // Click on "Coding Mode" icon in left nav gutter
    const codingModeButton = page.locator('[data-testid="coding-mode-button"], button[title="Coding Mode"], .nav-icon-coding-mode');
    await codingModeButton.waitFor({ state: 'visible', timeout: 10000 });
    await codingModeButton.click();
    await page.waitForTimeout(2000);

    // Get the agentic coding window
    const windows = electronApp.windows();
    const agenticWindow = windows.find(w => w.url().includes('agentic-coding'));
    expect(agenticWindow).toBeDefined();

    // Wait for the input field
    const chatInput = agenticWindow!.locator('.ai-chat-input-field');
    await chatInput.waitFor({ state: 'visible', timeout: 10000 });

    // Type "/" to trigger typeahead
    await chatInput.click();
    await chatInput.fill('/');
    await page.waitForTimeout(1000);

    const typeahead = agenticWindow!.locator('.generic-typeahead');
    await expect(typeahead).toBeVisible({ timeout: 5000 });

    // Should show our custom "test" command
    const testCommand = typeahead.locator('text=/test');
    const testCommandVisible = await testCommand.isVisible().catch(() => false);

    console.log('Test command visible:', testCommandVisible);

    if (!testCommandVisible) {
      const allOptions = await typeahead.locator('.generic-typeahead-option').allTextContents();
      console.log('All options:', allOptions);
    }

    expect(testCommandVisible).toBe(true);
  });
});
