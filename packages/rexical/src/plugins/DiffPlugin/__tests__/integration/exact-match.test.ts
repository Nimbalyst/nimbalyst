/**
 * Test to verify exact matches are correctly identified and skipped
 */

import {describe, expect, it} from 'vitest';
import {$getRoot} from 'lexical';
import {
  $convertFromEnhancedMarkdownString,
} from '../../../../markdown';
import {createTestHeadlessEditor, MARKDOWN_TEST_TRANSFORMERS} from '../utils/testConfig';
import {canonicalizeForest} from '../../core/canonicalTree';
import {diffTrees} from '../../core/ThresholdedOrderPreservingTree';

describe('Exact Match Detection', () => {
  it('should identify identical headings as EQUAL', () => {
    const markdown = '# Title\n\nParagraph.\n';

    // Create two editors with identical content
    const editor1 = createTestHeadlessEditor();
    editor1.update(() => {
      const root = $getRoot();
      root.clear();
      $convertFromEnhancedMarkdownString(markdown, MARKDOWN_TEST_TRANSFORMERS);
    }, { discrete: true });

    const editor2 = createTestHeadlessEditor();
    editor2.update(() => {
      const root = $getRoot();
      root.clear();
      $convertFromEnhancedMarkdownString(markdown, MARKDOWN_TEST_TRANSFORMERS);
    }, { discrete: true });

    // Canonicalize both trees
    let tree1: any[] = [];
    editor1.getEditorState().read(() => {
      tree1 = canonicalizeForest($getRoot().getChildren());
    });

    let tree2: any[] = [];
    editor2.getEditorState().read(() => {
      tree2 = canonicalizeForest($getRoot().getChildren());
    });

    console.log(`\nTree1 has ${tree1.length} nodes`);
    console.log(`Tree2 has ${tree2.length} nodes`);

    // Create root nodes for diffTrees
    const root1 = {
      id: -1,
      key: 'root1',
      type: 'root',
      text: undefined,
      attrs: undefined,
      children: tree1,
      serialized: { type: 'root', version: 1 } as any,
    };

    const root2 = {
      id: -2,
      key: 'root2',
      type: 'root',
      text: undefined,
      attrs: undefined,
      children: tree2,
      serialized: { type: 'root', version: 1 } as any,
    };

    // Run diff
    const diffOps = diffTrees(root1, root2, {
      pairAlignThreshold: 0.8,
      equalThreshold: 0.1,
    });

    console.log(`\nTotal diff operations: ${diffOps.length}`);

    // Count operation types at depth 1
    const rootOps = diffOps.filter(op => {
      const depth = op.op === 'delete' ? op.aPath.length :
                   op.op === 'insert' ? op.bPath.length :
                   op.aPath.length;
      return depth === 1;
    });

    const equalOps = rootOps.filter(op => op.op === 'equal');
    const replaceOps = rootOps.filter(op => op.op === 'replace');
    const insertOps = rootOps.filter(op => op.op === 'insert');
    const deleteOps = rootOps.filter(op => op.op === 'delete');

    console.log(`\nRoot-level operations:`);
    console.log(`  EQUAL: ${equalOps.length}`);
    console.log(`  REPLACE: ${replaceOps.length}`);
    console.log(`  INSERT: ${insertOps.length}`);
    console.log(`  DELETE: ${deleteOps.length}`);

    // For identical trees, we expect all EQUAL operations
    expect(equalOps.length).toBe(tree1.length);
    expect(replaceOps.length).toBe(0);
    expect(insertOps.length).toBe(0);
    expect(deleteOps.length).toBe(0);
  });

  it('should identify changed paragraph as REPLACE', () => {
    const oldMarkdown = '# Title\n\nOld paragraph.\n';
    const newMarkdown = '# Title\n\nNew paragraph.\n';

    const editor1 = createTestHeadlessEditor();
    editor1.update(() => {
      const root = $getRoot();
      root.clear();
      $convertFromEnhancedMarkdownString(oldMarkdown, MARKDOWN_TEST_TRANSFORMERS);
    }, { discrete: true });

    const editor2 = createTestHeadlessEditor();
    editor2.update(() => {
      const root = $getRoot();
      root.clear();
      $convertFromEnhancedMarkdownString(newMarkdown, MARKDOWN_TEST_TRANSFORMERS);
    }, { discrete: true });

    let tree1: any[] = [];
    editor1.getEditorState().read(() => {
      tree1 = canonicalizeForest($getRoot().getChildren());
    });

    let tree2: any[] = [];
    editor2.getEditorState().read(() => {
      tree2 = canonicalizeForest($getRoot().getChildren());
    });

    const root1 = {
      id: -1,
      key: 'root1',
      type: 'root',
      text: undefined,
      attrs: undefined,
      children: tree1,
      serialized: { type: 'root', version: 1 } as any,
    };

    const root2 = {
      id: -2,
      key: 'root2',
      type: 'root',
      text: undefined,
      attrs: undefined,
      children: tree2,
      serialized: { type: 'root', version: 1 } as any,
    };

    const diffOps = diffTrees(root1, root2, {
      pairAlignThreshold: 0.8,
      equalThreshold: 0.1,
    });

    const rootOps = diffOps.filter(op => {
      const depth = op.op === 'delete' ? op.aPath.length :
                   op.op === 'insert' ? op.bPath.length :
                   op.aPath.length;
      return depth === 1;
    });

    const equalOps = rootOps.filter(op => op.op === 'equal');
    const replaceOps = rootOps.filter(op => op.op === 'replace');

    console.log(`\n=== Change Detection ===`);
    console.log(`  EQUAL: ${equalOps.length} (title should be here)`);
    console.log(`  REPLACE: ${replaceOps.length} (changed paragraph should be here)`);

    // We expect: title as EQUAL, paragraph as REPLACE
    expect(equalOps.length).toBe(1); // Title
    expect(replaceOps.length).toBeGreaterThanOrEqual(1); // Paragraph(s)
  });
});
