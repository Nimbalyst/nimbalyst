/**
 * Monaco Editor External Change E2E Test
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

// Selector for the VISIBLE Monaco editor (inside the visible tab wrapper)
const VISIBLE_MONACO_SELECTOR = '.file-tabs-container .tab-editor-wrapper:not([style*="display: none"]) .monaco-code-editor';

/**
 * Helper to get Monaco editor content
 */
async function getMonacoContent(page: Page, timeout = 5000): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await page.evaluate(() => {
      const monaco = (window as any).monaco;
      const editors = monaco?.editor?.getEditors();
      if (editors && editors.length > 0) {
        return { source: 'monaco-api', content: editors[0].getValue() };
      }

      const monacoWrapper = document.querySelector('.monaco-code-editor');
      if (monacoWrapper) {
        const lines = monacoWrapper.querySelectorAll('.view-line');
        if (lines.length > 0) {
          const rawContent = Array.from(lines).map(l => l.textContent || '').join('\n');
          return { source: 'view-lines', content: rawContent.replace(/\u00A0/g, ' ') };
        }
      }

      return null;
    });

    if (result !== null && result.content.length > 0) {
      return result.content;
    }

    await page.waitForTimeout(200);
  }

  return '';
}

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a TypeScript file
  const tsPath = path.join(workspaceDir, 'test.ts');
  await fs.writeFile(tsPath, '// Original content\nconst x = 1;\n', 'utf8');

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
  const tsPath = path.join(workspaceDir, 'test.ts');
  const externalContent = '// Modified externally\nconst y = 2;\n';

  // Open the TypeScript file
  await openFileFromTree(page, 'test.ts');

  // Wait for Monaco editor to load
  await page.waitForSelector(VISIBLE_MONACO_SELECTOR, { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await page.waitForTimeout(500);

  // Verify no dirty indicator (editor is clean)
  const tabElement = getTabByFileName(page, 'test.ts');
  await expect(tabElement.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0);

  // Verify original content
  const initialContent = await getMonacoContent(page);
  expect(initialContent).toContain('Original content');

  // Modify file externally
  await fs.writeFile(tsPath, externalContent, 'utf8');

  // Wait for file watcher to detect and reload
  await page.waitForTimeout(1500);

  // Verify editor shows new content (no conflict dialog)
  const updatedContent = await getMonacoContent(page);
  expect(updatedContent).toContain('Modified externally');
  expect(updatedContent).not.toContain('Original content');
});
