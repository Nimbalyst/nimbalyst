/**
 * E2E tests for permission persistence WITHOUT involving the AI agent.
 *
 * These tests share a single Electron app instance for efficiency.
 * Each test uses the same workspace but operates via IPC to verify:
 * - Tool patterns are correctly saved
 * - URL patterns are correctly saved for domain-level access
 * - Permission state is correctly retrieved
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
} from '../helpers';
import { dismissAPIKeyDialog } from '../utils/testHelpers';
import {
  getWorkspacePermissions,
  trustWorkspace,
  setPermissionMode,
  addAllowedPattern,
  addAllowedUrlPattern,
} from '../utils/permissionTestHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.setTimeout(30000); // Shorter timeout since we're not waiting for AI

// Use serial mode to prevent worker restarts on test failures
// This ensures all tests share the same Electron app instance
test.describe.configure({ mode: 'serial' });

test.describe('Permission Persistence', () => {
  // Shared state across all tests in this serial suite
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeAll(async () => {
    workspaceDir = await createTempWorkspace();

    // Create a test file so the workspace has content
    const testFilePath = path.join(workspaceDir, 'test.md');
    await fs.writeFile(testFilePath, '# Test Document\n\nTest content.\n', 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir, permissionMode: 'none' });
    page = await electronApp.firstWindow();

    await waitForAppReady(page);
    await dismissProjectTrustToast(page);
    await dismissAPIKeyDialog(page);
  });

  test.afterAll(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  });

  test('Tool pattern: adding pattern via IPC persists correctly', async () => {
    // Step 1: Trust the workspace and set to "ask" mode
    await trustWorkspace(page, workspaceDir);
    await setPermissionMode(page, workspaceDir, 'ask');

    // Step 2: Verify initial state - no patterns saved
    let permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.isTrusted).toBe(true);
    expect(permissions.permissionMode).toBe('ask');
    expect(permissions.allowedPatterns).toHaveLength(0);

    // Step 3: Add a tool pattern (simulates "Allow Always" for WebSearch)
    await addAllowedPattern(page, workspaceDir, 'websearch', 'Search the web');

    // Step 4: Verify pattern was saved
    permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.allowedPatterns.some(p => p.pattern === 'websearch')).toBe(true);
    expect(permissions.allowedPatterns.some(p => p.displayName === 'Search the web')).toBe(true);
  });

  test('URL pattern: adding hostname pattern via IPC persists correctly', async () => {
    // Step 1: Trust the workspace and set to "ask" mode
    await trustWorkspace(page, workspaceDir);
    await setPermissionMode(page, workspaceDir, 'ask');

    // Step 2: Verify initial state (may have patterns from previous test)
    let permissions = await getWorkspacePermissions(page, workspaceDir);

    // Step 3: Add a URL pattern (simulates "Allow Always" for WebFetch)
    await addAllowedUrlPattern(page, workspaceDir, 'example.com', 'Allow fetching from example.com');

    // Step 4: Verify URL pattern was saved
    permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.allowedUrlPatterns.some(p => p.pattern === 'example.com')).toBe(true);
    expect(permissions.allowedUrlPatterns.some(p => p.description === 'Allow fetching from example.com')).toBe(true);
  });

  test('Permission mode: changing mode persists correctly', async () => {
    // Trust the workspace
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
    // Trust the workspace
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
