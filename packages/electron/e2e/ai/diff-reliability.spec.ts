/**
 * Diff Reliability E2E Tests
 *
 * Tests the DiffPlugin's ability to handle various edge cases and complex scenarios
 * that commonly cause edit application failures. Uses the AI tool simulator to test
 * without requiring actual AI API calls.
 *
 * These tests align with the diff-plugin-reliability.md plan and help identify
 * failure modes in the diff application system.
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS,
  waitForAppReady,
  ACTIVE_EDITOR_SELECTOR,
  ACTIVE_FILE_TAB_SELECTOR
} from '../helpers';
import {
  simulateApplyDiff,
  simulateStreamContent,
  waitForEditorReady,
  createTestMarkdown,
  triggerManualSave,
  waitForSave
} from '../utils/aiToolSimulator';
import * as fs from 'fs/promises';
import * as path from 'path';


test.describe('Diff Reliability - Complex Structures', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFilePath: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    testFilePath = path.join(workspaceDir, 'test.md');

    // Create initial test file before launching app
    await fs.writeFile(testFilePath, '# Test\n\nInitial content.\n', 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should handle nested list edits', async () => {
    const content = `# Shopping List

- Fruits
  - Apples
  - Bananas
  - Oranges
- Vegetables
  - Carrots
  - Broccoli
`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Try to add a nested item
    const result = await simulateApplyDiff(page, testFilePath, [
      { oldText: '  - Oranges', newText: '  - Oranges\n  - Grapes' }
    ]);

    expect(result.success).toBe(true);

    // Accept the suggested changes
    await page.click('button:has-text("Accept All")');
    await page.waitForTimeout(200);

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    // Verify the change was applied to disk
    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('Grapes');
  });

  test('should handle table row additions', async () => {
    const content = `# Data Table

| Name | Age | City |
|------|-----|------|
| Alice | 30 | NYC |
| Bob | 25 | LA |
`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Add a new row
    const result = await simulateApplyDiff(page, testFilePath, [
      {
        oldText: '| Bob | 25 | LA |',
        newText: '| Bob | 25 | LA |\n| Charlie | 35 | SF |'
      }
    ]);

    expect(result.success).toBe(true);

    // Accept the suggested changes
    await page.click('button:has-text("Accept All")');
    await page.waitForTimeout(200);

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('Charlie');
  });

  test('should handle code block modifications', async () => {
    const content = `# Code Example

\`\`\`javascript
function hello() {
  console.log("Hello");
}
\`\`\`
`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Modify code block content
    const result = await simulateApplyDiff(page, testFilePath, [
      {
        oldText: '  console.log("Hello");',
        newText: '  console.log("Hello");\n  console.log("World");'
      }
    ]);

    expect(result.success).toBe(true);

    // Accept the suggested changes
    await page.click('button:has-text("Accept All")');
    await page.waitForTimeout(200);

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('World');
  });

  test('should handle mixed content type sections', async () => {
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

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Modify multiple sections
    const result = await simulateApplyDiff(page, testFilePath, [
      { oldText: '- List item 2', newText: '- List item 2\n- List item 3' },
      { oldText: 'More text here.', newText: 'More text here with additions.' }
    ]);

    expect(result.success).toBe(true);

    // Accept the suggested changes
    await page.click('button:has-text("Accept All")');
    await page.waitForTimeout(200);

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('List item 3');
    expect(updatedContent).toContain('with additions');
  });

  test('should handle deeply nested structures', async () => {
    const content = `# Nested Structure

- Level 1
  - Level 2
    - Level 3
      - Level 4
        - Level 5
`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Modify deep nested item
    const result = await simulateApplyDiff(page, testFilePath, [
      { oldText: '        - Level 5', newText: '        - Level 5 Modified' }
    ]);

    expect(result.success).toBe(true);

    // Accept the suggested changes
    await page.click('button:has-text("Accept All")');
    await page.waitForTimeout(200);

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('Level 5 Modified');
  });

  test('should handle whitespace-sensitive changes', async () => {
    const content = `# Whitespace Test

This is a paragraph with    multiple    spaces.

Another paragraph.
`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Modify text with whitespace
    const result = await simulateApplyDiff(page, testFilePath, [
      {
        oldText: 'This is a paragraph with    multiple    spaces.',
        newText: 'This is a paragraph with single spaces.'
      }
    ]);

    expect(result.success).toBe(true);

    // Accept the suggested changes
    await page.click('button:has-text("Accept All")');
    await page.waitForTimeout(200);

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('single spaces');
  });
});

test.describe('Diff Reliability - Streaming Scenarios', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFilePath: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    testFilePath = path.join(workspaceDir, 'test.md');

    // Create initial test file before launching app
    await fs.writeFile(testFilePath, '# Test\n\nInitial content.\n', 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should handle streaming list additions', async () => {
    const content = `# Task List

- Task 1
- Task 2
`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Stream a new list item
    await simulateStreamContent(page, '\n- Task 3\n- Task 4', { insertAtEnd: true });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('Task 3');
    expect(updatedContent).toContain('Task 4');
  });

  test('should handle streaming into middle of document', async () => {
    const content = `# Section 1

Content 1

# Section 2

Content 2
`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Stream content into the middle
    await simulateStreamContent(
      page,
      '\n\nNew paragraph in section 1',
      { insertAfter: 'Content 1' }
    );

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('New paragraph in section 1');
  });

  test('should handle streaming complex markdown structures', async () => {
    const content = `# Document

Initial content.
`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
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
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('New Section');
    expect(updatedContent).toContain('List item 1');
    expect(updatedContent).toContain('console.log');
  });

  test('should handle rapid successive streaming operations', async () => {
    const content = `# Notes

`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Stream multiple chunks rapidly
    for (let i = 1; i <= 5; i++) {
      await simulateStreamContent(page, `\n- Note ${i}`, { insertAtEnd: true });
      await page.waitForTimeout(100);
    }

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    for (let i = 1; i <= 5; i++) {
      expect(updatedContent).toContain(`Note ${i}`);
    }
  });
});

test.describe('Diff Reliability - Edge Cases', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;
  let testFilePath: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();
    testFilePath = path.join(workspaceDir, 'test.md');

    // Create initial test file before launching app
    await fs.writeFile(testFilePath, '# Test\n\nInitial content.\n', 'utf8');

    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should handle empty document edits', async () => {
    await fs.writeFile(testFilePath, '', 'utf8');
    await page.click('text=test.md');
    await waitForEditorReady(page);

    // Add content to empty document
    await simulateStreamContent(page, '# New Document\n\nFirst content.', { insertAtEnd: true });

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('New Document');
  });

  test('should handle very long lines', async () => {
    const longLine = 'A'.repeat(500);
    const content = `# Long Lines\n\n${longLine}\n`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Modify the long line
    const result = await simulateApplyDiff(page, testFilePath, [
      { oldText: longLine, newText: longLine + ' Modified' }
    ]);

    expect(result.success).toBe(true);
  });

  test('should handle special characters in content', async () => {
    const content = `# Special Characters

Text with *asterisks* and _underscores_ and [brackets].

More text with \`backticks\` and |pipes|.
`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, testFilePath, [
      {
        oldText: 'More text with `backticks` and |pipes|.',
        newText: 'More text with `backticks` and |pipes| and ~tildes~.'
      }
    ]);

    expect(result.success).toBe(true);

    // Accept the suggested changes
    await page.click('button:has-text("Accept All")');
    await page.waitForTimeout(200);

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('tildes');
  });

  test('should handle formatting boundaries', async () => {
    const content = `# Formatting

**Bold text** followed by *italic text* and ~~strikethrough~~.
`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    const result = await simulateApplyDiff(page, testFilePath, [
      {
        oldText: '**Bold text** followed by *italic text*',
        newText: '**Bold text** followed by *italic text* and `code`'
      }
    ]);

    expect(result.success).toBe(true);
  });

  test('should handle multiple simultaneous edits', async () => {
    const content = `# Multiple Sections

## Section A
Content A

## Section B
Content B

## Section C
Content C
`;

    await fs.writeFile(testFilePath, content, 'utf8');
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator(ACTIVE_FILE_TAB_SELECTOR)).toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await waitForEditorReady(page);

    // Apply multiple edits at once
    const result = await simulateApplyDiff(page, testFilePath, [
      { oldText: 'Content A', newText: 'Content A Modified' },
      { oldText: 'Content B', newText: 'Content B Modified' },
      { oldText: 'Content C', newText: 'Content C Modified' }
    ]);

    expect(result.success).toBe(true);

    // Accept the suggested changes
    await page.click('button:has-text("Accept All")');
    await page.waitForTimeout(200);

    // Save the document
    await triggerManualSave(electronApp);
    await waitForSave(page, 'test.md');

    const updatedContent = await fs.readFile(testFilePath, 'utf8');
    expect(updatedContent).toContain('Content A Modified');
    expect(updatedContent).toContain('Content B Modified');
    expect(updatedContent).toContain('Content C Modified');
  });
});
