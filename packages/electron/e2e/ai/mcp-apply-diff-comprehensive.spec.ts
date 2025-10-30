/**
 * MCP applyDiff Comprehensive Tests
 *
 * Tests the applyReplacements mechanism that the MCP applyDiff tool uses.
 * Consolidates tests from mcp-apply-diff.spec.ts and mcp-apply-diff-position-bug.spec.ts
 *
 * Flow: AI → MCP Tool → ToolExecutor → IPC → Renderer → editorRegistry.applyReplacements()
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import {
  simulateApplyDiff,
  waitForEditorReady,
  triggerManualSave,
  waitForSave
} from '../utils/aiToolSimulator';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.describe('MCP applyDiff', () => {
  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should replace text using applyReplacements', async () => {
    // Create test file
    const testFilePath = path.join(workspaceDir, 'shopping.md');
    await fs.writeFile(testFilePath, `# Shopping List\n\n- Apples\n- Bananas\n- Oranges\n`, 'utf8');

    // Open file
    await page.click('text=shopping.md');
    await page.waitForTimeout(1000);

    // Apply replacement
    const result = await page.evaluate(async (filePath) => {
      const registry = (window as any).__editorRegistry;
      if (!registry) {
        return { success: false, error: 'editorRegistry not available' };
      }

      try {
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

    expect(result.success).toBe(true);

    // Wait for diff UI and accept
    await page.waitForTimeout(1000);
    const acceptButton = page.locator('button:has-text("Accept All")').first();
    await expect(acceptButton).toBeVisible({ timeout: 3000 });
    await acceptButton.click();
    await page.waitForTimeout(1000);

    // Verify content
    const finalContent = await page.evaluate((filePath) => {
      const registry = (window as any).__editorRegistry;
      return registry ? registry.getContent(filePath) : null;
    }, testFilePath);

    expect(finalContent).toContain('Strawberries');
    expect(finalContent).not.toContain('Bananas');
  });

  test('should handle replacement without moving lines to end of document', async () => {
    test.setTimeout(30000);

    // Create document with multiple sections
    const testFilePath = path.join(workspaceDir, 'haikus.md');
    const initialContent = `# Poetry

## Trees
Branches reach for sky,
Roots dig deep through ancient earth—
Patience carved in rings.

## Robots
Steel minds never sleep,
Circuits hum with electric dreams—
Silicon heartbeat.

## Hornets
Black and yellow threat,
Paper castles guard their queen—
Anger on the wing.

## Grass
Blades bend with the wind,
Green whispers in morning dew—
Earth's living carpet.

## Flowers
Petals unfold soft,
Colors bloom in morning light—
Spring's whispered promise.
`;

    await fs.writeFile(testFilePath, initialContent, 'utf8');

    // Open file
    await page.locator('.file-tree-name', { hasText: 'haikus.md' }).click();
    await expect(page.locator('.file-tabs-container .tab.active .tab-title'))
      .toContainText('haikus.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Apply diff to replace Grass section
    const result = await simulateApplyDiff(page, testFilePath, [
      {
        oldText: `## Grass
Blades bend with the wind,
Green whispers in morning dew—
Earth's living carpet.`,
        newText: `## Grass
Blades trampled and torn,
Green fades to withered brown death—
Earth reclaims its own.`
      }
    ]);

    expect(result.success).toBe(true);

    // Accept and save
    const acceptButton = page.locator('button:has-text("Accept All")');
    if (await acceptButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await acceptButton.click();
      await page.waitForTimeout(200);
    }

    await triggerManualSave(electronApp);
    await waitForSave(page, 'haikus.md');

    // Verify structure is correct
    const diskContent = await fs.readFile(testFilePath, 'utf8');
    const lines = diskContent.split('\n');

    const grassIndex = lines.findIndex(line => line === '## Grass');
    expect(grassIndex).toBeGreaterThan(-1);

    // Verify Grass section has new content
    expect(lines[grassIndex + 1]).toBe('Blades trampled and torn,');
    expect(lines[grassIndex + 2]).toBe('Green fades to withered brown death—');
    expect(lines[grassIndex + 3]).toBe('Earth reclaims its own.');

    // Verify Flowers section comes after Grass
    const flowersIndex = lines.findIndex(line => line === '## Flowers');
    expect(flowersIndex).toBe(grassIndex + 5);

    // Verify last line is NOT from Grass section (position bug check)
    const lastNonEmptyLine = lines.filter(l => l.trim()).pop();
    expect(lastNonEmptyLine).not.toBe('Earth reclaims its own.');
    expect(lastNonEmptyLine).toBe('Spring\'s whispered promise.');
  });

  test('should preserve order when replacing middle section', async () => {
    test.setTimeout(30000);

    const testFilePath = path.join(workspaceDir, 'sections.md');
    const initialContent = `# Document

## Section 1
Content 1

## Section 2
Content 2

## Section 3
Content 3
`;

    await fs.writeFile(testFilePath, initialContent, 'utf8');

    await page.locator('.file-tree-name', { hasText: 'sections.md' }).click();
    await waitForEditorReady(page);

    // Replace middle section
    const result = await simulateApplyDiff(page, testFilePath, [
      {
        oldText: `## Section 2
Content 2`,
        newText: `## Section 2
Modified content`
      }
    ]);

    expect(result.success).toBe(true);

    const acceptButton = page.locator('button:has-text("Accept All")');
    if (await acceptButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await acceptButton.click();
      await page.waitForTimeout(200);
    }

    await triggerManualSave(electronApp);
    await waitForSave(page, 'sections.md');

    const diskContent = await fs.readFile(testFilePath, 'utf8');

    // Verify order is preserved
    expect(diskContent.indexOf('Section 1')).toBeLessThan(diskContent.indexOf('Section 2'));
    expect(diskContent.indexOf('Section 2')).toBeLessThan(diskContent.indexOf('Section 3'));
    expect(diskContent).toContain('Modified content');
  });

  test('should handle replacement near end of document', async () => {
    test.setTimeout(30000);

    const testFilePath = path.join(workspaceDir, 'end-test.md');
    const initialContent = `# Document

## First
Content

## Last
Last content
`;

    await fs.writeFile(testFilePath, initialContent, 'utf8');

    await page.locator('.file-tree-name', { hasText: 'end-test.md' }).click();
    await waitForEditorReady(page);

    // Replace last section
    const result = await simulateApplyDiff(page, testFilePath, [
      {
        oldText: `## Last
Last content`,
        newText: `## Last
Updated last content`
      }
    ]);

    expect(result.success).toBe(true);

    const acceptButton = page.locator('button:has-text("Accept All")');
    if (await acceptButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await acceptButton.click();
      await page.waitForTimeout(200);
    }

    await triggerManualSave(electronApp);
    await waitForSave(page, 'end-test.md');

    const diskContent = await fs.readFile(testFilePath, 'utf8');
    const lines = diskContent.split('\n');

    // Verify last section has new content
    const lastIndex = lines.findIndex(line => line === '## Last');
    expect(lines[lastIndex + 1]).toBe('Updated last content');

    // Verify it's still at the end
    const remainingLines = lines.slice(lastIndex + 2).filter(l => l.trim());
    expect(remainingLines.length).toBe(0);
  });
});
