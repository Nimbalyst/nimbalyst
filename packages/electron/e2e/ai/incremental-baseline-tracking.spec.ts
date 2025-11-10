/**
 * E2E test for incremental diff baseline tracking
 *
 * Tests that when users accept AI changes incrementally, subsequent AI edits
 * use the accepted state as the baseline (not the original pre-edit state).
 *
 * Bug scenario:
 * - Version A: Initial doc
 * - Version B: Changes made by AI
 * - Version C: All changes accepted
 * - Version D: More changes made by AI
 * - Bug: Version D diff used Version A as baseline instead of Version C
 * - Result: Previously accepted changes showed up as red again
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree
} from '../utils/testHelpers';
import {
  simulateApplyDiff,
  waitForSave,
  queryTags,
  getDiffBaseline
} from '../utils/aiToolSimulator';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'test.md');

  // Version A: Initial content
  const initialContent = `# Document

First paragraph.

Second paragraph.

Third paragraph.
`;

  await fs.writeFile(testFilePath, initialContent, 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
  await dismissAPIKeyDialog(page);
  await waitForWorkspaceReady(page);
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('subsequent AI edits should use accepted state as baseline, not original', async () => {
  // Open file
  await openFileFromTree(page, 'test.md');
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Verify initial content (Version A)
  const versionA = await fs.readFile(testFilePath, 'utf8');
  expect(versionA).toContain('First paragraph.');

  // SIMULATE FIRST AI EDIT: Version A → Version B
  const versionC = versionA.replace('First paragraph.', 'FIRST AI EDIT');

  // Create pre-edit tag with Version A (what the AI started with)
  await page.evaluate(async ([filePath, content]) => {
    await window.electronAPI.invoke('history:create-tag', filePath, 'test-session-1', content, 'test-session-1', 'baseline-test');
  }, [testFilePath, versionA]);

  await page.waitForTimeout(100);

  // Verify pre-edit tag was created
  let tags = await queryTags(electronApp, testFilePath);
  const preEditTag = tags.find((t: any) => t.type === 'pre-edit' && t.status === 'pending-review');
  expect(preEditTag).toBeDefined();
  console.log('✓ Pre-edit tag created for first AI edit');

  // SIMULATE USER ACCEPTS ALL CHANGES
  // In real flow: User clicks Accept All → handleClearDiffTag marks tag as reviewed
  // NO incremental-approval tag is created when session is complete
  await page.evaluate(async ([filePath, tagId]) => {
    await window.electronAPI.history.updateTagStatus(filePath, tagId, 'reviewed');
  }, [testFilePath, preEditTag.tagId]);

  // Write accepted content to disk (simulates what handleClearDiffTag does)
  await fs.writeFile(testFilePath, versionC, 'utf8');
  await page.waitForTimeout(100);

  // Verify pre-edit tag was marked as reviewed
  tags = await queryTags(electronApp, testFilePath);
  const reviewedPreEdit = tags.find((t: any) => t.type === 'pre-edit' && t.status === 'reviewed');
  expect(reviewedPreEdit).toBeDefined();
  console.log('✓ Pre-edit tag marked as reviewed after accepting all changes');

  // Verify NO pending tags remain (session complete)
  const pendingTags = tags.filter((t: any) => t.status === 'pending-review');
  expect(pendingTags.length).toBe(0);
  console.log('✓ No pending tags after session complete');

  // SIMULATE SECOND AI EDIT: AI makes new edit with Version C (accepted state) as baseline
  // When AI creates a new pre-edit tag, it uses the CURRENT file content as the baseline
  // Since we accepted changes, current content is Version C
  await page.evaluate(async ([filePath, content, sessionId]) => {
    await window.electronAPI.invoke('history:create-tag',
      filePath,
      sessionId,
      content,
      sessionId,
      'second-edit-test'
    );
  }, [testFilePath, versionC, 'test-session-1']);

  await page.waitForTimeout(100);

  // Verify new pre-edit tag was created with Version C as baseline
  tags = await queryTags(electronApp, testFilePath);
  const secondPreEditTag = tags.find((t: any) => t.type === 'pre-edit' && t.status === 'pending-review');
  expect(secondPreEditTag).toBeDefined();
  console.log('✓ Second pre-edit tag created');

  // CRITICAL TEST: Verify getDiffBaseline returns the new pre-edit tag with Version C content
  // NOT the old pre-edit tag with Version A content
  const baseline = await getDiffBaseline(electronApp, testFilePath);
  expect(baseline).toBeDefined();
  expect(baseline?.tagType).toBe('pre-edit'); // New pre-edit tag (not incremental-approval)
  expect(baseline?.content).toContain('FIRST AI EDIT'); // Should have Version C content (accepted state)
  expect(baseline?.content).not.toContain('First paragraph.'); // Should NOT have Version A content

  console.log('✓ getDiffBaseline correctly returned new pre-edit with accepted state (Version C)');
  console.log('✓ Second AI edit will diff against accepted state, not original');
});
