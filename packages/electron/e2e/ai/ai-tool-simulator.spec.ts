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

    // Open a file first so the editor registry gets initialized
    await page.click('text=first.md');
    await page.waitForTimeout(1000); // Wait for editor to fully initialize

    // Set up AI API for testing
    await setupAIApiForTesting(page);

    // Wait a bit more to ensure registry is available
    await page.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should apply diff edits to the correct tab when switching', async () => {
    // First file is already open from beforeEach

    // Open second file (creates second tab)
    await page.click('text=second.md');
    await page.waitForTimeout(1000); // Wait for tab to fully load

    // Get active file path before applying diff
    const activeFilePath = await getActiveEditorFilePath(page);
    console.log('Active file before diff:', activeFilePath);
    expect(activeFilePath).toContain('second.md');

    // Apply edit to second file
    console.log('Applying diff to second.md...');
    const result = await simulateApplyDiff(page, testFile2Path, [
      { oldText: 'second test document', newText: 'EDITED second document' }
    ]);

    console.log('Diff result:', result);

    if (!result.success) {
      console.error('Diff application failed:', result.error);

      // Get current editor content for debugging
      const currentContent = await page.evaluate(() => {
        const activeEditor = document.querySelector('.multi-editor-instance.active .editor');
        return activeEditor?.textContent || 'NO CONTENT';
      });
      console.log('Current editor content:', currentContent);
    }

    expect(result.success).toBe(true);
    await page.waitForTimeout(500);

    // Verify edit in second file
    let hasEdit = await verifyEditorContains(page, 'EDITED second document');
    expect(hasEdit).toBe(true);

    // Switch to first tab
    await page.click('text=first.md');
    await page.waitForTimeout(500);

    // Verify first file was NOT edited
    hasEdit = await verifyEditorContains(page, 'EDITED', false);
    expect(hasEdit).toBe(true);

    // Apply edit to first file
    console.log('Applying diff to first.md...');
    const result2 = await simulateApplyDiff(page, testFile1Path, [
      { oldText: 'first test document', newText: 'MODIFIED first document' }
    ]);

    console.log('Second diff result:', result2);
    expect(result2.success).toBe(true);
    await page.waitForTimeout(500);

    // Verify edit in first file
    hasEdit = await verifyEditorContains(page, 'MODIFIED first document');
    expect(hasEdit).toBe(true);

    // Switch back to second and verify isolation
    await page.click('text=second.md');
    await page.waitForTimeout(500);

    hasEdit = await verifyEditorContains(page, 'MODIFIED', false);
    expect(hasEdit).toBe(true); // Should NOT have MODIFIED
  });

  test('should stream content to the correct tab', async () => {
    // Files already open from beforeEach (first.md)

    // Open second file
    await page.click('text=second.md');
    await page.waitForTimeout(1000);

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
    await page.click('.tab:has-text("first.md")');
    await page.waitForTimeout(500);

    // Verify first file does NOT have the streamed content
    const hasWrongStream = await verifyEditorContains(page, 'This content was streamed!', false);
    expect(hasWrongStream).toBe(true); // Should NOT contain streamed content
  });

  test('should correctly mark text for add and removal in sequential edits', async () => {
    // First file is already open from beforeEach

    console.log('\n=== EDIT 1 ===');
    const result1 = await simulateApplyDiff(page, testFile1Path, [
      { oldText: 'Section One', newText: 'Section One (Edit 1)' }
    ]);
    console.log('Edit 1 result:', result1);
    await page.waitForTimeout(500);

    // Check for red (removed) and green (added) after Edit 1
    const diff1 = await page.evaluate(() => {
      const editor = document.querySelector('.multi-editor-instance.active .editor');

      // Log all elements with classes containing "diff"
      const allElements = Array.from(editor?.querySelectorAll('*') || []);
      const diffElements = allElements.filter(el =>
        Array.from(el.classList).some(cls => cls.toLowerCase().includes('diff'))
      );

      console.log('Total elements with diff classes:', diffElements.length);
      diffElements.forEach(el => {
        console.log('  Element:', el.tagName, 'Classes:', Array.from(el.classList).join(', '), 'Text:', el.textContent?.substring(0, 50));
      });

      const removed = Array.from(editor?.querySelectorAll('.PlaygroundEditorTheme__diffRemove') || [])
        .map(el => el.textContent?.trim());
      const added = Array.from(editor?.querySelectorAll('.PlaygroundEditorTheme__diffAdd') || [])
        .map(el => el.textContent?.trim());

      // Also check for any diff state attributes
      const nodesWithDiffState = allElements.filter(el =>
        el.hasAttribute('data-lexical-diff-state') ||
        el.getAttribute('data-diff-state')
      );
      console.log('Elements with diff state attributes:', nodesWithDiffState.length);

      return { removed, added, diffElementCount: diffElements.length };
    });
    console.log('After Edit 1 - Removed:', diff1.removed, 'Added:', diff1.added, 'Diff elements:', diff1.diffElementCount);

    // Should have red "Section One" and green "Section One (Edit 1)"
    expect(diff1.removed.some(text => text === 'Section One')).toBe(true);
    expect(diff1.added.some(text => text === 'Section One (Edit 1)')).toBe(true);

    console.log('\n=== EDIT 2 ===');
    const result2 = await simulateApplyDiff(page, testFile1Path, [
      { oldText: 'Section One (Edit 1)', newText: 'Section One (Edit 2)' }
    ]);
    console.log('Edit 2 result:', result2);
    await page.waitForTimeout(500);

    // Check for red (removed) and green (added) after Edit 2
    const diff2 = await page.evaluate(() => {
      const editor = document.querySelector('.multi-editor-instance.active .editor');
      const removed = Array.from(editor?.querySelectorAll('.PlaygroundEditorTheme__diffRemove') || [])
        .map(el => el.textContent?.trim());
      const added = Array.from(editor?.querySelectorAll('.PlaygroundEditorTheme__diffAdd') || [])
        .map(el => el.textContent?.trim());
      return { removed, added };
    });
    console.log('After Edit 2 - Removed:', diff2.removed, 'Added:', diff2.added);

    // Get markdown to see what would be saved
    const markdown2 = await page.evaluate(() => {
      const registry = (window as any).__editorRegistry;
      const filePath = registry.getActiveFilePath();
      return registry.getContent(filePath);
    });
    console.log('Markdown (what would be saved):', markdown2);

    // After Edit 2, should now have:
    // Red: "Section One" AND "Section One (Edit 1)"
    // Green: "Section One (Edit 2)"
    expect(diff2.removed.length).toBeGreaterThan(0);
    expect(diff2.added.some(text => text === 'Section One (Edit 2)')).toBe(true);

    // The markdown export should only include the latest (green) text
    expect(markdown2).toContain('Section One (Edit 2)');
    expect(markdown2).not.toContain('Section One (Edit 1)');
  });

  test.skip('should handle rapid tab switching with edits', async () => {
    // Files already open from beforeEach (first.md)

    // Open second file
    await page.click('text=second.md');
    await page.waitForTimeout(1000);

    // Rapid switching with edits
    for (let i = 0; i < 3; i++) {
      // Switch to second tab
      await page.click('.tab:has-text("second.md")');
      await page.waitForTimeout(500);

      // Edit second file
      const result2 = await simulateApplyDiff(page, testFile2Path, [
        {
          oldText: i === 0 ? 'Section Two' : `Section Two (Edit ${i})`,
          newText: `Section Two (Edit ${i + 1})`
        }
      ]);
      console.log(`Edit ${i+1} on second.md:`, result2);
      await page.waitForTimeout(500);

      // Switch to first tab
      await page.click('.tab:has-text("first.md")');
      await page.waitForTimeout(500);

      // Edit first file
      const result1 = await simulateApplyDiff(page, testFile1Path, [
        {
          oldText: i === 0 ? 'Section One' : `Section One (Edit ${i})`,
          newText: `Section One (Edit ${i + 1})`
        }
      ]);
      console.log(`Edit ${i+1} on first.md:`, result1);
      await page.waitForTimeout(500);
    }

    // Verify both files have their edits
    await page.click('.tab:has-text("second.md")');
    await page.waitForTimeout(500);

    // Get actual content to see what we got
    const secondContent = await page.evaluate(() => {
      const activeEditor = document.querySelector('.multi-editor-instance.active .editor');
      return activeEditor?.textContent || '';
    });
    console.log('Actual second.md content:', secondContent);

    const hasSecondEdit = await verifyEditorContains(page, 'Section Two (Edit 3)');
    if (!hasSecondEdit) {
      console.log('FAILURE: second.md does not contain "Section Two (Edit 3)"');
      console.log('Looking for other patterns...');
      const hasEdit1 = await verifyEditorContains(page, 'Section Two (Edit 1)');
      const hasEdit2 = await verifyEditorContains(page, 'Section Two (Edit 2)');
      const hasEdit23 = await verifyEditorContains(page, 'Section Two (Edit 23)');
      console.log(`Contains "Edit 1": ${hasEdit1}, "Edit 2": ${hasEdit2}, "Edit 23": ${hasEdit23}`);
    }
    expect(hasSecondEdit).toBe(true);

    await page.click('.tab:has-text("first.md")');
    await page.waitForTimeout(500);

    const firstContent = await page.evaluate(() => {
      const activeEditor = document.querySelector('.multi-editor-instance.active .editor');
      return activeEditor?.textContent || '';
    });
    console.log('Actual first.md content:', firstContent);

    const hasFirstEdit = await verifyEditorContains(page, 'Section One (Edit 3)');
    if (!hasFirstEdit) {
      console.log('FAILURE: first.md does not contain "Section One (Edit 3)"');
    }
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
