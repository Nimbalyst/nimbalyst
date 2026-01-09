import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, waitForAppReady } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Unified Editor Header Bar - Breadcrumb', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should show relative path from workspace root in breadcrumb', async () => {
    // Create a test file in a subdirectory
    const subDir = path.join(workspaceDir, 'test-subdir');
    const testFile = path.join(subDir, 'test-file.md');

    // Ensure directory exists
    await fs.mkdir(subDir, { recursive: true });

    // Create test file
    await fs.writeFile(testFile, '# Test File\n\nThis is a test.');

    // Launch the app with our workspace
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);

    // Wait for file tree to load
    await page.waitForSelector('.file-tree', { timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

    // Expand the test-subdir folder by clicking on it
    const folderItem = page.locator('.file-tree-item').filter({ hasText: 'test-subdir' }).first();
    await expect(folderItem).toBeVisible({ timeout: 5000 });
    await folderItem.click();
    await page.waitForTimeout(500);

    // Now find and click on the test file
    const fileItem = page.locator('.file-tree-item').filter({ hasText: 'test-file.md' }).first();
    await expect(fileItem).toBeVisible({ timeout: 5000 });
    await fileItem.dblclick(); // Double click to open

    // Wait for the unified header bar to appear
    const headerBar = page.locator('.unified-editor-header-bar');
    await expect(headerBar).toBeVisible({ timeout: 5000 });

    // Get the breadcrumb element
    const breadcrumb = headerBar.locator('.unified-header-breadcrumb');
    await expect(breadcrumb).toBeVisible();

    // Debug: log the workspace path and what we see
    console.log('[Test] Workspace dir:', workspaceDir);
    console.log('[Test] Test file path:', testFile);

    // Get all breadcrumb segments
    const segments = breadcrumb.locator('.breadcrumb-segment');
    const segmentCount = await segments.count();

    console.log(`[Test] Found ${segmentCount} breadcrumb segments`);

    // Log each segment for debugging
    for (let i = 0; i < segmentCount; i++) {
      const text = await segments.nth(i).textContent();
      console.log(`[Test] Segment ${i}: "${text?.trim()}"`);
    }

    // Should have at least 2 segments: "test-subdir" and "test-file.md"
    expect(segmentCount).toBeGreaterThanOrEqual(2);

    // Check the breadcrumb text contains the folder and file
    const breadcrumbText = await breadcrumb.textContent();
    console.log(`[Test] Full breadcrumb text: "${breadcrumbText}"`);

    expect(breadcrumbText).toContain('test-subdir');
    expect(breadcrumbText).toContain('test-file.md');

    // The breadcrumb should NOT contain the full absolute path
    expect(breadcrumbText).not.toContain('/Users/');
    expect(breadcrumbText).not.toContain(workspaceDir);
  });
});
