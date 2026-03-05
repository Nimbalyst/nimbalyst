/**
 * E2E tests for workspace trust and permission persistence.
 *
 * Consolidated from:
 *   agent-permissions.spec.ts (trust toast workflow, dismiss behavior)
 *   permission-persistence.spec.ts (tool/URL pattern persistence via IPC)
 *
 * Tests share a single Electron app instance. Trust workflow tests run first
 * (they interact with the trust toast), then IPC persistence tests follow.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS,
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
} from '../utils/testHelpers';
import {
  getWorkspacePermissions,
  trustWorkspace,
  setPermissionMode,
  addAllowedPattern,
  addAllowedUrlPattern,
} from '../utils/permissionTestHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create test files
  await fs.writeFile(
    path.join(workspaceDir, 'trust-workflow.md'),
    '# Trust Workflow Test\n\nTest content.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'test.md'),
    '# Test Document\n\nTest content.\n',
    'utf8'
  );

  // Launch with 'none' permission mode so trust toast appears
  electronApp = await launchElectronApp({ workspace: workspaceDir, permissionMode: 'none' });
  page = await electronApp.firstWindow();

  await waitForAppReady(page);
  await dismissAPIKeyDialog(page);

  // Wait for workspace sidebar to be ready
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.workspaceSidebar))
    .toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
});

test.afterAll(async () => {
  await electronApp?.close();
  await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
});

// ============================================================================
// Trust Workflow Tests (from agent-permissions.spec.ts)
// ============================================================================

test.describe('Trust Workflow', () => {
  test('trust workflow: trust via toast -> verify trusted state -> verify settings', async () => {
    // 1. Trust toast should appear for new workspace
    const trustToast = page.getByRole('heading', { name: /^Trust .+\?$/ });
    await expect(trustToast).toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // 2. Verify permission options are available
    const allowEditsOption = page.getByRole('button', { name: /Allow Edits/ });
    await expect(allowEditsOption).toBeVisible();

    // 3. Click Allow Edits to trust the workspace
    await allowEditsOption.click();
    await page.waitForTimeout(300);

    // 4. Click Save to confirm
    const saveButton = page.getByRole('button', { name: 'Save' });
    await saveButton.click();
    await page.waitForTimeout(500);

    // 5. Toast should dismiss after selection
    await expect(trustToast).not.toBeVisible({ timeout: 3000 });

    // 6. Trust indicator should now show trusted state
    const trustIndicator = page.getByRole('button', { name: /Allow Edits mode|trusted/i }).first();
    await expect(trustIndicator).toBeVisible({ timeout: 3000 });
  });

  test('dismiss toast: click Cancel dismisses without trusting', async () => {
    // Revoke trust first so the toast appears again
    await page.evaluate(async (wsDir) => {
      await window.electronAPI.invoke('permissions:revokeWorkspaceTrust', wsDir);
    }, workspaceDir);
    await page.waitForTimeout(500);

    // 1. Trust toast should appear for now-untrusted workspace
    const trustToast = page.getByRole('heading', { name: /^Trust .+\?$/ });
    await expect(trustToast).toBeVisible({ timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // 2. Click "Cancel" button to dismiss without trusting
    const cancelButton = page.getByRole('button', { name: 'Cancel' });
    await cancelButton.click();
    await page.waitForTimeout(500);

    // 3. Toast should dismiss
    await expect(trustToast).not.toBeVisible({ timeout: 3000 });

    // 4. Trust indicator should still show UNtrusted state
    const trustIndicator = page.getByRole('button', { name: /not trusted|untrusted/i }).first();
    await expect(trustIndicator).toBeVisible();
  });
});

// ============================================================================
// Permission Persistence Tests (from permission-persistence.spec.ts)
// These tests trust the workspace via IPC before running.
// ============================================================================

test.describe('Permission Persistence', () => {
  test('Tool pattern: adding pattern via IPC persists correctly', async () => {
    // Trust the workspace and set to "ask" mode via IPC
    await trustWorkspace(page, workspaceDir);
    await setPermissionMode(page, workspaceDir, 'ask');

    // Verify initial state - no patterns saved
    let permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.isTrusted).toBe(true);
    expect(permissions.permissionMode).toBe('ask');
    expect(permissions.allowedPatterns).toHaveLength(0);

    // Add a tool pattern (simulates "Allow Always" for WebSearch)
    await addAllowedPattern(page, workspaceDir, 'websearch', 'Search the web');

    // Verify pattern was saved
    permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.allowedPatterns.some(p => p.pattern === 'websearch')).toBe(true);
    expect(permissions.allowedPatterns.some(p => p.displayName === 'Search the web')).toBe(true);
  });

  test('URL pattern: adding hostname pattern via IPC persists correctly', async () => {
    await trustWorkspace(page, workspaceDir);
    await setPermissionMode(page, workspaceDir, 'ask');

    // Add a URL pattern (simulates "Allow Always" for WebFetch)
    await addAllowedUrlPattern(page, workspaceDir, 'example.com', 'Allow fetching from example.com');

    // Verify URL pattern was saved
    const permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.allowedUrlPatterns.some(p => p.pattern === 'example.com')).toBe(true);
    expect(permissions.allowedUrlPatterns.some(p => p.description === 'Allow fetching from example.com')).toBe(true);
  });

  test('Permission mode: changing mode persists correctly', async () => {
    await trustWorkspace(page, workspaceDir);

    // Set to 'ask' mode
    await setPermissionMode(page, workspaceDir, 'ask');
    let permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.permissionMode).toBe('ask');

    // Change to 'allow-all' mode
    await setPermissionMode(page, workspaceDir, 'allow-all');
    permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.permissionMode).toBe('allow-all');

    // Change back to 'ask' mode
    await setPermissionMode(page, workspaceDir, 'ask');
    permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.permissionMode).toBe('ask');
  });

  test('Multiple patterns: can add multiple tool and URL patterns', async () => {
    await trustWorkspace(page, workspaceDir);
    await setPermissionMode(page, workspaceDir, 'ask');

    // Add multiple tool patterns
    await addAllowedPattern(page, workspaceDir, 'edit', 'Edit files in project');
    await addAllowedPattern(page, workspaceDir, 'bash:npm test', 'Run npm test');

    // Add multiple URL patterns
    await addAllowedUrlPattern(page, workspaceDir, 'github.com', 'Allow github.com');

    // Verify all patterns were saved (includes patterns from previous tests)
    const permissions = await getWorkspacePermissions(page, workspaceDir);

    // Verify tool patterns exist
    expect(permissions.allowedPatterns.some(p => p.pattern === 'websearch')).toBe(true);
    expect(permissions.allowedPatterns.some(p => p.pattern === 'edit')).toBe(true);
    expect(permissions.allowedPatterns.some(p => p.pattern === 'bash:npm test')).toBe(true);

    // Verify URL patterns exist
    expect(permissions.allowedUrlPatterns.some(p => p.pattern === 'example.com')).toBe(true);
    expect(permissions.allowedUrlPatterns.some(p => p.pattern === 'github.com')).toBe(true);
  });
});
