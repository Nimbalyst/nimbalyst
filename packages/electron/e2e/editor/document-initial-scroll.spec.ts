import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR, waitForAppReady } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Editor - Document Initial Scroll Position', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should load document at the top when it contains a code block', async () => {
    // Create a markdown document with enough content that the code block is off-screen
    // This ensures we can detect if the editor auto-scrolls to the code block
    const documentContent = `# Document Title

This is the first paragraph at the top of the document. This content should be visible when the document loads.

## Section 1

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## Section 2

Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

## Section 3

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

## Section 4

Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

## Section 5

More content to push the code block further down the page so it requires scrolling to see it.

## Section 6

Additional paragraph content to ensure the code block is well below the fold.

## Section 7

Even more content here to make sure we have enough vertical space.

## Section 8

The code block should be far enough down that it's not visible without scrolling.

\`\`\`javascript
// This is a code block that should be off-screen initially
function example() {
  console.log('Hello world');
  console.log('This code block is far down the page');
}
\`\`\`

## Section 9

More content after the code block.

## Section 10

Final section at the bottom.`;

    await fs.writeFile(path.join(workspaceDir, 'test-code-block.md'), documentContent, 'utf8');

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();
    await waitForAppReady(page);

    // Wait for file tree to load
    await page.locator('.file-tree-name', { hasText: 'test-code-block.md' }).first().waitFor({ timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });

    // Open the file
    await page.locator('.file-tree-name', { hasText: 'test-code-block.md' }).click();

    // Wait for editor to load
    const editor = page.locator(ACTIVE_EDITOR_SELECTOR);
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Check scroll position at multiple intervals to catch the auto-scroll behavior
    const checkScrollPosition = async (label: string) => {
      return await page.evaluate((lbl) => {
        // Check the actual scrollable element - the .editor-scroller div
        const editorScroller = document.querySelector('.file-tabs-container .multi-editor-instance.active .editor-scroller');

        const position = editorScroller ? {
          scrollTop: editorScroller.scrollTop,
          scrollHeight: editorScroller.scrollHeight,
          clientHeight: editorScroller.clientHeight
        } : null;

        console.log(`[${lbl}] Editor scroller position:`, position);

        return {
          label: lbl,
          editorScrollerPosition: position
        };
      }, label);
    };

    // Check immediately after editor is visible
    const position1 = await checkScrollPosition('Immediately after editor visible');

    // Wait 500ms and check again
    await page.waitForTimeout(500);
    const position2 = await checkScrollPosition('After 500ms');

    // Wait another 1000ms and check again (total 1500ms)
    await page.waitForTimeout(1000);
    const position3 = await checkScrollPosition('After 1500ms');

    // Wait another 1500ms and check again (total 3000ms)
    await page.waitForTimeout(1500);
    const position4 = await checkScrollPosition('After 3000ms');

    // Log all results for debugging
    console.log('Scroll position tracking:', {
      position1: position1?.editorScrollerPosition,
      position2: position2?.editorScrollerPosition,
      position3: position3?.editorScrollerPosition,
      position4: position4?.editorScrollerPosition
    });

    // Verify that the editor-scroller element is scrolled to the top
    const finalScrollTop = position4?.editorScrollerPosition?.scrollTop ?? 0;
    expect(finalScrollTop).toBe(0);

    // Additionally, verify that the title is visible in the viewport
    const titleVisible = await page.evaluate(() => {
      const editorContainer = document.querySelector('.file-tabs-container .multi-editor-instance.active .editor');
      const title = editorContainer?.querySelector('h1');
      if (!title || !editorContainer) return false;

      const titleRect = title.getBoundingClientRect();
      const containerRect = editorContainer.getBoundingClientRect();

      // Check if the title is within the visible area of the container
      return (
        titleRect.top >= containerRect.top &&
        titleRect.bottom <= containerRect.bottom
      );
    });

    expect(titleVisible).toBe(true);
  });
});
