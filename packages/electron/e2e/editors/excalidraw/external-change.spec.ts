/**
 * Excalidraw External Change E2E Test
 *
 * Tests that external file changes auto-reload when editor is clean.
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

  // Create an excalidraw file with one element
  const excalidrawPath = path.join(workspaceDir, 'test.excalidraw');
  const initialContent = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [
      {
        id: 'original-rect',
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 100,
        height: 50,
        backgroundColor: 'transparent',
        strokeColor: '#1e1e1e',
      },
    ],
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

test('external file change auto-reloads when editor is clean', async () => {
  const excalidrawPath = path.join(workspaceDir, 'test.excalidraw');

  // Open the excalidraw file
  await openFileFromTree(page, 'test.excalidraw');

  // Wait for the Excalidraw editor to load
  await page.waitForSelector('.excalidraw-editor', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Wait for initial load and any auto-save to settle
  // IMPORTANT: Need to wait >2s AFTER the last save for the time-based echo detection heuristic to pass
  // Excalidraw may auto-save shortly after load, so we need to wait longer
  await page.waitForTimeout(3500);

  // Verify no dirty indicator (editor is clean)
  const tabElement = getTabByFileName(page, 'test.excalidraw');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0);

  // Verify original element count
  const initialElementCount = await page.evaluate((filePath) => {
    const getEditorAPI = (window as any).__excalidraw_getEditorAPI;
    if (getEditorAPI) {
      const api = getEditorAPI(filePath);
      if (api) {
        return api.getSceneElements().length;
      }
    }
    return -1;
  }, excalidrawPath);
  expect(initialElementCount).toBe(1);

  // Modify file externally - add a second element
  const modifiedContent = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [
      {
        id: 'original-rect',
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 100,
        height: 50,
        backgroundColor: 'transparent',
        strokeColor: '#1e1e1e',
      },
      {
        id: 'external-rect',
        type: 'rectangle',
        x: 200,
        y: 200,
        width: 150,
        height: 75,
        backgroundColor: '#a5d8ff',
        strokeColor: '#1e1e1e',
      },
    ],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  };
  await fs.writeFile(excalidrawPath, JSON.stringify(modifiedContent, null, 2), 'utf8');

  // Wait for file watcher to detect and reload
  await page.waitForTimeout(2000);

  // Verify editor shows new content (2 elements now)
  // Poll a few times since the file watcher + reload can take variable time
  let finalElementCount = -1;
  for (let attempt = 0; attempt < 5; attempt++) {
    finalElementCount = await page.evaluate((filePath) => {
      const getEditorAPI = (window as any).__excalidraw_getEditorAPI;
      if (getEditorAPI) {
        const api = getEditorAPI(filePath);
        if (api) {
          const elements = api.getSceneElements();
          console.log('[Test] Excalidraw element count:', elements.length, 'elements:', elements.map((e: any) => e.id));
          return elements.length;
        }
      }
      return -1;
    }, excalidrawPath);

    if (finalElementCount === 2) break;
    console.log(`[Test] Attempt ${attempt + 1}: element count = ${finalElementCount}, waiting...`);
    await page.waitForTimeout(500);
  }

  expect(finalElementCount).toBe(2);
});
