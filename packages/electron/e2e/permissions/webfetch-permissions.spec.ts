/**
 * E2E tests for WebFetch and WebSearch permission checks.
 *
 * Tests share a single app instance for performance. Each test uses a separate file
 * to avoid interference between tests. Tests must run serially since they share
 * the same workspace and app state.
 *
 * Tests that in Smart Permissions mode:
 * - WebFetch requests trigger permission confirmation and "Always" saves URL patterns
 * - WebSearch requests trigger permission confirmation and "Always" saves tool patterns
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
  TEST_TIMEOUTS,
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  closeTabByFileName,
  trustWorkspaceSmartPermissions,
  switchToAgentMode,
  submitChatPrompt,
  openAgentPermissionsSettings,
  getAllowedUrlPatterns,
  getAllowedToolPatterns,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

// Skip entire file in CI - requires real AI API
test.skip(() => !process.env.ANTHROPIC_API_KEY, 'Requires ANTHROPIC_API_KEY - not for CI');

// Increase timeout for AI-related tests
test.setTimeout(90000);

// Tests must run serially since they share the app instance
test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create all test files upfront - each test uses a separate file
  await fs.writeFile(
    path.join(workspaceDir, 'webfetch-test.md'),
    '# WebFetch Test Document\n\nTest content for webfetch permission tests.\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(workspaceDir, 'websearch-test.md'),
    '# WebSearch Test Document\n\nTest content for websearch permission tests.\n',
    'utf8'
  );

  electronApp = await launchElectronApp({ workspace: workspaceDir, permissionMode: 'none' });
  page = await electronApp.firstWindow();

  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissAPIKeyDialog(page);
  await dismissProjectTrustToast(page);

  // Trust with Smart Permissions (not Always Allow)
  await trustWorkspaceSmartPermissions(page);
});

test.afterAll(async () => {
  // Cancel any active AI request to avoid the "AI session running" quit dialog
  try {
    const cancelButton = page.locator('button.ai-cancel-button, [aria-label="Cancel"]');
    if (await cancelButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await cancelButton.click();
      await page.waitForTimeout(500);
    }
  } catch {
    // No cancel button visible, that's fine
  }

  await electronApp?.close();

  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('webfetch: Allow Always saves pattern and subsequent requests pass without asking', async () => {
  // Switch to agent mode
  await switchToAgentMode(page);
  await page.waitForTimeout(1000);

  // First request: Ask the agent to fetch a web page
  await submitChatPrompt(page, 'Fetch https://example.com and tell me the page title');

  // Wait for the permission confirmation dialog to appear
  const permissionConfirmation = page.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmation);
  await expect(permissionConfirmation).toBeVisible({ timeout: 30000 });

  // Verify the dialog shows WebFetch-related info
  await expect(permissionConfirmation.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationTitle))
    .toContainText('permission');

  // Verify the command/URL is shown
  const commandText = await permissionConfirmation.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationCommand).textContent();
  expect(commandText).toBeTruthy();
  expect(commandText?.toLowerCase()).toContain('example.com');

  // Click "Allow Always" to save the pattern
  const allowAlwaysButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationAllowAlwaysButton);
  await expect(allowAlwaysButton).toBeVisible();
  await allowAlwaysButton.click();

  // Wait for the dialog to close and the request to complete
  await expect(permissionConfirmation).not.toBeVisible({ timeout: 5000 });

  // Wait for the AI to finish responding (look for the response to complete)
  // The AI should successfully fetch example.com now
  await page.waitForTimeout(3000);

  // Second request: Ask to fetch the same domain again - should NOT ask for permission
  await submitChatPrompt(page, 'Fetch https://example.com/about and summarize it');

  // Wait a bit for the request to be processed
  await page.waitForTimeout(5000);

  // The permission dialog should NOT appear this time since we clicked "Allow Always"
  // If it does appear within 3 seconds, the test fails
  const dialogAppeared = await permissionConfirmation.isVisible().catch(() => false);
  expect(dialogAppeared).toBe(false);

  // Navigate to Agent Permissions settings and verify the URL pattern was saved
  await openAgentPermissionsSettings(page);

  // Get all allowed URL patterns from the settings panel
  const allowedPatterns = await getAllowedUrlPatterns(page);
  console.log('Allowed URL patterns:', allowedPatterns);

  // Verify example.com is in the list
  const hasExampleDomain = allowedPatterns.some(pattern =>
    pattern.toLowerCase().includes('example.com')
  );
  expect(hasExampleDomain).toBe(true);
});

test('websearch: Allow Always saves pattern and subsequent requests pass without asking', async () => {
  // Switch to agent mode
  await switchToAgentMode(page);
  await page.waitForTimeout(1000);

  // First request: Ask the agent to search the web
  await submitChatPrompt(page, 'Search the web for "Anthropic Claude latest news"');

  // Wait for the permission confirmation dialog to appear
  const permissionConfirmation = page.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmation);
  await expect(permissionConfirmation).toBeVisible({ timeout: 30000 });

  // Verify the dialog shows permission-related info
  await expect(permissionConfirmation.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationTitle))
    .toContainText('permission');

  // Verify the command shows it's a search (the rawCommand includes "search")
  const commandText = await permissionConfirmation.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationCommand).textContent();
  expect(commandText).toBeTruthy();
  expect(commandText?.toLowerCase()).toContain('search');

  // Click "Allow Always" to save the pattern
  const allowAlwaysButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.permissionConfirmationAllowAlwaysButton);
  await expect(allowAlwaysButton).toBeVisible();
  await allowAlwaysButton.click();

  // Wait for the dialog to close and the request to complete
  await expect(permissionConfirmation).not.toBeVisible({ timeout: 5000 });

  // Wait for the AI to finish responding
  await page.waitForTimeout(3000);

  // Second request: Ask to search again - should NOT ask for permission
  await submitChatPrompt(page, 'Search for "TypeScript 5.0 features"');

  // Wait a bit for the request to be processed
  await page.waitForTimeout(5000);

  // The permission dialog should NOT appear this time since we clicked "Allow Always"
  // If it does appear within 3 seconds, the test fails
  const dialogAppeared = await permissionConfirmation.isVisible().catch(() => false);
  expect(dialogAppeared).toBe(false);

  // Navigate to Agent Permissions settings and verify the tool pattern was saved
  await openAgentPermissionsSettings(page);

  // Get all allowed tool patterns from the settings panel
  const allowedPatterns = await getAllowedToolPatterns(page);
  console.log('Allowed tool patterns:', allowedPatterns);

  // Verify "Search the web" (the displayName for websearch) is in the list
  const hasWebSearchPattern = allowedPatterns.some(pattern =>
    pattern.toLowerCase().includes('search') && pattern.toLowerCase().includes('web')
  );
  expect(hasWebSearchPattern).toBe(true);
});
