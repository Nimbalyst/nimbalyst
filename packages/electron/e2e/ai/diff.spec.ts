/**
 * Diff E2E Tests (Consolidated)
 *
 * Tests diff approval workflows, tab targeting, consecutive edits, baseline tracking,
 * cleanup behavior, complex structures, streaming scenarios, and edge cases.
 * Uses synthetic AI simulation (no real API calls).
 *
 * Consolidated from:
 * - diff-behavior.spec.ts (tab targeting, consecutive edits, group approval, baseline, cleanup)
 * - diff-reliability.spec.ts (complex structures, streaming, edge cases)
 *
 * Original sources:
 * - ai-tool-simulator.spec.ts (tab targeting)
 * - ai-turn-end-snapshots.spec.ts (consecutive edits with pre-edit tags)
 * - consecutive-edits-diff-update.spec.ts (diff view updates on consecutive edits)
 * - diff-edge-case-cleanup.spec.ts (CLEAR_DIFF_TAG_COMMAND on manual deletion)
 * - diff-group-approval.spec.ts (individual group approval)
 * - incremental-baseline-tracking.spec.ts (baseline shifts after acceptance)
 * - incremental-diff-cleanup.spec.ts (tag cleanup after incremental accept/reject)
 * - reject-then-accept-all.spec.ts (rejected diffs stay rejected on Accept All)
 * - Various diff-reliability edge case files
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
  TEST_TIMEOUTS,
  ACTIVE_EDITOR_SELECTOR,
} from '../helpers';
import {
  simulateApplyDiff,
  simulateStreamContent,
  setupAIApiForTesting,
  acceptDiffs,
  verifyEditorContains,
  getActiveEditorFilePath,
  waitForEditorReady,
  createTestMarkdown,
  queryTags,
  getDiffBaseline,
  countTagsByType,
  triggerManualSave,
  waitForSave,
} from '../utils/aiToolSimulator';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  openFileFromTree,
  closeTabByFileName,
  manualSaveDocument,
  editDocumentContent,
} from '../utils/testHelpers';

// All test files created upfront to avoid state conflicts
const TEST_FILES = {
  // --- Behavior tests ---
  // Tab targeting
  tabFirst: 'tab-first.md',
  tabSecond: 'tab-second.md',
  // Consecutive edits
  consecutiveEdits: 'consecutive-edits.md',
  rapidEdits: 'rapid-edits.md',
  tabSwitchEdits: 'tab-switch-edits.md',
  tabSwitchSecond: 'tab-switch-second.md',
  // File-watcher based consecutive edits
  fwConsecutive: 'fw-consecutive.md',
  fwDiffMode: 'fw-diff-mode.md',
  // Manual delete cleanup
  manualDelete: 'manual-delete.md',
  // Group approval
  groupApproval: 'group-approval.md',
  // Baseline tracking
  baselineTracking: 'baseline-tracking.md',
  // Incremental cleanup
  incrementalAccept: 'incremental-accept.md',
  incrementalReject: 'incremental-reject.md',
  incrementalAutosave: 'incremental-autosave.md',
  incrementalMixed: 'incremental-mixed.md',
  incrementalBaseline: 'incremental-baseline.md',
  // Reject then accept all
  rejectThenAccept: 'reject-then-accept.md',

  // --- Reliability tests ---
  // Complex Structures
  nestedList: 'nested-list.md',
  tableRow: 'table-row.md',
  codeBlock: 'code-block.md',
  mixedContent: 'mixed-content.md',
  deeplyNested: 'deeply-nested.md',
  whitespace: 'whitespace.md',
  // Streaming Scenarios
  streamingList: 'streaming-list.md',
  streamingMiddle: 'streaming-middle.md',
  streamingComplex: 'streaming-complex.md',
  streamingRapid: 'streaming-rapid.md',
  // Edge Cases
  emptyDoc: 'empty-doc.md',
  longLines: 'long-lines.md',
  specialChars: 'special-chars.md',
  formatting: 'formatting.md',
  multipleEdits: 'multiple-edits.md',
};

// Content templates
const SIMPLE_CONTENT = '# Test\n\nOriginal content.\n';
const INITIAL_CONTENT = '# Test\n\nInitial content.\n';
const MULTI_SECTION_CONTENT = `# Document Title

## Section One
This is the first section with some content.

## Section Two
This is the second section with different content.

## Section Three
This is the third section with more content.
`;
const THREE_SECTION_CONTENT = `# Document

First section.

Second section.

Third section.
`;
const PARAGRAPH_CONTENT = `# Test Document

This is the first paragraph.

This is the second paragraph.
`;
const TWO_LINE_CONTENT = '# Test Document\n\nOriginal content line 1.\nOriginal content line 2.\n';
const BASELINE_CONTENT = `# Document

First paragraph.

Second paragraph.

Third paragraph.
`;

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create all test files upfront
  const fileContents: Record<string, string> = {
    // Behavior test files
    [TEST_FILES.tabFirst]: createTestMarkdown({
      'First Document': 'This is the first test document.',
      'Section One': 'Content in section one.',
    }),
    [TEST_FILES.tabSecond]: createTestMarkdown({
      'Second Document': 'This is the second test document.',
      'Section Two': 'Content in section two.',
    }),
    [TEST_FILES.consecutiveEdits]: TWO_LINE_CONTENT,
    [TEST_FILES.rapidEdits]: TWO_LINE_CONTENT,
    [TEST_FILES.tabSwitchEdits]: TWO_LINE_CONTENT,
    [TEST_FILES.tabSwitchSecond]: TWO_LINE_CONTENT,
    [TEST_FILES.fwConsecutive]: SIMPLE_CONTENT,
    [TEST_FILES.fwDiffMode]: SIMPLE_CONTENT,
    [TEST_FILES.manualDelete]: PARAGRAPH_CONTENT,
    [TEST_FILES.groupApproval]: `# Document Title

This is the first paragraph with some content that we will modify.

This is the second paragraph with different content.

This is the third paragraph.
`,
    [TEST_FILES.baselineTracking]: BASELINE_CONTENT,
    [TEST_FILES.incrementalAccept]: MULTI_SECTION_CONTENT,
    [TEST_FILES.incrementalReject]: MULTI_SECTION_CONTENT,
    [TEST_FILES.incrementalAutosave]: MULTI_SECTION_CONTENT,
    [TEST_FILES.incrementalMixed]: MULTI_SECTION_CONTENT,
    [TEST_FILES.incrementalBaseline]: MULTI_SECTION_CONTENT,
    [TEST_FILES.rejectThenAccept]: THREE_SECTION_CONTENT,

    // Reliability test files
    [TEST_FILES.nestedList]: INITIAL_CONTENT,
    [TEST_FILES.tableRow]: INITIAL_CONTENT,
    [TEST_FILES.codeBlock]: INITIAL_CONTENT,
    [TEST_FILES.mixedContent]: INITIAL_CONTENT,
    [TEST_FILES.deeplyNested]: INITIAL_CONTENT,
    [TEST_FILES.whitespace]: INITIAL_CONTENT,
    [TEST_FILES.streamingList]: INITIAL_CONTENT,
    [TEST_FILES.streamingMiddle]: INITIAL_CONTENT,
    [TEST_FILES.streamingComplex]: INITIAL_CONTENT,
    [TEST_FILES.streamingRapid]: INITIAL_CONTENT,
    [TEST_FILES.emptyDoc]: INITIAL_CONTENT,
    [TEST_FILES.longLines]: INITIAL_CONTENT,
    [TEST_FILES.specialChars]: INITIAL_CONTENT,
    [TEST_FILES.formatting]: INITIAL_CONTENT,
    [TEST_FILES.multipleEdits]: INITIAL_CONTENT,
  };

  for (const [fileName, content] of Object.entries(fileContents)) {
    await fs.writeFile(path.join(workspaceDir, fileName), content, 'utf8');
  }

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);

  // Make window wider so diff header buttons render properly
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.setSize(1400, 900);
      win.center();
    }
  });
  await page.waitForTimeout(200);
});

test.afterAll(async () => {
  await electronApp?.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

// ============================================================
// TAB TARGETING
// Tests that diffs and streaming target the correct tab
// ============================================================

test.describe('Tab Targeting', () => {
  test('should apply diff edits to the correct tab when switching', async () => {
    const file1Path = path.join(workspaceDir, TEST_FILES.tabFirst);
    const file2Path = path.join(workspaceDir, TEST_FILES.tabSecond);

    // Open first file
    await openFileFromTree(page, TEST_FILES.tabFirst);
    await page.waitForTimeout(500);

    // Set up AI API for testing
    await setupAIApiForTesting(page);

    // Open second file (creates second tab)
    await openFileFromTree(page, TEST_FILES.tabSecond);
    await page.waitForTimeout(500);

    // Apply edit to second file
    const result = await simulateApplyDiff(page, file2Path, [
      { oldText: 'second test document', newText: 'EDITED second document' },
    ]);
    expect(result.success).toBe(true);
    await page.waitForTimeout(500);

    // Accept the diffs
    await acceptDiffs(page);

    // Verify edit in second file
    let hasEdit = await verifyEditorContains(page, 'EDITED second document');
    expect(hasEdit).toBe(true);

    // Switch to first tab - verify it was NOT edited
    await openFileFromTree(page, TEST_FILES.tabFirst);
    await page.waitForTimeout(500);
    hasEdit = await verifyEditorContains(page, 'EDITED', false);
    expect(hasEdit).toBe(true); // Should NOT contain EDITED

    // Apply edit to first file
    const result2 = await simulateApplyDiff(page, file1Path, [
      { oldText: 'first test document', newText: 'MODIFIED first document' },
    ]);
    expect(result2.success).toBe(true);
    await page.waitForTimeout(500);
    await acceptDiffs(page);

    // Verify edit in first file
    hasEdit = await verifyEditorContains(page, 'MODIFIED first document');
    expect(hasEdit).toBe(true);

    // Switch back to second - verify isolation
    await openFileFromTree(page, TEST_FILES.tabSecond);
    await page.waitForTimeout(500);
    hasEdit = await verifyEditorContains(page, 'MODIFIED', false);
    expect(hasEdit).toBe(true); // Should NOT have MODIFIED

    // Clean up tabs
    await closeTabByFileName(page, TEST_FILES.tabFirst);
    await closeTabByFileName(page, TEST_FILES.tabSecond);
  });

  test('should apply additional edits without cross-tab bleed', async () => {
    const file2Path = path.join(workspaceDir, TEST_FILES.tabSecond);

    // Open both files
    await openFileFromTree(page, TEST_FILES.tabFirst);
    await page.waitForTimeout(500);
    await setupAIApiForTesting(page);

    await openFileFromTree(page, TEST_FILES.tabSecond);
    await page.waitForTimeout(500);

    // Apply a second edit to second file (adds new content)
    const result = await simulateApplyDiff(page, file2Path, [
      { oldText: 'Content in section two.', newText: 'Content in section two.\n\nThis was added by AI!' },
    ]);
    expect(result.success).toBe(true);
    await page.waitForTimeout(500);
    await acceptDiffs(page);

    // Verify new content appears in second file
    const hasNewContent = await verifyEditorContains(page, 'This was added by AI!');
    expect(hasNewContent).toBe(true);

    // Switch to first tab - should NOT have the new content
    await openFileFromTree(page, TEST_FILES.tabFirst);
    await page.waitForTimeout(500);
    const hasWrongContent = await verifyEditorContains(page, 'This was added by AI!', false);
    expect(hasWrongContent).toBe(true); // Should NOT contain the new content

    // Clean up tabs
    await closeTabByFileName(page, TEST_FILES.tabFirst);
    await closeTabByFileName(page, TEST_FILES.tabSecond);
  });
});

// ============================================================
// CONSECUTIVE EDITS VIA FILE WATCHER
// Tests that diff mode activates and persists through consecutive
// disk writes (simulating what Claude Code's Edit tool does)
// ============================================================

test.describe('Consecutive Edits via File Watcher', () => {
  test('should handle consecutive disk edits without showing conflict dialog', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.fwConsecutive);
    await openFileFromTree(page, TEST_FILES.fwConsecutive);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 2000 });

    // Read original content and create pre-edit tag
    const originalContent = await fs.readFile(filePath, 'utf8');
    await page.evaluate(
      async ([fp, content]) => {
        await window.electronAPI.history.createTag(fp, 'test-tag-1', content, 'test-session', 'tool-1');
      },
      [filePath, originalContent]
    );
    await page.waitForTimeout(200);

    // Write edit 1 to disk
    const content1 = originalContent.replace('Original content.', 'Original content.\n\nFirst edit.');
    await fs.writeFile(filePath, content1, 'utf8');
    await page.waitForTimeout(1000);

    // Dialogs should NOT appear
    await expect(page.locator('.file-background-change-dialog-overlay')).not.toBeVisible({ timeout: 500 });

    // Diff mode should activate
    const keepAllButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton);
    await expect(keepAllButton).toBeVisible({ timeout: 2000 });

    // Write edit 2
    const content2 = content1.replace('First edit.', 'First edit.\n\nSecond edit.');
    await fs.writeFile(filePath, content2, 'utf8');
    await page.waitForTimeout(1000);
    await expect(keepAllButton).toBeVisible({ timeout: 2000 });

    // Write edit 3
    const content3 = content2.replace('Second edit.', 'Second edit.\n\nThird edit.');
    await fs.writeFile(filePath, content3, 'utf8');
    await page.waitForTimeout(1000);
    await expect(keepAllButton).toBeVisible({ timeout: 2000 });

    // Accept and verify
    await keepAllButton.click();
    await page.waitForTimeout(500);
    await expect(keepAllButton).not.toBeVisible({ timeout: 2000 });

    const finalContent = await fs.readFile(filePath, 'utf8');
    expect(finalContent).toContain('First edit');
    expect(finalContent).toContain('Second edit');
    expect(finalContent).toContain('Third edit');

    await closeTabByFileName(page, TEST_FILES.fwConsecutive);
  });

  test('should show diff mode after applyReplacements and update on subsequent edits', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.fwDiffMode);
    await openFileFromTree(page, TEST_FILES.fwDiffMode);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 2000 });

    // Simulate first AI edit via editorRegistry
    await page.evaluate(async ([fp]) => {
      const editorRegistry = (window as any).__editorRegistry;
      await editorRegistry.applyReplacements(fp, [{ oldText: 'Original content.', newText: 'First edit.' }]);
    }, [filePath]);
    await page.waitForTimeout(500);

    const keepAllButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton);
    await expect(keepAllButton).toBeVisible({ timeout: 3000 });

    // Make second edit
    await page.evaluate(async ([fp]) => {
      const editorRegistry = (window as any).__editorRegistry;
      await editorRegistry.applyReplacements(fp, [{ oldText: 'First edit.', newText: 'Second edit.' }]);
    }, [filePath]);
    await page.waitForTimeout(500);
    await expect(keepAllButton).toBeVisible();

    // Accept changes
    await keepAllButton.click();
    await page.waitForTimeout(200);
    await expect(keepAllButton).not.toBeVisible({ timeout: 2000 });

    await closeTabByFileName(page, TEST_FILES.fwDiffMode);
  });
});

// ============================================================
// CONSECUTIVE EDITS DIFF VIEW UPDATES
// Tests that the diff view correctly updates when multiple edits
// are written to disk while diff mode is active
// ============================================================

test.describe('Consecutive Edits Diff View Updates', () => {
  test('should update diff view when consecutive AI edits occur', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.consecutiveEdits);
    await openFileFromTree(page, TEST_FILES.consecutiveEdits);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 2000 });

    // Create pre-edit tag
    const tagName = `ai-edit-pending-test-${Date.now()}`;
    const initialContent = await fs.readFile(filePath, 'utf8');
    await page.evaluate(
      async ({ filePath, tag, content }) => {
        await window.electronAPI.invoke('history:create-tag', filePath, tag, content, 'test-session', 'test-tool-use');
      },
      { filePath, tag: tagName, content: initialContent }
    );

    // First edit
    const firstEdit = '# Test Document\n\nFirst edit line 1.\nFirst edit line 2.\n';
    await fs.writeFile(filePath, firstEdit, 'utf8');
    await page.waitForTimeout(500);

    const acceptAllButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton);
    await expect(acceptAllButton).toBeVisible({ timeout: 2000 });

    const editor = page.locator(PLAYWRIGHT_TEST_SELECTORS.contentEditable);
    expect(await editor.textContent()).toContain('First edit');

    // Second edit
    const secondEdit = '# Test Document\n\nSecond edit line 1.\nSecond edit line 2.\nAdditional line.\n';
    await fs.writeFile(filePath, secondEdit, 'utf8');
    await page.waitForTimeout(500);

    await expect(acceptAllButton).toBeVisible({ timeout: 2000 });
    const updatedText = await editor.textContent();
    expect(updatedText).toContain('Second edit');
    expect(updatedText).toContain('Additional line');
    expect(updatedText).not.toContain('First edit line 1');

    // Accept and verify
    await acceptAllButton.click();
    await page.waitForTimeout(500);
    expect(await fs.readFile(filePath, 'utf8')).toBe(secondEdit);

    await closeTabByFileName(page, TEST_FILES.consecutiveEdits);
  });

  test('should show diff between original and latest after multiple rapid edits', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.rapidEdits);
    await openFileFromTree(page, TEST_FILES.rapidEdits);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 2000 });

    // Create pre-edit tag
    const originalContent = await fs.readFile(filePath, 'utf8');
    await page.evaluate(
      async ({ filePath, tag, content }) => {
        await window.electronAPI.invoke('history:create-tag', filePath, tag, content, 'test-session', 'test-tool-use');
      },
      { filePath, tag: `ai-edit-rapid-${Date.now()}`, content: originalContent }
    );

    // Three rapid edits
    await fs.writeFile(filePath, '# Test Document\n\nEdit 1.\n', 'utf8');
    await page.waitForTimeout(200);
    await fs.writeFile(filePath, '# Test Document\n\nEdit 2.\n', 'utf8');
    await page.waitForTimeout(200);
    const edit3 = '# Test Document\n\nEdit 3.\nFinal line.\n';
    await fs.writeFile(filePath, edit3, 'utf8');
    await page.waitForTimeout(500);

    const acceptAllButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton);
    await expect(acceptAllButton).toBeVisible({ timeout: 2000 });

    const editorText = await page.locator(PLAYWRIGHT_TEST_SELECTORS.contentEditable).textContent();
    expect(editorText).toContain('Edit 3');
    expect(editorText).toContain('Final line');

    await acceptAllButton.click();
    await page.waitForTimeout(200);
    expect(await fs.readFile(filePath, 'utf8')).toBe(edit3);

    await closeTabByFileName(page, TEST_FILES.rapidEdits);
  });

  test('should maintain diff mode across tab switches during consecutive edits', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.tabSwitchEdits);
    await openFileFromTree(page, TEST_FILES.tabSwitchEdits);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 2000 });

    // Create pre-edit tag and apply first edit
    const originalContent = await fs.readFile(filePath, 'utf8');
    await page.evaluate(
      async ({ filePath, tag, content }) => {
        await window.electronAPI.invoke('history:create-tag', filePath, tag, content, 'test-session', 'test-tool-use');
      },
      { filePath, tag: `ai-edit-tab-switch-${Date.now()}`, content: originalContent }
    );

    await fs.writeFile(filePath, '# Test Document\n\nEdited content.\n', 'utf8');
    await page.waitForTimeout(500);

    const acceptAllButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton);
    await expect(acceptAllButton).toBeVisible({ timeout: 2000 });

    // Switch to another file
    await openFileFromTree(page, TEST_FILES.tabSwitchSecond);
    await page.waitForTimeout(500);

    // Apply second edit to original file (while viewing different file)
    await fs.writeFile(filePath, '# Test Document\n\nSecond edited content.\n', 'utf8');
    await page.waitForTimeout(500);

    // Switch back
    await openFileFromTree(page, TEST_FILES.tabSwitchEdits);
    await page.waitForTimeout(500);

    // Diff mode should be restored with updated content
    await expect(acceptAllButton).toBeVisible({ timeout: 2000 });
    const editorText = await page.locator(ACTIVE_EDITOR_SELECTOR).textContent();
    expect(editorText).toContain('Second edited content');

    await closeTabByFileName(page, TEST_FILES.tabSwitchEdits);
    await closeTabByFileName(page, TEST_FILES.tabSwitchSecond);
  });
});

// ============================================================
// MANUAL DELETE CLEANUP
// Tests CLEAR_DIFF_TAG_COMMAND when user manually deletes diff content
// ============================================================

test.describe('Manual Delete Cleanup', () => {
  test('should clear pending tag when user manually deletes all diff content and saves', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.manualDelete);
    const originalContent = await fs.readFile(filePath, 'utf8');

    await openFileFromTree(page, TEST_FILES.manualDelete);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 2000 });

    // Create pre-edit tag
    await page.evaluate(
      async ([fp, content]) => {
        await window.electronAPI.invoke('history:create-tag', fp, 'test-tag-manual-delete', content, 'test-session', 'tool-test');
      },
      [filePath, originalContent]
    );
    await page.waitForTimeout(200);

    // Apply diffs
    const result = await simulateApplyDiff(page, filePath, [
      { oldText: 'This is the first paragraph.', newText: 'FIRST CHANGE.' },
      { oldText: 'This is the second paragraph.', newText: 'SECOND CHANGE.' },
    ]);
    expect(result.success).toBe(true);
    await page.waitForSelector('.unified-diff-header', { timeout: 2000 });

    // Verify pending tag exists
    const tagsBefore = await queryTags(electronApp, filePath);
    expect(tagsBefore.filter((t: any) => t.status === 'pending-review').length).toBeGreaterThan(0);

    // Select all and delete
    const editor = page.locator(PLAYWRIGHT_TEST_SELECTORS.contentEditable);
    await editor.click();
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    // Save - should trigger tag clearing
    await page.keyboard.press('Meta+s');
    await page.waitForTimeout(1000);

    // Tag should be marked as reviewed
    const tagsAfterSave = await queryTags(electronApp, filePath);
    expect(tagsAfterSave.filter((t: any) => t.status === 'pending-review').length).toBe(0);

    // Close and reopen - should NOT show diff mode
    await closeTabByFileName(page, TEST_FILES.manualDelete);
    await openFileFromTree(page, TEST_FILES.manualDelete);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 2000 });
    await page.waitForTimeout(500);
    await expect(page.locator('.unified-diff-header')).not.toBeVisible();

    await closeTabByFileName(page, TEST_FILES.manualDelete);
  });
});

// ============================================================
// GROUP APPROVAL
// Tests individual diff group approval
// ============================================================

test.describe('Group Approval', () => {
  test('should decrease change count after approving individual group', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.groupApproval);
    await openFileFromTree(page, TEST_FILES.groupApproval);
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, filePath, [
      { oldText: 'first paragraph', newText: 'FIRST PARAGRAPH' },
      { oldText: 'second paragraph', newText: 'SECOND PARAGRAPH' },
    ]);
    expect(result.success).toBe(true);

    await page.waitForSelector('.unified-diff-header', { timeout: TEST_TIMEOUTS.DEFAULT_WAIT });

    // Should show 2 changes (may auto-select first change, showing "1 of 2")
    const counterText = await page.locator('.unified-diff-header-change-counter').textContent();
    expect(counterText).toContain('2');

    // Navigate to first change if not already selected
    if (!counterText?.includes('of')) {
      await page.locator('button[aria-label="Next change"]').click();
      await page.waitForTimeout(200);
    }
    expect(await page.locator('.unified-diff-header-change-counter').textContent()).toContain('of 2');

    // Keep individual change group
    await page.locator('.unified-diff-header-button-accept-single').click();
    await page.waitForTimeout(300);

    // Should now show 1 change
    const updatedCount = await page.locator('.unified-diff-header-change-counter').textContent();
    expect(updatedCount).toContain('1');
    expect(updatedCount).not.toContain('2');

    // Diff bar should still exist (one change pending)
    await expect(page.locator('.unified-diff-header')).toBeVisible();

    await closeTabByFileName(page, TEST_FILES.groupApproval);
  });
});

// ============================================================
// BASELINE TRACKING
// Tests that subsequent AI edits use accepted state as baseline
// ============================================================

test.describe('Baseline Tracking', () => {
  test('subsequent AI edits should use accepted state as baseline, not original', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.baselineTracking);

    await openFileFromTree(page, TEST_FILES.baselineTracking);
    await waitForEditorReady(page);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 2000 });

    // Version A: initial
    const versionA = await fs.readFile(filePath, 'utf8');
    expect(versionA).toContain('First paragraph.');

    // Create pre-edit tag with Version A
    await page.evaluate(
      async ([fp, content]) => {
        await window.electronAPI.invoke('history:create-tag', fp, 'test-session-1', content, 'test-session-1', 'baseline-test');
      },
      [filePath, versionA]
    );
    await page.waitForTimeout(100);

    // Verify pre-edit tag
    let tags = await queryTags(electronApp, filePath);
    const preEditTag = tags.find((t: any) => t.type === 'pre-edit' && t.status === 'pending-review');
    expect(preEditTag).toBeDefined();

    // Simulate user accepts -> mark tag as reviewed, write accepted content
    const versionC = versionA.replace('First paragraph.', 'FIRST AI EDIT');
    await page.evaluate(
      async ([fp, tagId]) => {
        await window.electronAPI.history.updateTagStatus(fp, tagId, 'reviewed');
      },
      [filePath, preEditTag.tagId]
    );
    await fs.writeFile(filePath, versionC, 'utf8');
    await page.waitForTimeout(100);

    // Verify no pending tags
    tags = await queryTags(electronApp, filePath);
    expect(tags.filter((t: any) => t.status === 'pending-review').length).toBe(0);

    // Second AI edit: create new pre-edit tag with Version C (the accepted state)
    await page.evaluate(
      async ([fp, content, sessionId]) => {
        await window.electronAPI.invoke('history:create-tag', fp, sessionId, content, sessionId, 'second-edit-test');
      },
      [filePath, versionC, 'test-session-1']
    );
    await page.waitForTimeout(100);

    // getDiffBaseline should return Version C, not Version A
    const baseline = await getDiffBaseline(electronApp, filePath);
    expect(baseline).toBeDefined();
    expect(baseline?.content).toContain('FIRST AI EDIT');
    expect(baseline?.content).not.toContain('First paragraph.');

    await closeTabByFileName(page, TEST_FILES.baselineTracking);
  });
});

// ============================================================
// INCREMENTAL CLEANUP
// Tests tag cleanup after incremental accept/reject workflows
// ============================================================

test.describe('Incremental Cleanup', () => {
  test('should clear tag and exit diff mode after accepting all changes', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.incrementalAccept);
    await openFileFromTree(page, TEST_FILES.incrementalAccept);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    const originalContent = await fs.readFile(filePath, 'utf8');
    await page.evaluate(
      async ([fp, content]) => {
        await window.electronAPI.invoke('history:create-tag', fp, 'test-tag-accept-all', content, 'test-session-accept', 'tool-accept-all');
      },
      [filePath, originalContent]
    );
    await page.waitForTimeout(200);

    const result = await simulateApplyDiff(page, filePath, [
      { oldText: 'This is the first section with some content.', newText: 'This is the UPDATED first section with new content.' },
      { oldText: 'This is the second section with different content.', newText: 'This is the MODIFIED second section with changed content.' },
      { oldText: 'This is the third section with more content.', newText: 'This is the REVISED third section with updated content.' },
    ]);
    expect(result.success).toBe(true);
    await page.waitForTimeout(1000);
    await page.waitForSelector('.unified-diff-header', { timeout: 2000 });
    expect(await page.locator('.unified-diff-header-change-counter').textContent()).toContain('3');

    // Accept all
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.acceptAllButton).click();
    await page.waitForTimeout(500);
    await expect(page.locator('.unified-diff-header')).toHaveCount(0, { timeout: 2000 });

    // Save and verify
    await manualSaveDocument(page);
    await waitForSave(page, TEST_FILES.incrementalAccept);
    const finalContent = await fs.readFile(filePath, 'utf8');
    expect(finalContent).toContain('UPDATED first section');
    expect(finalContent).toContain('MODIFIED second section');
    expect(finalContent).toContain('REVISED third section');

    // Close and reopen - should NOT show diff mode
    await closeTabByFileName(page, TEST_FILES.incrementalAccept);
    await openFileFromTree(page, TEST_FILES.incrementalAccept);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 3000 });
    await page.waitForTimeout(1000);
    expect(await page.locator('.unified-diff-header').count()).toBe(0);

    await closeTabByFileName(page, TEST_FILES.incrementalAccept);
  });

  test('should clear tag and exit diff mode after rejecting all changes', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.incrementalReject);
    await openFileFromTree(page, TEST_FILES.incrementalReject);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    const originalContent = await fs.readFile(filePath, 'utf8');
    await page.evaluate(
      async ([fp, content]) => {
        await window.electronAPI.invoke('history:create-tag', fp, 'test-tag-reject-all', content, 'test-session-reject', 'tool-reject-all');
      },
      [filePath, originalContent]
    );
    await page.waitForTimeout(200);

    const result = await simulateApplyDiff(page, filePath, [
      { oldText: 'This is the first section with some content.', newText: 'UPDATED first.' },
      { oldText: 'This is the second section with different content.', newText: 'MODIFIED second.' },
      { oldText: 'This is the third section with more content.', newText: 'REVISED third.' },
    ]);
    expect(result.success).toBe(true);
    await page.waitForSelector('.unified-diff-header', { timeout: 2000 });
    expect(await page.locator('.unified-diff-header-change-counter').textContent()).toContain('3');

    // Reject each change individually
    const rejectButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.diffRejectButton).first();
    await rejectButton.click();
    await page.waitForTimeout(200);
    await expect(page.locator('.unified-diff-header-change-counter')).toContainText('of 2');

    await rejectButton.click();
    await page.waitForTimeout(200);
    await expect(page.locator('.unified-diff-header-change-counter')).toContainText('of 1');

    await rejectButton.click();
    await page.waitForTimeout(500);
    await expect(page.locator('.unified-diff-header')).toHaveCount(0, { timeout: 2000 });

    // Verify original content preserved
    await manualSaveDocument(page);
    await waitForSave(page, TEST_FILES.incrementalReject);
    const finalContent = await fs.readFile(filePath, 'utf8');
    expect(finalContent).toContain('This is the first section with some content.');
    expect(finalContent).toContain('This is the second section with different content.');
    expect(finalContent).toContain('This is the third section with more content.');

    // Close and reopen - should NOT show diff mode
    await closeTabByFileName(page, TEST_FILES.incrementalReject);
    await openFileFromTree(page, TEST_FILES.incrementalReject);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 3000 });
    await page.waitForTimeout(1000);
    expect(await page.locator('.unified-diff-header').count()).toBe(0);

    await closeTabByFileName(page, TEST_FILES.incrementalReject);
  });

  test('should only show remaining diffs after accepting one and reopening file', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.incrementalBaseline);
    await openFileFromTree(page, TEST_FILES.incrementalBaseline);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    const originalContent = await fs.readFile(filePath, 'utf8');
    await page.evaluate(
      async ([fp, content]) => {
        await window.electronAPI.invoke('history:create-tag', fp, 'test-tag-baseline', content, 'test-session-baseline', 'tool-baseline');
      },
      [filePath, originalContent]
    );
    await page.waitForTimeout(200);

    const result = await simulateApplyDiff(page, filePath, [
      { oldText: 'This is the first section with some content.', newText: 'FIRST CHANGE.' },
      { oldText: 'This is the second section with different content.', newText: 'SECOND CHANGE.' },
    ]);
    expect(result.success).toBe(true);
    await page.waitForSelector('.unified-diff-header', { timeout: 2000 });

    const initialDiffCount = await page.locator('.diff-node').count();

    // Accept only the first change
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffAcceptButton).first().click();
    await page.waitForTimeout(500);

    // Verify incremental-approval tag was created
    expect(await countTagsByType(electronApp, filePath, 'incremental-approval')).toBeGreaterThanOrEqual(1);

    // Verify baseline shifted
    const baseline = await getDiffBaseline(electronApp, filePath);
    expect(baseline?.tagType).toBe('incremental-approval');

    // Close and reopen
    await closeTabByFileName(page, TEST_FILES.incrementalBaseline);
    await openFileFromTree(page, TEST_FILES.incrementalBaseline);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 3000 });
    await page.waitForTimeout(1000);

    // Should still show diff mode (second change pending)
    await expect(page.locator('.unified-diff-header')).toBeVisible({ timeout: 2000 });

    // Should show fewer diffs than before
    const remainingDiffCount = await page.locator('.diff-node').count();
    expect(remainingDiffCount).toBeLessThanOrEqual(initialDiffCount);

    await closeTabByFileName(page, TEST_FILES.incrementalBaseline);
  });
});

// ============================================================
// REJECT THEN ACCEPT ALL
// Tests that rejected diffs stay rejected when using Accept All
// ============================================================

test.describe('Reject Then Accept All', () => {
  test('should remember rejected change when accepting all remaining changes', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.rejectThenAccept);

    await openFileFromTree(page, TEST_FILES.rejectThenAccept);
    await waitForEditorReady(page);

    const originalContent = await fs.readFile(filePath, 'utf8');

    // Create pre-edit tag
    await page.evaluate(
      async ([fp, content]) => {
        await window.electronAPI.invoke('history:create-tag', fp, 'ai-edit-tag', content, 'test-ai-session', 'tool-1');
      },
      [filePath, originalContent]
    );
    await page.waitForTimeout(200);

    // Apply three diff changes
    const diffResult = await simulateApplyDiff(page, filePath, [
      { oldText: 'First section.', newText: 'FIRST CHANGE.' },
      { oldText: 'Second section.', newText: 'SECOND CHANGE.' },
      { oldText: 'Third section.', newText: 'THIRD CHANGE.' },
    ]);
    expect(diffResult.success).toBe(true);
    await page.waitForTimeout(1000);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.diffApprovalBar, { timeout: 2000 });
    expect(await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffChangeCounter).textContent()).toContain('3');

    // Accept first change
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffAcceptButton).click();
    await page.waitForTimeout(500);
    expect(await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffChangeCounter).textContent()).toContain('of 2');

    // Reject second change
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffRejectButton).click();
    await page.waitForTimeout(500);
    expect(await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffChangeCounter).textContent()).toContain('of 1');

    // Accept All remaining
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffAcceptAllButton).click();
    await page.waitForTimeout(1000);
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.diffApprovalBar)).toHaveCount(0, { timeout: 2000 });

    // Verify final content
    const finalContent = await fs.readFile(filePath, 'utf8');
    expect(finalContent).toContain('FIRST CHANGE');
    expect(finalContent).toContain('Second section'); // REJECTED - original preserved
    expect(finalContent).not.toContain('SECOND CHANGE');
    expect(finalContent).toContain('THIRD CHANGE');

    // Close and reopen - should NOT show diff mode
    await closeTabByFileName(page, TEST_FILES.rejectThenAccept);
    await openFileFromTree(page, TEST_FILES.rejectThenAccept);
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.contentEditable, { timeout: 3000 });
    await page.waitForTimeout(1000);
    expect(await page.locator(PLAYWRIGHT_TEST_SELECTORS.diffApprovalBar).count()).toBe(0);

    // Verify content persisted correctly
    const contentAfterReopen = await fs.readFile(filePath, 'utf8');
    expect(contentAfterReopen).toContain('FIRST CHANGE');
    expect(contentAfterReopen).toContain('Second section');
    expect(contentAfterReopen).not.toContain('SECOND CHANGE');
    expect(contentAfterReopen).toContain('THIRD CHANGE');

    await closeTabByFileName(page, TEST_FILES.rejectThenAccept);
  });
});

// ============================================================================
// COMPLEX STRUCTURES
// Tests the DiffPlugin's ability to handle various complex markdown structures
// ============================================================================

test.describe('Complex Structures', () => {
  test('should handle nested list edits', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.nestedList);
    const content = `# Shopping List

- Fruits
  - Apples
  - Bananas
  - Oranges
- Vegetables
  - Carrots
  - Broccoli
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.nestedList);
    await waitForEditorReady(page);

    // Try to add a nested item
    const result = await simulateApplyDiff(page, filePath, [
      { oldText: '  - Oranges', newText: '  - Oranges\n  - Grapes' }
    ]);

    expect(result.success).toBe(true);

    // Wait for unified diff header to appear
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

    // Accept the suggested changes
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();

    // Wait for diff header to disappear
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.nestedList);

    // Verify the change was applied to disk
    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('Grapes');

    await closeTabByFileName(page, TEST_FILES.nestedList);
  });

  test('should handle table row additions', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.tableRow);
    const content = `# Data Table

| Name | Age | City |
|------|-----|------|
| Alice | 30 | NYC |
| Bob | 25 | LA |
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.tableRow);
    await waitForEditorReady(page);

    // Add a new row
    const result = await simulateApplyDiff(page, filePath, [
      {
        oldText: '| Bob | 25 | LA |',
        newText: '| Bob | 25 | LA |\n| Charlie | 35 | SF |'
      }
    ]);

    expect(result.success).toBe(true);

    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

    // Accept (table diffs may require clicking twice due to a known Lexical bug)
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();
    await page.waitForTimeout(300);

    // Click again if header is still visible (table diff bug workaround)
    const headerStillVisible = await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader).isVisible();
    if (headerStillVisible) {
      await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();
    }

    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.tableRow);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('Charlie');

    await closeTabByFileName(page, TEST_FILES.tableRow);
  });

  test('should handle code block modifications', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.codeBlock);
    const content = `# Code Example

\`\`\`javascript
function hello() {
  console.log("Hello");
}
\`\`\`
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.codeBlock);
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, filePath, [
      {
        oldText: '  console.log("Hello");',
        newText: '  console.log("Hello");\n  console.log("World");'
      }
    ]);

    expect(result.success).toBe(true);

    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.codeBlock);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('World');

    await closeTabByFileName(page, TEST_FILES.codeBlock);
  });

  test('should handle mixed content type sections', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.mixedContent);
    const content = `# Mixed Content

Some text here.

- List item 1
- List item 2

\`\`\`python
def foo():
    pass
\`\`\`

More text here.
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.mixedContent);
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, filePath, [
      { oldText: '- List item 2', newText: '- List item 2\n- List item 3' },
      { oldText: 'More text here.', newText: 'More text here with additions.' }
    ]);

    expect(result.success).toBe(true);

    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.mixedContent);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('List item 3');
    expect(updatedContent).toContain('with additions');

    await closeTabByFileName(page, TEST_FILES.mixedContent);
  });

  test('should handle deeply nested structures', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.deeplyNested);
    const content = `# Nested Structure

- Level 1
  - Level 2
    - Level 3
      - Level 4
        - Level 5
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.deeplyNested);
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, filePath, [
      { oldText: '        - Level 5', newText: '        - Level 5 Modified' }
    ]);

    expect(result.success).toBe(true);

    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.deeplyNested);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('Level 5 Modified');

    await closeTabByFileName(page, TEST_FILES.deeplyNested);
  });

  test('should handle whitespace-sensitive changes', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.whitespace);
    const content = `# Whitespace Test

This is a paragraph with    multiple    spaces.

Another paragraph.
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.whitespace);
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, filePath, [
      {
        oldText: 'This is a paragraph with    multiple    spaces.',
        newText: 'This is a paragraph with single spaces.'
      }
    ]);

    expect(result.success).toBe(true);

    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.whitespace);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('single spaces');

    await closeTabByFileName(page, TEST_FILES.whitespace);
  });
});

// ============================================================================
// STREAMING SCENARIOS
// ============================================================================

test.describe('Streaming Scenarios', () => {
  test('should handle streaming list additions', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.streamingList);
    const content = `# Task List

- Task 1
- Task 2
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.streamingList);
    await waitForEditorReady(page);

    await simulateStreamContent(page, '\n- Task 3\n- Task 4', { insertAtEnd: true });

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.streamingList);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('Task 3');
    expect(updatedContent).toContain('Task 4');

    await closeTabByFileName(page, TEST_FILES.streamingList);
  });

  test('should handle streaming into middle of document', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.streamingMiddle);
    const content = `# Section 1

Content 1

# Section 2

Content 2
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.streamingMiddle);
    await waitForEditorReady(page);

    await simulateStreamContent(
      page,
      '\n\nNew paragraph in section 1',
      { insertAfter: 'Content 1' }
    );

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.streamingMiddle);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('New paragraph in section 1');

    await closeTabByFileName(page, TEST_FILES.streamingMiddle);
  });

  test('should handle streaming complex markdown structures', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.streamingComplex);
    const content = `# Document

Initial content.
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.streamingComplex);
    await waitForEditorReady(page);

    const complexContent = `

## New Section

This is a paragraph.

- List item 1
- List item 2

\`\`\`javascript
console.log("code");
\`\`\`
`;

    await simulateStreamContent(page, complexContent, { insertAtEnd: true });

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.streamingComplex);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('New Section');
    expect(updatedContent).toContain('List item 1');
    expect(updatedContent).toContain('console.log');

    await closeTabByFileName(page, TEST_FILES.streamingComplex);
  });

  test('should handle rapid successive streaming operations', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.streamingRapid);
    const content = `# Notes

`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.streamingRapid);
    await waitForEditorReady(page);

    for (let i = 1; i <= 5; i++) {
      await simulateStreamContent(page, `\n- Note ${i}`, { insertAtEnd: true });
      await page.waitForTimeout(100);
    }

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.streamingRapid);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    for (let i = 1; i <= 5; i++) {
      expect(updatedContent).toContain(`Note ${i}`);
    }

    await closeTabByFileName(page, TEST_FILES.streamingRapid);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

test.describe('Edge Cases', () => {
  test('should handle empty document edits', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.emptyDoc);

    await fs.writeFile(filePath, '', 'utf8');
    await openFileFromTree(page, TEST_FILES.emptyDoc);
    await waitForEditorReady(page);

    await simulateStreamContent(page, '# New Document\n\nFirst content.', { insertAtEnd: true });

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.emptyDoc);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('New Document');

    await closeTabByFileName(page, TEST_FILES.emptyDoc);
  });

  test('should handle very long lines', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.longLines);
    const longLine = 'A'.repeat(500);
    const content = `# Long Lines\n\n${longLine}\n`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.longLines);
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, filePath, [
      { oldText: longLine, newText: longLine + ' Modified' }
    ]);

    expect(result.success).toBe(true);

    await closeTabByFileName(page, TEST_FILES.longLines);
  });

  test('should handle special characters in content', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.specialChars);
    const content = `# Special Characters

Text with *asterisks* and _underscores_ and [brackets].

More text with \`backticks\` and |pipes|.
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.specialChars);
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, filePath, [
      {
        oldText: 'More text with `backticks` and |pipes|.',
        newText: 'More text with `backticks` and |pipes| and ~tildes~.'
      }
    ]);

    expect(result.success).toBe(true);

    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.specialChars);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('tildes');

    await closeTabByFileName(page, TEST_FILES.specialChars);
  });

  test('should handle formatting boundaries', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.formatting);
    const content = `# Formatting

**Bold text** followed by *italic text* and ~~strikethrough~~.
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.formatting);
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, filePath, [
      {
        oldText: '**Bold text** followed by *italic text*',
        newText: '**Bold text** followed by *italic text* and `code`'
      }
    ]);

    expect(result.success).toBe(true);

    await closeTabByFileName(page, TEST_FILES.formatting);
  });

  test('should handle multiple simultaneous edits', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.multipleEdits);
    const content = `# Multiple Sections

## Section A
Content A

## Section B
Content B

## Section C
Content C
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.multipleEdits);
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, filePath, [
      { oldText: 'Content A', newText: 'Content A Modified' },
      { oldText: 'Content B', newText: 'Content B Modified' },
      { oldText: 'Content C', newText: 'Content C Modified' }
    ]);

    expect(result.success).toBe(true);

    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.multipleEdits);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('Content A Modified');
    expect(updatedContent).toContain('Content B Modified');
    expect(updatedContent).toContain('Content C Modified');

    await closeTabByFileName(page, TEST_FILES.multipleEdits);
  });
});
