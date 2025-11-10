/**
 * Test edge cases where CLEAR_DIFF_TAG_COMMAND should be dispatched
 * to properly clean up diff sessions
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import {
  simulateApplyDiff,
  queryTags
} from '../utils/aiToolSimulator';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree
} from '../utils/testHelpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'test.md');

  // Create test file with content
  const initialContent = `# Test Document

This is the first paragraph.

This is the second paragraph.
`;

  await fs.writeFile(testFilePath, initialContent, 'utf8');

  // Launch app
  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);

  // Dismiss API key dialog
  await dismissAPIKeyDialog(page);

  // Wait for workspace
  await waitForWorkspaceReady(page);

  // Open the test file
  await openFileFromTree(page, 'test.md');

  // Wait for editor
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, {
    timeout: TEST_TIMEOUTS.EDITOR_LOAD
  });
});

test.afterEach(async () => {
  if (electronApp) {
    await electronApp.close();
  }
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('should dispatch CLEAR_DIFF_TAG_COMMAND after Accept All', async () => {
  // Read original content
  const originalContent = await fs.readFile(testFilePath, 'utf8');

  // Create pre-edit tag (simulates AI session start)
  await page.evaluate(async ([filePath, content]) => {
    await window.electronAPI.invoke('history:create-tag', filePath, 'test-tag-accept-all', content, 'test-session', 'tool-test');
  }, [testFilePath, originalContent]);

  await page.waitForTimeout(200);

  // Apply diffs
  const result = await simulateApplyDiff(page, testFilePath, [
    { oldText: 'This is the first paragraph.', newText: 'FIRST CHANGE.' },
    { oldText: 'This is the second paragraph.', newText: 'SECOND CHANGE.' },
  ]);

  expect(result.success).toBe(true);

  // Wait for diff approval bar
  await page.waitForSelector('.diff-approval-bar', { timeout: 2000 });

  // Verify we have a pending tag
  const tagsBefore = await queryTags(electronApp, testFilePath);
  const pendingBefore = tagsBefore.filter(t => t.status === 'pending-review');
  console.log('Tags before Accept All:', tagsBefore.map(t => ({ type: t.type, status: t.status })));
  expect(pendingBefore.length).toBeGreaterThan(0);

  // Click Accept All
  const acceptAllButton = page.locator('button[data-action="accept-all"]');
  await acceptAllButton.click();

  // Wait for diff approval bar to disappear (indicates cleanup happened)
  await page.waitForSelector('.diff-approval-bar', { state: 'hidden', timeout: 3000 });

  // Verify tag was marked as reviewed
  await page.waitForTimeout(500);
  const tagsAfter = await queryTags(electronApp, testFilePath);
  console.log('Tags after Accept All:', tagsAfter.map(t => ({ type: t.type, status: t.status })));
  const pendingAfter = tagsAfter.filter(t => t.status === 'pending-review');
  expect(pendingAfter.length).toBe(0);

  console.log('✓ CLEAR_DIFF_TAG_COMMAND dispatched after Accept All');
});
