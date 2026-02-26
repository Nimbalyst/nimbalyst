/**
 * Tracker sync reactivity test
 *
 * Verifies that when a tracker item is created programmatically (simulating
 * sync hydration from a remote client), the TrackerTable UI updates
 * reactively without requiring navigation away and back.
 *
 * Tests the reactive notification path:
 *   PGLite insert -> watcher notification -> TrackerTable reload
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  ACTIVE_EDITOR_SELECTOR,
} from '../helpers';
import {
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  await fs.writeFile(
    path.join(workspaceDir, 'README.md'),
    '# Test Project\n\nA test project for tracker sync.\n',
    'utf8'
  );

  await new Promise(resolve => setTimeout(resolve, 300));

  electronApp = await launchElectronApp({ workspace: workspaceDir, permissionMode: 'allow-all' });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await dismissAPIKeyDialog(page);
  await waitForWorkspaceReady(page);
});

test.afterAll(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('programmatically created tracker item appears in table reactively', async () => {
  // Open a file to ensure the workspace is loaded
  await openFileFromTree(page, 'README.md');
  const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
  await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Switch to Tracker mode (Cmd+T)
  await page.keyboard.press('Meta+t');

  // Wait for the tracker sidebar
  const trackerSidebar = page.locator('.tracker-sidebar');
  await trackerSidebar.waitFor({ state: 'visible', timeout: 10000 });

  // Select "Bugs" in the sidebar
  const bugsSidebarButton = trackerSidebar.locator('button', { hasText: 'Bugs' });
  await bugsSidebarButton.click();

  // Wait for table to finish initial load
  await page.waitForTimeout(2000);

  // Verify no items with our test title exist yet
  const syncedRow = page.locator('.tracker-table-row', { hasText: 'Synced bug from remote' });
  await expect(syncedRow).not.toBeVisible();

  // Create a tracker item via IPC (simulates what TrackerSyncManager.hydrateTrackerItem does).
  // This writes to PGLite and notifies the document service watchers,
  // which sends 'document-service:tracker-items-changed' IPC to the renderer.
  const itemId = `sync_test_${Date.now()}`;
  await page.evaluate(
    async ({ itemId, workspacePath }) => {
      await (window as any).electronAPI.invoke('document-service:create-tracker-item', {
        id: itemId,
        type: 'bug',
        title: 'Synced bug from remote',
        description: 'This item was synced from another client',
        status: 'open',
        priority: 'high',
        workspace: workspacePath,
      });
    },
    { itemId, workspacePath: workspaceDir }
  );

  // The item should appear in the tracker table reactively (no navigate away needed)
  await expect(syncedRow).toBeVisible({ timeout: 5000 });
});
