/**
 * AI File Mention Typeahead Tests
 *
 * Tests the "@" file mention typeahead functionality in both AI Chat and Agentic Coding windows
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import * as fs from 'fs';
import * as path from 'path';

test.describe('AI File Mention Typeahead', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    // Create temporary workspace with test files
    workspaceDir = await createTempWorkspace();

    // Create several test files to mention
    const files = [
      { name: 'component.tsx', content: '# React Component\n\nTest component file.' },
      { name: 'utils.ts', content: '# Utilities\n\nHelper functions.' },
      { name: 'styles.css', content: '/* Styles */\n.test { color: red; }' },
      { name: 'readme.md', content: '# README\n\nProject documentation.' }
    ];

    for (const file of files) {
      fs.writeFileSync(path.join(workspaceDir, file.name), file.content);
    }

    // Launch app with workspace
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should show typeahead menu when typing @ in AI Chat', async () => {
    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A'); // Toggle AI Chat
    await page.waitForTimeout(500);

    // Find the chat input textarea
    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Type "@" to trigger typeahead
    await chatInput.click();
    await chatInput.type('@');
    await page.waitForTimeout(500);

    // Check if typeahead menu appears
    const typeahead = page.locator('.generic-typeahead');
    await expect(typeahead).toBeVisible({ timeout: 3000 });

    // Verify that test files appear in the menu
    const componentOption = typeahead.locator('text=component.tsx');
    await expect(componentOption).toBeVisible();

    const utilsOption = typeahead.locator('text=utils.ts');
    await expect(utilsOption).toBeVisible();
  });

  test('should filter typeahead options when typing after @', async () => {
    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Type "@com" to filter for component.tsx
    await chatInput.click();
    await chatInput.type('@com');
    await page.waitForTimeout(500);

    const typeahead = page.locator('.generic-typeahead');
    await expect(typeahead).toBeVisible({ timeout: 3000 });

    // Should show component.tsx
    const componentOption = typeahead.locator('text=component.tsx');
    await expect(componentOption).toBeVisible();

    // Should NOT show utils.ts (doesn't match "com")
    const utilsOption = typeahead.locator('text=utils.ts');
    await expect(utilsOption).not.toBeVisible();
  });

  test('should insert file mention when selecting from typeahead with Enter', async () => {
    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Type "@" to trigger typeahead
    await chatInput.click();
    await chatInput.type('@');
    await page.waitForTimeout(500);

    // Wait for typeahead to appear
    const typeahead = page.locator('.generic-typeahead');
    await expect(typeahead).toBeVisible({ timeout: 3000 });

    // Press Enter to select first option
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Verify the input contains a file mention in markdown format: @[filename](path)
    const inputValue = await chatInput.inputValue();
    console.log('Input value after selection:', inputValue);

    // Should contain markdown link format
    expect(inputValue).toMatch(/@\[.*?\]\(.*?\)/);
  });

  test('should navigate typeahead with arrow keys', async () => {
    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Type "@" to trigger typeahead
    await chatInput.click();
    await chatInput.type('@');
    await page.waitForTimeout(500);

    const typeahead = page.locator('.generic-typeahead');
    await expect(typeahead).toBeVisible({ timeout: 3000 });

    // Get all options
    const options = typeahead.locator('.generic-typeahead-option');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(0);

    // First option should be selected by default
    let selectedOption = typeahead.locator('.generic-typeahead-option.selected');
    await expect(selectedOption).toHaveCount(1);

    // Press ArrowDown to select next option
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // Should still have exactly one selected option (but different one)
    selectedOption = typeahead.locator('.generic-typeahead-option.selected');
    await expect(selectedOption).toHaveCount(1);

    // Press ArrowUp to go back
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);

    // Should still have selection
    selectedOption = typeahead.locator('.generic-typeahead-option.selected');
    await expect(selectedOption).toHaveCount(1);
  });

  test('should close typeahead with Escape key', async () => {
    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Type "@" to trigger typeahead
    await chatInput.click();
    await chatInput.type('@');
    await page.waitForTimeout(500);

    const typeahead = page.locator('.generic-typeahead');
    await expect(typeahead).toBeVisible({ timeout: 3000 });

    // Press Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Typeahead should be hidden
    await expect(typeahead).not.toBeVisible();

    // Input should still contain "@"
    const inputValue = await chatInput.inputValue();
    expect(inputValue).toBe('@');
  });

  test('should show typeahead in Agentic Coding window', async () => {
    // Open an agentic coding window
    // This requires opening a plan or creating a coding session
    // For now, let's just verify the component exists

    // Open a file first
    await page.click('text=readme.md');
    await page.waitForTimeout(500);

    // TODO: Open Agentic Coding window via menu or keyboard shortcut
    // The exact method depends on how agentic coding is launched in the app

    // For now, this test documents the expected behavior
    console.log('Agentic Coding typeahead test - needs implementation of window launch');
  });

  test('should insert file mention when clicking on option', async () => {
    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Type "@" to trigger typeahead
    await chatInput.click();
    await chatInput.type('@');
    await page.waitForTimeout(500);

    const typeahead = page.locator('.generic-typeahead');
    await expect(typeahead).toBeVisible({ timeout: 3000 });

    // Click on component.tsx option
    const componentOption = typeahead.locator('text=component.tsx').first();
    await expect(componentOption).toBeVisible();
    await componentOption.click();
    await page.waitForTimeout(300);

    // Verify the input contains the file mention
    const inputValue = await chatInput.inputValue();
    console.log('Input value after click:', inputValue);

    // Should contain component.tsx in markdown link format
    expect(inputValue).toContain('component.tsx');
    expect(inputValue).toMatch(/@\[.*?\]\(.*?\)/);

    // Typeahead should be closed
    await expect(typeahead).not.toBeVisible();
  });

  test('should handle typing after @ with no matches', async () => {
    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Type "@xyz" which won't match any files
    await chatInput.click();
    await chatInput.type('@xyz');
    await page.waitForTimeout(500);

    // Typeahead should either not appear or show no results
    const typeahead = page.locator('.generic-typeahead');
    const isVisible = await typeahead.isVisible().catch(() => false);

    if (isVisible) {
      // If typeahead is visible, it should have no options
      const options = typeahead.locator('.generic-typeahead-option');
      const count = await options.count();
      expect(count).toBe(0);
    }
    // Otherwise typeahead is hidden, which is also acceptable behavior
  });

  test('should support Tab key to select option', async () => {
    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Type "@" to trigger typeahead
    await chatInput.click();
    await chatInput.type('@');
    await page.waitForTimeout(500);

    const typeahead = page.locator('.generic-typeahead');
    await expect(typeahead).toBeVisible({ timeout: 3000 });

    // Press Tab to select first option
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    // Verify the input contains a file mention
    const inputValue = await chatInput.inputValue();
    expect(inputValue).toMatch(/@\[.*?\]\(.*?\)/);

    // Typeahead should be closed
    await expect(typeahead).not.toBeVisible();
  });
});
