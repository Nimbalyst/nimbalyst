/**
 * Mockup Diff Accept E2E Test
 *
 * Tests that when accepting AI edits to a mockup file,
 * the mockup viewer shows the updated content.
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

test('mockup viewer shows updated content after accepting diff', async () => {
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

  // Click "Keep All" to accept the changes
  const keepButton = page.locator('.unified-diff-header button', { hasText: /Keep/i }).first();
  await keepButton.click();
  await page.waitForTimeout(500);

  // Wait for diff header to disappear
  await page.waitForSelector('.unified-diff-header', { state: 'hidden', timeout: 3000 }).catch(() => {
    console.log('[Test] Diff header still visible after Keep');
  });

  // Debug: Check what's actually in the iframe
  await page.waitForTimeout(1000);

  // Get the iframe's HTML content
  const iframeHtml = await page.evaluate(() => {
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    return iframe?.contentDocument?.body?.innerHTML || 'NO IFRAME CONTENT';
  });
  console.log('[Test] Iframe HTML after accept:', iframeHtml);

  // Also check what's on disk
  const diskContent = await fs.readFile(mockupPath, 'utf-8');
  console.log('[Test] Disk content after accept:', diskContent.includes('blue') ? 'HAS BLUE' : 'NO BLUE', diskContent.includes('red') ? 'HAS RED' : 'NO RED');

  // Now verify the iframe shows the BLUE box
  const iframeFinal = page.frameLocator('iframe').first();
  const blueBox = iframeFinal.locator('div[style*="blue"]');

  // This is the critical assertion - after accepting, we should see BLUE not RED
  await expect(blueBox).toBeVisible({ timeout: 5000 });

  // Also verify RED is gone
  const redBoxAfter = iframeFinal.locator('div[style*="red"]');
  await expect(redBoxAfter).not.toBeVisible();

  // Verify the file on disk has blue
  const finalContent = await fs.readFile(mockupPath, 'utf-8');
  expect(finalContent).toContain('blue');
  expect(finalContent).not.toContain('red');
});
