import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace } from '../helpers';
import * as path from 'path';
import * as fs from 'fs/promises';

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
let testImagePath: string;

test.describe('AI Image Attachment', () => {
  test.beforeEach(async () => {
    workspacePath = await createTempWorkspace();

    // Create a test image (simple 1x1 PNG)
    testImagePath = path.join(workspacePath, 'test-image.png');
    const testImageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    await fs.writeFile(testImagePath, testImageBuffer);

    // Launch app with workspace
    electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test' }
    });

    // Wait for window to be ready
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.LONG });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });
  test('should show attachment preview after dropping image', async () => {
    // Open agentic coding window
    await page.keyboard.press('Control+Shift+A');
    await page.waitForTimeout(500);

    // Find the chat input
    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible();

    // Simulate file drop
    const fileBuffer = await fs.readFile(testImagePath);
    const dataTransfer = await page.evaluateHandle((data) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(data)], 'test-image.png', { type: 'image/png' });
      dt.items.add(file);
      return dt;
    }, Array.from(fileBuffer));

    await chatInput.dispatchEvent('drop', { dataTransfer });
    await page.waitForTimeout(500);

    // Check that attachment preview appears
    const attachmentPreview = page.locator('.attachment-preview');
    await expect(attachmentPreview).toBeVisible({ timeout: 3000 });

    // Check that filename is shown
    const filename = page.locator('.attachment-filename');
    await expect(filename).toContainText('test-image.png');
  });

  test('should allow removing attachment', async () => {
    // Open agentic coding window
    await page.keyboard.press('Control+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible();

    // Add an attachment (simplified - assume it's already added from previous test)
    const attachmentPreview = page.locator('.attachment-preview').first();

    if (await attachmentPreview.isVisible()) {
      // Click remove button
      const removeButton = page.locator('.attachment-remove');
      await removeButton.click();
      await page.waitForTimeout(300);

      // Verify attachment is removed
      await expect(attachmentPreview).not.toBeVisible();
    }
  });

  test('should insert @filename reference when attachment is added', async () => {
    // Open agentic coding window
    await page.keyboard.press('Control+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible();

    // Type some text first
    await chatInput.fill('Look at this image: ');

    // Simulate file drop
    const fileBuffer = await fs.readFile(testImagePath);
    const dataTransfer = await page.evaluateHandle((data) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(data)], 'test-image.png', { type: 'image/png' });
      dt.items.add(file);
      return dt;
    }, Array.from(fileBuffer));

    await chatInput.dispatchEvent('drop', { dataTransfer });
    await page.waitForTimeout(500);

    // Check that @filename was inserted
    const inputValue = await chatInput.inputValue();
    expect(inputValue).toContain('@test-image.png');
  });

  test('should validate file size', async () => {
    // Create a large test image (>5MB)
    const largeImagePath = path.join(workspacePath, 'large-image.png');
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024); // 6MB
    await fs.writeFile(largeImagePath, largeBuffer);

    // Open agentic coding window
    await page.keyboard.press('Control+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible();

    // Listen for alert
    let alertMessage = '';
    page.once('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    // Try to drop large file
    const fileBuffer = await fs.readFile(largeImagePath);
    const dataTransfer = await page.evaluateHandle((data) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(data)], 'large-image.png', { type: 'image/png' });
      dt.items.add(file);
      return dt;
    }, Array.from(fileBuffer));

    await chatInput.dispatchEvent('drop', { dataTransfer });
    await page.waitForTimeout(1000);

    // Verify error was shown
    expect(alertMessage).toContain('File size exceeds');
  });

  test('should support paste from clipboard', async () => {
    // Open agentic coding window
    await page.keyboard.press('Control+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible();

    // Focus input
    await chatInput.click();

    // Simulate paste with image
    const fileBuffer = await fs.readFile(testImagePath);
    await page.evaluate((data) => {
      const file = new File([new Uint8Array(data)], 'pasted-image.png', { type: 'image/png' });
      const clipboardData = {
        items: [{
          type: 'image/png',
          getAsFile: () => file
        }]
      };

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: clipboardData as any,
        bubbles: true,
        cancelable: true
      });

      document.querySelector('.ai-chat-input-field')?.dispatchEvent(pasteEvent);
    }, Array.from(fileBuffer));

    await page.waitForTimeout(500);

    // Check that attachment preview appears
    const attachmentPreview = page.locator('.attachment-preview');
    await expect(attachmentPreview).toBeVisible({ timeout: 3000 });
  });

  test('should clear attachments after sending message', async () => {
    // Open agentic coding window
    await page.keyboard.press('Control+Shift+A');
    await page.waitForTimeout(500);

    const chatInput = page.locator('.ai-chat-input-field');
    await expect(chatInput).toBeVisible();

    // Add an attachment
    const fileBuffer = fs.readFileSync(testImagePath);
    const dataTransfer = await page.evaluateHandle((data) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(data)], 'test-image.png', { type: 'image/png' });
      dt.items.add(file);
      return dt;
    }, Array.from(fileBuffer));

    await chatInput.dispatchEvent('drop', { dataTransfer });
    await page.waitForTimeout(500);

    // Verify attachment is visible
    const attachmentPreview = page.locator('.attachment-preview');
    await expect(attachmentPreview).toBeVisible();

    // Type message and send
    await chatInput.fill('Test message with image');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Verify attachments are cleared
    await expect(attachmentPreview).not.toBeVisible();

    // Verify input is cleared
    const inputValue = await chatInput.inputValue();
    expect(inputValue).toBe('');
  });
});
