/**
 * Test for larger document with section reordering
 * Tests diff handling when "Best Practices" section is moved from later in doc to after Overview
 */

import { describe, it, expect } from 'vitest';
import { $getRoot, $isElementNode } from 'lexical';
import { $isHeadingNode } from '@lexical/rich-text';
import {
  $convertFromEnhancedMarkdownString,
  $convertToEnhancedMarkdownString,
  getEditorTransformers,
} from '../../../../markdown';
import { applyMarkdownReplace } from '../../core/diffUtils';
import { $getDiffState } from '../../core/DiffState';
import { createTestHeadlessEditor } from '../../utils/testConfig';
import { getAllNodes, printEditorTree, printDiffStateSummary } from '../utils';
import { printEditorTree as printFullTree } from '../../utils/treeDebugUtils';
import * as fs from 'fs';
import * as path from 'path';

describe('Larger document with section additions', () => {
  it('should handle large document diff without "Could not find element node" errors', () => {
    /**
     * Tests the fix for $isElementNode checks that were rejecting DecoratorNodes.
     *
     * The larger test files have HorizontalRuleNodes (***) throughout.
     * Before the fix: These caused "Could not find element node" errors.
     * After the fix: All node types can receive diff states properly.
     */
    const editor = createTestHeadlessEditor();
    const transformers = getEditorTransformers();

    // Read the actual test files
    const oldMarkdown = fs.readFileSync(
      path.join(__dirname, 'larger/test-old.md'),
      'utf8'
    );
    const newMarkdown = fs.readFileSync(
      path.join(__dirname, 'larger/test-new.md'),
      'utf8'
    );

    // Setup: Load the old markdown
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        $convertFromEnhancedMarkdownString(oldMarkdown, transformers, undefined, true, true);
      },
      { discrete: true }
    );

    // Track if "Could not find element node" errors occur
    let elementNodeErrors = 0;
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      if (args[0]?.includes('Could not find element node')) {
        elementNodeErrors++;
      }
      originalWarn(...args);
    };

    // Apply the diff
    editor.update(
      () => {
        const original = $convertToEnhancedMarkdownString(transformers);
        applyMarkdownReplace(
          editor,
          original,
          [{ oldText: original, newText: newMarkdown }],
          transformers
        );
      },
      { discrete: true }
    );

    console.warn = originalWarn;

    // Print diagnostic info
    console.log(printDiffStateSummary(editor));

    // Print full tree (first 100 nodes)
    const treeOutput = printFullTree(editor);
    const lines = treeOutput.split('\n');
    console.log('\n=== DIFF TREE (first 100 lines) ===');
    console.log(lines.slice(0, 100).join('\n'));
    if (lines.length > 100) {
      console.log(`\n... (${lines.length - 100} more lines)`);
    }

    // The key test: should NOT have "Could not find element node" errors
    expect(elementNodeErrors, 'Should not have "Could not find element node" errors').toBe(0);

    // Count total operations
    const totalOperations = editor.getEditorState().read(() => {
      const root = $getRoot();
      let added = 0, removed = 0, modified = 0;

      function traverse(node: LexicalNode) {
        const diffState = $getDiffState(node);
        if (diffState === 'added') added++;
        if (diffState === 'removed') removed++;
        if (diffState === 'modified') modified++;

        if ($isElementNode(node)) {
          for (const child of node.getChildren()) {
            traverse(child);
          }
        }
      }

      for (const child of root.getChildren()) {
        traverse(child);
      }

      return { added, removed, modified, total: added + removed + modified };
    });

    console.log(`Total operations: ${totalOperations.total} (added: ${totalOperations.added}, removed: ${totalOperations.removed}, modified: ${totalOperations.modified})`);

    // The actual diff only moves "Best Practices" section (28 lines) from position 417 to position 24
    // That's 28 removes + 28 adds = 56 line changes
    // With paragraph/heading nodes + their text children, that's roughly 56 nodes
    // Everything else should be exact matches (unchanged)
    // Allow some tolerance for structure differences, but 182 operations is WAY too many
    expect(totalOperations.total, 'Should have minimal operations for a simple section move').toBeLessThan(100);

    // Verify diff states were applied (not all unchanged)
    const allNodes = getAllNodes(editor);
    const nodesWithDiffState = editor.getEditorState().read(() => {
      return allNodes.filter(node => {
        const state = $getDiffState(node);
        return state === 'added' || state === 'removed' || state === 'modified';
      });
    });

    console.log(`\nNodes with diff states: ${nodesWithDiffState.length}`);

    // Should have multiple nodes with diff states since new content was added
    expect(nodesWithDiffState.length, 'Should have nodes with diff states applied').toBeGreaterThan(0);

    // Verify that "Best Practices" appears as both added and removed
    // (since it moved from one position to another)
    const bestPracticesNodes = editor.getEditorState().read(() => {
      return allNodes.filter(node => {
        const text = node.getTextContent();
        return text.includes('Best Practices');
      });
    });

    console.log(`\nAll Best Practices nodes (${bestPracticesNodes.length}):`);
    editor.getEditorState().read(() => {
      bestPracticesNodes.forEach(node => {
        const state = $getDiffState(node);
        console.log(`  ${node.getType()} [${state || 'null'}]: "${node.getTextContent().substring(0, 50)}"`);
      });
    });

    const bestPracticesStates = editor.getEditorState().read(() => {
      return bestPracticesNodes.map(node => $getDiffState(node));
    });

    const hasAdded = bestPracticesStates.some(state => state === 'added');
    const hasRemoved = bestPracticesStates.some(state => state === 'removed');

    console.log(`\nBest Practices: ${hasAdded ? 'HAS added' : 'NO added'}, ${hasRemoved ? 'HAS removed' : 'NO removed'}`);

    // When a section moves, it should appear as BOTH added (at new location) and removed (at old location)
    expect(hasAdded, 'Best Practices should have an [added] instance').toBe(true);
    expect(hasRemoved, 'Best Practices should have a [removed] instance').toBe(true);





  });
});
