/**
 * Excalidraw Autosave E2E Test
 *
 * Tests that edited content is automatically saved after the autosave interval.
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
import {
  PLAYWRIGHT_TEST_SELECTORS,
  openFileFromTree,
  getTabByFileName,
} from '../../utils/testHelpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create an empty excalidraw file
  const excalidrawPath = path.join(workspaceDir, 'test.excalidraw');
  const initialContent = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  };
  await fs.writeFile(excalidrawPath, JSON.stringify(initialContent, null, 2), 'utf8');

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

test('autosave clears dirty indicator and saves content', async () => {
  const excalidrawPath = path.join(workspaceDir, 'test.excalidraw');

  // Open the excalidraw file
  await openFileFromTree(page, 'test.excalidraw');

  // Wait for the Excalidraw editor to load
  await page.waitForSelector('.excalidraw-editor', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Add an element via the API
  await page.evaluate((filePath) => {
    const getEditorAPI = (window as any).__excalidraw_getEditorAPI;
    if (getEditorAPI) {
      const api = getEditorAPI(filePath);
      if (api) {
        api.updateScene({
          elements: [
            {
              id: 'autosave-test-rect',
              type: 'rectangle',
              x: 100,
              y: 100,
              width: 200,
              height: 100,
              backgroundColor: 'transparent',
              strokeColor: '#1e1e1e',
            },
          ],
        });
      }
    }
  }, excalidrawPath);

  await page.waitForTimeout(500);

  // Verify dirty indicator appears
  const tabElement = getTabByFileName(page, 'test.excalidraw');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 2000 });

  // Wait for autosave (2s interval + 200ms debounce + buffer)
  await page.waitForTimeout(3500);

  // Verify dirty indicator cleared
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0, { timeout: 1000 });

  // Verify content saved to disk
  const savedContent = await fs.readFile(excalidrawPath, 'utf-8');
  const parsed = JSON.parse(savedContent);
  expect(parsed.elements.length).toBeGreaterThan(0);
  expect(parsed.elements[0].id).toBe('autosave-test-rect');
});
