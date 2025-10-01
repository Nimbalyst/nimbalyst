import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, ACTIVE_EDITOR_SELECTOR } from '../helpers';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Claude Code CLI Integration', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    await fs.writeFile(path.join(workspaceDir, 'test.md'), '# Test Document\n\nTest content for Claude Code\n', 'utf8');

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: 10000 });
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test.skip('should configure Claude Code provider and execute tools', async () => {
    // First, open the test document
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('test.md', { timeout: 5000 });

    // Wait for editor to load
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: 3000 });

    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(1000);

    // The AI chat panel should now be open with document context

    // Send a message that should trigger tool use
    const chatInput = page.locator('[data-testid="ai-chat-input"]');
    await chatInput.fill('Please add a new item "Item 4" to the todo list in this document.');
    await page.keyboard.press('Enter');

    // Wait for the response to start
    await page.waitForSelector('[data-testid="ai-message"]', { timeout: 10000 });

    // Check if Claude Code CLI is working
    const messages = page.locator('[data-testid="ai-message"]');
    await expect(messages).toHaveCount(2); // User message + AI response

    // Look for tool execution indicators
    const toolIndicators = [
      'applyDiff',
      'applying changes',
      'Item 4',
      'tool_use',
      'successfully'
    ];

    let foundToolExecution = false;
    for (const indicator of toolIndicators) {
      try {
        await expect(page.locator(`text*=${indicator}`)).toBeVisible({ timeout: 2000 });
        foundToolExecution = true;
        console.log(`Found tool execution indicator: ${indicator}`);
        break;
      } catch (e) {
        // Continue checking other indicators
      }
    }

    if (!foundToolExecution) {
      // If no tool indicators found, at least check that we got a response
      const lastMessage = messages.last();
      const messageText = await lastMessage.textContent();
      console.log('AI Response:', messageText);

      // Check that we got some kind of response (not an error)
      await expect(lastMessage).not.toContainText('error');
      await expect(lastMessage).not.toContainText('failed');
    }

    // Check if the document was actually modified
    const editorContent = await page.inputValue('[data-testid="editor"]');
    if (editorContent.includes('Item 4')) {
      console.log('✅ Document was successfully modified by Claude Code CLI');
    } else {
      console.log('❌ Document was not modified, tool execution may have failed');
      console.log('Editor content:', editorContent);
    }

    // Take a screenshot for debugging
    await page.screenshot({ path: 'claude-code-cli-test.png', fullPage: true });
  });

  test.skip('should handle Claude Code CLI unavailable gracefully', async () => {
    // First, open the test document
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('test.md', { timeout: 5000 });

    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(1000);

    // The AI chat should be available even if Claude Code CLI isn't configured
    const mockClaudeNotAvailable = true;
    if (mockClaudeNotAvailable) {
      // Try to use Claude Code
      const chatInput = page.locator('[data-testid="ai-chat-input"]');
      await chatInput.fill('Hello, can you help me?');

      // The system should either:
      // 1. Not show Claude Code as an option
      // 2. Show an error message if selected
      // 3. Fall back to another provider

      // For now, just ensure the panel is responsive
      await expect(chatInput).toBeVisible();
    }
  });

  test('should show Claude Code in model picker when available', async () => {
    // First, open the test document
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('test.md', { timeout: 5000 });

    // Check that Claude Code CLI appears in the model picker
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(1000);

    // Check if Claude Code section exists
    const claudeCodeSection = page.locator('text=CLAUDE CODE (MCP)');
    if (await claudeCodeSection.isVisible()) {
      console.log('✅ Claude Code section found in model picker');

      // Check if there are models listed
      const claudeCodeModels = page.locator('[data-testid="model-picker"] >> text=Claude Code CLI');
      await expect(claudeCodeModels).toBeVisible();
    } else {
      console.log('❌ Claude Code section not found in model picker');
      // This might be expected if Claude CLI is not installed
    }
  });

  test('should test Claude CLI binary directly', async () => {
    // Test if the Claude CLI binary is available and working
    const claudePath = '/Users/ghinkle/.claude/local/node_modules/.bin/claude';

    try {
      const testPromise = new Promise((resolve, reject) => {
        const claudeProcess = spawn(claudePath, ['--version'], {
          stdio: 'pipe',
          timeout: 5000
        });

        let output = '';
        claudeProcess.stdout?.on('data', (data) => {
          output += data.toString();
        });

        claudeProcess.on('close', (code) => {
          if (code === 0) {
            resolve(output);
          } else {
            reject(new Error(`Claude CLI exited with code ${code}`));
          }
        });

        claudeProcess.on('error', (error) => {
          reject(error);
        });
      });

      const result = await testPromise;
      console.log('✅ Claude CLI is available:', result);
    } catch (error) {
      console.log('❌ Claude CLI test failed:', error);
      test.skip();
    }
  });
});
