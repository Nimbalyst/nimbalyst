/**
 * AI Tool Simulator Tests
 *
 * Tests the AI tool call system without requiring actual AI API calls.
 * This validates that edits are applied to the correct tab when switching between tabs.
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  ACTIVE_EDITOR_SELECTOR
} from '../helpers';
import {
  simulateApplyDiff,
  simulateStreamContent,
  getActiveEditorFilePath,
  waitForEditorReady,
  createTestMarkdown,
  verifyEditorContains,
  setupAIApiForTesting
} from '../utils/aiToolSimulator';
import * as fs from 'fs';
import * as path from 'path';

test.describe('AI Tool Simulator', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFile1Path: string;
  let testFile2Path: string;

  test.beforeEach(async () => {
    // Create temporary workspace
    workspaceDir = await createTempWorkspace();

    // Create test files
    const testContent1 = createTestMarkdown({
      'First Document': 'This is the first test document.',
      'Section One': 'Content in section one.'
    });

    const testContent2 = createTestMarkdown({
      'Second Document': 'This is the second test document.',
      'Section Two': 'Content in section two.'
    });

    testFile1Path = path.join(workspaceDir, 'first.md');
    testFile2Path = path.join(workspaceDir, 'second.md');

    fs.writeFileSync(testFile1Path, testContent1);
    fs.writeFileSync(testFile2Path, testContent2);

    // Launch app
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Set up AI API for testing
    await setupAIApiForTesting(page);
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should apply diff edits to the correct tab when switching', async () => {
    // Open first file
    await page.click('text=first.md');
    await page.waitForTimeout(500);

    // Open second file (just click it - creates second tab automatically)
    await page.click('text=second.md');
    await page.waitForTimeout(500);

    // Apply edit to second file
    const result = await simulateApplyDiff(page, testFile2Path, [
      { oldText: 'second test document', newText: 'EDITED second document' }
    ]);
    expect(result.success).toBe(true);
    await page.waitForTimeout(200);

    // Verify edit in second file
    let hasEdit = await verifyEditorContains(page, 'EDITED second document');
    expect(hasEdit).toBe(true);

    // Switch to first tab
    await page.click('text=first.md');
    await page.waitForTimeout(200);

    // Verify first file was NOT edited
    hasEdit = await verifyEditorContains(page, 'EDITED', false);
    expect(hasEdit).toBe(true);

    // Apply edit to first file
    const result2 = await simulateApplyDiff(page, testFile1Path, [
      { oldText: 'first test document', newText: 'MODIFIED first document' }
    ]);
    expect(result2.success).toBe(true);
    await page.waitForTimeout(200);

    // Verify edit in first file
    hasEdit = await verifyEditorContains(page, 'MODIFIED first document');
    expect(hasEdit).toBe(true);

    // Switch back to second and verify isolation
    await page.click('text=second.md');
    await page.waitForTimeout(200);

    hasEdit = await verifyEditorContains(page, 'MODIFIED', false);
    expect(hasEdit).toBe(true); // Should NOT have MODIFIED
  });

  test('should stream content to the correct tab', async () => {
    // Open both files
    await page.click('text=first.md');
    await page.waitForTimeout(300);
    await page.click('text=second.md');
    await page.waitForTimeout(300);

    // Switch to second tab
    await page.click('.tab[data-file-path*="second.md"]');
    await page.waitForTimeout(300);

    // Stream content to second file
    console.log('Streaming to second.md...');
    await simulateStreamContent(page, '\n## New Streamed Section\n\nThis content was streamed!', {
      insertAtEnd: true
    });

    await page.waitForTimeout(1000);

    // Verify streamed content appears in second file
    const hasStreamedContent = await verifyEditorContains(page, 'This content was streamed!');
    expect(hasStreamedContent).toBe(true);

    // Switch to first tab
    await page.click('.tab[data-file-path*="first.md"]');
    await page.waitForTimeout(300);

    // Verify first file does NOT have the streamed content
    const hasWrongStream = await verifyEditorContains(page, 'This content was streamed!', false);
    expect(hasWrongStream).toBe(true); // Should NOT contain streamed content
  });

  test('should handle rapid tab switching with edits', async () => {
    // Open both files
    await page.click('text=first.md');
    await page.waitForTimeout(300);
    await page.click('text=second.md');
    await page.waitForTimeout(300);

    // Rapid switching with edits
    for (let i = 0; i < 3; i++) {
      // Switch to second tab
      await page.click('.tab[data-file-path*="second.md"]');
      await page.waitForTimeout(200);

      // Edit second file
      await simulateApplyDiff(page, testFile2Path, [
        {
          oldText: 'Section Two',
          newText: `Section Two (Edit ${i + 1})`
        }
      ]);
      await page.waitForTimeout(200);

      // Switch to first tab
      await page.click('.tab[data-file-path*="first.md"]');
      await page.waitForTimeout(200);

      // Edit first file
      await simulateApplyDiff(page, testFile1Path, [
        {
          oldText: 'Section One',
          newText: `Section One (Edit ${i + 1})`
        }
      ]);
      await page.waitForTimeout(200);
    }

    // Verify both files have their edits
    await page.click('.tab[data-file-path*="second.md"]');
    await page.waitForTimeout(300);
    const hasSecondEdit = await verifyEditorContains(page, 'Section Two (Edit 3)');
    expect(hasSecondEdit).toBe(true);

    await page.click('.tab[data-file-path*="first.md"]');
    await page.waitForTimeout(300);
    const hasFirstEdit = await verifyEditorContains(page, 'Section One (Edit 3)');
    expect(hasFirstEdit).toBe(true);
  });

  test('should fail gracefully when no active editor', async () => {
    // Try to apply diff without any file open
    const result = await simulateApplyDiff(page, '', [
      {
        oldText: 'test',
        newText: 'changed'
      }
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No target file path');
  });
});
