/**
 * Collaborative tracker content editing E2E test.
 *
 * Tests the full CollaborationPlugin path in TrackerItemDetail:
 * - Native bug created with PGLite content
 * - Collaborative editor bootstraps from PGLite content
 * - User types in the collaborative editor
 * - Content persists to PGLite (via onDirtyChange/saveContent)
 * - Close and reopen verifies persistence
 *
 * Requires: wrangler dev on port 8792 (started by this test)
 * Run with: RUN_COLLAB_TESTS=1 npx playwright test e2e/tracker/tracker-content-collab.spec.ts
 */

import { test, expect } from '@playwright/test';
test.skip(() => !process.env.RUN_COLLAB_TESTS, 'Requires RUN_COLLAB_TESTS=1 and wrangler dev');
import type { ElectronApplication, Page } from '@playwright/test';
import { webcrypto } from 'crypto';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
} from '../utils/testHelpers';
import { startWrangler, stopWrangler } from '../utils/wranglerHelpers';
import * as fs from 'fs/promises';

test.describe.configure({ mode: 'serial' });

const WRANGLER_PORT = 8792;
const TEST_ORG_ID = 'e2e-collab-content-org';
const TEST_USER_ID = 'e2e-collab-user-a';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let itemId: string;
let encryptionKeyBase64: string;

async function generateKeyBase64(): Promise<string> {
  const key = await webcrypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const raw = await webcrypto.subtle.exportKey('raw', key);
  return Buffer.from(raw).toString('base64');
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(90_000);

  workspaceDir = await createTempWorkspace();
  encryptionKeyBase64 = await generateKeyBase64();

  await startWrangler(WRANGLER_PORT);

  electronApp = await launchElectronApp({ workspace: workspaceDir, permissionMode: 'allow-all' });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await dismissAPIKeyDialog(page);
  await waitForWorkspaceReady(page);

  // Monkey-patch documentSync.open in the renderer to use the test handler.
  // This bypasses Stytch auth and connects directly to wrangler dev.
  await page.evaluate(
    ({ orgId, userId, serverUrl, keyBase64 }) => {
      const origOpen = (window as any).electronAPI.documentSync.open;
      (window as any).electronAPI.documentSync.open = async (
        _workspacePath: string,
        documentId: string,
        title?: string,
      ) => {
        return (window as any).electronAPI.invoke('document-sync:open-test', {
          serverUrl,
          orgId,
          userId,
          documentId,
          title,
          encryptionKeyBase64: keyBase64,
        });
      };
      // Also override getJwt to return a test JWT (wrangler test auth bypass)
      (window as any).electronAPI.documentSync.getJwt = async () => ({
        success: true,
        jwt: 'test-jwt',
      });
    },
    {
      orgId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      serverUrl: `ws://localhost:${WRANGLER_PORT}`,
      keyBase64: encryptionKeyBase64,
    },
  );

  // Also need to make the tracker model report sync mode as 'team'
  // so contentMode becomes 'collaborative'. Inject via tracker registry.
  await page.evaluate(() => {
    // Access the global tracker model registry and patch the bug model's sync config
    const runtime = (window as any).__nimbalystRuntime;
    if (runtime?.trackerRegistry) {
      const bugModel = runtime.trackerRegistry.get('bug');
      if (bugModel) {
        bugModel.sync = { mode: 'team', projectId: 'test-project' };
      }
    }
  });
});

test.afterAll(async () => {
  await electronApp?.close();
  await stopWrangler();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('should create a native bug and open detail panel', async () => {
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.trackerModeButton).click();

  const trackerSidebar = page.locator(PLAYWRIGHT_TEST_SELECTORS.trackerSidebar);
  await trackerSidebar.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

  const bugsButton = page.locator(`${PLAYWRIGHT_TEST_SELECTORS.trackerTypeButton}[data-tracker-type="bug"]`);
  await bugsButton.click();

  const trackerTable = page.locator(PLAYWRIGHT_TEST_SELECTORS.trackerTable);
  await trackerTable.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.DEFAULT_WAIT * 4 });

  await page.locator(PLAYWRIGHT_TEST_SELECTORS.trackerToolbarNewButton).click();

  const quickAddInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.trackerQuickAddInput);
  await quickAddInput.waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.DEFAULT_WAIT * 4 });
  await quickAddInput.fill('Collab Content Test');
  await quickAddInput.press('Enter');

  const newRow = page.locator(PLAYWRIGHT_TEST_SELECTORS.trackerTableRow, { hasText: 'Collab Content Test' });
  await expect(newRow).toBeVisible({ timeout: TEST_TIMEOUTS.DEFAULT_WAIT * 6 });

  itemId = (await newRow.getAttribute('data-item-id'))!;
  expect(itemId).toBeTruthy();

  await newRow.locator('.tracker-table-cell.title').click();
  await page.waitForTimeout(300);

  const detailPanel = page.locator('.tracker-item-detail');
  await detailPanel.waitFor({ state: 'visible', timeout: 5000 });
});

test('should render content editor and accept input in collaborative mode', async () => {
  const detailPanel = page.locator('.tracker-item-detail');
  await detailPanel.waitFor({ state: 'visible', timeout: 3000 });

  // Wait for either the local or collab editor to appear
  const contentEditor = page.locator('[data-testid="tracker-detail-content-editor"]');
  await expect(contentEditor).toBeVisible({ timeout: 10_000 });

  const editable = contentEditor.locator('[contenteditable="true"]');
  await expect(editable).toBeVisible({ timeout: 5000 });

  // Type content
  await editable.click();
  await page.keyboard.type('Collaborative content test');

  // Wait for debounced save
  await page.waitForTimeout(1500);

  // Verify text is in the editor
  await expect(editable).toContainText('Collaborative content test');
});

test('should persist content through close and reopen', async () => {
  // Close detail panel
  await page.keyboard.press('Escape');
  const detailPanel = page.locator('.tracker-item-detail');
  await expect(detailPanel).not.toBeVisible({ timeout: TEST_TIMEOUTS.DEFAULT_WAIT * 4 });

  // Reopen
  const rowById = page.locator(`[data-item-id="${itemId}"]`);
  await expect(rowById).toBeVisible({ timeout: TEST_TIMEOUTS.DEFAULT_WAIT * 4 });
  await rowById.locator('.tracker-table-cell.title').click();
  await page.waitForTimeout(300);
  await detailPanel.waitFor({ state: 'visible', timeout: 5000 });

  const contentEditor = page.locator('[data-testid="tracker-detail-content-editor"]');
  await expect(contentEditor).toBeVisible({ timeout: 10_000 });

  const editable = contentEditor.locator('[contenteditable="true"]');
  await expect(editable).toBeVisible({ timeout: 5000 });

  // Content should have been persisted to PGLite and reloaded
  await expect(editable).toContainText('Collaborative content test', { timeout: 5000 });
});
