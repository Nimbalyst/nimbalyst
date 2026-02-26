/**
 * E2E test for breadcrumb reveal: clicking a breadcrumb segment should
 * clear any active file filter and scroll the file tree to show the target.
 *
 * Reproduces the bug where files excluded by the active filter (e.g. .ts
 * under "Markdown Only") could not be revealed via the breadcrumb.
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

  // Create all files before launching (required by E2E conventions)
  await fs.writeFile(path.join(workspacePath, 'readme.md'), '# Readme\n', 'utf8');
  const subDir = path.join(workspacePath, 'src');
  await fs.mkdir(subDir, { recursive: true });
  await fs.writeFile(path.join(subDir, 'app.ts'), 'const x = 1;\n', 'utf8');

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
    // Race with a timeout to avoid hanging on close
    await Promise.race([
      electronApp.close(),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]).catch(() => {});
  }
  await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
});

test('breadcrumb reveal clears filter and scrolls to file', async () => {
  test.setTimeout(30000);
  // 1. Wait for file tree to load
  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'readme.md' })
  ).toBeVisible({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

  // 2. Expand src folder and open app.ts (a .ts file that opens in Monaco)
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'src' }).click();
  await page.waitForTimeout(500);
  await openFileFromTree(page, 'app.ts');

  // 3. Set filter to "Markdown Only" (hides .ts files)
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeFilterButton).click();
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.filterMenuMarkdownOnly).click();
  await page.waitForTimeout(500);

  // src folder and app.ts should be hidden by the filter
  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'src' })
  ).toHaveCount(0, { timeout: 2000 });
  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'app.ts' })
  ).toHaveCount(0, { timeout: 2000 });

  // 4. Click the breadcrumb filename to trigger reveal
  const breadcrumbFilename = page.locator('.breadcrumb-filename', { hasText: 'app.ts' });
  await expect(breadcrumbFilename).toBeVisible({ timeout: 2000 });
  await breadcrumbFilename.click({ force: true });

  // 5. Filter should clear and file should become visible in tree
  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'src' })
  ).toBeVisible({ timeout: 5000 });

  await expect(
    page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'app.ts' })
  ).toBeVisible({ timeout: 5000 });

  // 6. Filter indicator should be gone (filter cleared to "all")
  const filterButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeFilterButton);
  await expect(filterButton.locator('.filter-active-indicator')).toHaveCount(0, { timeout: 2000 });
});
