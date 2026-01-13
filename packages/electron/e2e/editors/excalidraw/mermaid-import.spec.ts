/**
 * Excalidraw Mermaid Import E2E Test
 *
 * Tests that Mermaid diagrams can be imported into Excalidraw.
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
} from '../../helpers';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a test .excalidraw file
  const excalidrawPath = path.join(workspaceDir, 'test-mermaid.excalidraw');
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

  await dismissProjectTrustToast(page);
});

test.afterEach(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('should import a simple mermaid diagram without crashing', async () => {
  // Open the excalidraw file
  await page.click('text=test-mermaid.excalidraw');
  await page.waitForSelector('.excalidraw-editor', { timeout: 10000 });

  // Track console errors
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  // Call the Mermaid import tool through getEditorAPI
  const excalidrawPath = path.join(workspaceDir, 'test-mermaid.excalidraw');
  const result = await page.evaluate(async (filePath) => {
    const mermaid = `graph TD
      A[Start] --> B[Process]
      B --> C[End]`;

    try {
      const getEditorAPI = (window as any).__excalidraw_getEditorAPI;
      const parseMermaidToExcalidraw = (window as any).__excalidraw_parseMermaidToExcalidraw;

      if (!getEditorAPI || !parseMermaidToExcalidraw) {
        return { success: false, error: 'Extension API not found' };
      }

      const api = getEditorAPI(filePath);
      if (!api) {
        return { success: false, error: 'No active editor' };
      }

      const { elements } = await parseMermaidToExcalidraw(mermaid, { fontSize: 16 });

      const currentElements = api.getSceneElements();

      const elementsBefore = currentElements.length;
      api.updateScene({ elements: [...currentElements, ...elements] });
      const elementsAfter = api.getSceneElements().length;

      return {
        success: true,
        elementCount: elements.length,
        elementTypes: elements.map(e => e.type),
        elementsBefore,
        elementsAfter,
        allElements: api.getSceneElements().map(e => ({ type: e.type, text: 'text' in e ? e.text : undefined }))
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, excalidrawPath);

  console.log('Mermaid import result:', JSON.stringify(result, null, 2));
  if (!result.success) {
    console.error('Import failed:', result.error);
  }
  expect(result).toHaveProperty('success', true);

  // Wait for rendering
  await page.waitForTimeout(1000);

  // Move mouse over the canvas to trigger handleCanvasPointerMove
  const canvas = await page.locator('.excalidraw-editor').boundingBox();
  if (canvas) {
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.waitForTimeout(500);
  }

  // Check that no length errors occurred
  const lengthErrors = errors.filter(e => e.includes('Cannot read properties of undefined (reading \'length\')'));
  expect(lengthErrors).toHaveLength(0);
});
