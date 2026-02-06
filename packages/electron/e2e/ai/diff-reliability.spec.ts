/**
 * Diff Reliability E2E Tests (Consolidated)
 *
 * Tests the DiffPlugin's ability to handle various edge cases and complex scenarios
 * that commonly cause edit application failures. Uses the AI tool simulator to test
 * without requiring actual AI API calls.
 *
 * These tests align with the diff-plugin-reliability.md plan and help identify
 * failure modes in the diff application system.
 *
 * CONSOLIDATION NOTES:
 * - All tests share a single app instance for performance
 * - Each test uses its own pre-created file to avoid state conflicts
 * - Tests close their tabs at the end to clean up for the next test
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
} from '../helpers';
import {
  simulateApplyDiff,
  simulateStreamContent,
  waitForEditorReady,
  triggerManualSave,
  waitForSave
} from '../utils/aiToolSimulator';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  openFileFromTree,
  closeTabByFileName,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

// Pre-created file paths for each test scenario
const TEST_FILES = {
  // Complex Structures
  nestedList: 'nested-list.md',
  tableRow: 'table-row.md',
  codeBlock: 'code-block.md',
  mixedContent: 'mixed-content.md',
  deeplyNested: 'deeply-nested.md',
  whitespace: 'whitespace.md',
  // Streaming Scenarios
  streamingList: 'streaming-list.md',
  streamingMiddle: 'streaming-middle.md',
  streamingComplex: 'streaming-complex.md',
  streamingRapid: 'streaming-rapid.md',
  // Edge Cases
  emptyDoc: 'empty-doc.md',
  longLines: 'long-lines.md',
  specialChars: 'special-chars.md',
  formatting: 'formatting.md',
  multipleEdits: 'multiple-edits.md',
};

// Initial content for files (can be overwritten by tests before opening)
const INITIAL_CONTENT = '# Test\n\nInitial content.\n';

// Use serial mode to prevent worker restarts on test failures
// This ensures all tests share the same Electron app instance
test.describe.configure({ mode: 'serial' });

// Shared state across all tests in this serial suite
let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create ALL test files upfront
  for (const fileName of Object.values(TEST_FILES)) {
    await fs.writeFile(path.join(workspaceDir, fileName), INITIAL_CONTENT, 'utf8');
  }

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);

  // Make window wider so diff header buttons render properly
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.setSize(1400, 900);
      win.center();
    }
  });
  await page.waitForTimeout(200);
});

test.afterAll(async () => {
  await electronApp?.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

// ============================================================================
// Complex Structures
// ============================================================================

test('should handle nested list edits', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.nestedList);
    const content = `# Shopping List

- Fruits
  - Apples
  - Bananas
  - Oranges
- Vegetables
  - Carrots
  - Broccoli
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.nestedList);
    await waitForEditorReady(page);

    // Try to add a nested item
    const result = await simulateApplyDiff(page, filePath, [
      { oldText: '  - Oranges', newText: '  - Oranges\n  - Grapes' }
    ]);

    expect(result.success).toBe(true);

    // Wait for unified diff header to appear
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

    // Accept the suggested changes (use unified diff header button)
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();

    // Wait for diff header to disappear (changes accepted)
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.nestedList);

    // Verify the change was applied to disk
    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('Grapes');

    // Clean up for next test
    await closeTabByFileName(page, TEST_FILES.nestedList);
  });

test('should handle table row additions', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.tableRow);
    const content = `# Data Table

| Name | Age | City |
|------|-----|------|
| Alice | 30 | NYC |
| Bob | 25 | LA |
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.tableRow);
    await waitForEditorReady(page);

    // Add a new row
    const result = await simulateApplyDiff(page, filePath, [
      {
        oldText: '| Bob | 25 | LA |',
        newText: '| Bob | 25 | LA |\n| Charlie | 35 | SF |'
      }
    ]);

    expect(result.success).toBe(true);

    // Wait for unified diff header to appear
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

    // Accept the suggested changes (use unified diff header button)
    // Note: Table diffs may require clicking twice due to a known Lexical bug
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();
    await page.waitForTimeout(300);

    // Click again if header is still visible (table diff bug workaround)
    const headerStillVisible = await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader).isVisible();
    if (headerStillVisible) {
      await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();
    }

    // Wait for diff header to disappear (changes accepted)
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.tableRow);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('Charlie');

    await closeTabByFileName(page, TEST_FILES.tableRow);
  });

test('should handle code block modifications', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.codeBlock);
    const content = `# Code Example

\`\`\`javascript
function hello() {
  console.log("Hello");
}
\`\`\`
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.codeBlock);
    await waitForEditorReady(page);

    // Modify code block content
    const result = await simulateApplyDiff(page, filePath, [
      {
        oldText: '  console.log("Hello");',
        newText: '  console.log("Hello");\n  console.log("World");'
      }
    ]);

    expect(result.success).toBe(true);

    // Wait for unified diff header to appear
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

    // Accept the suggested changes (use unified diff header button)
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();

    // Wait for diff header to disappear (changes accepted)
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.codeBlock);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('World');

    await closeTabByFileName(page, TEST_FILES.codeBlock);
  });

test('should handle mixed content type sections', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.mixedContent);
    const content = `# Mixed Content

Some text here.

- List item 1
- List item 2

\`\`\`python
def foo():
    pass
\`\`\`

More text here.
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.mixedContent);
    await waitForEditorReady(page);

    // Modify multiple sections
    const result = await simulateApplyDiff(page, filePath, [
      { oldText: '- List item 2', newText: '- List item 2\n- List item 3' },
      { oldText: 'More text here.', newText: 'More text here with additions.' }
    ]);

    expect(result.success).toBe(true);

    // Wait for unified diff header to appear
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

    // Accept the suggested changes (use unified diff header button)
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();

    // Wait for diff header to disappear (changes accepted)
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.mixedContent);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('List item 3');
    expect(updatedContent).toContain('with additions');

    await closeTabByFileName(page, TEST_FILES.mixedContent);
  });

test('should handle deeply nested structures', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.deeplyNested);
    const content = `# Nested Structure

- Level 1
  - Level 2
    - Level 3
      - Level 4
        - Level 5
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.deeplyNested);
    await waitForEditorReady(page);

    // Modify deep nested item
    const result = await simulateApplyDiff(page, filePath, [
      { oldText: '        - Level 5', newText: '        - Level 5 Modified' }
    ]);

    expect(result.success).toBe(true);

    // Wait for unified diff header to appear
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

    // Accept the suggested changes (use unified diff header button)
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();

    // Wait for diff header to disappear (changes accepted)
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.deeplyNested);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('Level 5 Modified');

    await closeTabByFileName(page, TEST_FILES.deeplyNested);
  });

test('should handle whitespace-sensitive changes', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.whitespace);
    const content = `# Whitespace Test

This is a paragraph with    multiple    spaces.

Another paragraph.
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.whitespace);
    await waitForEditorReady(page);

    // Modify text with whitespace
    const result = await simulateApplyDiff(page, filePath, [
      {
        oldText: 'This is a paragraph with    multiple    spaces.',
        newText: 'This is a paragraph with single spaces.'
      }
    ]);

    expect(result.success).toBe(true);

    // Wait for unified diff header to appear
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

    // Accept the suggested changes (use unified diff header button)
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();

    // Wait for diff header to disappear (changes accepted)
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.whitespace);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('single spaces');

    await closeTabByFileName(page, TEST_FILES.whitespace);
  });

// ============================================================================
// Streaming Scenarios
// ============================================================================

test('should handle streaming list additions', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.streamingList);
    const content = `# Task List

- Task 1
- Task 2
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.streamingList);
    await waitForEditorReady(page);

    // Stream a new list item
    await simulateStreamContent(page, '\n- Task 3\n- Task 4', { insertAtEnd: true });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.streamingList);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('Task 3');
    expect(updatedContent).toContain('Task 4');

    await closeTabByFileName(page, TEST_FILES.streamingList);
  });

test('should handle streaming into middle of document', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.streamingMiddle);
    const content = `# Section 1

Content 1

# Section 2

Content 2
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.streamingMiddle);
    await waitForEditorReady(page);

    // Stream content into the middle
    await simulateStreamContent(
      page,
      '\n\nNew paragraph in section 1',
      { insertAfter: 'Content 1' }
    );

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.streamingMiddle);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('New paragraph in section 1');

    await closeTabByFileName(page, TEST_FILES.streamingMiddle);
  });

test('should handle streaming complex markdown structures', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.streamingComplex);
    const content = `# Document

Initial content.
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.streamingComplex);
    await waitForEditorReady(page);

    // Stream a complex structure
    const complexContent = `

## New Section

This is a paragraph.

- List item 1
- List item 2

\`\`\`javascript
console.log("code");
\`\`\`
`;

    await simulateStreamContent(page, complexContent, { insertAtEnd: true });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.streamingComplex);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('New Section');
    expect(updatedContent).toContain('List item 1');
    expect(updatedContent).toContain('console.log');

    await closeTabByFileName(page, TEST_FILES.streamingComplex);
  });

test('should handle rapid successive streaming operations', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.streamingRapid);
    const content = `# Notes

`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.streamingRapid);
    await waitForEditorReady(page);

    // Stream multiple chunks rapidly
    for (let i = 1; i <= 5; i++) {
      await simulateStreamContent(page, `\n- Note ${i}`, { insertAtEnd: true });
      await page.waitForTimeout(100);
    }

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.streamingRapid);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    for (let i = 1; i <= 5; i++) {
      expect(updatedContent).toContain(`Note ${i}`);
    }

    await closeTabByFileName(page, TEST_FILES.streamingRapid);
  });

// ============================================================================
// Edge Cases
// ============================================================================

test('should handle empty document edits', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.emptyDoc);

    await fs.writeFile(filePath, '', 'utf8');
    await openFileFromTree(page, TEST_FILES.emptyDoc);
    await waitForEditorReady(page);

    // Add content to empty document
    await simulateStreamContent(page, '# New Document\n\nFirst content.', { insertAtEnd: true });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.emptyDoc);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('New Document');

    await closeTabByFileName(page, TEST_FILES.emptyDoc);
  });

test('should handle very long lines', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.longLines);
    const longLine = 'A'.repeat(500);
    const content = `# Long Lines\n\n${longLine}\n`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.longLines);
    await waitForEditorReady(page);

    // Modify the long line
    const result = await simulateApplyDiff(page, filePath, [
      { oldText: longLine, newText: longLine + ' Modified' }
    ]);

    expect(result.success).toBe(true);

    await closeTabByFileName(page, TEST_FILES.longLines);
  });

test('should handle special characters in content', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.specialChars);
    const content = `# Special Characters

Text with *asterisks* and _underscores_ and [brackets].

More text with \`backticks\` and |pipes|.
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.specialChars);
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, filePath, [
      {
        oldText: 'More text with `backticks` and |pipes|.',
        newText: 'More text with `backticks` and |pipes| and ~tildes~.'
      }
    ]);

    expect(result.success).toBe(true);

    // Wait for unified diff header to appear
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

    // Accept the suggested changes (use unified diff header button)
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();

    // Wait for diff header to disappear (changes accepted)
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.specialChars);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('tildes');

    await closeTabByFileName(page, TEST_FILES.specialChars);
  });

test('should handle formatting boundaries', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.formatting);
    const content = `# Formatting

**Bold text** followed by *italic text* and ~~strikethrough~~.
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.formatting);
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, filePath, [
      {
        oldText: '**Bold text** followed by *italic text*',
        newText: '**Bold text** followed by *italic text* and `code`'
      }
    ]);

    expect(result.success).toBe(true);

    await closeTabByFileName(page, TEST_FILES.formatting);
  });

test('should handle multiple simultaneous edits', async () => {
    const filePath = path.join(workspaceDir, TEST_FILES.multipleEdits);
    const content = `# Multiple Sections

## Section A
Content A

## Section B
Content B

## Section C
Content C
`;

    await fs.writeFile(filePath, content, 'utf8');
    await openFileFromTree(page, TEST_FILES.multipleEdits);
    await waitForEditorReady(page);

    // Apply multiple edits at once
    const result = await simulateApplyDiff(page, filePath, [
      { oldText: 'Content A', newText: 'Content A Modified' },
      { oldText: 'Content B', newText: 'Content B Modified' },
      { oldText: 'Content C', newText: 'Content C Modified' }
    ]);

    expect(result.success).toBe(true);

    // Wait for unified diff header to appear
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { timeout: 5000 });

    // Accept the suggested changes (use unified diff header button)
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffAcceptAllButton).click();

    // Wait for diff header to disappear (changes accepted)
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.unifiedDiffHeader, { state: 'hidden', timeout: 5000 });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, TEST_FILES.multipleEdits);

    const updatedContent = await fs.readFile(filePath, 'utf8');
    expect(updatedContent).toContain('Content A Modified');
    expect(updatedContent).toContain('Content B Modified');
    expect(updatedContent).toContain('Content C Modified');

    await closeTabByFileName(page, TEST_FILES.multipleEdits);
  });
