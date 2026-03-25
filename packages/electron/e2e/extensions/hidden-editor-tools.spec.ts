/**
 * Hidden Editor Tool Execution E2E Tests
 *
 * Tests that AI agents can use extension MCP tools (e.g., Excalidraw)
 * against files that are NOT open in a visible tab. The HiddenTabManager
 * mounts editors offscreen and the extension's API registers, allowing
 * tools to execute transparently.
 *
 * Uses __nimbalyst_extension_tools__ (dev-mode only) to call
 * executeExtensionTool directly through the same bridge as MCP tool calls.
 *
 * Run with: npx playwright test e2e/extensions/hidden-editor-tools.spec.ts
 * Requires: Nimbalyst dev server running (npm run dev)
 */

import { test, expect } from '@nimbalyst/extension-sdk/testing';
import * as path from 'path';
import * as fs from 'fs';

function createExcalidrawFile() {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [{
      id: 'seed-rect', type: 'rectangle',
      x: 10, y: 10, width: 100, height: 50,
      strokeColor: '#1e1e1e', backgroundColor: 'transparent',
      fillStyle: 'solid', strokeWidth: 2, roughness: 1, opacity: 100,
      angle: 0, groupIds: [], frameId: null,
      roundness: { type: 3 }, boundElements: [],
      updated: 1700000000000, link: null, locked: false,
      version: 1, versionNonce: 1, isDeleted: false, seed: 12345,
    }],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  }, null, 2);
}

test('hidden editor: read, write, and verify without visible tab', async ({ page }) => {
  const workspacePath = await page.evaluate(async () => {
    const state = await (window as any).electronAPI.getInitialState?.();
    return state?.workspacePath || '';
  });
  if (!workspacePath) {
    test.skip(true, 'No workspace path available');
    return;
  }

  // Unique filename to avoid cache collisions between runs
  const testFileName = `hidden-e2e-${Date.now()}.excalidraw`;
  const testFilePath = path.join(workspacePath, testFileName);
  fs.writeFileSync(testFilePath, createExcalidrawFile(), 'utf8');

  // Helper: call extension tool through the dev-mode bridge
  async function callTool(toolName: string, args: Record<string, unknown> = {}) {
    return page.evaluate(
      async ({ toolName, args, testFilePath, workspacePath }: any) => {
        const bridge = (window as any).__nimbalyst_extension_tools__;
        if (!bridge?.executeExtensionTool) throw new Error('Extension tools bridge not available (dev mode only)');
        return bridge.executeExtensionTool('excalidraw.' + toolName, { ...args, filePath: testFilePath }, {
          workspacePath,
          activeFilePath: testFilePath,
        });
      },
      { toolName, args, testFilePath, workspacePath }
    );
  }

  // Helper: check tab bar for excalidraw files
  async function hasExcalidrawTab(): Promise<boolean> {
    const tabs = await page.locator('[data-testid="tab-title"], .tab-title').allTextContents();
    return tabs.some(t => t.includes('.excalidraw'));
  }

  try {
    // No excalidraw tab open before test
    expect(await hasExcalidrawTab()).toBe(false);

    // Read elements from closed file via hidden editor
    const readResult: any = await callTool('get_elements');
    expect(readResult.success).not.toBe(false);

    // No tab appeared after read
    expect(await hasExcalidrawTab()).toBe(false);

    // Write a new element
    const addResult: any = await callTool('add_rectangle', { label: 'E2ERect', x: 300, y: 300 });
    expect(addResult.success).not.toBe(false);
    expect(addResult.data?.id).toBeDefined();

    // Verify write by reading back
    const verifyResult: any = await callTool('get_elements');
    const labels = (verifyResult.data?.elements || [])
      .map((e: any) => (e.label || '').replace(/\n/g, ''))
      .filter(Boolean);
    expect(labels).toContain('E2ERect');

    // Still no tab after write
    expect(await hasExcalidrawTab()).toBe(false);

    // Verify changes persisted to disk (auto-save with 100ms debounce)
    await new Promise(r => setTimeout(r, 500));
    const diskContent = fs.readFileSync(testFilePath, 'utf8');
    const diskData = JSON.parse(diskContent);
    expect(diskData.elements.length).toBeGreaterThanOrEqual(2);
  } finally {
    try { fs.unlinkSync(testFilePath); } catch { /* ignore */ }
  }
});
