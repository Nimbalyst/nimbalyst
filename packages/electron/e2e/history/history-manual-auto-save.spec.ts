import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR } from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
  editDocumentContent,
  manualSaveDocument,
  waitForAutosave,
  openHistoryDialog,
  getHistoryItemCount,
  findHistoryItemByContent,
  selectHistoryItem,
  restoreFromHistory
} from '../utils/testHelpers';
import * as path from 'path';
import * as fs from 'fs/promises';

test.describe('History - Manual and Auto Save Entries', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFile: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    testFile = path.join(workspaceDir, 'history-test.md');

    // Create initial document
    const initialContent = '# History Test\n\nInitial content.\n';
    await fs.writeFile(testFile, initialContent, 'utf8');

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Dismiss API key dialog
    await dismissAPIKeyDialog(page);

    // Wait for workspace
    await waitForWorkspaceReady(page);
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'history-test.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

    // Open the test file
    await openFileFromTree(page, 'history-test.md');
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should show both manual and auto save entries in history', async () => {
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Verify initial content
    let editorText = await editor.innerText();
    expect(editorText).toContain('Initial content');

    // MANUAL SAVE #1: Make first edit and manually save
    await editDocumentContent(page, editor, '# History Test\n\nManual save #1.\n');
    await manualSaveDocument(page);

    // Verify file was saved
    const manualSave1Content = await fs.readFile(testFile, 'utf8');
    expect(manualSave1Content).toContain('Manual save #1');

    // AUTO SAVE #1: Make second edit and let it autosave
    await editDocumentContent(page, editor, '# History Test\n\nAuto save #1.\n');
    await waitForAutosave(page, 'history-test.md');

    // Verify content was auto-saved
    const autoSave1Content = await fs.readFile(testFile, 'utf8');
    expect(autoSave1Content).toContain('Auto save #1');

    // MANUAL SAVE #2: Make third edit and manually save
    await editDocumentContent(page, editor, '# History Test\n\nManual save #2.\n');
    await manualSaveDocument(page);

    // AUTO SAVE #2: Make fourth edit and let it autosave
    await editDocumentContent(page, editor, '# History Test\n\nAuto save #2.\n');
    await waitForAutosave(page, 'history-test.md');

    // Now open history dialog
    await openHistoryDialog(page);

    // Get all history items
    const itemCount = await getHistoryItemCount(page);

    // We should have at least 4 entries:
    // - Manual save #1
    // - Auto save #1
    // - Manual save #2
    // - Auto save #2
    expect(itemCount).toBeGreaterThanOrEqual(4);

    console.log(`Found ${itemCount} history items`);
  });

  test('should restore from auto save entry', async () => {
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Create manual save
    await editDocumentContent(page, editor, '# History Test\n\nManual save version.\n');
    await manualSaveDocument(page);

    // Create auto save with different content
    const autoSaveMarker = `Auto saved at ${Date.now()}`;
    await editDocumentContent(page, editor, `# History Test\n\n${autoSaveMarker}\n`);
    await waitForAutosave(page, 'history-test.md');

    // Make one more change after auto save
    await editDocumentContent(page, editor, '# History Test\n\nNewest version.\n');
    await manualSaveDocument(page);

    // Open history
    await openHistoryDialog(page);

    // Find the auto save entry by searching for the marker
    const autoSaveItemIndex = await findHistoryItemByContent(page, autoSaveMarker);
    expect(autoSaveItemIndex).toBeGreaterThanOrEqual(0);

    // Restore the auto save version
    await restoreFromHistory(page);

    // Verify editor shows restored content
    const editorText = await editor.innerText();
    expect(editorText).toContain(autoSaveMarker);
    expect(editorText).not.toContain('Newest version');

    // Verify dirty indicator appears (since we restored but haven't saved)
    const tab = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer).locator(PLAYWRIGHT_TEST_SELECTORS.tab, {
      has: page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: 'history-test.md' })
    });
    await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator)).toBeVisible();
  });

  test('should restore from manual save entry', async () => {
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await editor.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    const manualSaveMarker = `Manual saved at ${Date.now()}`;

    // Create manual save
    await editDocumentContent(page, editor, `# History Test\n\n${manualSaveMarker}\n`);
    await manualSaveDocument(page);

    // Create newer content
    await editDocumentContent(page, editor, '# History Test\n\nNewer content.\n');
    await manualSaveDocument(page);

    // Open history and restore manual save
    await openHistoryDialog(page);

    // Find the manual save entry
    const manualSaveItemIndex = await findHistoryItemByContent(page, manualSaveMarker);
    expect(manualSaveItemIndex).toBeGreaterThanOrEqual(0);

    // Restore the manual save version
    await restoreFromHistory(page);

    // Verify editor shows restored content
    const editorText = await editor.innerText();
    expect(editorText).toContain(manualSaveMarker);
    expect(editorText).not.toContain('Newer content');
  });
});
