/**
 * MCP applyDiff Tool Test
 *
 * Tests the applyReplacements mechanism that the MCP applyDiff tool uses.
 * This validates the core diff functionality without requiring actual AI calls.
 *
 * Flow: AI → MCP Tool → ToolExecutor → IPC → Renderer → editorRegistry.applyReplacements()
 * This test directly calls applyReplacements() to test the final mechanism.
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import * as fs from 'fs';
import * as path from 'path';

test.describe('MCP applyDiff Tool', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFilePath: string;

  test.beforeEach(async () => {
    // Create temporary workspace
    workspaceDir = await createTempWorkspace();

    // Create test file with a simple shopping list
    const testContent = `# Shopping List

- Apples
- Bananas
- Oranges
`;

    testFilePath = path.join(workspaceDir, 'shopping.md');
    fs.writeFileSync(testFilePath, testContent);

    // Launch app
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();

    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

    // Open the test file
    await page.click('text=shopping.md');
    await page.waitForTimeout(1000); // Wait for editor to fully initialize
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('should replace text in a list using applyReplacements', async () => {
    // Test the mechanism that MCP applyDiff uses internally
    // This is the core diff functionality
    const result = await page.evaluate(async (filePath) => {
      const registry = (window as any).__editorRegistry;
      if (!registry) {
        return { success: false, error: 'editorRegistry not available' };
      }

      try {
        // Apply a simple replacement (Bananas → Strawberries)
        return await registry.applyReplacements(filePath, [
          {
            oldText: '- Bananas',
            newText: '- Strawberries'
          }
        ]);
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }, testFilePath);

    // Verify the replacement was successful
    expect(result.success).toBe(true);

    // Wait for diff UI
    await page.waitForTimeout(1000);

    // Verify Accept All button appears
    const acceptButton = page.locator('button:has-text("Accept All")').first();
    const acceptButtonVisible = await acceptButton.isVisible({ timeout: 3000 }).catch(() => false);
    expect(acceptButtonVisible).toBe(true);

    // Accept the diff
    await acceptButton.click();
    await page.waitForTimeout(1000);

    // Verify the content changed
    const finalContent = await page.evaluate((filePath) => {
      const registry = (window as any).__editorRegistry;
      return registry ? registry.getContent(filePath) : null;
    }, testFilePath);

    expect(finalContent).toContain('Strawberries');
    expect(finalContent).not.toContain('Bananas');
  });
});
