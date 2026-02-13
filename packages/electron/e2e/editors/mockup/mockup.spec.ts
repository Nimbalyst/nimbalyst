/**
 * Mockup Diff E2E Tests (Consolidated)
 *
 * Tests for accepting and rejecting AI edits to mockup files:
 * - Accepting diff shows updated content in iframe viewer
 * - Rejecting diff reverts to original content
 *
 * Consolidated from:
 * - diff-accept.spec.ts (1 test)
 * - diff-reject.spec.ts (1 test)
 *
 * All tests share a single app instance for performance.
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
  TEST_TIMEOUTS,
  ACTIVE_EDITOR_SELECTOR,
} from '../../helpers';

// Selector for the active tab's iframe (avoids matching hidden tab iframes)
const ACTIVE_TAB_WRAPPER = '.file-tabs-container .tab-editor-wrapper:not([style*="display: none"])';
import { dismissAPIKeyDialog } from '../../utils/testHelpers';

// Use serial mode to ensure tests run in order with shared app instance
test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

// Shared mockup HTML templates
const makeOriginalContent = (color: string) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Test Mockup</title>
</head>
<body>
    <div style="width: 100px; height: 100px; background-color: ${color};"></div>
</body>
</html>`;

test.describe('Mockup Diff', () => {
  test.beforeAll(async () => {
    workspaceDir = await createTempWorkspace();

    // Create test mockup files with different names to avoid conflicts
    await fs.writeFile(
      path.join(workspaceDir, 'accept.mockup.html'),
      makeOriginalContent('red'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceDir, 'reject.mockup.html'),
      makeOriginalContent('red'),
      'utf8'
    );

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await waitForAppReady(page);
    await dismissProjectTrustToast(page);
    await dismissAPIKeyDialog(page);
  });

  test.afterAll(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('mockup viewer shows updated content after accepting diff', async () => {
    const mockupPath = path.join(workspaceDir, 'accept.mockup.html');
    const originalContent = makeOriginalContent('red');
    const modifiedContent = makeOriginalContent('blue');

    // Open the mockup file
    await page.locator('.file-tree-name', { hasText: 'accept.mockup.html' }).click();

    // Wait for the mockup viewer to load (scoped to active tab)
    const activeWrapper = page.locator(ACTIVE_TAB_WRAPPER);
    await activeWrapper.locator('iframe').waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Verify the iframe shows the RED box initially
    const iframe = activeWrapper.frameLocator('iframe');
    const redBox = iframe.locator('div[style*="red"]');
    await expect(redBox).toBeVisible({ timeout: 5000 });

    // Simulate AI edit: write modified content to disk and create pending history tag
    await fs.writeFile(mockupPath, modifiedContent, 'utf8');

    const tagId = `test-tag-accept-${Date.now()}`;
    const sessionId = `test-session-accept-${Date.now()}`;

    await page.evaluate(async ({ filePath, tagId, sessionId, originalContent }) => {
      await window.electronAPI.history.createTag(
        filePath,
        tagId,
        originalContent,
        sessionId,
        'test-tool-use'
      );
    }, { filePath: mockupPath, tagId, sessionId, originalContent });

    // Close and reopen the file to trigger pending tag check
    await page.keyboard.press('Meta+w');
    await page.waitForTimeout(300);

    await page.locator('.file-tree-name', { hasText: 'accept.mockup.html' }).click();
    const activeWrapper2 = page.locator(ACTIVE_TAB_WRAPPER);
    // Diff view creates 2 iframes (Updated + Original), use .first()
    await activeWrapper2.locator('iframe').first().waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Wait for diff header to appear
    await page.waitForSelector('.unified-diff-header', { timeout: 5000 });

    // Click "Keep All" to accept the changes
    const keepButton = page.locator('.unified-diff-header button', { hasText: /Keep/i }).first();
    await keepButton.click();
    await page.waitForTimeout(500);

    // Wait for diff header to disappear
    await page.waitForSelector('.unified-diff-header', { state: 'hidden', timeout: 3000 }).catch(() => {
      console.log('[Test] Diff header still visible after Keep');
    });

    await page.waitForTimeout(1000);

    // After accepting, diff view collapses to single iframe
    const iframeFinal = activeWrapper2.frameLocator('iframe').first();
    const blueBox = iframeFinal.locator('div[style*="blue"]');
    await expect(blueBox).toBeVisible({ timeout: 5000 });

    // Also verify RED is gone
    const redBoxAfter = iframeFinal.locator('div[style*="red"]');
    await expect(redBoxAfter).not.toBeVisible();

    // Verify the file on disk has blue
    const finalContent = await fs.readFile(mockupPath, 'utf-8');
    expect(finalContent).toContain('blue');
    expect(finalContent).not.toContain('red');
  });

  test('rejecting diff reverts to original content', async () => {
    const mockupPath = path.join(workspaceDir, 'reject.mockup.html');
    const originalContent = makeOriginalContent('red');
    const modifiedContent = makeOriginalContent('blue');

    // Open the mockup file
    await page.locator('.file-tree-name', { hasText: 'reject.mockup.html' }).click();

    // Wait for the mockup viewer to load (scoped to active tab)
    const activeWrapper = page.locator(ACTIVE_TAB_WRAPPER);
    await activeWrapper.locator('iframe').waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Verify the iframe shows the RED box initially
    const iframe = activeWrapper.frameLocator('iframe');
    const redBox = iframe.locator('div[style*="red"]');
    await expect(redBox).toBeVisible({ timeout: 5000 });

    // Simulate AI edit: write modified content to disk and create pending history tag
    await fs.writeFile(mockupPath, modifiedContent, 'utf8');

    const tagId = `test-tag-reject-${Date.now()}`;
    const sessionId = `test-session-reject-${Date.now()}`;

    await page.evaluate(async ({ filePath, tagId, sessionId, originalContent }) => {
      await window.electronAPI.history.createTag(
        filePath,
        tagId,
        originalContent,
        sessionId,
        'test-tool-use'
      );
    }, { filePath: mockupPath, tagId, sessionId, originalContent });

    // Close and reopen the file to trigger pending tag check
    await page.keyboard.press('Meta+w');
    await page.waitForTimeout(300);

    await page.locator('.file-tree-name', { hasText: 'reject.mockup.html' }).click();
    const activeWrapper2 = page.locator(ACTIVE_TAB_WRAPPER);
    // Diff view creates 2 iframes (Updated + Original), use .first()
    await activeWrapper2.locator('iframe').first().waitFor({ state: 'visible', timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Wait for diff header to appear
    await page.waitForSelector('.unified-diff-header', { timeout: 5000 });

    // Click "Revert" to reject the changes
    const revertButton = page.locator('.unified-diff-header button', { hasText: /Revert/i }).first();
    await revertButton.click();
    await page.waitForTimeout(500);

    // Wait for diff header to disappear
    await page.waitForSelector('.unified-diff-header', { state: 'hidden', timeout: 3000 }).catch(() => {
      console.log('[Test] Diff header still visible after Revert');
    });

    await page.waitForTimeout(1000);

    // After reverting, diff view collapses to single iframe
    const iframeFinal = activeWrapper2.frameLocator('iframe').first();
    const redBoxAfter = iframeFinal.locator('div[style*="red"]');
    await expect(redBoxAfter).toBeVisible({ timeout: 5000 });

    // Also verify BLUE is gone
    const blueBoxAfter = iframeFinal.locator('div[style*="blue"]');
    await expect(blueBoxAfter).not.toBeVisible();

    // Verify the file on disk has red (reverted)
    const finalContent = await fs.readFile(mockupPath, 'utf-8');
    expect(finalContent).toContain('red');
    expect(finalContent).not.toContain('blue');
  });
});
