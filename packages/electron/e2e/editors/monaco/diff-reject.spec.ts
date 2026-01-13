/**
 * Monaco Editor Diff Reject E2E Test
 *
 * Tests that when rejecting AI edits to a code file,
 * the editor reverts to the original content.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS,
} from '../../helpers';
import { PLAYWRIGHT_TEST_SELECTORS } from '../../utils/testHelpers';

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

test.describe('Monaco Editor - Diff Reject', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFilePath: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    testFilePath = path.join(workspaceDir, 'App.tsx');

    // Create test file BEFORE launching app
    const originalContent = `function hello() {
  console.log("Original content");
  return true;
}
`;
    await fs.writeFile(testFilePath, originalContent, 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('rejecting diff reverts to original content', async () => {
    const originalContent = `function hello() {
  console.log("Original content");
  return true;
}
`;

    // Step 1: Create a tag (simulating PreToolUse hook)
    const tagId = 'ai-edit-pending-monaco-reject-test';

    await page.evaluate(async ({ filePath, tagId, content }) => {
      await window.electronAPI.history.createTag?.(
        filePath,
        tagId,
        content,
        'test-session',
        'tool123'
      );
    }, { filePath: testFilePath, tagId, content: originalContent });

    // Step 2: Open the file in Monaco editor
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'App.tsx' }).click();

    // Wait for Monaco editor container
    await page.waitForSelector('.monaco-code-editor', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Step 3: Verify original content loads
    const initialText = await getMonacoContent(page);
    expect(initialText).toContain('Original content');

    // Step 4: Modify file on disk (simulating AI edit)
    const newContent = `function hello() {
  console.log("Modified by AI");
  return false;
}
`;
    await fs.writeFile(testFilePath, newContent, 'utf8');

    // Step 5: Wait for file watcher to detect change
    await page.waitForTimeout(1000);

    // Step 6: Verify diff mode is active (Monaco uses UnifiedDiffHeader)
    const unifiedDiffHeader = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader);
    await expect(unifiedDiffHeader).toBeVisible({ timeout: 5000 });

    // Step 7: Reject all changes (click "Revert All" button)
    const rejectButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffRejectAllButton);
    await expect(rejectButton).toBeVisible({ timeout: 3000 });
    await rejectButton.click();

    // Wait for diff to be reverted
    await page.waitForTimeout(500);

    // Step 8: Verify editor content is now the original content
    const finalEditorText = await getMonacoContent(page);
    expect(finalEditorText).toContain('Original content');
    expect(finalEditorText).not.toContain('Modified by AI');

    // Step 9: Verify content on disk was reverted
    await page.waitForTimeout(500);
    const diskContent = await fs.readFile(testFilePath, 'utf8');
    expect(diskContent).toContain('Original content');
    expect(diskContent).not.toContain('Modified by AI');
  });
});
