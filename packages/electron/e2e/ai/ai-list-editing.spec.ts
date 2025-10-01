import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  configureAIModel,
  sendAIPrompt as sendAIPromptHelper,
  getEditorContent
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * E2E tests for AI-assisted list editing
 *
 * These tests verify that the AI can correctly perform various list operations:
 * - Adding list items
 * - Removing list items
 * - Editing list items
 * - Working with nested lists
 *
 * Using GPT-4 Turbo for consistent, reliable results.
 */
test.describe('AI List Editing', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFilePath: string;

  test.beforeEach(async () => {
    // Skip tests if OpenAI API key is not set
    if (!process.env.OPENAI_API_KEY) {
      test.skip();
    }

    // Create temp workspace
    workspaceDir = await createTempWorkspace();
    testFilePath = path.join(workspaceDir, 'list-test.md');

    // Create initial test file with a simple list
    const initialContent = `# Shopping List

- Apples
- Bananas
- Oranges
`;
    await fs.writeFile(testFilePath, initialContent, 'utf8');

    // Launch app with workspace
    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: {
        NODE_ENV: 'test',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      }
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Configure AI model first (before opening file)
    await configureAIModel(page, 'openai', 'GPT-4 Turbo');

    // Then open the test file
    await page.click(`text="list-test.md"`);
    await page.waitForTimeout(TEST_TIMEOUTS.EDITOR_LOAD);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  /**
   * Helper to get current document content (prefers file on disk)
   */
  async function getDocumentContent(): Promise<string> {
    // Read the file directly from disk (most reliable for saved changes)
    return await fs.readFile(testFilePath, 'utf8');
  }

  test('should add a new item to the end of a list', async () => {
    // Send prompt to add an item
    await sendAIPromptHelper(page, 'Add "Grapes" to the end of the shopping list', { timeout: 30000 });

    // Accept the diff
    const acceptButton = page.locator('button:has-text("Accept All")').first();
    await acceptButton.waitFor({ state: 'visible', timeout: 5000 });
    await acceptButton.click();

    // Wait for changes to be applied and saved
    await page.waitForTimeout(2000);

    // Verify the content was updated
    const content = await getDocumentContent();
    console.log('Document content:', content);
    console.log('Grapes index:', content.indexOf('Grapes'));
    console.log('Oranges index:', content.indexOf('Oranges'));

    expect(content).toContain('Grapes');
    expect(content).toContain('Apples');
    expect(content).toContain('Bananas');
    expect(content).toContain('Oranges');

    // Verify the order is correct (Grapes should be after Oranges)
    const grapesIndex = content.indexOf('Grapes');
    const orangesIndex = content.indexOf('Oranges');
    expect(grapesIndex).toBeGreaterThan(orangesIndex);
  });

  test('should add a new item at a specific position', async () => {
    // Send prompt to add an item between existing items
    await sendAIPromptHelper(page, 'Add "Pears" between Bananas and Oranges in the list');

    // Wait for changes
    await page.waitForTimeout(2000);

    // Verify the content
    const content = await getDocumentContent();

    expect(content).toContain('- Pears');

    // Verify the order: Apples, Bananas, Pears, Oranges
    const applesIndex = content.indexOf('- Apples');
    const bananasIndex = content.indexOf('- Bananas');
    const pearsIndex = content.indexOf('- Pears');
    const orangesIndex = content.indexOf('- Oranges');

    expect(applesIndex).toBeLessThan(bananasIndex);
    expect(bananasIndex).toBeLessThan(pearsIndex);
    expect(pearsIndex).toBeLessThan(orangesIndex);
  });

  test('should remove an item from the list', async () => {
    // Send prompt to remove an item
    await sendAIPromptHelper(page, 'Remove "Bananas" from the shopping list');

    // Wait for changes
    await page.waitForTimeout(2000);

    // Verify the content
    const content = await getDocumentContent();

    expect(content).not.toContain('Bananas');
    expect(content).toContain('- Apples');
    expect(content).toContain('- Oranges');
  });

  test('should edit an existing list item', async () => {
    // Send prompt to edit an item
    await sendAIPromptHelper(page, 'Change "Oranges" to "Blood Oranges" in the list');

    // Wait for changes
    await page.waitForTimeout(2000);

    // Verify the content
    const content = await getDocumentContent();

    expect(content).toContain('Blood Oranges');
    expect(content).not.toContain('- Oranges\n'); // The standalone Oranges item should be gone
    expect(content).toContain('- Apples');
    expect(content).toContain('- Bananas');
  });

  test('should add multiple items at once', async () => {
    // Send prompt to add multiple items
    await sendAIPromptHelper(page, 'Add the following items to the shopping list: Strawberries, Blueberries, Raspberries');

    // Wait for changes
    await page.waitForTimeout(2000);

    // Verify the content
    const content = await getDocumentContent();

    expect(content).toContain('Strawberries');
    expect(content).toContain('Blueberries');
    expect(content).toContain('Raspberries');
    expect(content).toContain('- Apples');
  });
});
