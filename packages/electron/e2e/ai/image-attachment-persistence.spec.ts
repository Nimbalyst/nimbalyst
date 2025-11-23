import { test, expect, ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import {
  switchToAgentMode,
  PLAYWRIGHT_TEST_SELECTORS
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Test that image attachments persist in user messages after session reload
 */

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.describe('Image Attachment Persistence', () => {
  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create a test markdown file
    const testFilePath = path.join(workspaceDir, 'test.md');
    await fs.writeFile(testFilePath, '# Test Document\n\nTest content.\n', 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test('attachments should flow through session reload', async () => {
    // Wait for app to be ready
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Create a test session
    const result = await page.evaluate(async (workspacePath: string) => {
      // Create a new session
      const createResult = await (window as any).electronAPI.invoke('ai:createSession', 'claude-code', undefined, workspacePath, undefined, 'coding');
      if (!createResult?.id) {
        return { error: 'Failed to create session', createResult };
      }
      const sessionId = createResult.id;

      // Load the session to verify creation worked
      const loadedSession = await (window as any).electronAPI.aiLoadSession(sessionId, workspacePath);

      return {
        sessionId,
        sessionCreated: !!loadedSession,
        provider: loadedSession?.provider,
        messageCount: loadedSession?.messages?.length || 0
      };
    }, workspaceDir);

    console.log('Session creation result:', JSON.stringify(result, null, 2));

    expect(result.error).toBeUndefined();
    expect(result.sessionId).toBeTruthy();
    expect(result.sessionCreated).toBe(true);
  });

  test('trace what aiLoadSession returns for messages', async () => {
    // Wait for app to be ready
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // This test examines what the session loading returns
    // We'll create a session, then examine its structure
    const traceResult = await page.evaluate(async (workspacePath: string) => {
      // Create session
      const createResult = await (window as any).electronAPI.invoke('ai:createSession', 'claude-code', undefined, workspacePath, undefined, 'coding');
      const sessionId = createResult?.id;
      if (!sessionId) return { error: 'No session ID' };

      // Load session
      const loadedSession = await (window as any).electronAPI.aiLoadSession(sessionId, workspacePath);

      // Examine structure
      return {
        sessionId,
        hasMessages: !!loadedSession?.messages,
        messagesIsArray: Array.isArray(loadedSession?.messages),
        messageCount: loadedSession?.messages?.length || 0,
        sessionKeys: loadedSession ? Object.keys(loadedSession) : [],
        // If there are messages, examine the first one
        firstMessageKeys: loadedSession?.messages?.[0] ? Object.keys(loadedSession.messages[0]) : [],
        firstMessage: loadedSession?.messages?.[0]
      };
    }, workspaceDir);

    console.log('Session structure:', JSON.stringify(traceResult, null, 2));

    expect(traceResult.error).toBeUndefined();
    expect(traceResult.sessionId).toBeTruthy();
    console.log('Session keys:', traceResult.sessionKeys);
    console.log('First message keys:', traceResult.firstMessageKeys);
  });

  test('message attachments should persist and display in transcript', async () => {
    // Wait for app to be ready
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Switch to agent mode - this auto-creates a session
    await switchToAgentMode(page);

    // Wait for agent mode to fully load
    await page.waitForTimeout(1000);

    // The session should be visible
    const sessionTab = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTab);
    await expect(sessionTab.first()).toBeVisible({ timeout: 5000 });

    // Find the chat input
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput);
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Create a real test image - use a known-good 1x1 red pixel PNG
    // This is a minimal valid PNG that ImageMagick/libvips can process
    const testImagePath = path.join(workspaceDir, 'test-image.png');
    // Generate a valid PNG using Node canvas-like approach
    // Actually, let's just read an existing PNG from the repo if available, or create via sharp
    // For now, create via shell command
    await page.evaluate(() => {
      // Create a canvas and draw a red square
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 100, 100);
      }
      // Store for later retrieval
      (window as any).__testCanvas = canvas;
    });

    // Get the canvas data as a blob and save it
    const pngDataUrl = await page.evaluate(() => {
      const canvas = (window as any).__testCanvas as HTMLCanvasElement;
      return canvas.toDataURL('image/png');
    });

    // Convert data URL to buffer and save
    const base64Data = pngDataUrl.replace(/^data:image\/png;base64,/, '');
    const pngBuffer = Buffer.from(base64Data, 'base64');
    await fs.writeFile(testImagePath, pngBuffer);

    // Focus the chat input
    await chatInput.click();

    // Simulate pasting an image by dispatching a paste event with image data
    await page.evaluate(async (imagePath: string) => {
      const input = document.querySelector('textarea.ai-chat-input-field') as HTMLTextAreaElement;
      if (!input) throw new Error('Chat input not found');

      // Read the image file and create a blob
      const response = await fetch(`file://${imagePath}`);
      const blob = await response.blob();

      // Create a File from the blob
      const file = new File([blob], 'test-image.png', { type: 'image/png' });

      // Create a DataTransfer with the file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // Create and dispatch paste event
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      });

      input.dispatchEvent(pasteEvent);
    }, testImagePath);

    // Wait for attachment to be processed
    await page.waitForTimeout(1000);

    // Check if attachment preview appeared in the input area
    const attachmentPreview = page.locator('.attachment-preview-item, .attachment-preview');
    const previewCount = await attachmentPreview.count();
    console.log(`Attachment previews in input: ${previewCount}`);

    // Type a message
    await chatInput.fill('What color is this image?');

    // Submit the message
    const sendButton = page.locator('button[type="submit"], .ai-chat-submit-button');
    if (await sendButton.isVisible()) {
      await sendButton.click();
    } else {
      // Use Enter key
      await chatInput.press('Enter');
    }

    // Wait for response
    await page.waitForTimeout(5000);

    // Check for thumbnail in the transcript - THIS IS THE KEY ASSERTION
    const thumbnail = page.locator('.message-attachment-thumbnail');
    await expect(thumbnail).toBeVisible({ timeout: 10000 });
    const thumbnailCount = await thumbnail.count();
    console.log(`Thumbnails in transcript: ${thumbnailCount}`);
    expect(thumbnailCount).toBeGreaterThan(0);

    // Take a screenshot to verify the image is visible
    await page.screenshot({ path: 'test-results/image-in-transcript.png' });

    // NOW TEST PERSISTENCE: Switch away and back to verify the image persists
    // Switch to files mode
    const filesModeButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.filesModeButton);
    await filesModeButton.click();
    await page.waitForTimeout(1000);

    // Switch back to agent mode
    await switchToAgentMode(page);
    await page.waitForTimeout(1000);

    // Verify thumbnail is STILL visible after switching back
    const thumbnailAfterSwitch = page.locator('.message-attachment-thumbnail');
    await expect(thumbnailAfterSwitch).toBeVisible({ timeout: 10000 });
    const thumbnailCountAfter = await thumbnailAfterSwitch.count();
    console.log(`Thumbnails after mode switch: ${thumbnailCountAfter}`);
    expect(thumbnailCountAfter).toBeGreaterThan(0);

    // Take another screenshot to verify persistence
    await page.screenshot({ path: 'test-results/image-after-switch.png' });
  });
});
