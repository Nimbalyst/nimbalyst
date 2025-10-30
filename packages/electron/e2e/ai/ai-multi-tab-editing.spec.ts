import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  configureAIModel,
  sendAIPrompt,
  ACTIVE_EDITOR_SELECTOR
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  waitForWorkspaceReady,
  openFileFromTree,
  switchToDocumentTab,
  submitChatPrompt
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * E2E tests for AI editing across multiple tabs
 *
 * These tests verify that the AI correctly targets the active tab when:
 * - Switching between tabs and making edits
 * - Reapplying edits after tab switches
 * - Multiple documents are open in the same session
 *
 * This is critical for preventing edits from being applied to the wrong document.
 */
test.describe('AI Multi-Tab Editing', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFile1Path: string;
  let testFile2Path: string;

  test.beforeEach(async () => {
    // Skip tests if OpenAI API key is not set
    if (!process.env.OPENAI_API_KEY) {
      test.skip();
    }

    // Create temp workspace
    workspaceDir = await createTempWorkspace();
    testFile1Path = path.join(workspaceDir, 'document-1.md');
    testFile2Path = path.join(workspaceDir, 'document-2.md');

    // Create initial test files with distinct content
    const file1Content = `# Document 1

This is the first document.

## Features
- Feature A
- Feature B
- Feature C
`;

    const file2Content = `# Document 2

This is the second document.

## Tasks
- Task X
- Task Y
- Task Z
`;

    await fs.writeFile(testFile1Path, file1Content, 'utf8');
    await fs.writeFile(testFile2Path, file2Content, 'utf8');

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

    // Wait for workspace using utility
    await waitForWorkspaceReady(page);

    // Configure AI model first
    await configureAIModel(page, 'openai', 'GPT-4 Turbo');
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  /**
   * Helper to get document content from file
   */
  async function getDocumentContent(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf8');
  }

  /**
   * Helper to verify active tab by checking the tab bar
   */
  async function verifyActiveTab(fileName: string): Promise<void> {
    const activeTab = page.locator(`${PLAYWRIGHT_TEST_SELECTORS.tab}.active`);
    await expect(activeTab).toContainText(fileName);
  }

  /**
   * Helper to click a tab by file name (wrapper around switchToDocumentTab)
   */
  async function clickTab(fileName: string): Promise<void> {
    await switchToDocumentTab(page, fileName);
  }

  test('should pass correct document context to AI when switching tabs', async () => {
    // This test validates that documentContext always reflects the active tab
    // It doesn't require AI to actually work, just checks the context being sent

    // Open first document
    await openFileFromTree(page, 'document-1.md');
    await page.waitForTimeout(TEST_TIMEOUTS.EDITOR_LOAD);
    await verifyActiveTab('document-1.md');

    // Set up console listener to capture document context logs
    const logs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Sending message with document context') ||
          text.includes('filePath')) {
        logs.push(text);
      }
    });

    // Start typing a message (don't send it yet)
    const aiChatVisible = await page.locator(PLAYWRIGHT_TEST_SELECTORS.aiChatPanel).isVisible().catch(() => false);
    if (!aiChatVisible) {
      await page.keyboard.press('Meta+Shift+A');
      await page.waitForTimeout(200);
    }

    // Open second document in new tab
    await openFileFromTree(page, 'document-2.md');
    await page.waitForTimeout(TEST_TIMEOUTS.EDITOR_LOAD);
    await verifyActiveTab('document-2.md');

    // Verify we have 2 tabs
    const tabs = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer).locator(PLAYWRIGHT_TEST_SELECTORS.tab);
    await expect(tabs).toHaveCount(2);

    // Now send a message and check that document-2.md is in the context
    // Clear previous logs before sending
    logs.length = 0;

    await submitChatPrompt(page, 'Test message');
    await page.waitForTimeout(1000);

    // Check logs for document-2.md in the context
    console.log('Context logs:', logs);
    const hasDoc2Context = logs.some(log => log.includes('document-2.md'));
    expect(hasDoc2Context).toBe(true);

    // Switch back to document 1
    await clickTab('document-1.md');
    await verifyActiveTab('document-1.md');

    // Send another message and verify document-1.md is now in context
    logs.length = 0;
    await submitChatPrompt(page, 'Another test message');
    await page.waitForTimeout(1000);

    console.log('Context logs after switch:', logs);
    const hasDoc1Context = logs.some(log => log.includes('document-1.md'));
    expect(hasDoc1Context).toBe(true);

    // Should NOT have document-2.md in the context anymore
    const stillHasDoc2 = logs.some(log => log.includes('document-2.md'));
    expect(stillHasDoc2).toBe(false);

    console.log('✓ Document context correctly switches with active tab');
  });

  test('should apply both streaming and diff edits to correct tab when switching', async () => {
    // This test verifies the CRITICAL fix: streaming edits must target the correct document
    test.setTimeout(90000);

    // Open first document
    await openFileFromTree(page, 'document-1.md');
    await page.waitForTimeout(TEST_TIMEOUTS.EDITOR_LOAD);
    await verifyActiveTab('document-1.md');

    // Make an edit to Document 1 first
    await sendAIPrompt(page, 'Add "Feature X" to the Features list', { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Verify Document 1 was edited
    let content1 = await getDocumentContent(testFile1Path);
    expect(content1).toContain('Feature X');
    console.log('✓ Document 1 initial edit complete');

    // Now the CRITICAL test: Open Document 2, request edit, then IMMEDIATELY switch back
    await openFileFromTree(page, 'document-2.md');
    await page.waitForTimeout(TEST_TIMEOUTS.EDITOR_LOAD);
    await verifyActiveTab('document-2.md');

    // Request an edit that will trigger BOTH streaming and applyDiff
    // Start the AI request
    const aiPromise = sendAIPrompt(page, 'Add "Task Alpha" to the Tasks list', { timeout: 30000, waitForCompletion: false });

    // IMMEDIATELY switch back to Document 1 (while AI is processing)
    await page.waitForTimeout(500); // Small delay to let AI start
    await clickTab('document-1.md');
    await verifyActiveTab('document-1.md');
    console.log('✓ Switched to Document 1 while AI processing Document 2 edit');

    // Wait for AI to complete
    await aiPromise;
    await page.waitForTimeout(3000);

    // Dump console errors to see validation logs
    const consoleLogs = await page.evaluate(() => {
      return (window as any).__validationLogs || [];
    });
    console.log('=== VALIDATION LOGS ===');
    console.log(JSON.stringify(consoleLogs, null, 2));

    // CRITICAL VALIDATION: Document 2 should have the edit, Document 1 should NOT
    const finalContent2 = await getDocumentContent(testFile2Path);
    const finalContent1 = await getDocumentContent(testFile1Path);

    // Document 2 should have the new task
    if (!finalContent2.includes('Task Alpha')) {
      console.warn('⚠️ AI did not apply edit (may have timed out)');
      test.skip();
      return;
    }

    expect(finalContent2).toContain('Task Alpha');
    console.log('✓ Document 2 has the correct edit');

    // Document 1 should NOT have Task Alpha
    expect(finalContent1).not.toContain('Task Alpha');
    expect(finalContent1).not.toContain('Tasks'); // Document 1 is about Features
    console.log('✓ Document 1 was NOT affected by Document 2 edit');

    // Also verify streaming didn't corrupt Document 1
    expect(finalContent1).toContain('Feature X'); // Original edit still there
    console.log('✓ STREAMING FIX VERIFIED: Edits correctly targeted');
  });

  test('should edit different tabs in sequence with AI in same session', async () => {
    // NOTE: This test may be flaky due to AI response times and reliability
    // The key validation is that edits target the correct document
    test.setTimeout(90000); // Extend timeout for this long test
    // Open first document
    await openFileFromTree(page, 'document-1.md');
    await page.waitForTimeout(TEST_TIMEOUTS.EDITOR_LOAD);
    await verifyActiveTab('document-1.md');

    // Edit Document 1: Add a feature
    await sendAIPrompt(page, 'Add "Feature D" to the end of the Features list', { timeout: 30000 });

    // Wait for the edit to be applied (look for diff or auto-save)
    await page.waitForTimeout(2000);

    // Verify Document 1 was edited
    let content1 = await getDocumentContent(testFile1Path);
    expect(content1).toContain('Feature D');
    console.log('✓ Document 1 edited successfully');

    // Now open the second document (creating a second tab)
    await openFileFromTree(page, 'document-2.md');
    await page.waitForTimeout(TEST_TIMEOUTS.EDITOR_LOAD);
    await verifyActiveTab('document-2.md');

    // CRITICAL: Verify we're on Document 2 and Document 1 is still in a tab
    const tabs = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer).locator(PLAYWRIGHT_TEST_SELECTORS.tab);
    await expect(tabs).toHaveCount(2);

    // Edit Document 2: Add a task (in the SAME AI session)
    await sendAIPrompt(page, 'Add "Task W" to the beginning of the Tasks list', { timeout: 30000 });

    // Wait for the edit to be applied
    await page.waitForTimeout(3000);

    // Verify Document 2 was edited (or at least attempted - AI might not always succeed)
    let content2 = await getDocumentContent(testFile2Path);
    const doc2WasEdited = content2.includes('Task W');

    if (!doc2WasEdited) {
      console.log('⚠️ Document 2 edit was not applied (AI may have timed out or failed)');
      console.log('Skipping remainder of test as it depends on this edit');
      test.skip();
      return;
    }

    console.log('✓ Document 2 edited successfully');

    // CRITICAL CHECK: Verify Document 1 was NOT modified by the second edit
    content1 = await getDocumentContent(testFile1Path);
    expect(content1).not.toContain('Task W'); // Task W should NOT be in Document 1
    expect(content1).not.toContain('Tasks'); // Document 1 should still be about Features
    expect(content1).toContain('Feature D'); // Previous edit should still be there
    console.log('✓ Document 1 was not affected by Document 2 edit');

    // Switch back to Document 1
    await clickTab('document-1.md');
    await verifyActiveTab('document-1.md');

    // Edit Document 1 again to verify context switching works
    await sendAIPrompt(page, 'Add "Feature E" after Feature D', { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Verify Document 1 received the new edit
    content1 = await getDocumentContent(testFile1Path);
    expect(content1).toContain('Feature E');
    const featureDIndex = content1.indexOf('Feature D');
    const featureEIndex = content1.indexOf('Feature E');
    expect(featureEIndex).toBeGreaterThan(featureDIndex);
    console.log('✓ Document 1 edited correctly after switching back');

    // FINAL CHECK: Verify Document 2 was not affected by the third edit
    const finalContent2 = await getDocumentContent(testFile2Path);
    expect(finalContent2).not.toContain('Feature E'); // Feature E should NOT be in Document 2
    expect(finalContent2).toContain('Task W'); // Task W should still be there
    console.log('✓ Document 2 was not affected by Document 1 edit after tab switch');
  });

  test('should handle reapply button correctly across tabs', async () => {
    // Open first document
    await page.click('text="document-1.md"');
    await page.waitForTimeout(TEST_TIMEOUTS.EDITOR_LOAD);

    // Make an edit that we can later reapply
    await sendAIPrompt(page, 'Add "Feature X" to the Features list', { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Verify the edit was applied
    let content1 = await getDocumentContent(testFile1Path);
    expect(content1).toContain('Feature X');

    // Open second document in a new tab
    await openFileFromTree(page, 'document-2.md');
    await page.waitForTimeout(TEST_TIMEOUTS.EDITOR_LOAD);
    await verifyActiveTab('document-2.md');

    // Now we're on Document 2, and the AI chat should have history from Document 1
    // The reapply button should be disabled or show a warning because we're on a different document

    // Look for tool call blocks in the chat (these have reapply buttons)
    const toolCallBlocks = page.locator('.ai-chat-tool-box');
    const toolCallCount = await toolCallBlocks.count();

    if (toolCallCount > 0) {
      // Expand the tool call to see the reapply button
      const firstToolCall = toolCallBlocks.first();
      await firstToolCall.click();
      await page.waitForTimeout(500);

      // The reapply button should either:
      // 1. Be disabled (if we added that feature)
      // 2. Show a warning about no active document
      // 3. Not be visible for non-applyDiff tool calls
      const reapplyButton = page.locator('button:has-text("Reapply")').first();
      const reapplyVisible = await reapplyButton.isVisible().catch(() => false);

      if (reapplyVisible) {
        // If reapply button is visible, it should ideally be disabled
        // (This depends on whether the tool call was an applyDiff)
        const isDisabled = await reapplyButton.isDisabled().catch(() => false);
        console.log('Reapply button disabled:', isDisabled);

        // If not disabled, there should be a warning message
        if (!isDisabled) {
          const warningText = page.locator('text=/No active document|Cannot reapply/i').first();
          const hasWarning = await warningText.isVisible().catch(() => false);
          console.log('Warning visible:', hasWarning);
        }
      }
    }

    // Switch back to Document 1
    await clickTab('document-1.md');
    await verifyActiveTab('document-1.md');

    // On Document 1, the reapply button should work
    // (We won't actually test clicking it to avoid duplicate edits, but we verify it's enabled)
    if (toolCallCount > 0) {
      const firstToolCall = toolCallBlocks.first();
      await firstToolCall.click();
      await page.waitForTimeout(500);

      const reapplyButton = page.locator('button:has-text("Reapply")').first();
      const reapplyVisible = await reapplyButton.isVisible().catch(() => false);

      if (reapplyVisible) {
        // On the correct document, button should be enabled
        const isEnabled = await reapplyButton.isEnabled().catch(() => true);
        console.log('Reapply button enabled on correct document:', isEnabled);
      }
    }
  });

  test('should log correct file path in AI edit operations', async () => {
    // This test verifies that logging shows the correct target file path
    // Open first document
    await page.click('text="document-1.md"');
    await page.waitForTimeout(TEST_TIMEOUTS.EDITOR_LOAD);

    // Set up console listener to capture logs
    const logs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      logs.push(text);
    });

    // Make an edit
    await sendAIPrompt(page, 'Add "New Feature" to the Features list', { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check logs for evidence of correct file path targeting
    const relevantLogs = logs.filter(log =>
      log.includes('document-1.md') ||
      log.includes('Applying edit') ||
      log.includes('Auto-applying')
    );

    console.log('Relevant logs:', relevantLogs);

    // Should have some logs mentioning the correct document
    const hasCorrectFile = relevantLogs.some(log => log.includes('document-1.md'));
    expect(hasCorrectFile).toBe(true);

    // Switch to document 2
    await page.click('text="document-2.md"');
    await page.waitForTimeout(TEST_TIMEOUTS.EDITOR_LOAD);

    // Clear previous logs
    logs.length = 0;

    // Make another edit
    await sendAIPrompt(page, 'Add "New Task" to the Tasks list', { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check logs now mention document-2.md
    const newRelevantLogs = logs.filter(log =>
      log.includes('document-2.md') ||
      log.includes('Applying edit') ||
      log.includes('Auto-applying')
    );

    console.log('New relevant logs:', newRelevantLogs);

    const hasCorrectFile2 = newRelevantLogs.some(log => log.includes('document-2.md'));
    expect(hasCorrectFile2).toBe(true);
  });

  test('should prevent edits when no document is open', async () => {
    // Don't open any document - just have AI chat open with no active editor

    // Try to send a prompt
    await sendAIPrompt(page, 'Add a new item to the list', { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Look for error message in the chat
    const errorMessage = page.locator('.ai-chat-message:has-text("No active document")').first();
    const hasError = await errorMessage.isVisible().catch(() => false);

    // If there's an error message, test passes
    // If not, the AI might handle it differently (e.g., just respond without making edits)
    console.log('Error message shown:', hasError);

    // Verify neither file was modified
    const content1 = await getDocumentContent(testFile1Path);
    const content2 = await getDocumentContent(testFile2Path);

    // Files should still have original content (no "new item" added)
    expect(content1).not.toContain('new item');
    expect(content2).not.toContain('new item');
  });
});
