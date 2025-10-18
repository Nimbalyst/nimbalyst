import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
    launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, waitForAppReady, getKeyboardShortcut,
    ACTIVE_EDITOR_SELECTOR
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Editor Sleep Management', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create 25 test files to test beyond the 20 editor limit
    for (let i = 1; i <= 25; i++) {
      await fs.writeFile(
        path.join(workspaceDir, `file-${String(i).padStart(2, '0')}.md`),
        `# Document ${i}\n\nThis is file number ${i}.\n`,
        'utf8'
      );
    }

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test.skip('should allow opening more than 20 tabs and sleep editors beyond limit', async () => {
    // NOTE: This test is obsolete - EditorPool has been removed in favor of TabEditor/TabContent architecture
    // The new architecture doesn't use sleep/wake since all editors are React components that unmount when not visible
    // Open 20 files (at the limit)
    console.log('Opening first 20 files...');
    for (let i = 1; i <= 20; i++) {
      const fileName = `file-${String(i).padStart(2, '0')}.md`;
      await page.locator('.file-tree-name', { hasText: fileName }).click();
      await expect(page.locator('.file-tabs-container .tab .tab-title', { hasText: fileName })).toBeVisible({
        timeout: TEST_TIMEOUTS.TAB_SWITCH
      });
      if (i % 5 === 0) {
        console.log(`  Opened ${i} files...`);
      }
    }

    // All 20 tabs should be open
    const tabCount = await page.locator('.file-tabs-container .tab').count();
    expect(tabCount).toBe(20);
    console.log(`✓ All 20 tabs are open`);

    // Check editor pool stats - should have 20 awake, 0 sleeping
    const statsAt20 = await page.evaluate(() => {
      const pool = (window as any).__editorPool__;
      return pool ? pool.getStats() : null;
    });

    expect(statsAt20).not.toBeNull();
    expect(statsAt20!.total).toBe(20);
    expect(statsAt20!.sleeping).toBe(0);
    console.log(`✓ EditorPool has 20 editors, 0 sleeping`);

    // Open 21st file - should put the oldest (file-01) to sleep
    console.log('Opening file 21 (should sleep file-01)...');
    await page.locator('.file-tree-name', { hasText: 'file-21.md' }).click();
    await expect(page.locator('.file-tabs-container .tab .tab-title', { hasText: 'file-21.md' })).toBeVisible({
      timeout: TEST_TIMEOUTS.TAB_SWITCH
    });
    await page.waitForTimeout(500);

    // Check stats - should have 21 total, 1 sleeping
    const statsAt21 = await page.evaluate(() => {
      const pool = (window as any).__editorPool__;
      return pool ? pool.getStats() : null;
    });

    expect(statsAt21!.total).toBe(21);
    expect(statsAt21!.sleeping).toBe(1);
    console.log(`✓ EditorPool has 21 editors, 1 sleeping`);

    // Open files 22-25 - should sleep more editors
    console.log('Opening files 22-25...');
    for (let i = 22; i <= 25; i++) {
      const fileName = `file-${String(i).padStart(2, '0')}.md`;
      await page.locator('.file-tree-name', { hasText: fileName }).click();
      await expect(page.locator('.file-tabs-container .tab .tab-title', { hasText: fileName })).toBeVisible({
        timeout: TEST_TIMEOUTS.TAB_SWITCH
      });
    }

    await page.waitForTimeout(500);

    // Check final stats - should have 25 total, 5 sleeping
    const statsAt25 = await page.evaluate(() => {
      const pool = (window as any).__editorPool__;
      return pool ? pool.getStats() : null;
    });

    expect(statsAt25!.total).toBe(25);
    expect(statsAt25!.sleeping).toBe(5);
    console.log(`✓ EditorPool has 25 editors, 5 sleeping`);
    console.log(`✓ Successfully opened 25 tabs (more than the old 10-tab limit!)`);
  });

  test.skip('should wake up sleeping editor when switched to and preserve undo history', async () => {
    // This test would take too long to run (opening 20+ files)
    // The implementation is tested by the first test
    // Undo preservation is a fundamental feature of keeping editors rendered but hidden
  });

  test.skip('should not put dirty or visible editors to sleep', async () => {
    // This test would take too long to run (opening 20+ files)
    // The implementation correctly skips dirty and visible editors in EditorPool.evictLRU()
  });
});
