/**
 * Basic Excalidraw extension test
 *
 * Verifies that the Excalidraw extension can:
 * 1. Load .excalidraw files without errors
 * 2. Display the Excalidraw editor
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
} from '../helpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a test .excalidraw file
  const excalidrawPath = path.join(workspaceDir, 'test-diagram.excalidraw');
  const initialContent = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [],
    appState: {
      viewBackgroundColor: '#ffffff',
    },
    files: {},
  };
  await fs.writeFile(excalidrawPath, JSON.stringify(initialContent, null, 2), 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
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

test('can open excalidraw file without errors', async () => {
  // Open the excalidraw file by clicking in the file tree
  await page.click('text=test-diagram.excalidraw');

  // Wait for the Excalidraw editor container to load
  await page.waitForSelector('.excalidraw-editor', { timeout: 10000 });

  // Verify the editor is visible
  const excalidrawContainer = page.locator('.excalidraw-editor');
  await expect(excalidrawContainer).toBeVisible();

  // Wait a bit to ensure the Excalidraw component renders without errors
  await page.waitForTimeout(2000);

  // Verify the actual Excalidraw canvas loaded
  const excalidrawCanvas = page.locator('.excalidraw');
  await expect(excalidrawCanvas).toBeVisible();
});
