/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from '@lexical/markdown';
import {createHeadlessEditor} from '@lexical/headless';
import {$getRoot} from 'lexical';
import type {SerializedLexicalNode} from 'lexical';
import {createTestEditor} from '../utils';

// The original content
const ORIGINAL_MARKDOWN = `# Initial Header

Some paragraph text goes here

## Initial List
- One
- Two
    - Two Point Five
- Three

End Paragraph`;

// Modified version 1: Add a paragraph and bullet point
const MODIFIED_V1_MARKDOWN = `# Initial Header

Some paragraph text goes here

Added a new paragraph here!

## Initial List
- One
- Two
    - Two Point Five
    - Added nested item
- Three
- Four

End Paragraph`;

// Modified version 2: Remove some items
const MODIFIED_V2_MARKDOWN = `# Initial Header

Some paragraph text goes here

## Initial List
- One
- Three

End Paragraph`;

describe('Real World Diff Analysis', () => {
  let editor: any;

  beforeEach(() => {
    editor = createTestEditor();
  });

  function convertMarkdownToJSON(markdown: string): SerializedLexicalNode {
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        $convertFromMarkdownString(markdown, TRANSFORMERS, root, true, false);
      },
      {discrete: true},
    );

    return editor.getEditorState().toJSON().root as SerializedLexicalNode;
  }

  function printNodeStructure(
    node: SerializedLexicalNode,
    indent: string = '',
  ): string {
    let output = `${indent}${node.type}`;

    if (node.type === 'text' && 'text' in node) {
      output += `: "${(node as any).text}"`;
    } else if (node.type === 'heading' && 'tag' in node) {
      output += `: ${(node as any).tag}`;
    } else if (node.type === 'list' && 'listType' in node) {
      output += `: ${(node as any).listType}`;
    }

    output += '\n';

    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        output += printNodeStructure(child, indent + '  ');
      }
    }

    return output;
  }

  test('debug markdown conversion', () => {
    const simpleMarkdown = `# Hello World`;

    console.log('=== DEBUG SIMPLE MARKDOWN ===');
    console.log('Input markdown:', simpleMarkdown);

    editor.update(
      () => {
        const root = $getRoot();
        console.log('Root before clear:', root.getChildrenSize());
        root.clear();
        console.log('Root after clear:', root.getChildrenSize());

        try {
          $convertFromMarkdownString(
            simpleMarkdown,
            TRANSFORMERS,
            root,
            true,
            false,
          );
          console.log('Root after conversion:', root.getChildrenSize());
          console.log(
            'Root children types:',
            root.getChildren().map((child) => child.getType()),
          );
        } catch (error) {
          console.log('Error in conversion:', error);
        }
      },
      {discrete: true},
    );

    const result = editor.getEditorState().read(() => {
      const root = $getRoot();
      return {
        childCount: root.getChildrenSize(),
        children: root.getChildren().map((child) => ({
          type: child.getType(),
          text: child.getTextContent(),
        })),
        json: root.exportJSON(),
      };
    });

    console.log('Final result:', JSON.stringify(result, null, 2));

    // Test our convertMarkdownToJSON function
    const convertedJSON = convertMarkdownToJSON(simpleMarkdown);
    console.log('=== CONVERTED JSON ===');
    console.log(JSON.stringify(convertedJSON, null, 2));
  });

  test('analyze original markdown structure', () => {
    const originalJSON = convertMarkdownToJSON(ORIGINAL_MARKDOWN);

    console.log('=== ORIGINAL STRUCTURE ===');
    console.log(printNodeStructure(originalJSON));

    console.log('=== ORIGINAL JSON ===');
    console.log(JSON.stringify(originalJSON, null, 2));

    // Basic assertions to ensure it converted properly
    expect(originalJSON.type).toBe('root');
    expect(
      'children' in originalJSON && Array.isArray(originalJSON.children),
    ).toBe(true);
  });

  test('analyze modified v1 (additions) structure', () => {
    const originalJSON = convertMarkdownToJSON(ORIGINAL_MARKDOWN);
    const modifiedJSON = convertMarkdownToJSON(MODIFIED_V1_MARKDOWN);

    console.log('=== MODIFIED V1 (ADDITIONS) STRUCTURE ===');
    console.log(printNodeStructure(modifiedJSON));

    console.log('=== STRUCTURAL COMPARISON ===');
    console.log(
      'Original child count:',
      (originalJSON as any).children?.length,
    );
    console.log(
      'Modified child count:',
      (modifiedJSON as any).children?.length,
    );

    // Show specific differences
    const originalChildren = (originalJSON as any).children || [];
    const modifiedChildren = (modifiedJSON as any).children || [];

    console.log('\n=== CHILD-BY-CHILD COMPARISON ===');
    const maxLength = Math.max(
      originalChildren.length,
      modifiedChildren.length,
    );

    for (let i = 0; i < maxLength; i++) {
      const origChild = originalChildren[i];
      const modChild = modifiedChildren[i];

      console.log(`Index ${i}:`);
      console.log(
        `  Original: ${
          origChild
            ? `${origChild.type} (${getNodeSummary(origChild)})`
            : 'NONE'
        }`,
      );
      console.log(
        `  Modified: ${
          modChild ? `${modChild.type} (${getNodeSummary(modChild)})` : 'NONE'
        }`,
      );
    }
  });

  test('analyze modified v2 (removals) structure', () => {
    const originalJSON = convertMarkdownToJSON(ORIGINAL_MARKDOWN);
    const modifiedJSON = convertMarkdownToJSON(MODIFIED_V2_MARKDOWN);

    console.log('=== MODIFIED V2 (REMOVALS) STRUCTURE ===');
    console.log(printNodeStructure(modifiedJSON));

    // Focus on the list structure specifically
    const originalList = findNodeByType(originalJSON, 'list');
    const modifiedList = findNodeByType(modifiedJSON, 'list');

    console.log('\n=== LIST COMPARISON ===');
    if (originalList && modifiedList) {
      console.log('Original list items:');
      findAllNodesByType(originalList, 'listitem').forEach((item, index) => {
        console.log(`  ${index}: ${getNodeSummary(item)}`);
      });

      console.log('Modified list items:');
      findAllNodesByType(modifiedList, 'listitem').forEach((item, index) => {
        console.log(`  ${index}: ${getNodeSummary(item)}`);
      });
    }
  });

  test('identify patterns for handler-based approach', () => {
    const originalJSON = convertMarkdownToJSON(ORIGINAL_MARKDOWN);
    const additionsJSON = convertMarkdownToJSON(MODIFIED_V1_MARKDOWN);
    const removalsJSON = convertMarkdownToJSON(MODIFIED_V2_MARKDOWN);

    console.log('=== HANDLER APPROACH ANALYSIS ===');

    // Analyze what types of changes we see
    console.log('\n1. ROOT LEVEL CHANGES:');
    analyzeRootChanges(originalJSON, additionsJSON, 'additions');
    analyzeRootChanges(originalJSON, removalsJSON, 'removals');

    console.log('\n2. LIST LEVEL CHANGES:');
    analyzeListChanges(originalJSON, additionsJSON, 'additions');
    analyzeListChanges(originalJSON, removalsJSON, 'removals');

    console.log('\n3. SUGGESTED HANDLER STRATEGY:');
    console.log('- RootHandler: manages top-level paragraphs, headings, lists');
    console.log(
      '- ListHandler: manages list items and nested lists recursively',
    );
    console.log('- ParagraphHandler: manages text content within paragraphs');
    console.log('- TextHandler: manages word-level changes within text nodes');
  });

  // Helper functions
  function getNodeSummary(node: SerializedLexicalNode): string {
    if (node.type === 'text' && 'text' in node) {
      return `"${(node as any).text.substring(0, 30)}..."`;
    }
    if (node.type === 'heading' && 'tag' in node) {
      return `${(node as any).tag}`;
    }
    if (node.type === 'list' && 'listType' in node) {
      return `${(node as any).listType}`;
    }
    if ('children' in node && Array.isArray(node.children)) {
      return `${node.children.length} children`;
    }
    return node.type;
  }

  function findNodeByType(
    node: SerializedLexicalNode,
    targetType: string,
  ): SerializedLexicalNode | null {
    if (node.type === targetType) {
      return node;
    }

    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNodeByType(child, targetType);
        if (found) return found;
      }
    }

    return null;
  }

  function findAllNodesByType(
    node: SerializedLexicalNode,
    targetType: string,
  ): SerializedLexicalNode[] {
    const results: SerializedLexicalNode[] = [];

    if (node.type === targetType) {
      results.push(node);
    }

    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        results.push(...findAllNodesByType(child, targetType));
      }
    }

    return results;
  }

  function analyzeRootChanges(
    original: SerializedLexicalNode,
    modified: SerializedLexicalNode,
    changeType: string,
  ) {
    const origChildren = (original as any).children || [];
    const modChildren = (modified as any).children || [];

    console.log(`  ${changeType} at root level:`);
    console.log(`    Original: ${origChildren.length} children`);
    console.log(`    Modified: ${modChildren.length} children`);

    // Find insertions/deletions at root level
    if (modChildren.length > origChildren.length) {
      console.log(
        `    + ${modChildren.length - origChildren.length} items added`,
      );
    } else if (modChildren.length < origChildren.length) {
      console.log(
        `    - ${origChildren.length - modChildren.length} items removed`,
      );
    }
  }

  function analyzeListChanges(
    original: SerializedLexicalNode,
    modified: SerializedLexicalNode,
    changeType: string,
  ) {
    const originalList = findNodeByType(original, 'list');
    const modifiedList = findNodeByType(modified, 'list');

    if (!originalList || !modifiedList) {
      console.log(`  ${changeType}: No list comparison possible`);
      return;
    }

    const origItems = findAllNodesByType(originalList, 'listitem');
    const modItems = findAllNodesByType(modifiedList, 'listitem');

    console.log(`  ${changeType} in list:`);
    console.log(`    Original: ${origItems.length} list items`);
    console.log(`    Modified: ${modItems.length} list items`);

    if (modItems.length > origItems.length) {
      console.log(
        `    + ${modItems.length - origItems.length} list items added`,
      );
    } else if (modItems.length < origItems.length) {
      console.log(
        `    - ${origItems.length - modItems.length} list items removed`,
      );
    }
  }
});
