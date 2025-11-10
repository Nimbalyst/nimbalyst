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

  // SIMULATE: User accepts first AI edit (Version A → Version B → Version C accepted)
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

  // User accepts changes - simulate by manually creating incremental-approval tag
  // (In real app this happens in handleClearDiffTag after clicking Accept All)
  await page.evaluate(async ([filePath, content, sessionId]) => {
    await window.electronAPI.invoke('history:create-incremental-approval-tag',
      filePath,
      content,
      sessionId,
      {}
    );
  }, [testFilePath, versionC, 'test-session-1']);

  await page.waitForTimeout(100);

  // Verify incremental-approval tag was created
  tags = await queryTags(electronApp, testFilePath);
  const incrementalTag = tags.find((t: any) => t.type === 'incremental-approval' && t.status === 'pending-review');
  expect(incrementalTag).toBeDefined();
  console.log('✓ Incremental-approval tag created with accepted state (Version C)');

  // Verify pre-edit tag was marked as reviewed
  const reviewedPreEdit = tags.find((t: any) => t.type === 'pre-edit' && t.status === 'reviewed');
  expect(reviewedPreEdit).toBeDefined();
  console.log('✓ Pre-edit tag marked as reviewed');

  // SECOND AI EDIT: Start a new AI edit with Version C as current state
  // This simulates: AI makes more changes on top of the accepted state
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

  // Verify new pre-edit tag was created
  tags = await queryTags(electronApp, testFilePath);
  const secondPreEditTag = tags.filter((t: any) => t.type === 'pre-edit' && t.status === 'pending-review');
  expect(secondPreEditTag.length).toBeGreaterThan(0);
  console.log('✓ Second pre-edit tag created');

  // Verify old incremental-approval tag was marked as reviewed (by createTag)
  const reviewedIncremental = tags.find((t: any) => t.type === 'incremental-approval' && t.status === 'reviewed');
  expect(reviewedIncremental).toBeDefined();
  console.log('✓ Previous incremental-approval tag marked as reviewed when creating new pre-edit tag');

  // CRITICAL TEST: Verify getDiffBaseline returns content with the accepted changes (Version C)
  // NOT the original content (Version A)
  // The pending tag will be the new pre-edit tag, but it was created with Version C content
  const baseline = await getDiffBaseline(electronApp, testFilePath);
  expect(baseline).toBeDefined();
  expect(baseline?.content).toContain('FIRST AI EDIT'); // Should have Version C content (accepted state)
  expect(baseline?.content).not.toContain('First paragraph.'); // Should NOT have Version A content

  console.log('✓ getDiffBaseline correctly returned accepted state (Version C)');
  console.log('✓ Second AI edit will diff against accepted state, not original');
});
