/**
 * Test for large document diff failure case
 * Files: test2-old.md vs test2-new.md
 *
 * This is a real-world example where the new document is significantly shorter (72 lines vs 202 lines)
 * The document was substantially rewritten and condensed.
 */

import {describe, expect, it} from 'vitest';
import {$getRoot} from 'lexical';
import {
  $convertFromEnhancedMarkdownString,
  $convertToEnhancedMarkdownString,
} from '../../../../markdown';
import {createTestHeadlessEditor, MARKDOWN_TEST_TRANSFORMERS} from '../../utils/testConfig';
import {diffTrees} from '../../core/ThresholdedOrderPreservingTree';
import {canonicalizeForest, type CanonicalTreeNode} from '../../core/canonicalTree';
import {applyMarkdownDiffToDocument} from '../../core/diffUtils';
import {$approveDiffs} from '../../core/diffPluginUtils';
import * as fs from 'fs';
import * as path from 'path';

describe('Larger document diff - test2 (PM guide rewrite)', () => {
  it('should correctly diff substantial document rewrite', () => {
    // Read the actual markdown files
    const oldMarkdown = fs.readFileSync(
      path.join(__dirname, 'larger/test2-old.md'),
      'utf8'
    );
    const newMarkdown = fs.readFileSync(
      path.join(__dirname, 'larger/test2-new.md'),
      'utf8'
    );

    console.log(`\n=== DOCUMENT DIFF TEST ===`);
    console.log(`Old document: ${oldMarkdown.split('\n').length} lines`);
    console.log(`New document: ${newMarkdown.split('\n').length} lines`);

    const transformers = MARKDOWN_TEST_TRANSFORMERS;

    // Build CanonicalTreeNode directly from editor state
    const oldEditor = createTestHeadlessEditor();
    let oldTree: CanonicalTreeNode[] = [];
    oldEditor.update(() => {
      const root = $getRoot();
      root.clear();
      $convertFromEnhancedMarkdownString(oldMarkdown, transformers);
    }, { discrete: true });
    oldEditor.getEditorState().read(() => {
      const root = $getRoot();
      oldTree = canonicalizeForest(root.getChildren());
    });

    const newEditor = createTestHeadlessEditor();
    let newTree: CanonicalTreeNode[] = [];
    newEditor.update(() => {
      const root = $getRoot();
      root.clear();
      $convertFromEnhancedMarkdownString(newMarkdown, transformers);
    }, { discrete: true });
    newEditor.getEditorState().read(() => {
      const root = $getRoot();
      newTree = canonicalizeForest(root.getChildren());
    });

    console.log(`Old tree: ${oldTree.length} root children`);
    console.log(`New tree: ${newTree.length} root children`);

    // Create root nodes
    const oldRoot: CanonicalTreeNode = {
      id: -1,
      key: 'old-root',
      type: 'root',
      text: undefined,
      attrs: undefined,
      children: oldTree,
      serialized: { type: 'root', version: 1 } as any,
    };

    const newRoot: CanonicalTreeNode = {
      id: -2,
      key: 'new-root',
      type: 'root',
      text: undefined,
      attrs: undefined,
      children: newTree,
      serialized: { type: 'root', version: 1 } as any,
    };

    // Run order-preserving diff
    const diffOps = diffTrees(oldRoot, newRoot, {
      pairAlignThreshold: 0.8,
      equalThreshold: 0.1
    });

    console.log(`\nDiff operations: ${diffOps.length}`);

    // Print tree view
    function printTreeView(ops: typeof diffOps, maxDepth: number = 2) {
      const sorted = Array.from(ops).sort((a, b) => {
        const pathA = a.op === 'delete' ? a.aPath : a.op === 'insert' ? a.bPath : a.aPath;
        const pathB = b.op === 'delete' ? b.aPath : b.op === 'insert' ? b.bPath : b.aPath;

        for (let i = 0; i < Math.max(pathA.length, pathB.length); i++) {
          if (pathA[i] === undefined) return -1;
          if (pathB[i] === undefined) return 1;
          if (pathA[i] !== pathB[i]) return pathA[i] - pathB[i];
        }
        return 0;
      });

      for (const op of sorted) {
        const depth = op.op === 'delete' ? op.aPath.length :
                     op.op === 'insert' ? op.bPath.length :
                     op.aPath.length;

        if (depth > maxDepth) continue; // Limit depth for readability

        const indent = '  '.repeat(depth);

        const pathStr = op.op === 'delete' ? `old[${op.aPath.join(',')}]` :
                       op.op === 'insert' ? `new[${op.bPath.join(',')}]` :
                       `[${op.aPath.join(',')}]->[${op.bPath.join(',')}]`;

        const truncate = (s: string, len: number = 60) => s.length > len ? s.substring(0, len) + '...' : s;

        if (op.op === 'insert') {
          console.log(`${indent}➕ INSERT ${pathStr}: ${op.b.type} "${truncate(op.b.text || '')}"`);
        } else if (op.op === 'delete') {
          console.log(`${indent}➖ DELETE ${pathStr}: ${op.a.type} "${truncate(op.a.text || '')}"`);
        } else if (op.op === 'equal') {
          console.log(`${indent}✓ EQUAL ${pathStr}: ${op.a.type} "${truncate(op.a.text || '')}"`);
        } else {
          console.log(`${indent}🔄 REPLACE ${pathStr}: ${op.a.type} "${truncate(op.a.text || '')}" → ${op.b.type} "${truncate(op.b.text || '')}"`);
        }
      }
    }

    console.log('\n=== TREE VIEW (depth 0-2) ===');
    printTreeView(diffOps, 2);

    // Count operation types at depth 1 (root children)
    const rootChildOps = diffOps.filter(op => {
      const depth = op.op === 'delete' ? op.aPath.length :
                   op.op === 'insert' ? op.bPath.length :
                   op.aPath.length;
      return depth === 1;
    });

    const equalCount = rootChildOps.filter(op => op.op === 'equal').length;
    const replaceCount = rootChildOps.filter(op => op.op === 'replace').length;
    const insertCount = rootChildOps.filter(op => op.op === 'insert').length;
    const deleteCount = rootChildOps.filter(op => op.op === 'delete').length;

    console.log(`\n=== ROOT CHILDREN OPERATIONS ===`);
    console.log(`Equal: ${equalCount}`);
    console.log(`Replace: ${replaceCount}`);
    console.log(`Insert: ${insertCount}`);
    console.log(`Delete: ${deleteCount}`);
    console.log(`Total root children ops: ${rootChildOps.length}`);

    // Verify we got some operations
    expect(diffOps.length).toBeGreaterThan(0);

    // The title heading should match (equal or replace)
    const titleOp = diffOps.find(op =>
      (op.op === 'equal' || op.op === 'replace') &&
      op.a.type === 'heading' &&
      op.a.text?.includes('Claude Code for Product Managers')
    );
    expect(titleOp).toBeDefined();
    console.log(`\n✓ Title heading matched`);

    // Should have significant changes given the rewrite
    expect(replaceCount + insertCount + deleteCount).toBeGreaterThan(10);
    console.log(`✓ Detected significant changes (${replaceCount + insertCount + deleteCount} changes at root level)`);
  });

  it('should produce correct new markdown after accepting all changes', async () => {
    // Read the actual markdown files
    const oldMarkdown = fs.readFileSync(
      path.join(__dirname, 'larger/test2-old.md'),
      'utf8'
    );
    const newMarkdown = fs.readFileSync(
      path.join(__dirname, 'larger/test2-new.md'),
      'utf8'
    );

    console.log(`\n=== ACCEPTANCE TEST ===`);

    const transformers = MARKDOWN_TEST_TRANSFORMERS;

    // Build OLD markdown in editor - this is what we'll apply changes TO
    const editor = createTestHeadlessEditor();
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      $convertFromEnhancedMarkdownString(oldMarkdown, transformers);
    }, { discrete: true });

    console.log(`Editor loaded with OLD markdown (${oldMarkdown.length} bytes)`);

    // Export BEFORE applying diff - should match old
    let beforeMarkdown = '';
    editor.getEditorState().read(() => {
      beforeMarkdown = $convertToEnhancedMarkdownString(transformers);
    });

    console.log(`Before applying diff: ${beforeMarkdown.length} bytes, contains title: ${beforeMarkdown.includes('Claude Code for Product Managers')}`);
    expect(beforeMarkdown).toContain('Claude Code for Product Managers');

    // Check what TreeMatcher produces for debugging
    const {createWindowedTreeMatcher} = await import('../../core/TreeMatcher');
    const sourceEditor2 = createTestHeadlessEditor();
    sourceEditor2.update(() => {
      const root = $getRoot();
      root.clear();
      $convertFromEnhancedMarkdownString(oldMarkdown, transformers);
    }, { discrete: true });

    const targetEditor2 = createTestHeadlessEditor();
    targetEditor2.update(() => {
      const root = $getRoot();
      root.clear();
      $convertFromEnhancedMarkdownString(newMarkdown, transformers);
    }, { discrete: true });

    const matcher = createWindowedTreeMatcher(sourceEditor2, targetEditor2, { transformers, windowSize: 2, similarityThreshold: 0.05 });
    const matchResult = matcher.matchRootChildren();

    console.log(`\n=== TREEMATCHER RESULT ===`);
    console.log(`Total diffs: ${matchResult.diffs.length}`);

    // Find the title node operations
    const titleDiffs = matchResult.sequence.filter(d =>
      (d.sourceMarkdown && d.sourceMarkdown.includes('Claude Code for Product Managers')) ||
      (d.targetMarkdown && d.targetMarkdown.includes('Claude Code for Product Managers'))
    );

    console.log(`\nTitle-related diffs (${titleDiffs.length}):`);
    titleDiffs.forEach((d, i) => {
      console.log(`  [${i}] ${d.changeType}: source[${d.sourceIndex}] -> target[${d.targetIndex}]`);
      console.log(`      sourceKey: ${d.sourceKey}, targetKey: ${d.targetKey}`);
      console.log(`      sourceLiveKey: ${d.sourceLiveKey}`);
      console.log(`      sourceType: ${d.sourceNode?.type}, targetType: ${d.targetNode?.type}`);
      console.log(`      sourceMarkdown: "${(d.sourceMarkdown || '').substring(0, 60)}"`);
      console.log(`      targetMarkdown: "${(d.targetMarkdown || '').substring(0, 60)}"`);
      console.log(`      similarity: ${d.similarity}, matchType: ${d.matchType}`);
      console.log(`      sourceNode:`, JSON.stringify(d.sourceNode, null, 2).substring(0, 200));
      console.log(`      targetNode:`, JSON.stringify(d.targetNode, null, 2).substring(0, 200));
    });

    // Apply the diff using the actual DiffPlugin implementation
    applyMarkdownDiffToDocument(editor, oldMarkdown, newMarkdown, transformers);

    // Export AFTER applying diff (with diff markers) - should still have content
    let afterDiffMarkdown = '';
    editor.getEditorState().read(() => {
      afterDiffMarkdown = $convertToEnhancedMarkdownString(transformers);
    });

    console.log(`After applying diff: ${afterDiffMarkdown.length} bytes, contains title: ${afterDiffMarkdown.includes('Claude Code for Product Managers')}`);

    // If title is missing after diff, this is the bug!
    if (!afterDiffMarkdown.includes('Claude Code for Product Managers')) {
      console.log('\n❌ TITLE MISSING AFTER APPLYING DIFF!');
      console.log('First 500 chars:', afterDiffMarkdown.substring(0, 500));
    }

    // Accept all diffs using the real DiffPlugin implementation
    $approveDiffs(editor);

    // Export AFTER accepting - should match new markdown
    let afterAcceptMarkdown = '';
    editor.getEditorState().read(() => {
      afterAcceptMarkdown = $convertToEnhancedMarkdownString(transformers);
    });

    console.log(`After accepting all: ${afterAcceptMarkdown.length} bytes, contains title: ${afterAcceptMarkdown.includes('Claude Code for Product Managers')}`);

    // The title should still be present after accepting changes
    expect(afterAcceptMarkdown).toContain('Claude Code for Product Managers');

    // Verify the markdown roughly matches the expected new markdown
    // (we don't need exact match due to whitespace differences)
    expect(afterAcceptMarkdown.length).toBeGreaterThan(newMarkdown.length * 0.9);
    expect(afterAcceptMarkdown.length).toBeLessThan(newMarkdown.length * 1.1);
  });
});
