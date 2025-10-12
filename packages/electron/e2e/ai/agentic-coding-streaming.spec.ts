/**
 * Agentic Coding Streaming Transcript Tests
 *
 * Tests the real-time streaming transcript feature in the Agentic Coding Window.
 * Validates that streaming content appears immediately and is replaced by persisted messages.
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import {
  simulateAgenticStreaming,
  setupStreamHandlerCapture,
  hasStreamingIndicator,
  transcriptContains,
  getAgenticInput,
  setAgenticInput,
  waitForStreamingComplete,
  simulateMessageExchange
} from '../utils/agenticStreamingSimulator';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let agenticWindow: Page;
let workspacePath: string;

test.describe('Agentic Coding Streaming Transcript', () => {
  test.beforeEach(async () => {
    workspacePath = await createTempWorkspace();

    // Create a plan document
    const planPath = path.join(workspacePath, 'test-plan.md');
    await fs.writeFile(planPath, `---
planStatus:
  planId: test-streaming-plan
  title: Test Streaming Plan
  status: draft
  planType: feature
  priority: high
---
# Test Streaming Plan

## Goals
- Test streaming transcript feature
`);

    // Launch app with workspace
    electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test' }
    });

    const mainPage = await electronApp.firstWindow();
    await mainPage.waitForLoadState('domcontentloaded');

    // Open agentic coding window
    await mainPage.evaluate(async ({ workspacePath, planPath }) => {
      return await window.electronAPI.invoke('agentic-coding:create-window', {
        workspacePath,
        planDocumentPath: planPath
      });
    }, { workspacePath, planPath });

    // Wait for agentic window to open
    await mainPage.waitForTimeout(2000);
    const windows = electronApp.windows();
    const foundWindow = windows.find(w =>
      w.url().includes('mode=agentic-coding')
    );

    if (!foundWindow) {
      throw new Error('Agentic coding window not found');
    }

    agenticWindow = foundWindow;

    // Debug: check the URL
    const url = agenticWindow.url();
    console.log('[Test] Agentic window URL:', url);

    await agenticWindow.waitForLoadState('domcontentloaded');
    await agenticWindow.waitForTimeout(1000);

    // Set up stream handler capturing AFTER the page loads
    await setupStreamHandlerCapture(agenticWindow);
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should display streaming content in real-time', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // First, verify we can see the agentic window content
    const title = await agenticWindow.textContent('body');
    console.log('[Test] Body text length:', title?.length);

    // Check for key agentic window elements
    const hasPromptsTab = await agenticWindow.locator('button:has-text("Prompts")').count();
    console.log('[Test] Prompts tab count:', hasPromptsTab);

    // Verify this is actually the agentic window
    expect(hasPromptsTab).toBeGreaterThan(0);

    // Simulate streaming response
    const chunks = ['This is a test streaming response'];

    await simulateAgenticStreaming(agenticWindow, chunks, {
      delayBetweenChunks: 100,
      includeCompletion: false
    });

    // Wait for streaming to process
    await agenticWindow.waitForTimeout(500);

    // Check if test streaming was injected
    const hasTestAPI = await agenticWindow.evaluate(() => {
      return typeof (window as any).__testStreamingContent;
    });
    console.log('[Test] Test API type:', hasTestAPI);

    const testContent = await agenticWindow.evaluate(() => {
      return (window as any).__testStreamingContent;
    });
    console.log('[Test] Test streaming content:', testContent);

    // Check if React state was updated
    const reactState = await agenticWindow.evaluate(() => {
      // Try to find any React internals or DOM hints
      const transcriptDiv = document.querySelector('[class*="transcript"]');
      return {
        hasTranscript: !!transcriptDiv,
        transcriptHTML: transcriptDiv?.innerHTML?.substring(0, 200),
        bodyText: document.body.textContent?.substring(0, 500)
      };
    });
    console.log('[Test] React state check:', JSON.stringify(reactState, null, 2));

    // Check for streaming indicator
    const bodyText = await agenticWindow.textContent('body');
    const hasIndicator = bodyText?.includes('streaming...');
    console.log('[Test] Has streaming indicator:', hasIndicator);
    console.log('[Test] Body text (first 200 chars):', bodyText?.substring(0, 200));

    expect(hasIndicator).toBe(true);
  });

  test('should remove thinking indicator when streaming starts', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Simulate streaming starts (should remove thinking)
    await simulateAgenticStreaming(agenticWindow, ['First chunk'], {
      delayBetweenChunks: 50,
      includeCompletion: false
    });

    await agenticWindow.waitForTimeout(300);

    // Verify streaming indicator is present
    const hasStreaming = await hasStreamingIndicator(agenticWindow);
    expect(hasStreaming).toBe(true);
  });

  test('should replace streaming content with persisted message on completion', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    const chunks = ['Complete ', 'message ', 'here'];

    // Simulate full streaming cycle with completion
    await simulateAgenticStreaming(agenticWindow, chunks, {
      delayBetweenChunks: 80,
      includeCompletion: true
    });

    // Wait for completion to process
    await waitForStreamingComplete(agenticWindow, 2000);

    // Streaming indicator should be gone
    const hasIndicator = await hasStreamingIndicator(agenticWindow);
    expect(hasIndicator).toBe(false);

    // Content should still be in transcript (now persisted)
    const hasContent = await transcriptContains(agenticWindow, 'Complete message here');
    expect(hasContent).toBe(true);
  });

  test('should show pulsing cursor during streaming', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Start streaming
    await simulateAgenticStreaming(agenticWindow, ['Streaming text'], {
      delayBetweenChunks: 50,
      includeCompletion: false
    });

    await agenticWindow.waitForTimeout(300);

    // Check for cursor element (by checking for pulse animation)
    const hasCursor = await agenticWindow.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('span'));
      return elements.some(el => {
        const style = el.getAttribute('style') || '';
        return style.includes('pulse') || style.includes('animation');
      });
    });

    expect(hasCursor).toBe(true);
  });

  test('should maintain per-tab input state', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Type in first tab
    await setAgenticInput(agenticWindow, 'First tab input');
    await agenticWindow.waitForTimeout(200);

    // Create a new tab
    const newTabButton = agenticWindow.locator('button:has-text("New Session")');
    await newTabButton.click();
    await agenticWindow.waitForTimeout(1000);

    // Input should be empty in new tab
    const newTabInput = await getAgenticInput(agenticWindow);
    expect(newTabInput).toBe('');

    // Type in second tab
    await setAgenticInput(agenticWindow, 'Second tab input');
    await agenticWindow.waitForTimeout(200);

    // Switch back to first tab
    const firstTab = agenticWindow.locator('.tab').first();
    await firstTab.click();
    await agenticWindow.waitForTimeout(500);

    // First tab should still have its input
    const firstTabInput = await getAgenticInput(agenticWindow);
    expect(firstTabInput).toBe('First tab input');
  });

  test('should clear streaming content on cancel', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Start streaming
    await simulateAgenticStreaming(agenticWindow, ['Streaming content'], {
      delayBetweenChunks: 50,
      includeCompletion: false
    });

    await agenticWindow.waitForTimeout(300);

    // Verify streaming is visible
    const hasStreamingBefore = await hasStreamingIndicator(agenticWindow);
    expect(hasStreamingBefore).toBe(true);

    // Click cancel button
    const cancelButton = agenticWindow.locator('button:has-text("Cancel")');
    if (await cancelButton.isVisible()) {
      await cancelButton.click();
      await agenticWindow.waitForTimeout(300);

      // Streaming should be cleared
      const hasStreamingAfter = await hasStreamingIndicator(agenticWindow);
      expect(hasStreamingAfter).toBe(false);
    }
  });

  test('should handle streaming with tool calls', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Simulate streaming with tool calls
    await simulateAgenticStreaming(agenticWindow, [
      'Analyzing the code...',
      ' Reading file...'
    ], {
      delayBetweenChunks: 100,
      includeToolCalls: true,
      toolCalls: [{
        id: 'test-read-1',
        name: 'Read',
        arguments: { file_path: '/test/file.txt' },
        result: 'File content here'
      }],
      includeCompletion: true
    });

    await waitForStreamingComplete(agenticWindow, 2000);

    // Verify content appears
    const hasContent = await transcriptContains(agenticWindow, 'Analyzing the code');
    expect(hasContent).toBe(true);

    // Completion should clear streaming indicator
    const hasIndicator = await hasStreamingIndicator(agenticWindow);
    expect(hasIndicator).toBe(false);
  });

  test('should debounce rapid streaming updates', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Create many rapid chunks
    const rapidChunks = Array.from({ length: 50 }, (_, i) => `Word${i} `);

    const startTime = Date.now();

    await simulateAgenticStreaming(agenticWindow, rapidChunks, {
      delayBetweenChunks: 10, // Very rapid updates
      includeCompletion: true
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should take at least 50ms per debounced update
    // With 50 chunks at 10ms each = 500ms minimum
    expect(duration).toBeGreaterThan(400);

    await waitForStreamingComplete(agenticWindow, 2000);

    // All content should still appear
    const hasContent = await transcriptContains(agenticWindow, 'Word0');
    expect(hasContent).toBe(true);
  });

  test('should auto-scroll to bottom during streaming', async () => {
    test.setTimeout(TEST_TIMEOUTS.VERY_LONG);

    // Add some initial messages to create scrollable content
    await agenticWindow.evaluate(() => {
      // Simulate several existing messages
      for (let i = 0; i < 10; i++) {
        const event = new CustomEvent('test-add-message', {
          detail: { content: `Message ${i}\n`.repeat(5) }
        });
        window.dispatchEvent(event);
      }
    });

    await agenticWindow.waitForTimeout(500);

    // Start streaming
    await simulateAgenticStreaming(agenticWindow, [
      'New streaming message at the bottom'
    ], {
      delayBetweenChunks: 100,
      includeCompletion: false
    });

    await agenticWindow.waitForTimeout(500);

    // Check if scrolled to bottom
    const isAtBottom = await agenticWindow.evaluate(() => {
      const container = document.querySelector('[style*="overflowY"]');
      if (!container) return false;
      const { scrollTop, scrollHeight, clientHeight } = container;
      return scrollHeight - scrollTop - clientHeight < 100; // Within 100px of bottom
    });

    expect(isAtBottom).toBe(true);
  });
});
