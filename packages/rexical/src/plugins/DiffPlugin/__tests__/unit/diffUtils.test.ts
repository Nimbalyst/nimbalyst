/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import {
    $convertToMarkdownString,
    TRANSFORMERS,
} from '@lexical/markdown';
import {parsePatch} from 'diff';
import {$getRoot, $isElementNode, LexicalEditor, LexicalNode} from 'lexical';
import {createTestEditor} from '../utils';

import {$approveDiffs, $getDiffState, applyMarkdownDiff} from '../../core/index';
import {
  applyParsedDiffToMarkdown,
  generateUnifiedDiff,
} from '../../core/standardDiffFormat';
import { $convertFromEnhancedMarkdownString, $convertToEnhancedMarkdownString } from "@/markdown";

/**
 * Utility function to set up markdown diff tests.
 * Creates an editor, initializes it with the originalMarkdown,
 * applies the markdownDiff, and returns the editor for testing.
 */
function setupMarkdownDiffTest(
  originalMarkdown: string,
  markdownDiff: string,
): LexicalEditor {
  const editor = createTestEditor();

  // const editor = createHeadlessEditor({
  //   nodes: [
  //     DEFAULT_NODES,
  //     ...getDiffNodes(),
  //     ParagraphNode,
  //     TextNode,
  //     ListNode,
  //     ListItemNode,
  //     HeadingNode,
  //     QuoteNode,
  //     CodeNode,
  //     LinkNode,
  //   ],
  //   onError: (error) => {
  //     throw error;
  //   },
  // });

  // Initialize editor with original content
  editor.update(
    () => {
      const root = $getRoot();
      root.clear(); // Clear is OK here as we're initializing the test
        $convertFromEnhancedMarkdownString(
        originalMarkdown,
        TRANSFORMERS,
        root,
      );
    },
    {discrete: true},
  );

  // Apply the markdown diff
  applyMarkdownDiff(editor, markdownDiff, TRANSFORMERS);

  return editor;
}

describe('Markdown Diff', () => {
  test('Applies markdown diff to paragraph correctly', async () => {
    // Define the original and modified markdown
    const originalMarkdown = 'This is the original paragraph.';
    const markdownDiff =
      '---\n+++ \n@@ -1,1 +1,1 @@\n-This is the original paragraph.\n+This is the modified paragraph.';

    // First verify the diff parsing works correctly
    const expectedMarkdown = applyParsedDiffToMarkdown(
      originalMarkdown,
      markdownDiff,
    );

    // Create editor and apply diff
    const testEditor = setupMarkdownDiffTest(originalMarkdown, markdownDiff);

    // Verify the diff was applied correctly
    testEditor.getEditorState().read(() => {
      const root = $getRoot();
      const content = root.getTextContent();

      // Get all nodes and check for DiffState markers
      const allNodes: LexicalNode[] = [];
      root.getChildren().forEach((node: LexicalNode) => {
        if ($isElementNode(node)) {
          node
            .getChildren()
            .forEach((child: LexicalNode) => allNodes.push(child));
        }
      });

      const hasRemoveNode = allNodes.some(
        (node) => $getDiffState(node) === 'removed',
      );
      const hasAddNode = allNodes.some(
        (node) => $getDiffState(node) === 'added',
      );

      // Check that nodes were properly marked for removal and addition
      expect(hasRemoveNode).toBe(true);
      expect(hasAddNode).toBe(true);
      expect(content).toContain('modified');
    });

    // Apply the diff
    testEditor.update(
      () => {
        $approveDiffs(testEditor);
      },
      {discrete: true},
    );

    // Compare final editor output to expected markdown
    const resultingMarkdown = testEditor.getEditorState().read(() => {
      return $convertToEnhancedMarkdownString(TRANSFORMERS);
    });
    expect(resultingMarkdown.trim()).toEqual(expectedMarkdown.trim());
  });

  test('List And Paragraph Diff', async () => {
    const initialMarkdown = `# List and Paragraph Test
- List Item

This is a paragraph.`;
    const markdownDiff = `--- a/list.md
+++ b/list.md
@@ -1,4 +1,4 @@
 # List and Paragraph Test
-- List Item
+- List Item (updated)
 
-This is a paragraph.
+This is an updated paragraph.
`;

    // First verify the diff parsing works correctly
    const expectedMarkdown = applyParsedDiffToMarkdown(
      initialMarkdown,
      markdownDiff,
    );

    const testEditor = setupMarkdownDiffTest(initialMarkdown, markdownDiff);

    // Apply the diff to see final result
    testEditor.update(
      () => {
        $approveDiffs(testEditor);
      },
      {discrete: true},
    );

    const updatedMarkdown = testEditor.getEditorState().read(() => {
      return $convertToEnhancedMarkdownString(TRANSFORMERS);
    });

    // Compare final editor output to expected markdown
    expect(updatedMarkdown.trim()).toEqual(expectedMarkdown.trim());

    await testEditor.getEditorState().read(() => {
      const root = $getRoot();
      const content = root.getTextContent();

      expect(content).toContain('updated');

      expect(content).toContain('List Item (updated)');
      expect(content).toContain('This is an updated paragraph.');
      expect(content).not.toContain('List Item\n'); // Check for exact line ending
      expect(content).not.toContain('This is a paragraph.');
    });
  });

  test('Applies markdown diff to lists correctly', async () => {
    // Define the original markdown with a list
    const originalMarkdown = `# List Test
- First item
- Second item that will be modified
- Third item that will be removed
- Fourth item`;

    // Define the unified diff
    const markdownDiff = `---
+++ 
@@ -1,5 +1,4 @@
 # List Test
-- First item
-- Second item that will be modified
-- Third item that will be removed
+- New first item
+- Second item that has been modified
 - Fourth item
\\ No newline at end of file`;

    // First verify the diff parsing works correctly
    const expectedMarkdown = applyParsedDiffToMarkdown(
      originalMarkdown,
      markdownDiff,
    );

    // Verify the updated markdown has the expected changes
    expect(expectedMarkdown).toContain('New first item');
    expect(expectedMarkdown).toContain('Second item that has been modified');
    expect(expectedMarkdown).not.toContain('Third item that will be removed');

    // Now test with the editor using our utility
    const testEditor = setupMarkdownDiffTest(originalMarkdown, markdownDiff);

    // Verify the diff was applied correctly
    testEditor.getEditorState().read(() => {
      const root = $getRoot();
      const allContent = root.getTextContent();

      // Look for diff state markers to verify the diff was applied
      const allNodes: LexicalNode[] = [];
      root.getChildren().forEach((node: LexicalNode) => {
        if ($isElementNode(node)) {
          node.getChildren().forEach((child: LexicalNode) => {
            allNodes.push(child);
            if ($isElementNode(child)) {
              child
                .getChildren()
                .forEach((grandchild: LexicalNode) =>
                  allNodes.push(grandchild),
                );
            }
          });
        }
      });

      const hasRemoveNode = allNodes.some(
        (node) => $getDiffState(node) === 'removed',
      );
      const hasAddNode = allNodes.some(
        (node) => $getDiffState(node) === 'added',
      );

      // Check that nodes were properly marked for removal and addition
      expect(hasRemoveNode).toBe(true);
      expect(hasAddNode).toBe(true);
      expect(allContent).toContain('First');
      expect(allContent).toContain('Fourth item');
    });

    // Apply the diff
    testEditor.update(
      () => {
        $approveDiffs(testEditor);
      },
      {discrete: true},
    );

    // Verify the changes after approval
    await testEditor.getEditorState().read(() => {
      const root = $getRoot();
      const postApproveContent = root.getTextContent();
      expect(postApproveContent).toContain('New first item');
      expect(postApproveContent).toContain(
        'Second item that has been modified',
      );
      expect(postApproveContent).not.toContain(
        'Third item that will be removed',
      );
    });

    const resultingMarkdown = testEditor.getEditorState().read(() => {
      return $convertToEnhancedMarkdownString(TRANSFORMERS);
    });
    expect(resultingMarkdown.trim()).toEqual(expectedMarkdown.trim());
  });

  test('Applies markdown diff with new first list item correctly', async () => {
    // This test specifically checks that a new first item is inserted at the beginning
    // of the list, not above the header or in the wrong position
    const originalMarkdown = `# List Test
- First item
- Second item that will be modified
- Third item that will be removed
- Fourth item`;

    const bulletListDiff = `---
+++ 
@@ -1,5 +1,4 @@
 # List Test
-- First item
-- Second item that will be modified
-- Third item that will be removed
+- New first item
+- Second item that has been modified
 - Fourth item`;
    const parsedDiff = parsePatch(bulletListDiff);
    console.log(parsedDiff);

    // First verify the diff parsing works correctly
    const expectedMarkdown = applyParsedDiffToMarkdown(
      originalMarkdown,
      bulletListDiff,
    );

    // Create editor and apply diff
    const testEditor = setupMarkdownDiffTest(originalMarkdown, bulletListDiff);

    // Verify the diff was applied correctly
    testEditor.getEditorState().read(() => {
      const root = $getRoot();
      // const allContent = root.getTextContent();

      // Look for add/remove nodes to verify the diff was applied
      const allNodes: LexicalNode[] = [];
      root.getChildren().forEach((node: LexicalNode) => {
        if ($isElementNode(node)) {
          node.getChildren().forEach((child: LexicalNode) => {
            allNodes.push(child);
            if ($isElementNode(child)) {
              child
                .getChildren()
                .forEach((grandchild: LexicalNode) =>
                  allNodes.push(grandchild),
                );
            }
          });
        }
      });

      const hasRemoveNode = allNodes.some(
        (node) => $getDiffState(node) === 'removed',
      );
      const hasAddNode = allNodes.some(
        (node) => $getDiffState(node) === 'added',
      );

      // Check that nodes were properly marked for removal and addition
      expect(hasRemoveNode).toBe(true);
      expect(hasAddNode).toBe(true);
    });

    // Apply the diff to see final result
    testEditor.update(
      () => {
        $approveDiffs(testEditor);
      },
      {discrete: true},
    );

    // Compare final editor output to expected markdown
    const resultingMarkdown = testEditor.getEditorState().read(() => {
      return $convertToEnhancedMarkdownString(TRANSFORMERS);
    });

    expect(resultingMarkdown.trim()).toEqual(expectedMarkdown.trim());
  });

  test('Applies markdown diff to mixed content correctly', async () => {
    // Define the original markdown with a list item followed by a paragraph
    const originalMarkdown = `- List item that will be updated

This is a paragraph that will also be updated.`;

    // Define the unified diff
    const markdownDiff = `---
+++ 
@@ -1,3 +1,3 @@
-- List item that will be updated
+- List item that has been updated
 
-This is a paragraph that will also be updated.
+This is a paragraph that has now been updated.`;

    // First verify the diff parsing works correctly
    const expectedMarkdown = applyParsedDiffToMarkdown(
      originalMarkdown,
      markdownDiff,
    );

    // Create editor and apply diff
    const testEditor = setupMarkdownDiffTest(originalMarkdown, markdownDiff);

    // Verify the diff was applied correctly
    testEditor.getEditorState().read(() => {
      const root = $getRoot();
      const allContent = root.getTextContent();

      // Check diff markers were applied
      const allNodes: LexicalNode[] = [];
      root.getChildren().forEach((node: LexicalNode) => {
        if ($isElementNode(node)) {
          node.getChildren().forEach((child: LexicalNode) => {
            allNodes.push(child);
            if ($isElementNode(child)) {
              child
                .getChildren()
                .forEach((grandchild: LexicalNode) =>
                  allNodes.push(grandchild),
                );
            }
          });
        }
      });

      const hasRemoveNode = allNodes.some(
        (node) => $getDiffState(node) === 'removed',
      );
      const hasAddNode = allNodes.some(
        (node) => $getDiffState(node) === 'added',
      );

      // Check that both types of markers are present
      expect(hasRemoveNode).toBe(true);
      expect(hasAddNode).toBe(true);

      // The content should contain both old and new text when getTextContent() is called
      // because remove and add nodes both contribute to the text content
      expect(allContent).toContain('will be');
      expect(allContent).toContain('has been');
      expect(allContent).toContain('will also be');
      expect(allContent).toContain('has now been');
    });

    // Apply the diff to see final result
    testEditor.update(
      () => {
        $approveDiffs(testEditor);
      },
      {discrete: true},
    );

    // sleep for 1 second
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const updatedMarkdown = testEditor.getEditorState().read(() => {
      return $convertToEnhancedMarkdownString(TRANSFORMERS);
    });

    // Compare final editor output to expected markdown
    expect(updatedMarkdown.trim()).toEqual(expectedMarkdown.trim());

    // Verify the changes after approval
    await testEditor.getEditorState().read(() => {
      const root = $getRoot();
      const postApproveContent = root.getTextContent();
      expect(postApproveContent).toContain('List item that has been updated');
      expect(postApproveContent).not.toContain(
        'List item that will be updated',
      );
      expect(postApproveContent).toContain(
        'paragraph that has now been updated',
      );
      expect(postApproveContent).not.toContain(
        'paragraph that will also be updated',
      );
    });
  });

  test('Applies list diff with item removal correctly', async () => {
    // This test specifically covers the case where a list item is completely removed
    // and should not appear in the final content after approval
    const originalMarkdown = `# List Test
- First item
- Second item that will be modified
- Third item that will be removed
- Fourth item`;

    const markdownDiff = `---
+++ 
@@ -1,5 +1,4 @@
 # List Test
-- First item
-- Second item that will be modified
-- Third item that will be removed
+- New first item
+- Second item that has been modified
 - Fourth item
\\ No newline at end of file`;

    // First verify the diff parsing works correctly
    const expectedMarkdown = applyParsedDiffToMarkdown(
      originalMarkdown,
      markdownDiff,
    );

    // Verify the updated markdown has the expected changes
    expect(expectedMarkdown).toContain('New first item');
    expect(expectedMarkdown).toContain('Second item that has been modified');
    expect(expectedMarkdown).not.toContain('Third item that will be removed');

    // Create editor and apply diff
    const testEditor = setupMarkdownDiffTest(originalMarkdown, markdownDiff);

    // Verify the diff was applied correctly - should have RemoveNode for third item
    testEditor.getEditorState().read(() => {
      const root = $getRoot();
      const allNodes: LexicalNode[] = [];

      // Collect all nodes including deeply nested ones
      function collectNodes(node: LexicalNode) {
        allNodes.push(node);
        if ($isElementNode(node)) {
          node.getChildren().forEach(collectNodes);
        }
      }

      root.getChildren().forEach(collectNodes);

      const removeNodes = allNodes.filter(
        (node) => $getDiffState(node) === 'removed',
      );
      const addNodes = allNodes.filter(
        (node) => $getDiffState(node) === 'added',
      );

      // Should have RemoveNode markers including one for "Third item that will be removed"
      expect(removeNodes.length).toBeGreaterThan(0);
      expect(addNodes.length).toBeGreaterThan(0);

      // Specifically check that "Third item that will be removed" is marked for removal
      const thirdItemRemoveNode = removeNodes.find(
        (node) => node.getTextContent() === 'Third item that will be removed',
      );
      expect(thirdItemRemoveNode).toBeDefined();
    });

    // Apply the diff (approve changes)
    testEditor.update(
      () => {
        $approveDiffs(testEditor);
      },
      {discrete: true},
    );

    // Verify the changes after approval - "Third item that will be removed" should be gone
    await testEditor.getEditorState().read(() => {
      const root = $getRoot();
      const postApproveContent = root.getTextContent();

      expect(postApproveContent).toContain('New first item');
      expect(postApproveContent).toContain(
        'Second item that has been modified',
      );
      expect(postApproveContent).toContain('Fourth item');
      expect(postApproveContent).not.toContain(
        'Third item that will be removed',
      );
    });

    // Verify the final markdown matches expected
    const resultingMarkdown = testEditor.getEditorState().read(() => {
      return $convertToEnhancedMarkdownString(TRANSFORMERS);
    });
    expect(resultingMarkdown.trim()).toEqual(expectedMarkdown.trim());
  });

  test('Applies comprehensive markdown diff with multiple element types correctly', async () => {
    const originalMarkdown = `# Main Document Title

This is an introductory paragraph that explains the purpose of this document. It contains some important information that will be modified.

## First Section

Here we have some content in the first section. This text will undergo several changes during our diff test.

- First list item
- Second list item that needs updating
- Third list item to be removed
- Fourth list item

### Subsection A

This subsection contains detailed information about topic A. The content here is quite comprehensive and covers multiple aspects.

### Subsection B

Similarly, this subsection covers topic B with relevant details and explanations.

## Second Section

The second section provides additional context and information. This paragraph will be modified to demonstrate diff capabilities.

1. Numbered item one
2. Numbered item two
3. Numbered item three

## Conclusion

This concluding section summarizes the key points discussed throughout the document.`;

    // Define the target markdown with all the changes we want
    const targetMarkdown = `# Updated Document Title

This is a revised introductory paragraph that explains the updated purpose of this document. It contains enhanced important information.

## First Section

Here we have updated content in the first section. This text has undergone several improvements during our diff test.

- First list item
- Second list item that has been updated
- New third list item
- Fourth list item
- Additional fifth list item

### Subsection A

This subsection contains enhanced detailed information about topic A. The content here is now more comprehensive and covers additional aspects.

### Subsection B

Similarly, this subsection covers topic B with relevant details and explanations.

## Second Section

The second section provides enhanced context and comprehensive information. This paragraph has been modified to better demonstrate diff capabilities.

1. Numbered item one
2. Updated numbered item two
3. Numbered item three
4. New numbered item four

### New Subsection

This is a completely new subsection added through the diff process.

## Conclusion

This concluding section provides an enhanced summary of the key points discussed throughout the document.`;

    // Generate a proper unified diff using the diff library
    const markdownDiff = generateUnifiedDiff(originalMarkdown, targetMarkdown);

    // First verify the diff parsing works correctly
    const expectedMarkdown = applyParsedDiffToMarkdown(
      originalMarkdown,
      markdownDiff,
    );

    // Verify the updated markdown has the expected changes
    expect(expectedMarkdown).toContain('Updated Document Title');
    expect(expectedMarkdown).toContain('revised introductory paragraph');
    expect(expectedMarkdown).toContain(
      'Second list item that has been updated',
    );
    expect(expectedMarkdown).toContain('New third list item');
    expect(expectedMarkdown).toContain('Additional fifth list item');
    expect(expectedMarkdown).toContain('enhanced detailed information');
    expect(expectedMarkdown).toContain('Updated numbered item two');
    expect(expectedMarkdown).toContain('New numbered item four');
    expect(expectedMarkdown).toContain('New Subsection');
    expect(expectedMarkdown).toContain('enhanced summary');

    // Now test with the editor using our utility
    const testEditor = setupMarkdownDiffTest(originalMarkdown, markdownDiff);

    // Apply the diff
    testEditor.update(
      () => {
        $approveDiffs(testEditor);
      },
      {discrete: true},
    );

    // Compare final editor output to expected markdown
    const resultingMarkdown = testEditor.getEditorState().read(() => {
      return $convertToEnhancedMarkdownString(TRANSFORMERS);
    });
    expect(resultingMarkdown.trim()).toEqual(expectedMarkdown.trim());
  });
});
