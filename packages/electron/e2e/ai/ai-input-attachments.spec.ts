/**
 * AI Input & Attachments E2E Tests
 *
 * Consolidated tests for AI chat input functionality including:
 * - Image attachment via drag/drop and paste
 * - Attachment removal and clearing after send
 * - File size validation
 * - @mention typeahead for all file types
 * - @mention search for nested files
 *
 * Consolidated from:
 *   ai-image-attachment.spec.ts
 *   file-mention-all-types.spec.ts
 *   image-attachment-persistence.spec.ts (meaningful tests only)
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
  TEST_TIMEOUTS,
  ACTIVE_EDITOR_SELECTOR,
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  openFileFromTree,
  openAIChatWithSession,
  dismissAPIKeyDialog,
  switchToAgentMode,
} from '../utils/testHelpers';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';

// Use serial mode to share a single app instance
test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;
let testImagePath: string;
let largeImagePath: string;

test.beforeAll(async () => {
  workspacePath = await createTempWorkspace();

  // Create test files of different types for @mention tests
  const testFiles = [
    { name: 'notes.md', content: '# Notes\n\nSome notes.' },
    { name: 'index.ts', content: 'export const foo = "bar";' },
    { name: 'script.js', content: 'console.log("hello");' },
    { name: 'main.py', content: 'print("hello world")' },
    { name: 'config.json', content: '{"key": "value"}' },
    { name: 'docker-compose.yml', content: 'version: "3"\nservices:\n  web:\n    image: nginx' },
    { name: 'index.html', content: '<html><body>Hello</body></html>' },
    { name: 'styles.css', content: 'body { margin: 0; }' },
  ];

  for (const file of testFiles) {
    await fs.writeFile(path.join(workspacePath, file.name), file.content, 'utf8');
  }

  // Create nested file for subdirectory search
  const subdir = path.join(workspacePath, 'src', 'components');
  await fs.mkdir(subdir, { recursive: true });
  await fs.writeFile(
    path.join(workspacePath, 'src', 'components', 'Button.tsx'),
    'export const Button = () => <button />',
    'utf8'
  );

  // Create test image (1x1 PNG)
  testImagePath = path.join(workspacePath, 'test-image.png');
  const testImageBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  await fs.writeFile(testImagePath, testImageBuffer);

  // Create large test image (>5MB) for size validation
  largeImagePath = path.join(workspacePath, 'large-image.png');
  const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
  await fs.writeFile(largeImagePath, largeBuffer);

  electronApp = await launchElectronApp({
    workspace: workspacePath,
    env: { NODE_ENV: 'test' },
  });

  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
  await dismissAPIKeyDialog(page);

  // Open a file so editor is available
  await openFileFromTree(page, 'notes.md');
  await page.waitForSelector(ACTIVE_EDITOR_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
});

test.afterAll(async () => {
  await electronApp?.close();
  await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
});

// ============================================================================
// Image Attachment Tests
// ============================================================================

test.describe('Image Attachments', () => {
  test('should show attachment preview after dropping image', async () => {
    await openAIChatWithSession(page);

    const aiChatPanel = page.locator(PLAYWRIGHT_TEST_SELECTORS.aiChatPanel);
    const chatInput = aiChatPanel.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput);
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

    const attachmentPreview = page.locator(PLAYWRIGHT_TEST_SELECTORS.attachmentPreview);
    await expect(attachmentPreview).toBeVisible({ timeout: 3000 });

    const filename = page.locator(PLAYWRIGHT_TEST_SELECTORS.attachmentFilename);
    await expect(filename).toContainText('test-image.png');
  });

  test('should allow removing attachment', async () => {
    await openAIChatWithSession(page);

    const aiChatPanel = page.locator(PLAYWRIGHT_TEST_SELECTORS.aiChatPanel);
    const chatInput = aiChatPanel.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput);
    await expect(chatInput).toBeVisible();

    // Add an attachment
    const fileBuffer = await fs.readFile(testImagePath);
    const dataTransfer = await page.evaluateHandle((data) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(data)], 'test-image.png', { type: 'image/png' });
      dt.items.add(file);
      return dt;
    }, Array.from(fileBuffer));

    await chatInput.dispatchEvent('drop', { dataTransfer });
    await page.waitForTimeout(500);

    const attachmentPreview = page.locator(PLAYWRIGHT_TEST_SELECTORS.attachmentPreview).first();
    await expect(attachmentPreview).toBeVisible({ timeout: 3000 });

    // Remove it
    const removeButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.attachmentRemoveButton);
    await removeButton.click();
    await page.waitForTimeout(300);

    await expect(attachmentPreview).not.toBeVisible();
  });

  test('should insert @filename reference when attachment is added', async () => {
    await openAIChatWithSession(page);

    const aiChatPanel = page.locator(PLAYWRIGHT_TEST_SELECTORS.aiChatPanel);
    const chatInput = aiChatPanel.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput);
    await expect(chatInput).toBeVisible();

    await chatInput.fill('Look at this image: ');

    const fileBuffer = await fs.readFile(testImagePath);
    const dataTransfer = await page.evaluateHandle((data) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(data)], 'test-image.png', { type: 'image/png' });
      dt.items.add(file);
      return dt;
    }, Array.from(fileBuffer));

    await chatInput.dispatchEvent('drop', { dataTransfer });
    await page.waitForTimeout(500);

    const inputValue = await chatInput.inputValue();
    expect(inputValue).toContain('@test-image.png');
  });

  test('should validate file size', async () => {
    await openAIChatWithSession(page);

    const aiChatPanel = page.locator(PLAYWRIGHT_TEST_SELECTORS.aiChatPanel);
    const chatInput = aiChatPanel.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput);
    await expect(chatInput).toBeVisible();

    let alertMessage = '';
    page.once('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    const fileBuffer = await fs.readFile(largeImagePath);
    const dataTransfer = await page.evaluateHandle((data) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(data)], 'large-image.png', { type: 'image/png' });
      dt.items.add(file);
      return dt;
    }, Array.from(fileBuffer));

    await chatInput.dispatchEvent('drop', { dataTransfer });
    await page.waitForTimeout(1000);

    expect(alertMessage).toContain('File size exceeds');
  });

  test('should support paste from clipboard', async () => {
    await openAIChatWithSession(page);

    const aiChatPanel = page.locator(PLAYWRIGHT_TEST_SELECTORS.aiChatPanel);
    const chatInput = aiChatPanel.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput);
    await expect(chatInput).toBeVisible();

    await chatInput.click();

    const fileBuffer = await fs.readFile(testImagePath);
    await page.evaluate((data) => {
      const file = new File([new Uint8Array(data)], 'pasted-image.png', { type: 'image/png' });
      const clipboardData = {
        items: [{
          type: 'image/png',
          getAsFile: () => file,
        }],
      };

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: clipboardData as any,
        bubbles: true,
        cancelable: true,
      });

      document.querySelector('.ai-chat-input-field')?.dispatchEvent(pasteEvent);
    }, Array.from(fileBuffer));

    await page.waitForTimeout(500);

    const attachmentPreview = page.locator(PLAYWRIGHT_TEST_SELECTORS.attachmentPreview);
    await expect(attachmentPreview).toBeVisible({ timeout: 3000 });
  });

  test('should clear attachments after sending message', async () => {
    await openAIChatWithSession(page);

    const aiChatPanel = page.locator(PLAYWRIGHT_TEST_SELECTORS.aiChatPanel);
    const chatInput = aiChatPanel.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput);
    await expect(chatInput).toBeVisible();

    const fileBuffer = fsSync.readFileSync(testImagePath);
    const dataTransfer = await page.evaluateHandle((data: number[]) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(data)], 'test-image.png', { type: 'image/png' });
      dt.items.add(file);
      return dt;
    }, Array.from(fileBuffer));

    await chatInput.dispatchEvent('drop', { dataTransfer });
    await page.waitForTimeout(500);

    const attachmentPreview = page.locator(PLAYWRIGHT_TEST_SELECTORS.attachmentPreview);
    await expect(attachmentPreview).toBeVisible();

    await chatInput.fill('Test message with image');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await expect(attachmentPreview).not.toBeVisible();
    const inputValue = await chatInput.inputValue();
    expect(inputValue).toBe('');
  });
});

// ============================================================================
// @mention Typeahead Tests
// ============================================================================

test.describe('File Mention Typeahead', () => {
  test('should show all file types in @ mention typeahead', async () => {
    // Switch to agent mode if not already
    await switchToAgentMode(page);
    await page.waitForTimeout(300);

    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput).first();
    await chatInput.click();
    await chatInput.fill('@');
    await page.waitForTimeout(300);

    const typeahead = page.locator('.generic-typeahead');
    await expect(typeahead).toBeVisible({ timeout: 2000 });

    const options = await page.locator('.generic-typeahead-option').allTextContents();
    expect(options.length).toBeGreaterThan(0);

    const fileNames = options.map(opt => opt.trim().toLowerCase());
    expect(fileNames.some(name => name.includes('notes.md'))).toBe(true);
    expect(fileNames.some(name => name.includes('index.ts'))).toBe(true);
    expect(fileNames.some(name => name.includes('script.js'))).toBe(true);
    expect(fileNames.some(name => name.includes('main.py'))).toBe(true);
    expect(fileNames.some(name => name.includes('config.json'))).toBe(true);
    expect(fileNames.some(name => name.includes('docker-compose.yml'))).toBe(true);
    expect(fileNames.some(name => name.includes('index.html'))).toBe(true);
    expect(fileNames.some(name => name.includes('styles.css'))).toBe(true);

    await chatInput.fill('');
  });

  test('should find nested files by filename in @ mention search', async () => {
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput).first();
    await chatInput.click();
    await chatInput.fill('@Button');
    await page.waitForTimeout(300);

    const options = await page.locator('.generic-typeahead-option').allTextContents();
    expect(options.some(opt => opt.toLowerCase().includes('button'))).toBe(true);
  });
});
