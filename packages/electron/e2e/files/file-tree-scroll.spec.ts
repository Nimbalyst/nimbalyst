/**
 * E2E test: expanding a directory in the file tree should NOT cause the
 * scroll position to jump back to the currently-open file.
 *
 * Reproduces the bug where the reveal effect (revealRequestAtom) was never
 * cleared after its initial scroll, causing every subsequent visibleNodes
 * change (e.g. expanding a directory) to re-trigger scrollToIndex.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  waitForAppReady,
} from '../helpers';
import { openFileFromTree, PLAYWRIGHT_TEST_SELECTORS } from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspacePath: string;

test.beforeAll(async () => {
  workspacePath = await createTempWorkspace();

  // Create a workspace with enough items to require scrolling.
  //
  // Structure:
  //   aaa-top.md                <-- file visible at top of tree
  //   dir-00/ ... dir-19/       <-- directories to fill the tree
  //     inner.md
  //   src/                      <-- directory near bottom to expand
  //     app.ts
  //   zzz-deep/                 <-- target file at bottom
  //     target.md

  for (let i = 0; i < 20; i++) {
    const name = `dir-${String(i).padStart(2, '0')}`;
    const dirPath = path.join(workspacePath, name);
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(path.join(dirPath, 'inner.md'), `# ${name}\n`, 'utf8');
  }

  await fs.writeFile(path.join(workspacePath, 'aaa-top.md'), '# Top\n', 'utf8');

  const srcDir = path.join(workspacePath, 'src');
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, 'app.ts'), 'const x = 1;\n', 'utf8');

  const targetDir = path.join(workspacePath, 'zzz-deep');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'target.md'), '# Target\n', 'utf8');

  electronApp = await launchElectronApp({
    workspace: workspacePath,
    env: { NODE_ENV: 'test' },
  });

  page = await electronApp.firstWindow();
  page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  await waitForAppReady(page);
});

test.afterAll(async () => {
  if (electronApp) {
    await Promise.race([
      electronApp.close(),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]).catch(() => {});
  }
  await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
});

/**
 * Helper: get the Virtuoso scroller element (or fallback to the container).
 */
async function getTreeScroller(p: Page) {
  const virtuosoScroller = p.locator('.file-tree-container [data-testid="virtuoso-scroller"]').first();
  const exists = await virtuosoScroller.count();
  return exists > 0
    ? virtuosoScroller
    : p.locator('.file-tree-container').first();
}

test('expanding a directory after opening a file does not scroll back', async () => {
  test.setTimeout(30000);

  // 1. Wait for tree to load
  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'aaa-top.md' })
  ).toBeVisible({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

  // 2. Expand zzz-deep and open target.md via the tree (scrolls tree down)
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'zzz-deep' }).click();
  await page.waitForTimeout(500);
  await openFileFromTree(page, 'target.md');

  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: 'target.md' })
  ).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  // 3. Scroll to the top of the file tree
  const scroller = await getTreeScroller(page);
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(300);

  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'aaa-top.md' })
  ).toBeVisible({ timeout: 2000 });

  // 4. Click dir-00 to expand it - this changes visibleNodes
  const scrollBefore = await scroller.evaluate(el => el.scrollTop);
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'dir-00' }).click();
  await page.waitForTimeout(800);

  // 5. Scroll should NOT have jumped hundreds of pixels down to target.md
  const scrollAfter = await scroller.evaluate(el => el.scrollTop);
  const scrollDelta = Math.abs(scrollAfter - scrollBefore);
  expect(scrollDelta).toBeLessThan(100);

  // aaa-top.md should still be visible
  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'aaa-top.md' })
  ).toBeVisible({ timeout: 1000 });
});

test('expanding a directory after breadcrumb reveal does not scroll back', async () => {
  test.setTimeout(30000);

  // This test specifically targets the revealRequestAtom bug: breadcrumb click
  // sets revealRequest which should be cleared after the initial scroll.

  // 1. Open src/app.ts via the tree so it has a breadcrumb
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'src' }).click();
  await page.waitForTimeout(500);
  await openFileFromTree(page, 'app.ts');

  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: 'app.ts' })
  ).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  // 2. Click the breadcrumb filename to trigger a reveal (sets revealRequestAtom)
  const breadcrumbFilename = page.locator('.breadcrumb-filename', { hasText: 'app.ts' });
  const breadcrumbExists = await breadcrumbFilename.count();
  if (breadcrumbExists === 0) {
    // If breadcrumb isn't available, skip this test (the first test covers
    // the basic scenario; this one is specifically for the reveal path)
    test.skip();
    return;
  }
  await breadcrumbFilename.click({ force: true });
  await page.waitForTimeout(500);

  // 3. Scroll the tree to the top
  const scroller = await getTreeScroller(page);
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(300);

  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'aaa-top.md' })
  ).toBeVisible({ timeout: 2000 });

  // 4. Expand dir-00
  const scrollBefore = await scroller.evaluate(el => el.scrollTop);
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'dir-00' }).click();
  await page.waitForTimeout(800);

  // 5. Verify no scroll jump
  const scrollAfter = await scroller.evaluate(el => el.scrollTop);
  const scrollDelta = Math.abs(scrollAfter - scrollBefore);
  expect(scrollDelta).toBeLessThan(100);

  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'aaa-top.md' })
  ).toBeVisible({ timeout: 1000 });
});
