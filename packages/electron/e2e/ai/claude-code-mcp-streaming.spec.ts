/**
 * Claude Code MCP Streaming Test
 *
 * Tests that Claude Code can successfully use the MCP streamContent tool
 * to insert content into documents via the AI Chat sidebar.
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import {
  waitForEditorReady,
  triggerManualSave,
  waitForSave
} from '../utils/aiToolSimulator';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.describe('Claude Code MCP Streaming', () => {
  test.beforeEach(async () => {
    // Create temporary workspace directory
    workspaceDir = await createTempWorkspace();
    testFilePath = path.join(workspaceDir, 'test.md');

    // Create test file BEFORE launching app
    await fs.writeFile(testFilePath, '# Test Document\n\nInitial content.\n', 'utf8');

    // Launch Electron app with workspace
    electronApp = await launchElectronApp({ workspace: workspaceDir });

    // Get the first window and wait for app to be ready
    page = await electronApp.firstWindow();

    // Listen to browser console BEFORE app loads
    page.on('console', msg => {
      console.log('[BROWSER]', msg.text());
    });

    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    // Clean up: close app and remove temp files
    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should successfully call streamContent MCP tool', async () => {
    test.setTimeout(60000); // 60 seconds for AI interaction

    // Open the test file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator('.file-tabs-container .tab.active .tab-title'))
      .toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Open AI Chat sidebar (Cmd+Shift+A)
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(500);

    // Verify AI Chat panel is visible
    const aiChatPanel = page.locator('[data-testid="ai-chat-panel"]');
    await expect(aiChatPanel).toBeVisible({ timeout: 5000 });

    // Create a new session if one doesn't exist
    const newSessionButton = page.locator('button:has-text("New Session")');
    const isNewSessionVisible = await newSessionButton.isVisible().catch(() => false);
    if (isNewSessionVisible) {
      await newSessionButton.click();
      await page.waitForTimeout(500);
    }

    // Wait for chat input to be available
    await page.waitForTimeout(500);

    // Type a message that should trigger streamContent
    const chatInput = page.getByPlaceholder('Ask a question... (type @ to mention files)');
    await chatInput.click();
    await chatInput.fill('Add a haiku about robots at the end of the document');

    // Send the message (press Enter or click send button)
    await chatInput.press('Enter');

    // Wait for AI response to start
    await page.waitForTimeout(2000);

    // Look for streaming indicator or response
    const hasStreamingOrResponse = await page.evaluate(() => {
      const body = document.body.textContent || '';
      return body.includes('streaming') ||
             body.includes('haiku') ||
             body.includes('robot') ||
             body.includes('Successfully streamed');
    });

    console.log('[Test] Has streaming or response:', hasStreamingOrResponse);

    // Wait for the AI to finish (look for completion signals)
    await page.waitForTimeout(10000); // Give AI time to respond

    // Check if content was added to the editor
    const editorContent = await page.evaluate(() => {
      const registry = (window as any).__editorRegistry;
      if (!registry) return null;
      const filePath = registry.getActiveFilePath();
      return filePath ? registry.getContent(filePath) : null;
    });

    console.log('[Test] Editor content after AI:', editorContent?.substring(0, 500));

    // Save the file
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    // Read file from disk to verify
    const diskContent = await fs.readFile(testFilePath, 'utf8');
    console.log('[Test] Disk content:', diskContent);

    // Verify that new content was added (should be longer than initial content)
    const initialLength = '# Test Document\n\nInitial content.\n'.length;
    expect(diskContent.length).toBeGreaterThan(initialLength);

    // Verify content was actually added (check for any haiku-like content with line breaks)
    const lines = diskContent.split('\n');
    expect(lines.length).toBeGreaterThan(4); // Should have more than just title + initial content

    // Verify content is in correct order (not reversed)
    expect(lines[0]).toBe('# Test Document');
    expect(lines[2]).toBe('Initial content.');
  });

  test('should handle streamContent with position parameter', async () => {
    test.setTimeout(60000);

    // Open the test file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await waitForEditorReady(page);

    // Simulate MCP streamContent call directly
    const result = await page.evaluate(async ({ filePath }) => {
      const registry = (window as any).__editorRegistry;
      if (!registry) return { success: false, error: 'No registry' };

      const streamId = `test-stream-${Date.now()}`;
      const content = '\n## New Section\nThis was streamed at the end.\n';

      try {
        // Start streaming
        registry.startStreaming(filePath, {
          id: streamId,
          position: 'end',
          mode: 'append',
          insertAtEnd: true
        });

        // Small delay for processor to register
        await new Promise(resolve => setTimeout(resolve, 50));

        // Stream content
        registry.streamContent(filePath, streamId, content);

        // End streaming
        registry.endStreaming(filePath, streamId);

        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }, { filePath: testFilePath });

    console.log('[Test] Stream result:', result);
    expect(result.success).toBe(true);

    // Wait for React to update
    await page.waitForTimeout(500);

    // Save and verify
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const diskContent = await fs.readFile(testFilePath, 'utf8');
    console.log('[Test] Disk content after streaming:', diskContent);
    console.log('[Test] Contains "New Section":', diskContent.includes('New Section'));
    console.log('[Test] Contains "This was streamed at the end":', diskContent.includes('This was streamed at the end'));
    expect(diskContent).toContain('New Section');
    expect(diskContent).toContain('This was streamed at the end');
  });

  test('should handle streaming with insertAfter parameter', async () => {
    test.setTimeout(30000);

    // Create a document with multiple sections
    await fs.writeFile(
      testFilePath,
      '# Document\n\n## Section 1\nFirst section.\n\n## Section 2\nSecond section.\n',
      'utf8'
    );

    // Open the test file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await waitForEditorReady(page);

    // Stream content after "Section 1"
    const result = await page.evaluate(async ({ filePath }) => {
      const registry = (window as any).__editorRegistry;
      if (!registry) return { success: false, error: 'No registry' };

      const streamId = `test-stream-${Date.now()}`;
      const content = '\nInserted after Section 1.\n';

      try {
        registry.startStreaming(filePath, {
          id: streamId,
          position: 'cursor',
          mode: 'append',
          insertAfter: '## Section 1'
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        registry.streamContent(filePath, streamId, content);
        registry.endStreaming(filePath, streamId);

        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }, { filePath: testFilePath });

    expect(result.success).toBe(true);

    await page.waitForTimeout(500);
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const diskContent = await fs.readFile(testFilePath, 'utf8');

    // Verify insertion happened after Section 1
    const section1Index = diskContent.indexOf('## Section 1');
    const insertedIndex = diskContent.indexOf('Inserted after Section 1');
    const section2Index = diskContent.indexOf('## Section 2');

    expect(insertedIndex).toBeGreaterThan(section1Index);
    expect(insertedIndex).toBeLessThan(section2Index);
  });

  test('should not show "No processor found" error', async () => {
    test.setTimeout(30000);

    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await waitForEditorReady(page);

    // Set up console listener to catch errors
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleMessages.push(text);
      if (text.includes('No processor found')) {
        console.log('[Test] ERROR FOUND:', text);
      }
    });

    // Simulate MCP streamContent
    await page.evaluate(async ({ filePath }) => {
      const registry = (window as any).__editorRegistry;
      const streamId = `mcp-stream-${Date.now()}-${Math.random()}`;

      registry.startStreaming(filePath, {
        id: streamId,
        position: 'end',
        mode: 'append',
        insertAtEnd: true
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      registry.streamContent(filePath, streamId, '\nTest content\n');
      registry.endStreaming(filePath, streamId);
    }, { filePath: testFilePath });

    await page.waitForTimeout(1000);

    // Check for the error
    const hasProcessorError = consoleMessages.some(msg =>
      msg.includes('No processor found')
    );

    expect(hasProcessorError).toBe(false);
  });

  test('should handle rapid streaming chunks without errors', async () => {
    test.setTimeout(30000);

    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await waitForEditorReady(page);

    const result = await page.evaluate(async ({ filePath }) => {
      const registry = (window as any).__editorRegistry;
      const streamId = `rapid-stream-${Date.now()}`;

      try {
        registry.startStreaming(filePath, {
          id: streamId,
          position: 'end',
          mode: 'append',
          insertAtEnd: true
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        // Stream 20 rapid chunks
        for (let i = 0; i < 20; i++) {
          registry.streamContent(filePath, streamId, `Chunk ${i} `);
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        registry.endStreaming(filePath, streamId);

        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }, { filePath: testFilePath });

    expect(result.success).toBe(true);

    await page.waitForTimeout(500);
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const diskContent = await fs.readFile(testFilePath, 'utf8');

    // Verify all chunks appeared
    expect(diskContent).toContain('Chunk 0');
    expect(diskContent).toContain('Chunk 19');
  });
});
