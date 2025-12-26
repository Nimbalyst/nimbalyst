import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace } from '../helpers';
import { dismissAPIKeyDialog } from '../utils/testHelpers';
import {
  getWorkspacePermissions,
  trustWorkspace,
  setPermissionMode,
  addAllowedUrlPattern,
  isUrlAllowed,
} from '../utils/permissionTestHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * E2E tests for WebFetch URL pattern persistence.
 *
 * These tests verify that URL patterns saved via "Allow Always" are:
 * 1. Correctly persisted to the permission engine cache
 * 2. Correctly checked on subsequent URL requests
 * 3. Persisted across app restarts
 *
 * This tests the issue where users report that "Allow Always" doesn't
 * persist and they keep getting prompted for the same URLs.
 */

test.setTimeout(60000);

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a test file so the workspace has content
  const testFilePath = path.join(workspaceDir, 'test.md');
  await fs.writeFile(testFilePath, '# Test Document\n\nTest content.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();

  await page.waitForLoadState('domcontentloaded');
  await dismissAPIKeyDialog(page);
});

test.afterEach(async () => {
  try {
    await electronApp.evaluate(async ({ app }) => {
      app.exit(0);
    });
  } catch {
    // App may already be closed
  }

  await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
});

test('URL pattern: isUrlAllowed returns true immediately after adding pattern', async () => {
  // Step 1: Trust the workspace and set to "ask" mode
  await trustWorkspace(page, workspaceDir);
  await setPermissionMode(page, workspaceDir, 'ask');

  // Step 2: Verify URL is NOT allowed initially
  const initialCheck = await isUrlAllowed(page, workspaceDir, 'https://example.com/some/path');
  expect(initialCheck).toBe(false);

  // Step 3: Add the URL pattern (simulates "Allow Always" for WebFetch)
  await addAllowedUrlPattern(page, workspaceDir, 'example.com', 'Allow fetching from example.com');

  // Step 4: Verify URL IS allowed now (same app session)
  const afterAddCheck = await isUrlAllowed(page, workspaceDir, 'https://example.com/some/path');
  expect(afterAddCheck).toBe(true);

  // Step 5: Verify a different path on the same domain is also allowed
  const differentPathCheck = await isUrlAllowed(page, workspaceDir, 'https://example.com/another/path');
  expect(differentPathCheck).toBe(true);

  // Step 6: Verify a different domain is NOT allowed
  const differentDomainCheck = await isUrlAllowed(page, workspaceDir, 'https://other.com/path');
  expect(differentDomainCheck).toBe(false);
});

test('URL pattern: isUrlAllowed works for multiple patterns', async () => {
  // Setup
  await trustWorkspace(page, workspaceDir);
  await setPermissionMode(page, workspaceDir, 'ask');

  // Add multiple URL patterns
  await addAllowedUrlPattern(page, workspaceDir, 'example.com', 'Allow example.com');
  await addAllowedUrlPattern(page, workspaceDir, 'github.com', 'Allow github.com');
  await addAllowedUrlPattern(page, workspaceDir, 'docs.anthropic.com', 'Allow docs.anthropic.com');

  // Verify all domains are allowed
  expect(await isUrlAllowed(page, workspaceDir, 'https://example.com/foo')).toBe(true);
  expect(await isUrlAllowed(page, workspaceDir, 'https://github.com/user/repo')).toBe(true);
  expect(await isUrlAllowed(page, workspaceDir, 'https://docs.anthropic.com/api')).toBe(true);

  // Verify unrelated domain is not allowed
  expect(await isUrlAllowed(page, workspaceDir, 'https://malicious.com/hack')).toBe(false);
});

test('URL pattern: pattern saved to disk and retrieved correctly', async () => {
  // Setup
  await trustWorkspace(page, workspaceDir);
  await setPermissionMode(page, workspaceDir, 'ask');

  // Add URL pattern
  await addAllowedUrlPattern(page, workspaceDir, 'docs.anthropic.com', 'Anthropic docs');

  // Verify pattern appears in workspace permissions
  const permissions = await getWorkspacePermissions(page, workspaceDir);
  expect(permissions.allowedUrlPatterns.some(p => p.pattern === 'docs.anthropic.com')).toBe(true);

  // Verify URL check still works
  expect(await isUrlAllowed(page, workspaceDir, 'https://docs.anthropic.com/claude/api')).toBe(true);
});

test('URL pattern: persists across app restart', async () => {
  // Step 1: Trust workspace and add URL pattern
  await trustWorkspace(page, workspaceDir);
  await setPermissionMode(page, workspaceDir, 'ask');
  await addAllowedUrlPattern(page, workspaceDir, 'example.com', 'Allow example.com');

  // Verify it works before restart
  expect(await isUrlAllowed(page, workspaceDir, 'https://example.com/test')).toBe(true);

  // Step 2: Close the app
  await electronApp.evaluate(async ({ app }) => {
    app.exit(0);
  });

  // Wait a moment for the app to fully close
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Step 3: Relaunch the app with the same workspace
  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await dismissAPIKeyDialog(page);

  // Step 4: Verify the URL pattern persisted and isUrlAllowed still works
  const afterRestartCheck = await isUrlAllowed(page, workspaceDir, 'https://example.com/test');
  expect(afterRestartCheck).toBe(true);

  // Also verify via permissions state
  const permissions = await getWorkspacePermissions(page, workspaceDir);
  expect(permissions.allowedUrlPatterns.some(p => p.pattern === 'example.com')).toBe(true);
});

test('URL pattern: multiple checks use same cached engine', async () => {
  // This test verifies that multiple isUrlAllowed calls use the same
  // permission engine (no cache thrashing)

  // Setup
  await trustWorkspace(page, workspaceDir);
  await setPermissionMode(page, workspaceDir, 'ask');
  await addAllowedUrlPattern(page, workspaceDir, 'example.com', 'Allow example.com');

  // Make many rapid checks - they should all work consistently
  const results: boolean[] = [];
  for (let i = 0; i < 10; i++) {
    const result = await isUrlAllowed(page, workspaceDir, `https://example.com/path${i}`);
    results.push(result);
  }

  // All should be true
  expect(results.every(r => r === true)).toBe(true);
});

test('URL pattern: wildcard pattern allows all URLs', async () => {
  // Setup
  await trustWorkspace(page, workspaceDir);
  await setPermissionMode(page, workspaceDir, 'ask');

  // Verify URLs are not allowed initially
  expect(await isUrlAllowed(page, workspaceDir, 'https://example.com/test')).toBe(false);
  expect(await isUrlAllowed(page, workspaceDir, 'https://random-site.com/page')).toBe(false);

  // Add wildcard pattern (simulates "Allow All WebFetches")
  await addAllowedUrlPattern(page, workspaceDir, '*', 'Allow all web fetches');

  // Now ALL URLs should be allowed
  expect(await isUrlAllowed(page, workspaceDir, 'https://example.com/test')).toBe(true);
  expect(await isUrlAllowed(page, workspaceDir, 'https://random-site.com/page')).toBe(true);
  expect(await isUrlAllowed(page, workspaceDir, 'https://any.domain.com/any/path')).toBe(true);
});

test('URL pattern: subdomain handling', async () => {
  // Setup
  await trustWorkspace(page, workspaceDir);
  await setPermissionMode(page, workspaceDir, 'ask');

  // Add pattern for a specific subdomain
  await addAllowedUrlPattern(page, workspaceDir, 'docs.anthropic.com', 'Allow docs subdomain');

  // The specific subdomain should be allowed
  expect(await isUrlAllowed(page, workspaceDir, 'https://docs.anthropic.com/api')).toBe(true);

  // The parent domain should NOT be allowed (pattern is exact hostname match)
  expect(await isUrlAllowed(page, workspaceDir, 'https://anthropic.com/home')).toBe(false);

  // A different subdomain should NOT be allowed
  expect(await isUrlAllowed(page, workspaceDir, 'https://api.anthropic.com/v1')).toBe(false);
});

test('URL pattern: allow-all mode bypasses URL pattern checks', async () => {
  // Setup - set to allow-all mode
  await trustWorkspace(page, workspaceDir);
  await setPermissionMode(page, workspaceDir, 'allow-all');

  // In allow-all mode, ALL URLs should be allowed even without patterns
  expect(await isUrlAllowed(page, workspaceDir, 'https://example.com/test')).toBe(true);
  expect(await isUrlAllowed(page, workspaceDir, 'https://any-site.com/path')).toBe(true);

  // Switch back to 'ask' mode
  await setPermissionMode(page, workspaceDir, 'ask');

  // Now URLs should NOT be allowed (no patterns saved)
  expect(await isUrlAllowed(page, workspaceDir, 'https://example.com/test')).toBe(false);
});
