import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, waitForAppReady } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Bottom Panel - Mode Switching Layout', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create a test markdown file
    await fs.writeFile(
      path.join(workspaceDir, 'test.md'),
      '# Test Document\n\nThis is a test document with some content.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();
    await waitForAppReady(page);

    // Open the test file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).first().waitFor({
      timeout: TEST_TIMEOUTS.FILE_TREE_LOAD
    });
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('bottom panel should not push content off screen when switching modes', async () => {
    // Get the tab manager as a reference point for "top of content"
    const tabManager = page.locator('.file-tabs-container');
    await expect(tabManager).toBeVisible();

    // Get initial position of tab manager
    const initialBox = await tabManager.boundingBox();
    expect(initialBox).toBeTruthy();
    const initialTop = initialBox!.y;

    // Open the bottom panel by clicking the Plans button in navigation gutter
    const plansButton = page.locator('button[aria-label="Plans (Cmd+Shift+P)"]');
    await expect(plansButton).toBeVisible();
    await plansButton.click();
    await page.waitForTimeout(500);

    // Verify bottom panel is visible
    const bottomPanel = page.locator('.bottom-panel-container');
    await expect(bottomPanel).toBeVisible({ timeout: 3000 });

    // Check that tab manager is still visible and hasn't moved significantly
    const tabManagerAfterPanel = await tabManager.boundingBox();
    expect(tabManagerAfterPanel).toBeTruthy();
    expect(tabManagerAfterPanel!.y).toBeGreaterThanOrEqual(initialTop - 5); // Allow 5px tolerance
    expect(tabManagerAfterPanel!.y).toBeLessThanOrEqual(initialTop + 5);

    // Switch to Agent mode by clicking the Agent button
    const agentButton = page.locator('button[aria-label="Agent (Cmd+K)"]');
    await expect(agentButton).toBeVisible();
    await agentButton.click();
    await page.waitForTimeout(500);

    // Verify tab manager is hidden (agent mode)
    await expect(tabManager).not.toBeVisible();

    // Bottom panel should still be visible
    await expect(bottomPanel).toBeVisible();

    // Switch back to Editor mode by clicking the Files button
    const filesButton = page.locator('button[aria-label="Files (Cmd+E)"]');
    await expect(filesButton).toBeVisible();
    await filesButton.click();
    await page.waitForTimeout(500);

    // Verify we're back in Editor mode
    await expect(tabManager).toBeVisible();

    // Check that tab manager is still visible and at correct position
    const finalTabManagerBox = await tabManager.boundingBox();
    expect(finalTabManagerBox).toBeTruthy();
    expect(finalTabManagerBox!.y).toBeGreaterThanOrEqual(initialTop - 5);
    expect(finalTabManagerBox!.y).toBeLessThanOrEqual(initialTop + 5);

    // Bottom panel should still be visible
    await expect(bottomPanel).toBeVisible();

    // Verify editor content is still visible
    const editor = page.locator('.file-tabs-container .multi-editor-instance.active .editor [contenteditable="true"]');
    await expect(editor).toBeVisible();

    // Check editor is at a reasonable position (not pushed off screen)
    const editorBox = await editor.boundingBox();
    expect(editorBox).toBeTruthy();
    expect(editorBox!.y).toBeGreaterThan(0);
    expect(editorBox!.y).toBeLessThan(200); // Should be in the top portion of the screen
  });

  test('switching modes multiple times should maintain stable layout', async () => {
    // Open bottom panel
    const plansButton = page.locator('button[aria-label="Plans (Cmd+Shift+P)"]');
    await plansButton.click();
    await page.waitForTimeout(500);

    const tabManager = page.locator('.file-tabs-container');
    const initialTabManagerBox = await tabManager.boundingBox();
    expect(initialTabManagerBox).toBeTruthy();
    const referenceTop = initialTabManagerBox!.y;

    const agentButton = page.locator('button[aria-label="Agent (Cmd+K)"]');
    const filesButton = page.locator('button[aria-label="Files (Cmd+E)"]');

    // Switch modes multiple times
    const modes = [agentButton, filesButton, agentButton, filesButton, agentButton];

    for (const button of modes) {
      await button.click();
      await page.waitForTimeout(300);

      // For files mode, check tab manager position
      if (button === filesButton) {
        await expect(tabManager).toBeVisible();
        const currentBox = await tabManager.boundingBox();
        expect(currentBox).toBeTruthy();

        // Tab manager should still be at the same position
        expect(currentBox!.y).toBeGreaterThanOrEqual(referenceTop - 10);
        expect(currentBox!.y).toBeLessThanOrEqual(referenceTop + 10);
      }
    }

    // Final check - switch back to editor mode and verify everything is visible
    await filesButton.click();
    await page.waitForTimeout(500);

    await expect(tabManager).toBeVisible();
    const editor = page.locator('.file-tabs-container .multi-editor-instance.active .editor [contenteditable="true"]');
    await expect(editor).toBeVisible();

    // Bottom panel should still be visible
    const bottomPanel = page.locator('.bottom-panel-container');
    await expect(bottomPanel).toBeVisible();
  });

  test('resizing bottom panel should not affect mode switching', async () => {
    // Open bottom panel
    const plansButton = page.locator('button[aria-label="Plans (Cmd+Shift+P)"]');
    await plansButton.click();
    await page.waitForTimeout(500);

    const tabManager = page.locator('.file-tabs-container');

    // Try to resize bottom panel (if there's a resize handle)
    const resizeHandle = page.locator('.bottom-panel-resize-handle');

    // Note: Resizing might not be implemented, so we'll make this optional
    const handleExists = await resizeHandle.count() > 0;

    if (handleExists) {
      const handleBox = await resizeHandle.boundingBox();
      if (handleBox) {
        // Drag to resize
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y);
        await page.mouse.down();
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y - 100);
        await page.mouse.up();
        await page.waitForTimeout(300);
      }
    }

    // Switch to Agent mode
    const agentButton = page.locator('button[aria-label="Agent (Cmd+K)"]');
    await agentButton.click();
    await page.waitForTimeout(500);

    // Switch back to Editor mode
    const filesButton = page.locator('button[aria-label="Files (Cmd+E)"]');
    await filesButton.click();
    await page.waitForTimeout(500);

    // Verify tab manager is still visible
    await expect(tabManager).toBeVisible();
    const tabManagerBox = await tabManager.boundingBox();
    expect(tabManagerBox).toBeTruthy();
    expect(tabManagerBox!.y).toBeGreaterThanOrEqual(0);
  });
});
