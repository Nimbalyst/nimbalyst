/**
 * Mockup Diff Reject E2E Test
 *
 * Tests that when rejecting AI edits to a mockup file,
 * the mockup viewer reverts to the original content.
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
} from '../../helpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();
  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
});

test.afterEach(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('rejecting diff reverts to original content', async () => {
  const mockupPath = path.join(workspaceDir, 'test.mockup.html');

  // Original content with a RED box
  const originalContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Test Mockup</title>
</head>
<body>
    <div style="width: 100px; height: 100px; background-color: red;"></div>
</body>
</html>`;

  // Modified content with a BLUE box
  const modifiedContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Test Mockup</title>
</head>
<body>
    <div style="width: 100px; height: 100px; background-color: blue;"></div>
</body>
</html>`;

  // Create the original file
  await fs.writeFile(mockupPath, originalContent, 'utf8');

  // Open the mockup file
  await page.locator('.file-tree-name', { hasText: 'test.mockup.html' }).click();

  // Wait for the mockup viewer to load
  await page.waitForSelector('iframe', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify the iframe shows the RED box initially
  const iframeInitial = page.frameLocator('iframe').first();
  const redBox = iframeInitial.locator('div[style*="red"]');
  await expect(redBox).toBeVisible({ timeout: 5000 });

  // Simulate AI edit:
  // 1. Write modified content to disk
  // 2. Create a pending history tag
  await fs.writeFile(mockupPath, modifiedContent, 'utf8');

  const tagId = `test-tag-${Date.now()}`;
  const sessionId = `test-session-${Date.now()}`;

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

  await page.locator('.file-tree-name', { hasText: 'test.mockup.html' }).click();
  await page.waitForSelector('iframe', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
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

  // Verify the iframe shows the RED box (reverted to original)
  const iframeFinal = page.frameLocator('iframe').first();
  const redBoxAfter = iframeFinal.locator('div[style*="red"]');

  // This is the critical assertion - after rejecting, we should see RED not BLUE
  await expect(redBoxAfter).toBeVisible({ timeout: 5000 });

  // Also verify BLUE is gone
  const blueBoxAfter = iframeFinal.locator('div[style*="blue"]');
  await expect(blueBoxAfter).not.toBeVisible();

  // Verify the file on disk has red (reverted)
  const finalContent = await fs.readFile(mockupPath, 'utf-8');
  expect(finalContent).toContain('red');
  expect(finalContent).not.toContain('blue');
});
