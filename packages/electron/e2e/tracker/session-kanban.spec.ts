/**
 * Session Kanban Board E2E Tests
 *
 * Tests the kanban board view in TrackerMode that organizes AI sessions
 * by development phase (Backlog, Planning, Implementing, Validating, Complete).
 *
 * Sessions are seeded via IPC since the board only shows sessions with metadata.phase set.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
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
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

// Session IDs for seeded sessions
const SESSION_IDS = {
  backlog1: randomUUID(),
  planning1: randomUUID(),
  implementing1: randomUUID(),
  implementing2: randomUUID(),
  validating1: randomUUID(),
  complete1: randomUUID(),
};

/**
 * Inject sessions directly into the Jotai sessionRegistryAtom.
 * This bypasses the DB/IPC layer so tests don't depend on main process compilation state.
 */
async function injectSessions(p: Page, sessions: Array<{
  id: string;
  title: string;
  phase: string;
  workspaceId: string;
  tags?: string[];
  sessionType?: string;
  childCount?: number;
  worktreeId?: string | null;
}>): Promise<void> {
  await p.evaluate(
    (sessionsData) => {
      const metas = sessionsData.map(s => ({
        id: s.id,
        title: s.title,
        phase: s.phase,
        tags: s.tags || [],
        provider: 'claude-chat',
        model: 'claude-chat:claude-sonnet-4-20250514',
        sessionType: s.sessionType || 'session',
        messageCount: 0,
        workspaceId: s.workspaceId,
        isArchived: false,
        isPinned: false,
        parentSessionId: null,
        worktreeId: s.worktreeId || null,
        childCount: s.childCount || 0,
        uncommittedCount: 0,
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - Math.floor(Math.random() * 3600000),
      }));
      (window as any).__testHelpers.injectSessions(metas);
    },
    sessions
  );
  // Give Jotai derived atoms time to recompute
  await p.waitForTimeout(300);
}

/**
 * Navigate to the Session Kanban Board
 */
async function navigateToSessionKanban(p: Page): Promise<void> {
  // Click the tracker mode button in the navigation gutter
  await p.locator(PLAYWRIGHT_TEST_SELECTORS.trackerModeButton).click();
  await p.waitForTimeout(300);

  // Click the "Sessions Board" view in the sidebar
  await p.locator(PLAYWRIGHT_TEST_SELECTORS.trackerViewSessions).click();
  await p.waitForTimeout(300);
}

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a dummy file so the workspace has something to show
  await fs.writeFile(path.join(workspaceDir, 'readme.md'), '# Test Workspace\n', 'utf8');

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

test('session kanban board shows empty state, populates with sessions, supports search and phase toggle', async () => {
  // Step 1: Navigate to Sessions Board and verify empty state
  await navigateToSessionKanban(page);

  const board = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionKanbanBoard);
  await expect(board).toBeVisible({ timeout: 3000 });

  const emptyState = page.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanEmptyState);
  await expect(emptyState).toBeVisible({ timeout: 2000 });
  await expect(emptyState).toContainText('No sessions on the board');

  // Verify toolbar is visible
  const toolbar = page.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanToolbar);
  await expect(toolbar).toBeVisible();

  // Step 2: Create sessions with phases via IPC
  await createSessionWithPhase(page, SESSION_IDS.backlog1, 'Auth system redesign', 'backlog', workspaceDir, { tags: ['auth', 'backend'] });
  await createSessionWithPhase(page, SESSION_IDS.planning1, 'Dark mode implementation', 'planning', workspaceDir, { tags: ['ui'] });
  await createSessionWithPhase(page, SESSION_IDS.implementing1, 'Fix login bug', 'implementing', workspaceDir);
  await createSessionWithPhase(page, SESSION_IDS.implementing2, 'Add export feature', 'implementing', workspaceDir, { tags: ['feature'] });
  await createSessionWithPhase(page, SESSION_IDS.validating1, 'Database migration', 'validating', workspaceDir);
  await createSessionWithPhase(page, SESSION_IDS.complete1, 'Setup CI pipeline', 'complete', workspaceDir);

  // Verify sessions were created in the DB
  const dbCheck = await page.evaluate(async (wsPath) => {
    const result = await (window as any).electronAPI.invoke('sessions:list', wsPath, { includeArchived: true });
    return { success: result.success, count: result.sessions?.length ?? 0, ids: result.sessions?.map((s: any) => s.id).slice(0, 3) };
  }, workspaceDir);
  console.log('[E2E] DB check after creation:', JSON.stringify(dbCheck));

  // Refresh the Jotai session registry from the database
  await refreshSessionList(page);

  // Check if refreshSessions test helper is available
  const helperAvailable = await page.evaluate(() => {
    return typeof (window as any).__testHelpers?.refreshSessions === 'function';
  });
  console.log('[E2E] refreshSessions helper available:', helperAvailable);

  // Check if sessions:list returns phase data
  const listCheck = await page.evaluate(async (wsPath) => {
    const result = await (window as any).electronAPI.invoke('sessions:list', wsPath, { includeArchived: true });
    if (result.success && result.sessions) {
      const first = result.sessions[0];
      return {
        keys: Object.keys(first),
        sample: { id: first.id.substring(0, 8), title: first.title, phase: first.phase, tags: first.tags, metadata: first.metadata },
      };
    }
    return 'no sessions';
  }, workspaceDir);
  console.log('[E2E] sessions:list data:', JSON.stringify(listCheck));

  // Step 3: Verify columns exist
  const columns = page.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanColumn);
  // 5 columns (backlog, planning, implementing, validating, complete) - all visible since showComplete is true by default
  await expect(columns).toHaveCount(5, { timeout: 3000 });

  // Verify specific columns by data-phase attribute
  await expect(page.locator('[data-testid="session-kanban-column"][data-phase="backlog"]')).toBeVisible();
  await expect(page.locator('[data-testid="session-kanban-column"][data-phase="planning"]')).toBeVisible();
  await expect(page.locator('[data-testid="session-kanban-column"][data-phase="implementing"]')).toBeVisible();
  await expect(page.locator('[data-testid="session-kanban-column"][data-phase="validating"]')).toBeVisible();
  await expect(page.locator('[data-testid="session-kanban-column"][data-phase="complete"]')).toBeVisible();

  // Step 4: Verify cards are in the right columns
  const cards = page.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanCard);
  await expect(cards).toHaveCount(6, { timeout: 3000 });

  // Verify specific cards exist with their titles
  const backlogColumn = page.locator('[data-testid="session-kanban-column"][data-phase="backlog"]');
  await expect(backlogColumn.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanCard)).toHaveCount(1);
  await expect(backlogColumn).toContainText('Auth system redesign');

  const implementingColumn = page.locator('[data-testid="session-kanban-column"][data-phase="implementing"]');
  await expect(implementingColumn.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanCard)).toHaveCount(2);

  const completeColumn = page.locator('[data-testid="session-kanban-column"][data-phase="complete"]');
  await expect(completeColumn.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanCard)).toHaveCount(1);
  await expect(completeColumn).toContainText('Setup CI pipeline');

  // Step 5: Test search filter
  const searchInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanSearch);
  await searchInput.fill('login');
  await page.waitForTimeout(300);

  // Only the "Fix login bug" card should be visible
  const visibleCards = page.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanCard);
  await expect(visibleCards).toHaveCount(1, { timeout: 2000 });
  await expect(visibleCards.first()).toContainText('Fix login bug');

  // Clear search
  await searchInput.fill('');
  await page.waitForTimeout(300);
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanCard)).toHaveCount(6, { timeout: 2000 });

  // Step 6: Test show/hide complete toggle
  const toggleComplete = page.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanToggleComplete);
  await toggleComplete.click();
  await page.waitForTimeout(300);

  // Complete column should still be in DOM but the card should be gone (showComplete=false hides complete sessions)
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanCard)).toHaveCount(5, { timeout: 2000 });

  // Toggle back on
  await toggleComplete.click();
  await page.waitForTimeout(300);
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.kanbanCard)).toHaveCount(6, { timeout: 2000 });

  // Step 7: Verify card content details - check a card has type badge and time
  const authCard = page.locator(`[data-testid="session-kanban-card"][data-session-id="${SESSION_IDS.backlog1}"]`);
  await expect(authCard).toBeVisible();
  await expect(authCard).toContainText('Auth system redesign');
  await expect(authCard).toContainText('session'); // type badge
  // Tags should be visible
  await expect(authCard).toContainText('auth');
  await expect(authCard).toContainText('backend');
});
