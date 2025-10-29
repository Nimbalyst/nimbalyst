import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let doc1Path: string;
let doc2Path: string;

test.describe('Multi-Panel Parallel Streaming', () => {
  test.beforeEach(async () => {
    // Create temporary workspace directory
    workspaceDir = await createTempWorkspace();
    doc1Path = path.join(workspaceDir, 'document1.md');
    doc2Path = path.join(workspaceDir, 'document2.md');

    // Create test files BEFORE launching app
    await fs.writeFile(doc1Path, '# Document 1\n\nOriginal content for doc 1.\n', 'utf8');
    await fs.writeFile(doc2Path, '# Document 2\n\nOriginal content for doc 2.\n', 'utf8');

    // Launch Electron app with workspace
    electronApp = await launchElectronApp({ workspace: workspaceDir });

    // Get the first window and wait for app to be ready
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    // Clean up: close app and remove temp files
    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should handle parallel streaming to multiple agent sessions simultaneously', async () => {
    console.log('[TEST] Opening first document in editor mode');

    // Open document1 in editor mode
    await page.locator('.file-tree-name', { hasText: 'document1.md' }).click();
    await page.waitForTimeout(500);

    // Verify document1 tab is visible (don't check for active since multiple tabs can be active)
    await expect(page.locator('.tab .tab-title', { hasText: 'document1.md' }))
      .toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    console.log('[TEST] Opening second document in editor mode');

    // Open document2 in editor mode
    await page.locator('.file-tree-name', { hasText: 'document2.md' }).click();
    await page.waitForTimeout(500);

    // Verify document2 tab is visible
    await expect(page.locator('.tab .tab-title', { hasText: 'document2.md' }))
      .toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    console.log('[TEST] Switching to agent mode');

    // Switch to agent mode - this will auto-create the first session
    const agentModeButton = page.locator('[data-mode="agent"]');
    await agentModeButton.click();
    await page.waitForTimeout(1000); // Wait for mode switch and auto-session creation

    console.log('[TEST] Sending message to first auto-created session');

    // The first session is auto-created, just find the input and send a message
    const chatInput1 = page.locator('textarea.ai-chat-input-field').first();
    await chatInput1.waitFor({ state: 'visible', timeout: 5000 });

    // Fill the message (more reliable than type() for React inputs)
    await chatInput1.fill('Add a new bullet point: "- First doc edit" to document1.md');
    await page.waitForTimeout(100); // Brief wait to ensure React state updates

    // Send message with Enter key (press on the input itself, not globally)
    await chatInput1.press('Enter');

    // Wait a moment for first session to start processing
    await page.waitForTimeout(1000);

    console.log('[TEST] Creating second agent session for document2');

    // Now create a second session using the new session button
    const newSessionButton = page.locator('button.session-history-new-button').first();
    await newSessionButton.click();
    await page.waitForTimeout(500);

    // Find the visible chat input (should be the new session's input)
    const chatInput2 = page.locator('textarea.ai-chat-input-field:visible');
    await chatInput2.waitFor({ state: 'visible', timeout: 5000 });

    // Fill the message (more reliable than type() for React inputs)
    await chatInput2.fill('Add a new bullet point: "- Second doc edit" to document2.md');
    await page.waitForTimeout(100); // Brief wait to ensure React state updates

    console.log('[TEST] Sending message to second session');

    // Send message to second session with Enter key (press on the input itself, not globally)
    await chatInput2.press('Enter');

    console.log('[TEST] Waiting for both AI sessions to complete');

    // Wait for both sessions to complete (look for completion indicators)
    // This is where the test might fail if streaming isn't working correctly
    await page.waitForTimeout(15000); // Give AI time to respond

    console.log('[TEST] Checking second agent session for tool calls');

    // Check second session (currently active) for tool calls
    // Scope to visible session view (AISessionView uses display:flex when active)
    const activeSession2 = page.locator('[data-active="true"]');
    const session2ToolCalls = activeSession2.locator('.rich-transcript-tool-container').first();

    // Verify second session has tool calls (this should fail if not streaming correctly)
    await expect(session2ToolCalls).toBeVisible({ timeout: 10000 });

    console.log('[TEST] Switching to first agent session');

    // Switch to first session tab (tabs are in .ai-session-tabs-container)
    const sessionTab1 = page.locator('.ai-session-tabs-container .tab').first();
    await sessionTab1.click();
    await page.waitForTimeout(500);

    console.log('[TEST] Checking first agent session for messages');

    // Check first session for any transcript content (proves isolation is working)
    // Scope to visible session view (AISessionView uses display:flex when active)
    const activeSession1 = page.locator('[data-active="true"]');
    const session1Messages = activeSession1.locator('.rich-transcript-message').first();

    // Verify first session has messages (proves session isolation worked)
    await expect(session1Messages).toBeVisible({ timeout: 10000 });

    // Also check for tool calls if they exist
    const session1HasToolCalls = await activeSession1.locator('.rich-transcript-tool-container').count() > 0;
    console.log('[TEST] First session has tool calls:', session1HasToolCalls);

    console.log('[TEST] Switching back to editor mode');

    // Switch back to editor mode
    const editorModeButton = page.locator('[data-mode="editor"]');
    await editorModeButton.click();
    await page.waitForTimeout(1000);

    console.log('[TEST] Verifying document1 was edited');

    // Verify document1 has the edit
    await page.locator('.tab', { hasText: 'document1.md' }).click();
    await page.waitForTimeout(500);

    const doc1Content = await fs.readFile(doc1Path, 'utf8');
    expect(doc1Content).toContain('First doc edit');

    console.log('[TEST] Verifying document2 was edited');

    // Verify document2 has the edit
    await page.locator('.tab', { hasText: 'document2.md' }).click();
    await page.waitForTimeout(500);

    const doc2Content = await fs.readFile(doc2Path, 'utf8');
    expect(doc2Content).toContain('Second doc edit');

    console.log('[TEST] Test completed - both documents edited successfully by parallel sessions');
  });
});
