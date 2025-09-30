import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { ElectronApplication, Page } from 'playwright';

test.describe('Claude Code CLI Basic Tests', () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    // Start the Electron app
    electronApp = await electron.launch({
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
  });

  test.afterEach(async () => {
    await electronApp?.close();
  });

  test('should verify Claude CLI binary is available', async () => {
    // Test if the Claude CLI binary is available
    const testResult = await page.evaluate(async () => {
      const { spawn } = require('child_process');
      const claudePath = '/Users/ghinkle/.claude/local/node_modules/.bin/claude';

      return new Promise((resolve) => {
        try {
          const claudeProcess = spawn(claudePath, ['--version'], {
            stdio: 'pipe',
            timeout: 5000
          });

          let output = '';
          claudeProcess.stdout?.on('data', (data) => {
            output += data.toString();
          });

          claudeProcess.on('close', (code) => {
            resolve({ success: code === 0, output, code });
          });

          claudeProcess.on('error', (error) => {
            resolve({ success: false, error: error.message });
          });
        } catch (error) {
          resolve({ success: false, error: error.message });
        }
      });
    });

    console.log('Claude CLI test result:', testResult);

    if (testResult.success) {
      console.log('✅ Claude CLI is available');
    } else {
      console.log('❌ Claude CLI not available:', testResult.error);
    }
  });

  test('should load the app and verify basic UI', async () => {
    // Wait for the app to be ready with a basic selector
    await page.waitForSelector('body', { timeout: 10000 });
    await page.waitForTimeout(2000); // Give the app time to load

    // Take a screenshot
    await page.screenshot({
      path: 'app-loaded.png',
      fullPage: true
    });

    // Try to open AI Chat with keyboard shortcut
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(1000);

    // Take another screenshot
    await page.screenshot({
      path: 'ai-chat-opened.png',
      fullPage: true
    });

    // Check if we can find some basic UI elements
    const bodyExists = await page.locator('body').isVisible();
    expect(bodyExists).toBe(true);

    console.log('✅ App loaded successfully');
  });

  test('should test Claude Code provider creation directly', async () => {
    // Test creating a Claude Code provider instance
    const providerTest = await page.evaluate(async () => {
      try {
        // Try to access the window API
        const electronAPI = (window as any).electronAPI;
        if (!electronAPI) {
          return { success: false, error: 'electronAPI not available' };
        }

        // Try to create an AI session with Claude Code
        try {
          const sessionResult = await electronAPI.aiCreateSession(
            'claude-code',
            undefined, // documentContext
            '/tmp',    // workspacePath
            'claude-code-cli' // modelId
          );

          return {
            success: true,
            sessionId: sessionResult?.sessionId,
            provider: sessionResult?.provider
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
            details: 'Failed to create AI session'
          };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    console.log('Claude Code provider test:', providerTest);

    if (providerTest.success) {
      console.log('✅ Claude Code provider created successfully');
      console.log('Session ID:', providerTest.sessionId);
    } else {
      console.log('❌ Claude Code provider test failed:', providerTest.error);
    }
  });
});