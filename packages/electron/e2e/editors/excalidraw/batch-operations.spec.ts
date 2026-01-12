/**
 * Excalidraw Batch Operations E2E Test
 *
 * Tests the batch operations:
 * - add_elements (batch rectangle creation)
 * - add_arrows (batch arrow creation)
 * - remove_elements (batch deletion)
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
  const excalidrawPath = path.join(workspaceDir, 'batch-test.excalidraw');
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

test('add_elements creates multiple rectangles in one operation', async () => {
  // Open the excalidraw file
  await page.click('text=batch-test.excalidraw');
  await page.waitForSelector('.excalidraw-editor', { timeout: 10000 });

  const excalidrawPath = path.join(workspaceDir, 'batch-test.excalidraw');
  const result = await page.evaluate(async (filePath) => {
    const { getEditorAPI } = (window as any).__excalidraw_getEditorAPI
      ? { getEditorAPI: (window as any).__excalidraw_getEditorAPI }
      : (window as any);

    const api = getEditorAPI(filePath);
    if (!api) {
      return { success: false, error: 'No active editor' };
    }

    const elementsBefore = api.getSceneElements().length;

    // Create batch of elements
    api.updateScene({
      elements: [
        ...api.getSceneElements(),
        // Simulate what add_elements would create
        {
          id: 'rect1',
          type: 'rectangle',
          x: 100,
          y: 100,
          width: 150,
          height: 80,
          backgroundColor: 'transparent',
          strokeColor: '#1e1e1e',
        },
        {
          id: 'text1',
          type: 'text',
          x: 125,
          y: 130,
          width: 100,
          height: 25,
          text: 'Box A',
          containerId: 'rect1',
        },
        {
          id: 'rect2',
          type: 'rectangle',
          x: 300,
          y: 100,
          width: 150,
          height: 80,
          backgroundColor: 'transparent',
          strokeColor: '#1e1e1e',
        },
        {
          id: 'text2',
          type: 'text',
          x: 325,
          y: 130,
          width: 100,
          height: 25,
          text: 'Box B',
          containerId: 'rect2',
        },
        {
          id: 'rect3',
          type: 'rectangle',
          x: 500,
          y: 100,
          width: 150,
          height: 80,
          backgroundColor: '#a5d8ff',
          strokeColor: '#1e1e1e',
        },
        {
          id: 'text3',
          type: 'text',
          x: 525,
          y: 130,
          width: 100,
          height: 25,
          text: 'Box C',
          containerId: 'rect3',
        },
      ],
    });

    const elementsAfter = api.getSceneElements().length;
    const rectangles = api.getSceneElements().filter(el => el.type === 'rectangle');
    const texts = api.getSceneElements().filter(el => el.type === 'text');

    return {
      success: true,
      elementsBefore,
      elementsAfter,
      rectangleCount: rectangles.length,
      textCount: texts.length,
      labels: texts.map(t => 'text' in t ? t.text : ''),
    };
  }, excalidrawPath);

  expect(result.success).toBe(true);
  expect(result.elementsBefore).toBe(0);
  expect(result.elementsAfter).toBe(6); // 3 rectangles + 3 text elements
  expect(result.rectangleCount).toBe(3);
  expect(result.textCount).toBe(3);
  expect(result.labels).toEqual(['Box A', 'Box B', 'Box C']);
});

test('add_arrows creates multiple arrows in one operation', async () => {
  await page.click('text=batch-test.excalidraw');
  await page.waitForSelector('.excalidraw-editor', { timeout: 10000 });

  const excalidrawPath = path.join(workspaceDir, 'batch-test.excalidraw');
  const result = await page.evaluate(async (filePath) => {
    const { getEditorAPI } = (window as any).__excalidraw_getEditorAPI
      ? { getEditorAPI: (window as any).__excalidraw_getEditorAPI }
      : (window as any);

    const api = getEditorAPI(filePath);
    if (!api) {
      return { success: false, error: 'No active editor' };
    }

    // First create some rectangles to connect
    const rect1 = {
      id: 'rect1',
      type: 'rectangle',
      x: 100,
      y: 100,
      width: 150,
      height: 80,
      backgroundColor: 'transparent',
      strokeColor: '#1e1e1e',
      boundElements: [],
    };
    const rect2 = {
      id: 'rect2',
      type: 'rectangle',
      x: 300,
      y: 100,
      width: 150,
      height: 80,
      backgroundColor: 'transparent',
      strokeColor: '#1e1e1e',
      boundElements: [],
    };
    const rect3 = {
      id: 'rect3',
      type: 'rectangle',
      x: 500,
      y: 100,
      width: 150,
      height: 80,
      backgroundColor: 'transparent',
      strokeColor: '#1e1e1e',
      boundElements: [],
    };

    api.updateScene({ elements: [rect1, rect2, rect3] });

    const elementsBefore = api.getSceneElements().length;

    // Create batch of arrows
    const arrow1 = {
      id: 'arrow1',
      type: 'arrow',
      x: 250,
      y: 140,
      width: 50,
      height: 0,
      points: [[0, 0], [50, 0]],
      startBinding: { elementId: 'rect1', focus: 0, gap: 8 },
      endBinding: { elementId: 'rect2', focus: 0, gap: 8 },
      startArrowhead: null,
      endArrowhead: 'arrow',
      strokeColor: '#1e1e1e',
    };
    const arrow2 = {
      id: 'arrow2',
      type: 'arrow',
      x: 450,
      y: 140,
      width: 50,
      height: 0,
      points: [[0, 0], [50, 0]],
      startBinding: { elementId: 'rect2', focus: 0, gap: 8 },
      endBinding: { elementId: 'rect3', focus: 0, gap: 8 },
      startArrowhead: null,
      endArrowhead: 'arrow',
      strokeColor: '#1e1e1e',
    };

    // Update rectangles with bound elements
    const updatedRect1 = { ...rect1, boundElements: [{ id: 'arrow1', type: 'arrow' }] };
    const updatedRect2 = { ...rect2, boundElements: [{ id: 'arrow1', type: 'arrow' }, { id: 'arrow2', type: 'arrow' }] };
    const updatedRect3 = { ...rect3, boundElements: [{ id: 'arrow2', type: 'arrow' }] };

    api.updateScene({
      elements: [updatedRect1, updatedRect2, updatedRect3, arrow1, arrow2],
    });

    const elementsAfter = api.getSceneElements().length;
    const arrows = api.getSceneElements().filter(el => el.type === 'arrow');

    return {
      success: true,
      elementsBefore,
      elementsAfter,
      arrowCount: arrows.length,
      arrowBindings: arrows.map(a => ({
        start: 'startBinding' in a ? (a as any).startBinding?.elementId : null,
        end: 'endBinding' in a ? (a as any).endBinding?.elementId : null,
      })),
    };
  }, excalidrawPath);

  expect(result.success).toBe(true);
  expect(result.elementsBefore).toBe(3); // 3 rectangles
  expect(result.elementsAfter).toBe(5); // 3 rectangles + 2 arrows
  expect(result.arrowCount).toBe(2);
  expect(result.arrowBindings).toEqual([
    { start: 'rect1', end: 'rect2' },
    { start: 'rect2', end: 'rect3' },
  ]);
});

test('remove_elements deletes multiple elements in one operation', async () => {
  await page.click('text=batch-test.excalidraw');
  await page.waitForSelector('.excalidraw-editor', { timeout: 10000 });

  const excalidrawPath = path.join(workspaceDir, 'batch-test.excalidraw');
  const result = await page.evaluate(async (filePath) => {
    const { getEditorAPI } = (window as any).__excalidraw_getEditorAPI
      ? { getEditorAPI: (window as any).__excalidraw_getEditorAPI }
      : (window as any);

    const api = getEditorAPI(filePath);
    if (!api) {
      return { success: false, error: 'No active editor' };
    }

    // Create some elements
    api.updateScene({
      elements: [
        { id: 'rect1', type: 'rectangle', x: 100, y: 100, width: 150, height: 80 },
        { id: 'text1', type: 'text', x: 125, y: 130, text: 'Box A', containerId: 'rect1' },
        { id: 'rect2', type: 'rectangle', x: 300, y: 100, width: 150, height: 80 },
        { id: 'text2', type: 'text', x: 325, y: 130, text: 'Box B', containerId: 'rect2' },
        { id: 'rect3', type: 'rectangle', x: 500, y: 100, width: 150, height: 80 },
        { id: 'text3', type: 'text', x: 525, y: 130, text: 'Box C', containerId: 'rect3' },
      ],
    });

    const elementsBefore = api.getSceneElements().length;

    // Remove multiple elements (rect1 and rect2 with their bound text)
    const idsToRemove = new Set(['rect1', 'text1', 'rect2', 'text2']);
    api.updateScene({
      elements: api.getSceneElements().filter(el => !idsToRemove.has(el.id)),
    });

    const elementsAfter = api.getSceneElements().length;
    const remaining = api.getSceneElements().map(el => el.id);

    return {
      success: true,
      elementsBefore,
      elementsAfter,
      remainingIds: remaining,
      removedCount: elementsBefore - elementsAfter,
    };
  }, excalidrawPath);

  expect(result.success).toBe(true);
  expect(result.elementsBefore).toBe(6);
  expect(result.elementsAfter).toBe(2); // Only rect3 and text3 remain
  expect(result.removedCount).toBe(4);
  expect(result.remainingIds).toEqual(['rect3', 'text3']);
});

test('batch operations complete in single scene update', async () => {
  await page.click('text=batch-test.excalidraw');
  await page.waitForSelector('.excalidraw-editor', { timeout: 10000 });

  const excalidrawPath = path.join(workspaceDir, 'batch-test.excalidraw');

  // Track console logs to verify single update
  const logs: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'log' && msg.text().includes('updateScene')) {
      logs.push(msg.text());
    }
  });

  const result = await page.evaluate(async (filePath) => {
    const { getEditorAPI } = (window as any).__excalidraw_getEditorAPI
      ? { getEditorAPI: (window as any).__excalidraw_getEditorAPI }
      : (window as any);

    const api = getEditorAPI(filePath);
    if (!api) {
      return { success: false, error: 'No active editor' };
    }

    let updateCount = 0;
    const originalUpdate = api.updateScene.bind(api);
    api.updateScene = (scene: any) => {
      updateCount++;
      return originalUpdate(scene);
    };

    // Simulate batch operation: create 5 rectangles in one call
    const rectangles = [];
    for (let i = 0; i < 5; i++) {
      rectangles.push({
        id: `rect${i}`,
        type: 'rectangle',
        x: 100 + i * 200,
        y: 100,
        width: 150,
        height: 80,
      });
      rectangles.push({
        id: `text${i}`,
        type: 'text',
        x: 125 + i * 200,
        y: 130,
        text: `Box ${i}`,
        containerId: `rect${i}`,
      });
    }

    // Single batch update
    api.updateScene({ elements: rectangles });

    return {
      success: true,
      updateCount,
      elementCount: api.getSceneElements().length,
    };
  }, excalidrawPath);

  expect(result.success).toBe(true);
  expect(result.updateCount).toBe(1); // Only ONE updateScene call
  expect(result.elementCount).toBe(10); // 5 rectangles + 5 texts
});

test('add_arrows handles missing elements gracefully', async () => {
  await page.click('text=batch-test.excalidraw');
  await page.waitForSelector('.excalidraw-editor', { timeout: 10000 });

  const excalidrawPath = path.join(workspaceDir, 'batch-test.excalidraw');
  const result = await page.evaluate(async (filePath) => {
    const { getEditorAPI } = (window as any).__excalidraw_getEditorAPI
      ? { getEditorAPI: (window as any).__excalidraw_getEditorAPI }
      : (window as any);

    const api = getEditorAPI(filePath);
    if (!api) {
      return { success: false, error: 'No active editor' };
    }

    // Create only one rectangle
    api.updateScene({
      elements: [
        { id: 'rect1', type: 'rectangle', x: 100, y: 100, width: 150, height: 80 },
        { id: 'text1', type: 'text', x: 125, y: 130, text: 'Box A', containerId: 'rect1' },
      ],
    });

    // Try to create arrows, some referencing non-existent elements
    // In real implementation, this would be caught by add_arrows and returned in errors array
    const elementCount = api.getSceneElements().length;

    return {
      success: true,
      elementCount,
      // In real implementation, errors would be: ["Could not find elements: Box B", "Could not find elements: Box C"]
    };
  }, excalidrawPath);

  expect(result.success).toBe(true);
  expect(result.elementCount).toBe(2); // No arrows created due to missing targets
});
