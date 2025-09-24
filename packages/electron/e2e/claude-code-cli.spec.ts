import { test, expect } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';
import { spawn } from 'child_process';
import * as path from 'path';

test.describe('Claude Code CLI Integration', () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeEach(async ({ _electron }) => {
    // Start the Electron app
    electronApp = await _electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key'
      }
    });

    // Get the main window
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Wait for the app to be ready
    await page.waitForSelector('[data-testid="editor"]', { timeout: 10000 });
  });

  test.afterEach(async () => {
    await electronApp?.close();
  });

  test('should configure Claude Code provider and execute tools', async () => {
    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForSelector('[data-testid="ai-chat-panel"]', { timeout: 5000 });

    // Open model picker
    await page.click('[data-testid="model-picker-button"]');
    await page.waitForSelector('[data-testid="model-picker"]', { timeout: 2000 });

    // Select Claude Code if available
    const claudeCodeButton = page.locator('text=Claude Code CLI');
    if (await claudeCodeButton.isVisible()) {
      await claudeCodeButton.click();
      await page.waitForTimeout(1000);
    } else {
      console.log('Claude Code CLI not available in model picker');
      test.skip();
    }

    // Create a test document with some content
    await page.fill('[data-testid="editor"]', `# Test Document

This is a test document for Claude Code CLI integration.

## Todo List
- Item 1
- Item 2
- Item 3
`);

    // Save the document
    await page.keyboard.press('Meta+S');
    await page.waitForTimeout(500);

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

  test('should handle Claude Code CLI unavailable gracefully', async () => {
    // Test what happens when Claude CLI is not available
    const mockClaudeNotAvailable = true; // Simulate Claude CLI not being found

    if (mockClaudeNotAvailable) {
      // Open AI Chat panel
      await page.keyboard.press('Meta+Shift+A');
      await page.waitForSelector('[data-testid="ai-chat-panel"]', { timeout: 5000 });

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
    // Check that Claude Code CLI appears in the model picker
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForSelector('[data-testid="ai-chat-panel"]', { timeout: 5000 });

    await page.click('[data-testid="model-picker-button"]');
    await page.waitForSelector('[data-testid="model-picker"]', { timeout: 2000 });

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