/**
 * Monaco Editor Diff Accept E2E Test
 *
 * Tests the file-watcher-based diff approval system for code files (Monaco editor):
 * 1. Create a code file with original content
 * 2. Tag file as "pending-review" (simulating AI PreToolUse hook)
 * 3. Open file in Monaco editor
 * 4. Verify original content loads correctly
 * 5. Modify file on disk (simulating AI edit)
 * 6. File watcher detects change
 * 7. Monaco shows diff view with pending changes
 * 8. Accept all changes
 * 9. Verify accepted changes are now in editor and on disk
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
 * Uses multiple methods to find the editor content with retry logic
 */
async function getMonacoContent(page: Page, timeout = 5000): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await page.evaluate(() => {
      // Method 1: Try global monaco API
      const monaco = (window as any).monaco;
      const editors = monaco?.editor?.getEditors();
      if (editors && editors.length > 0) {
        return { source: 'monaco-api', content: editors[0].getValue() };
      }

      // Method 2: Try getting from view lines (fallback)
      // Note: view-lines use non-breaking spaces (charCode 160), need to normalize
      const monacoWrapper = document.querySelector('.monaco-code-editor');
      if (monacoWrapper) {
        const lines = monacoWrapper.querySelectorAll('.view-line');
        if (lines.length > 0) {
          const rawContent = Array.from(lines).map(l => l.textContent || '').join('\n');
          // Replace non-breaking spaces with regular spaces
          const normalizedContent = rawContent.replace(/\u00A0/g, ' ');
          return { source: 'view-lines', content: normalizedContent };
        }
      }

      return null;
    });

    if (result !== null && result.content.length > 0) {
      return result.content;
    }

    await page.waitForTimeout(200);
  }

  // Final fallback - get text from view-lines
  return await page.evaluate(() => {
    const monacoWrapper = document.querySelector('.monaco-code-editor');
    if (monacoWrapper) {
      const lines = monacoWrapper.querySelectorAll('.view-line');
      if (lines.length > 0) {
        const rawContent = Array.from(lines).map(l => l.textContent || '').join('\n');
        // Replace non-breaking spaces with regular spaces
        return rawContent.replace(/\u00A0/g, ' ');
      }
    }
    return '';
  });
}

test.describe('Monaco Editor - Diff Accept', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFilePath: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    testFilePath = path.join(workspaceDir, 'App.tsx');

    // CRITICAL: Create test file BEFORE launching app
    const originalContent = `function hello() {
  console.log("Original content");
  return true;
}
`;
    await fs.writeFile(testFilePath, originalContent, 'utf8');

    // Launch Electron app with workspace
    electronApp = await launchElectronApp({ workspace: workspaceDir });

    // Get the first window and wait for app to be ready
    page = await electronApp.firstWindow();

    // Capture browser console for debugging
    page.on('console', msg => {
      const text = msg.text();
      const type = msg.type();
      if (type === 'error' || type === 'warning' ||
          text.includes('TabEditor') || text.includes('Monaco') ||
          text.includes('DiffPlugin') || text.includes('AI edit') || text.includes('ERROR')) {
        console.log(`BROWSER [${type}]:`, text);
      }
    });

    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should show diff when code file has pending AI edit tag', async () => {
    console.log('[TEST] Starting Monaco file-watcher diff approval test');

    // Step 1: Create a tag (simulating PreToolUse hook)
    const tagId = 'ai-edit-pending-monaco-test';
    const originalContent = `function hello() {
  console.log("Original content");
  return true;
}
`;

    console.log('[TEST] Creating pending tag...');
    await page.evaluate(async ({ filePath, tagId, content }) => {
      console.log('[TEST EVAL] Creating tag:', { filePath, tagId });
      await window.electronAPI.history.createTag?.(
        filePath,
        tagId,
        content,
        'test-session',
        'tool123'
      );
      console.log('[TEST EVAL] Tag created');
    }, { filePath: testFilePath, tagId, content: originalContent });

    // Step 2: Open the file in Monaco editor
    console.log('[TEST] Opening file in Monaco editor...');
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: 'App.tsx' }).click();

    // Wait for Monaco editor container
    await page.waitForSelector('.monaco-code-editor', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
    await page.waitForTimeout(500);

    // Step 3: Verify original content loads in Monaco
    console.log('[TEST] Verifying original content...');
    const initialText = await getMonacoContent(page);

    console.log('[TEST] Initial Monaco content:', initialText);
    expect(initialText).toContain('Original content');

    // Step 4: Modify file on disk (simulating AI edit)
    const newContent = `function hello() {
  console.log("Modified by AI");
  return false;
}
`;
    console.log('[TEST] Writing modified content to disk...');
    await fs.writeFile(testFilePath, newContent, 'utf8');

    // Step 5: Wait for file watcher to detect change
    console.log('[TEST] Waiting for file watcher to trigger diff...');
    await page.waitForTimeout(1000);

    // Check if pending tags were found
    const pendingTagsCheck = await page.evaluate(async ({ filePath }) => {
      const tags = await window.electronAPI.history.getPendingTags?.(filePath);
      console.log('[TEST EVAL] Pending tags found:', tags);
      return tags;
    }, { filePath: testFilePath });
    console.log('[TEST] Pending tags check:', pendingTagsCheck);

    // Step 6: Verify diff mode is active
    // Monaco now uses UnifiedDiffHeader for diff approval
    console.log('[TEST] Checking for unified diff header...');
    const unifiedDiffHeader = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader);
    await expect(unifiedDiffHeader).toBeVisible({ timeout: 5000 });

    // Verify Monaco is in diff mode by checking for the diff editor container
    const hasDiffEditor = await page.evaluate(() => {
      // Monaco diff editor adds specific classes
      const diffContainer = document.querySelector('.monaco-diff-editor');
      console.log('[TEST EVAL] Monaco diff editor present:', !!diffContainer);
      return !!diffContainer;
    });

    console.log('[TEST] Monaco diff editor active:', hasDiffEditor);
    expect(hasDiffEditor).toBe(true);

    // Step 7: Accept all changes (click "Keep All" button)
    console.log('[TEST] Accepting all changes...');
    const acceptAllButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton);
    await expect(acceptAllButton).toBeVisible({ timeout: 3000 });
    await acceptAllButton.click();

    // Wait for diff to be applied
    await page.waitForTimeout(500);

    // Step 8: Verify tag status was updated to 'reviewed'
    console.log('[TEST] Checking tag status...');
    const tagStatus = await page.evaluate(async ({ filePath, tagId }) => {
      const tag = await window.electronAPI.history.getTag?.(filePath, tagId);
      console.log('[TEST EVAL] Tag after approval:', tag);
      return tag?.status;
    }, { filePath: testFilePath, tagId });

    expect(tagStatus).toBe('reviewed');
    console.log('[TEST] Tag marked as reviewed');

    // Step 9: Verify editor content is now the accepted content
    console.log('[TEST] Verifying accepted content in editor...');
    const finalEditorText = await getMonacoContent(page);

    console.log('[TEST] Final editor content:', finalEditorText);
    expect(finalEditorText).toContain('Modified by AI');
    expect(finalEditorText).not.toContain('Original content');

    // Step 10: Verify content was saved to disk
    console.log('[TEST] Verifying content on disk...');
    // Wait a moment for save to complete
    await page.waitForTimeout(500);

    const diskContent = await fs.readFile(testFilePath, 'utf8');
    console.log('[TEST] Disk content:', diskContent);
    expect(diskContent).toContain('Modified by AI');

    console.log('[TEST] Monaco diff approval test - SUCCESS!');
  });
});
