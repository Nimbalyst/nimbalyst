/**
 * Excalidraw Save on Close Test
 *
 * Tests that edited content is saved when closing the tab
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
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  openFileFromTree,
  closeTabByFileName,
  getTabByFileName,
} from '../utils/testHelpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create an Excalidraw file with minimal content
  const excalidrawPath = path.join(workspaceDir, 'test.excalidraw');
  const initialContent = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [],
    appState: {
      viewBackgroundColor: '#ffffff',
    },
    files: {},
  }, null, 2);
  await fs.writeFile(excalidrawPath, initialContent, 'utf8');

  // Launch with alpha release channel so Excalidraw extension loads
  electronApp = await launchElectronApp({
    workspace: workspaceDir,
    env: { NIMBALYST_RELEASE_CHANNEL: 'alpha' }
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);

  // Dismiss project trust toast if it appears
  await dismissProjectTrustToast(page);
});

test.afterEach(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('edited content is saved when tab is closed', async () => {
  const excalidrawPath = path.join(workspaceDir, 'test.excalidraw');

  // Open the Excalidraw file using helper
  await openFileFromTree(page, 'test.excalidraw');

  // Wait for the Excalidraw canvas to load
  await page.waitForSelector('.excalidraw', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(1000); // Give Excalidraw time to fully initialize

  // Wait for the Excalidraw canvas to be ready
  const canvas = page.locator('.excalidraw canvas').first();
  await canvas.waitFor({ state: 'visible' });
  await page.waitForTimeout(500); // Extra time for Excalidraw to initialize

  // Use Excalidraw's API to add an element programmatically
  // This is more reliable than simulating mouse events
  const elementAdded = await page.evaluate((testFilePath: string) => {
    // Find the Excalidraw API from the global registry
    const getEditorAPI = (window as any).__excalidraw_getEditorAPI;
    if (!getEditorAPI) {
      console.error('No Excalidraw getEditorAPI found');
      return false;
    }

    const api = getEditorAPI(testFilePath);
    if (!api || !api.updateScene) {
      console.error('Excalidraw API not ready for path:', testFilePath);
      return false;
    }

    console.log('Found Excalidraw API for:', testFilePath);

    // Create a rectangle element
    const rectangle = {
      id: 'test-rectangle-' + Date.now(),
      type: 'rectangle',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      angle: 0,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      fillStyle: 'hachure',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: Math.floor(Math.random() * 100000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 100000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
    };

    // Get current elements and add the new one
    const currentElements = api.getSceneElements() || [];
    api.updateScene({
      elements: [...currentElements, rectangle],
    });

    console.log('Added rectangle, total elements:', currentElements.length + 1);
    return true;
  }, excalidrawPath);

  expect(elementAdded).toBe(true);

  // Wait for dirty indicator to appear
  const tabElement = getTabByFileName(page, 'test.excalidraw');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 3000 });

  // Close the tab using helper (clicks close button, waits for tab to disappear)
  await closeTabByFileName(page, 'test.excalidraw');

  // Wait for save to complete (async save via IPC)
  await page.waitForTimeout(500);

  // Read the file and check the content
  const savedContent = await fs.readFile(excalidrawPath, 'utf-8');
  const savedData = JSON.parse(savedContent);

  console.log('Saved elements count:', savedData.elements.length);

  // Verify the content was saved - should have at least one element (the rectangle)
  expect(savedData.elements.length).toBeGreaterThan(0);

  // Verify the element is a rectangle
  const rectangle = savedData.elements.find((el: any) => el.type === 'rectangle');
  expect(rectangle).toBeDefined();
});
