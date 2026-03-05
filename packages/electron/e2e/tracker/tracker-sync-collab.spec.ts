/**
 * Collaborative Tracker Sync E2E Test
 *
 * Tests the real encrypted WebSocket sync path between TWO Electron apps:
 *
 *   App A (upserts item via TrackerSyncManager)
 *     -> TrackerSyncProvider encrypts with AES-256-GCM
 *     -> WebSocket to TrackerRoom Durable Object (wrangler dev --local)
 *     -> broadcast to App B's TrackerSyncProvider
 *     -> decrypt
 *     -> PGLite hydrate via onItemUpserted callback
 *     -> document-service:tracker-items-changed IPC
 *     -> TrackerTable reactively renders the new row
 *
 * Both apps use the real TrackerSyncManager code path via a test-only
 * IPC handler (tracker-sync:connect-test) that bypasses Stytch/team/key-envelope
 * auth but uses the real TrackerSyncProvider, encryption, PGLite hydration,
 * and IPC notification.
 *
 * Requires: npm run dev (Vite on 5273) + wrangler dev started by this test
 */

// Skip in CI - requires wrangler dev running locally and launches 2 Electron instances
import { test, expect } from '@playwright/test';
test.skip(() => !process.env.RUN_COLLAB_TESTS, 'Requires RUN_COLLAB_TESTS=1 and wrangler dev - not for CI');
import type { ElectronApplication, Page } from '@playwright/test';
import { webcrypto } from 'crypto';
import {
  launchElectronApp,
  createTempWorkspace,
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  waitForWorkspaceReady,
  openFileFromTree,
} from '../utils/testHelpers';
import {
  startWrangler,
  stopWrangler,
} from '../utils/wranglerHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Use port 8792 to avoid conflicts with dev (8790) and unit integration tests (8791)
const WRANGLER_PORT = 8792;
const TEST_ORG_ID = 'e2e-test-org';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

async function generateAesKey(): Promise<CryptoKey> {
  return webcrypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  ) as Promise<CryptoKey>;
}

async function exportKeyAsJwk(key: CryptoKey): Promise<JsonWebKey> {
  return webcrypto.subtle.exportKey('jwk', key);
}

/**
 * Launch an Electron app with an isolated database directory.
 * Each instance gets its own NIMBALYST_USER_DATA_PATH so PGLite databases
 * don't collide.
 */
async function launchIsolatedElectronApp(
  workspace: string,
  instanceName: string,
): Promise<{ app: ElectronApplication; page: Page; dbDir: string }> {
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), `nimbalyst-e2e-${instanceName}-`));

  const app = await launchElectronApp({
    workspace,
    permissionMode: 'allow-all',
    preserveTestDatabase: true, // We manage our own DB path
    env: {
      NIMBALYST_USER_DATA_PATH: dbDir,
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await dismissAPIKeyDialog(page);
  await waitForWorkspaceReady(page);

  return { app, page, dbDir };
}

/**
 * Connect an Electron app's TrackerSyncManager to the test wrangler server
 * using the test-only IPC handler that bypasses auth.
 */
async function connectTrackerSync(
  page: Page,
  opts: {
    workspacePath: string;
    serverUrl: string;
    projectId: string;
    orgId: string;
    userId: string;
    encryptionKeyJwk: JsonWebKey;
  },
): Promise<void> {
  const result = await page.evaluate(
    async (payload) => {
      return (window as any).electronAPI.invoke('tracker-sync:connect-test', payload);
    },
    opts,
  );

  if (!result.success) {
    throw new Error(`tracker-sync:connect-test failed: ${result.error}`);
  }

  // Wait for the provider to reach 'connected' status
  await expect(async () => {
    const status = await page.evaluate(async (wp) => {
      const s = await (window as any).electronAPI.invoke('tracker-sync:get-status', { workspacePath: wp });
      return s.status;
    }, opts.workspacePath);
    expect(status).toBe('connected');
  }).toPass({ timeout: 10_000 });
}

/**
 * Upsert a tracker item through the real TrackerSyncManager (main process).
 * This encrypts and sends via WebSocket - the real production code path.
 */
async function upsertTrackerItem(
  page: Page,
  item: {
    id: string;
    type: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    workspace: string;
  },
): Promise<void> {
  const result = await page.evaluate(async (itemData) => {
    return (window as any).electronAPI.invoke('tracker-sync:upsert-item', { item: itemData });
  }, item);

  if (!result.success) {
    throw new Error(`tracker-sync:upsert-item failed: ${result.error}`);
  }
}

// --------------------------------------------------------------------------
// Test Suite
// --------------------------------------------------------------------------

test.describe('Collaborative Tracker Sync', () => {
  // Wrangler startup + two Electron launches + WebSocket connections need time
  test.setTimeout(120_000);

  let appA: ElectronApplication;
  let pageA: Page;
  let dbDirA: string;
  let appB: ElectronApplication;
  let pageB: Page;
  let dbDirB: string;
  let workspaceDirA: string;
  let workspaceDirB: string;
  let sharedKeyJwk: JsonWebKey;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(90_000);

    // 1. Start wrangler dev (collabv3 server)
    await startWrangler(WRANGLER_PORT);

    // 2. Generate shared encryption key (in production this is the org key)
    const sharedKey = await generateAesKey();
    sharedKeyJwk = await exportKeyAsJwk(sharedKey);

    // 3. Create two separate temp workspaces (one per app)
    workspaceDirA = await createTempWorkspace();
    workspaceDirB = await createTempWorkspace();
    await fs.writeFile(path.join(workspaceDirA, 'README.md'), '# App A\n', 'utf8');
    await fs.writeFile(path.join(workspaceDirB, 'README.md'), '# App B\n', 'utf8');

    // 4. Launch two isolated Electron apps
    const launchA = launchIsolatedElectronApp(workspaceDirA, 'appA');
    const launchB = launchIsolatedElectronApp(workspaceDirB, 'appB');
    const [instanceA, instanceB] = await Promise.all([launchA, launchB]);
    appA = instanceA.app;
    pageA = instanceA.page;
    dbDirA = instanceA.dbDir;
    appB = instanceB.app;
    pageB = instanceB.page;
    dbDirB = instanceB.dbDir;
  });

  test.afterAll(async () => {
    await appA?.close();
    await appB?.close();
    await stopWrangler();
    // Clean up temp directories
    for (const dir of [workspaceDirA, workspaceDirB, dbDirA, dbDirB]) {
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  });

  test('App A creates a tracker item that appears in App B via encrypted WebSocket sync', async () => {
    const projectId = `e2e-collab-${Date.now()}`;
    const testItemId = `sync-e2e-${Date.now()}`;
    const testTitle = 'Bug from another device';

    // ------------------------------------------------------------------
    // Step 1: Connect both apps to the same TrackerRoom
    // ------------------------------------------------------------------
    const connectOpts = {
      serverUrl: `http://localhost:${WRANGLER_PORT}`,
      projectId,
      orgId: TEST_ORG_ID,
      encryptionKeyJwk: sharedKeyJwk,
    };

    await Promise.all([
      connectTrackerSync(pageA, {
        ...connectOpts,
        workspacePath: workspaceDirA,
        userId: 'e2e-user-a',
      }),
      connectTrackerSync(pageB, {
        ...connectOpts,
        workspacePath: workspaceDirB,
        userId: 'e2e-user-b',
      }),
    ]);

    // ------------------------------------------------------------------
    // Step 2: Navigate App B to Tracker mode so it shows the table
    // ------------------------------------------------------------------
    await openFileFromTree(pageB, 'README.md');
    await pageB.keyboard.press('Meta+t');

    const trackerSidebar = pageB.locator(PLAYWRIGHT_TEST_SELECTORS.trackerSidebar);
    await expect(trackerSidebar).toBeVisible({ timeout: 10_000 });

    // Click Bugs type button
    const bugsButton = trackerSidebar.locator(
      `${PLAYWRIGHT_TEST_SELECTORS.trackerTypeButton}[data-tracker-type="bug"]`,
    );
    await bugsButton.click();

    const trackerTable = pageB.locator(PLAYWRIGHT_TEST_SELECTORS.trackerTable);
    await expect(trackerTable).toBeVisible({ timeout: 5000 });

    // Verify no rows with our test title exist yet
    const targetRow = pageB.locator(
      `${PLAYWRIGHT_TEST_SELECTORS.trackerTableRow}[data-item-title="${testTitle}"]`,
    );
    await expect(targetRow).not.toBeVisible();

    // ------------------------------------------------------------------
    // Step 3: App A upserts a tracker item through the real sync path
    // ------------------------------------------------------------------
    await upsertTrackerItem(pageA, {
      id: testItemId,
      type: 'bug',
      title: testTitle,
      description: 'Synced from App A to App B via encrypted WebSocket',
      status: 'open',
      priority: 'high',
      workspace: workspaceDirA,
    });

    // ------------------------------------------------------------------
    // Step 4: Verify the item appears in App B's TrackerTable
    // ------------------------------------------------------------------
    await expect(targetRow).toBeVisible({ timeout: 15_000 });
  });
});
