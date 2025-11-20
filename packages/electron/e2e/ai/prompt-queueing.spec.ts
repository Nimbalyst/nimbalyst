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

/**
 * E2E test for AI prompt queueing feature
 *
 * Tests that users can queue multiple prompts while AI is processing,
 * and they execute sequentially in FIFO order.
 *
 * Uses real Claude Code provider (requires ANTHROPIC_API_KEY).
 */

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.describe('AI Prompt Queueing', () => {
  test.beforeEach(async () => {
    // Create temporary workspace
    workspaceDir = await createTempWorkspace();
    testFilePath = path.join(workspaceDir, 'test.md');

    // CRITICAL: Create test file BEFORE launching app
    await fs.writeFile(testFilePath, '# Test Document\n\nInitial content.\n', 'utf8');

    // Launch app with workspace
    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: {
        // Real API key for Claude Code
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key'
      }
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Listen to console logs for debugging
    page.on('console', msg => {
      const text = msg.text();
      // Capture queue-related logs from AIService
      if (
        text.includes('[AIService]') ||
        text.includes('queue') ||
        text.includes('Queue') ||
        text.includes('QUEUE') ||
        text.includes('ai:sendMessage') ||
        text.includes('stream completed') ||
        text.includes('queuedPrompts')
      ) {
        console.log('[RENDER-LOG]', text);
      }
    });

    await waitForAppReady(page);

    // Dismiss API key dialog if present
    const apiDialog = page.locator('.api-key-dialog-overlay');
    if (await apiDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.api-key-dialog-button.secondary').click();
      await page.waitForTimeout(500);
    }
  });

  test.afterEach(async () => {
    // Clean up
    if (electronApp) {
      await electronApp.close();
    }
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test('should queue prompts when AI is processing and execute them sequentially', async () => {
    test.setTimeout(90000); // 90 seconds for real API calls
    console.log('\n========== QUEUE TEST START ==========\n');

    // Clear debug log file
    try {
      await fs.unlink('/tmp/queue-debug.log');
      console.log('[TEST] Cleared old debug log');
    } catch (error) {
      console.log('[TEST] No previous debug log to clear');
    }

    // Open the test file
    console.log('[TEST] Opening test.md file...');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await page.waitForTimeout(500);

    // Switch to agent mode to access AI
    console.log('[TEST] Switching to agent mode...');
    const agentModeButton = page.locator('[data-mode="agent"]');
    if (await agentModeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await agentModeButton.click();
      await page.waitForTimeout(500);
    }

    // Get the AI input field
    const aiInput = page.locator('.ai-chat-input-field');
    await expect(aiInput).toBeVisible({ timeout: 5000 });
    console.log('[TEST] ✓ AI input ready');

    // Send first prompt
    console.log('\n========== SENDING FIRST PROMPT ==========');
    console.log('[TEST] Prompt: "What is 2+2? Answer in one word."');
    await aiInput.fill('What is 2+2? Answer in one word.');
    await aiInput.press('Enter');

    // Wait for AI to start processing (loading state)
    await page.waitForTimeout(1000);

    // Check that send button is replaced with cancel button (indicating loading state)
    const cancelButton = page.locator('.ai-chat-cancel-button');
    await expect(cancelButton).toBeVisible({ timeout: 5000 });
    console.log('[TEST] ✓ Cancel button visible (AI is processing)');

    // While AI is processing, queue a second prompt
    console.log('\n========== QUEUEING SECOND PROMPT ==========');
    console.log('[TEST] Prompt: "What is 3+3? Answer in one word."');
    await aiInput.fill('What is 3+3? Answer in one word.');
    await aiInput.press('Enter'); // Should auto-queue when loading

    console.log('[TEST] Checking queue state...');

    // Verify queue list shows the queued prompt
    const queueList = page.locator('.prompt-queue-list');
    await expect(queueList).toBeVisible({ timeout: 2000 });

    const queueItem = page.locator('.prompt-queue-item');
    await expect(queueItem).toBeVisible();
    await expect(queueItem.locator('.prompt-queue-text')).toContainText('What is 3+3');

    // Verify queue header shows count
    const queueCount = page.locator('.prompt-queue-count');
    await expect(queueCount).toBeVisible();
    await expect(queueCount).toContainText('1 queued');
    console.log('[TEST] ✓ Queue list shows queued prompt with count');

    console.log('\n========== WAITING FOR FIRST PROMPT TO COMPLETE ==========');

    // Wait for first response to complete (look for completion in transcript)
    // The response should appear in the agent transcript panel
    const transcriptPanel = page.locator('.agent-transcript-panel');
    await expect(transcriptPanel).toBeVisible();

    // Wait for first response (should contain answer to 2+2)
    await expect(transcriptPanel).toContainText('2+2', { timeout: 30000 });

    console.log('[TEST] ✓ First prompt completed');
    console.log('\n========== CHECKING IF SECOND PROMPT AUTO-STARTS ==========');

    // After first completes, queue should auto-process second prompt
    // Wait a bit for queue processing to kick in
    console.log('[TEST] Waiting 2 seconds for queue processing...');
    await page.waitForTimeout(2000);

    // Queue list should be hidden (empty queue)
    const queueListAfter = page.locator('.prompt-queue-list');
    const queueListVisible = await queueListAfter.isVisible().catch(() => false);
    console.log(`[TEST] Queue list visible: ${queueListVisible}`);
    expect(queueListVisible).toBe(false);
    console.log('[TEST] ✓ Queue cleared after processing');

    console.log('\n========== WAITING FOR SECOND PROMPT TO COMPLETE ==========');

    // Wait for second response to appear
    await expect(transcriptPanel).toContainText('3+3', { timeout: 30000 });

    console.log('[TEST] ✓ Second prompt completed');
    console.log('\n========== TEST COMPLETE ==========\n');

    // Verify both responses are in the transcript
    const transcriptText = await transcriptPanel.textContent();
    expect(transcriptText).toContain('2+2');
    expect(transcriptText).toContain('3+3');
    console.log('[TEST] ✓ Both prompts found in transcript');

    // Check debug log file
    console.log('\n========== DEBUG LOG FILE ==========');
    try {
      const debugLog = await fs.readFile('/tmp/queue-debug.log', 'utf8');
      console.log('[TEST] Debug log contents:\n', debugLog);
    } catch (error) {
      console.log('[TEST] No debug log file found (or error reading it)');
    }
  });

  test('should allow cancelling queued prompts', async () => {
    console.log('[Test] Starting queue cancellation test');

    // Open the test file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await page.waitForTimeout(500);

    // Switch to agent mode
    const agentModeButton = page.locator('[data-mode="agent"]');
    if (await agentModeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await agentModeButton.click();
      await page.waitForTimeout(500);
    }

    // Get the AI input field
    const aiInput = page.locator('.ai-chat-input-field');
    await expect(aiInput).toBeVisible({ timeout: 5000 });

    // Send first prompt
    await aiInput.fill('Count from 1 to 5.');
    await aiInput.press('Enter');

    // Wait for AI to start processing
    await page.waitForTimeout(1000);

    // Queue a second prompt
    await aiInput.fill('This should be cancelled.');
    await aiInput.press('Enter');

    // Verify queue item appears
    const queueItem = page.locator('.prompt-queue-item');
    await expect(queueItem).toBeVisible({ timeout: 2000 });

    console.log('[Test] Queue item visible, clicking cancel button');

    // Click the cancel button (×)
    const cancelButton = queueItem.locator('.prompt-queue-cancel');
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    console.log('[Test] Clicked cancel, verifying queue is empty');

    // Queue list should disappear
    const queueList = page.locator('.prompt-queue-list');
    await expect(queueList).not.toBeVisible({ timeout: 2000 });

    // Wait for first prompt to complete
    const transcriptPanel = page.locator('.agent-transcript-panel');
    await expect(transcriptPanel).toBeVisible();

    // Wait a bit after completion to ensure cancelled prompt doesn't run
    await page.waitForTimeout(5000);

    // Verify cancelled prompt did NOT execute
    const transcriptText = await transcriptPanel.textContent();
    expect(transcriptText).not.toContain('This should be cancelled');

    console.log('[Test] Confirmed cancelled prompt did not execute');
  });

  test('should show queue count badge accurately', async () => {
    console.log('[Test] Starting queue count badge test');

    // Open the test file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await page.waitForTimeout(500);

    // Switch to agent mode
    const agentModeButton = page.locator('[data-mode="agent"]');
    if (await agentModeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await agentModeButton.click();
      await page.waitForTimeout(500);
    }

    const aiInput = page.locator('.ai-chat-input-field');
    await expect(aiInput).toBeVisible({ timeout: 5000 });

    // Send first prompt
    await aiInput.fill('Say hello.');
    await aiInput.press('Enter');
    await page.waitForTimeout(1000);

    // Queue multiple prompts
    await aiInput.fill('First queued prompt');
    await aiInput.press('Enter');

    await page.waitForTimeout(200);

    await aiInput.fill('Second queued prompt');
    await aiInput.press('Enter');

    await page.waitForTimeout(200);

    await aiInput.fill('Third queued prompt');
    await aiInput.press('Enter');

    // Verify queue list shows all 3 items
    const queueItems = page.locator('.prompt-queue-item');
    await expect(queueItems).toHaveCount(3);

    // Check queue header shows count
    const queueCount = page.locator('.prompt-queue-count');
    await expect(queueCount).toBeVisible({ timeout: 2000 });
    await expect(queueCount).toContainText('3 queued');

    console.log('[Test] Queue list verified with 3 items');
  });
});
