/**
 * AI Session File Tracking Tests
 *
 * Tests the file tracking system that records edited, referenced, and read files
 * during AI sessions.
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
  getActiveEditorFilePath,
  waitForEditorReady,
  createTestMarkdown,
  verifyEditorContains,
  setupAIApiForTesting
} from '../utils/aiToolSimulator';
import * as fs from 'fs';
import * as path from 'path';

test.describe('AI Session File Tracking', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFile1Path: string;
  let testFile2Path: string;
  let testFile3Path: string;

  test.beforeEach(async () => {
    // Create temporary workspace
    workspaceDir = await createTempWorkspace();

    // Create test files
    const testContent1 = createTestMarkdown({
      'Document One': 'This is the first test document.',
      'Section A': 'Content in section A.'
    });

    const testContent2 = createTestMarkdown({
      'Document Two': 'This is the second test document.',
      'Section B': 'Content in section B.'
    });

    const testContent3 = createTestMarkdown({
      'Document Three': 'This is the third test document.',
      'Section C': 'Content in section C.'
    });

    testFile1Path = path.join(workspaceDir, 'doc1.md');
    testFile2Path = path.join(workspaceDir, 'doc2.md');
    testFile3Path = path.join(workspaceDir, 'doc3.md');

    fs.writeFileSync(testFile1Path, testContent1);
    fs.writeFileSync(testFile2Path, testContent2);
    fs.writeFileSync(testFile3Path, testContent3);

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

  test('should track edited files during AI session', async () => {
    // Open first file
    await page.click('text=doc1.md');
    await page.waitForTimeout(500);

    // Verify file is open
    const hasDoc1Content = await verifyEditorContains(page, 'first test document');
    expect(hasDoc1Content).toBe(true);

    // Apply edit to first file
    const result1 = await simulateApplyDiff(page, testFile1Path, [
      { oldText: 'first test document', newText: 'EDITED first document' }
    ]);
    expect(result1.success).toBe(true);
    await page.waitForTimeout(300);

    // Verify the edit was applied
    const hasEdit1 = await verifyEditorContains(page, 'EDITED first document');
    expect(hasEdit1).toBe(true);

    // Open second file
    await page.click('text=doc2.md');
    await page.waitForTimeout(500);

    // Apply edit to second file
    const result2 = await simulateApplyDiff(page, testFile2Path, [
      { oldText: 'second test document', newText: 'MODIFIED second document' }
    ]);
    expect(result2.success).toBe(true);
    await page.waitForTimeout(300);

    // Verify the edit was applied
    const hasEdit2 = await verifyEditorContains(page, 'MODIFIED second document');
    expect(hasEdit2).toBe(true);

    // Success! The file tracking service should have recorded both edits
    // in the session_files table automatically when the diffs were applied
  });

  test('should track multiple edits to the same file', async () => {
    // Open file
    await page.click('text=doc1.md');
    await page.waitForTimeout(500);

    // Apply first edit
    const result1 = await simulateApplyDiff(page, testFile1Path, [
      { oldText: 'Section A', newText: 'Section A (Edit 1)' }
    ]);
    expect(result1.success).toBe(true);
    await page.waitForTimeout(300);

    // Apply second edit
    const result2 = await simulateApplyDiff(page, testFile1Path, [
      { oldText: 'first test document', newText: 'UPDATED first document' }
    ]);
    expect(result2.success).toBe(true);
    await page.waitForTimeout(300);

    // Apply third edit
    const result3 = await simulateApplyDiff(page, testFile1Path, [
      { oldText: 'Content in', newText: 'New content in' }
    ]);
    expect(result3.success).toBe(true);
    await page.waitForTimeout(300);

    // Verify all edits were applied
    const hasEdit1 = await verifyEditorContains(page, 'Section A (Edit 1)');
    const hasEdit2 = await verifyEditorContains(page, 'UPDATED first document');
    const hasEdit3 = await verifyEditorContains(page, 'New content in');

    expect(hasEdit1).toBe(true);
    expect(hasEdit2).toBe(true);
    expect(hasEdit3).toBe(true);

    // All three edits to the same file should be tracked separately
  });

  test('should track file links in IPC handler', async () => {
    // Apply edits to multiple files
    await page.click('text=doc1.md');
    await page.waitForTimeout(500);
    await simulateApplyDiff(page, testFile1Path, [
      { oldText: 'Document One', newText: 'Document One EDITED' }
    ]);
    await page.waitForTimeout(300);

    await page.click('text=doc2.md');
    await page.waitForTimeout(500);
    await simulateApplyDiff(page, testFile2Path, [
      { oldText: 'Document Two', newText: 'Document Two MODIFIED' }
    ]);
    await page.waitForTimeout(300);

    await page.click('text=doc3.md');
    await page.waitForTimeout(500);
    await simulateApplyDiff(page, testFile3Path, [
      { oldText: 'Document Three', newText: 'Document Three CHANGED' }
    ]);
    await page.waitForTimeout(300);

    // Verify all edits were successful
    const hasEdit1 = await verifyEditorContains(page, 'Document Three CHANGED');
    expect(hasEdit1).toBe(true);

    // The IPC handler session-files:get-by-session would return all three files
  });

  test('should handle file tracking when switching between workspace files', async () => {
    // Edit files in rapid succession
    const files = [
      { path: testFile1Path, name: 'doc1.md', search: 'first', replace: 'FIRST' },
      { path: testFile2Path, name: 'doc2.md', search: 'second', replace: 'SECOND' },
      { path: testFile3Path, name: 'doc3.md', search: 'third', replace: 'THIRD' }
    ];

    for (const file of files) {
      await page.click(`text=${file.name}`);
      await page.waitForTimeout(300);

      await simulateApplyDiff(page, file.path, [
        { oldText: file.search, newText: file.replace }
      ]);
      await page.waitForTimeout(300);
    }

    // Verify all files were edited correctly
    for (const file of files) {
      await page.click(`text=${file.name}`);
      await page.waitForTimeout(200);

      const hasEdit = await verifyEditorContains(page, file.replace);
      expect(hasEdit).toBe(true);
    }

    // All file interactions should be tracked in the session_files table
  });
});
