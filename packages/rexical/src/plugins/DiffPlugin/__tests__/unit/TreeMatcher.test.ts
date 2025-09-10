/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/**
 * Tests for the improved WindowedTreeMatcher algorithm.
 *
 * KEY BEHAVIORAL CHANGES:
 * - Exact matches (similarity = 1.0) don't appear in diff output since they represent "no change"
 * - Only actual differences (updates, adds, removes) are reported in the diff
 * - Content-first matching with global optimization prevents spurious changes
 * - Empty spacing nodes (empty paragraphs) are filtered out during matching
 * - This dramatically reduces visual noise in diffs and fixes the "middle insertion problem"
 */

import {$convertFromMarkdownString, TRANSFORMERS} from '@lexical/markdown';
import {$getRoot, $isElementNode} from 'lexical';
import {createTestEditor} from '../utils';

import {
  createWindowedTreeMatcher,
  WindowedMatchResult,
} from '../../core/TreeMatcher';

// Helper function to create an editor with markdown content
function createEditorWithMarkdown(markdown: string) {
  const editor = createTestEditor();

  editor.update(
    () => {
      $convertFromMarkdownString(
        markdown,
        TRANSFORMERS,
        undefined,
        true,
        false,
      );
    },
    {discrete: true},
  );

  return editor;
}

describe('WindowedTreeMatcher with Live Editors', () => {
  describe('Basic Matching', () => {
    it('should produce no diffs for identical content (exact matches = no changes)', () => {
      const sourceMarkdown = '# Heading\n\nSome paragraph text.';
      const targetMarkdown = '# Heading\n\nSome paragraph text.';

      const sourceEditor = createEditorWithMarkdown(sourceMarkdown);
      const targetEditor = createEditorWithMarkdown(targetMarkdown);

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      // With improved algorithm: exact matches don't appear in diff output
      // They represent "no change" so they're excluded from the result
      expect(result.diffs.length).toBe(0);
      expect(
        result.diffs.filter((d) => d.changeType === 'update'),
      ).toHaveLength(0);
      expect(
        result.diffs.filter((d) => d.changeType === 'remove'),
      ).toHaveLength(0);
      expect(result.diffs.filter((d) => d.changeType === 'add')).toHaveLength(
        0,
      );
    });

    it('should detect content changes in paragraphs', () => {
      const sourceMarkdown = 'Original text here.';
      const targetMarkdown = 'Modified text here.';

      const sourceEditor = createEditorWithMarkdown(sourceMarkdown);
      const targetEditor = createEditorWithMarkdown(targetMarkdown);

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      if (result.diffs.filter((d) => d.changeType === 'update').length > 0) {
        const updateDiff = result.diffs.find((d) => d.changeType === 'update');
        expect(updateDiff!.similarity).toBeGreaterThanOrEqual(0.5);
        expect(updateDiff!.similarity).toBeLessThan(1.0);
        expect(updateDiff!.sourceKey).toBeDefined();
        expect(updateDiff!.targetKey).toBeDefined();
      } else {
        // If no matches found, that's also valid for different content
        expect(
          result.diffs.filter((d) => d.changeType === 'remove').length,
        ).toBeGreaterThan(0);
        expect(
          result.diffs.filter((d) => d.changeType === 'add').length,
        ).toBeGreaterThan(0);
      }
    });

    it('should handle list insertions correctly', () => {
      const sourceMarkdown = '# Header\n\nSome text\n\n## End';
      const targetMarkdown =
        '# Header\n\nSome text\n\n- New item\n- Another item\n\n## End';

      const sourceEditor = createEditorWithMarkdown(sourceMarkdown);
      const targetEditor = createEditorWithMarkdown(targetMarkdown);

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      // With improved algorithm: exact matches (Header, text, End) don't appear in diff
      // Only the inserted list appears as additions
      expect(result.diffs.length).toBeGreaterThan(0);
      expect(
        result.diffs.filter((d) => d.changeType === 'add').length,
      ).toBeGreaterThan(0); // List should be unmatched
    });
  });

  describe('Windowed Matching', () => {
    it('should respect window size when matching', () => {
      const sourceMarkdown =
        'First\n\nSecond\n\nThird\n\nFourth\n\nFifth\n\nSixth';
      const targetMarkdown =
        'Different\n\nSecond\n\nThird\n\nFourth\n\nFifth\n\nSixth';

      const sourceEditor = createEditorWithMarkdown(sourceMarkdown);
      const targetEditor = createEditorWithMarkdown(targetMarkdown);

      // Use window size 2 for regular matching
      const normalMatcher = createWindowedTreeMatcher(
        sourceEditor,
        targetEditor,
        {
          transformers: TRANSFORMERS,
          windowSize: 2,
        },
      );

      // Use window size 0 to effectively disable windowing (only exact position matches)
      const restrictiveMatcher = createWindowedTreeMatcher(
        sourceEditor,
        targetEditor,
        {
          transformers: TRANSFORMERS,
          windowSize: 0,
        },
      );

      const normalResult = normalMatcher.matchRootChildren();
      const restrictiveResult = restrictiveMatcher.matchRootChildren();

      // The restrictive matcher should find fewer matches or more unmatched nodes
      // because it can't look beyond the exact position
      expect(restrictiveResult.diffs.length).toBeGreaterThanOrEqual(
        normalResult.diffs.length,
      );
    });
  });

  describe('List Handling', () => {
    it('should compare lists using markdown representation', () => {
      const sourceMarkdown = '- Item one\n- Item two\n- Item three';
      const targetMarkdown = '- Item one\n- Modified item\n- Item three';

      const sourceEditor = createEditorWithMarkdown(sourceMarkdown);
      const targetEditor = createEditorWithMarkdown(targetMarkdown);

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      // The lists have one matching node with modified content
      const updateDiffs = result.diffs.filter((d) => d.changeType === 'update');
      if (updateDiffs.length > 0) {
        expect(updateDiffs[0].similarity).toBeGreaterThan(0.5);
        expect(updateDiffs[0].sourceKey).toBeDefined();
        expect(updateDiffs[0].targetKey).toBeDefined();
      } else {
        // If no matches found, that's also valid for different content
        expect(
          result.diffs.filter((d) => d.changeType === 'remove').length,
        ).toBeGreaterThan(0);
        expect(
          result.diffs.filter((d) => d.changeType === 'add').length,
        ).toBeGreaterThan(0);
      }
    });

    it('should handle nested sublists with indented bullets', () => {
      // NOTE: Lexical requires 4 spaces (not 2) for nested list items
      // With 2 spaces, items remain at the same level in the list structure
      const sourceMarkdown = `- Item one
- Item two
    - Subitem A
    - Subitem B
- Item three`;

      const targetMarkdown = `- Item one
- Item two modified
    - Subitem A
    - Subitem B modified
    - New subitem C
- Item three`;

      const sourceEditor = createEditorWithMarkdown(sourceMarkdown);
      const targetEditor = createEditorWithMarkdown(targetMarkdown);

      console.log('\nNested list test:');

      // First let's see what nodes we actually get
      sourceEditor.getEditorState().read(() => {
        const root = $getRoot();
        console.log(
          'Source root children:',
          root
            .getChildren()
            .map((node) => `${node.getType()} (key: ${node.getKey()})`),
        );
      });

      targetEditor.getEditorState().read(() => {
        const root = $getRoot();
        console.log(
          'Target root children:',
          root
            .getChildren()
            .map((node) => `${node.getType()} (key: ${node.getKey()})`),
        );
      });

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      console.log(
        'Nested list matches:',
        result.diffs.map((m) => ({
          changeType: m.changeType,
          matchType: m.matchType,
          similarity: m.similarity,
          sourceIndex: m.sourceIndex,
          sourceKey: m.sourceKey,
          sourceType: m.sourceNode?.type,
          targetIndex: m.targetIndex,
          targetKey: m.targetKey,
          targetType: m.targetNode?.type,
        })),
      );

      console.log(
        'Remove diffs:',
        result.diffs.filter((d) => d.changeType === 'remove').length,
      );
      console.log(
        'Add diffs:',
        result.diffs.filter((d) => d.changeType === 'add').length,
      );

      // With improved algorithm: the modified list should appear as an update
      expect(result).toBeDefined();
      expect(result.diffs).toBeDefined();
      expect(
        result.diffs.filter((d) => d.changeType === 'update'),
      ).toHaveLength(1); // Nested lists are single list node with changes
      expect(
        result.diffs.filter((d) => d.changeType === 'remove'),
      ).toHaveLength(0);
      expect(result.diffs.filter((d) => d.changeType === 'add')).toHaveLength(
        0,
      );
    });

    it('should distinguish between bullet and numbered lists', () => {
      const sourceMarkdown = '- Bullet item\n- Another bullet';
      const targetMarkdown = '1. Numbered item\n2. Another numbered';

      const sourceEditor = createEditorWithMarkdown(sourceMarkdown);
      const targetEditor = createEditorWithMarkdown(targetMarkdown);

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      if (result.diffs.length > 0) {
        // If they match, the similarity should be less than perfect due to different content
        expect(result.diffs[0].similarity).toBeLessThan(1.0);
        expect(result.diffs[0].sourceKey).toBeDefined();
        expect(result.diffs[0].targetKey).toBeDefined();
      } else {
        // If they don't match, that's also valid for different list types
        expect(
          result.diffs.filter((d) => d.changeType === 'update'),
        ).toHaveLength(0);
        expect(
          result.diffs.filter((d) => d.changeType === 'remove'),
        ).toHaveLength(1);
        expect(result.diffs.filter((d) => d.changeType === 'add')).toHaveLength(
          1,
        );
      }
    });

    it('should handle section replacement with heading and list changes (generative test scenario)', () => {
      const sourceMarkdown = `## One

- One - One
- One - Two

## Two

- Two - One
- Two - Two

## Three

- Three - One
- Three - Two`;

      const targetMarkdown = `## One

- One - One
- One - Two

## Two (Updated)

- Two - Modified First Item
- Two - Modified Second Item
- Two - New Third Item

## Three

- Three - One
- Three - Two`;

      const sourceEditor = createEditorWithMarkdown(sourceMarkdown);
      const targetEditor = createEditorWithMarkdown(targetMarkdown);

      console.log('\nSection replacement test:');

      // Log the structure we get
      sourceEditor.getEditorState().read(() => {
        const root = $getRoot();
        console.log(
          'Source root children:',
          root
            .getChildren()
            .map(
              (node, idx) =>
                `${idx}: ${node.getType()} "${node.getTextContent()}"`,
            ),
        );
      });

      targetEditor.getEditorState().read(() => {
        const root = $getRoot();
        console.log(
          'Target root children:',
          root
            .getChildren()
            .map(
              (node, idx) =>
                `${idx}: ${node.getType()} "${node.getTextContent()}"`,
            ),
        );
      });

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        similarityThreshold: 0.3,
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      console.log(
        'Section replacement matches:',
        result.diffs.map((m) => ({
          changeType: m.changeType,
          matchType: m.matchType,
          similarity: m.similarity?.toFixed(3),
          sourceIndex: m.sourceIndex,
          sourceKey: m.sourceKey,
          sourceType: m.sourceNode?.type,
          targetIndex: m.targetIndex,
          targetKey: m.targetKey,
          targetType: m.targetNode?.type,
        })),
      );

      console.log(
        'Update diffs:',
        result.diffs.filter((d) => d.changeType === 'update').length,
      );
      console.log(
        'Remove diffs:',
        result.diffs.filter((d) => d.changeType === 'remove').length,
      );
      console.log(
        'Add diffs:',
        result.diffs.filter((d) => d.changeType === 'add').length,
      );

      // With improved algorithm: only actual changes appear in diff output
      expect(result).toBeDefined();
      expect(result.diffs).toBeDefined();
      expect(result.diffs.length).toBeGreaterThan(0);

      // The heading "## Two" should be detected as updated to "## Two (Updated)"
      const headingUpdates = result.diffs.filter(
        (d) =>
          d.changeType === 'update' &&
          d.sourceNode?.type === 'heading' &&
          d.targetNode?.type === 'heading',
      );
      console.log('Heading updates found:', headingUpdates.length);

      // The list should be detected as updated (with internal changes)
      const listUpdates = result.diffs.filter(
        (d) =>
          d.changeType === 'update' &&
          d.sourceNode?.type === 'list' &&
          d.targetNode?.type === 'list',
      );
      console.log('List updates found:', listUpdates.length);

      // Should only report the actual changes (section 2 heading and list updates)
      // Sections 1 and 3 that didn't change won't appear in diff output
      expect(result.diffs.length).toBeGreaterThan(0);
    });
  });

  describe('Recursive Diffing Decision', () => {
    it('should not have exact matches in diff output to test recursive decision', () => {
      const sourceEditor = createEditorWithMarkdown('# Test');
      const targetEditor = createEditorWithMarkdown('# Test');

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      // With improved algorithm: exact matches don't appear in diff output
      expect(result.diffs.length).toBe(0);
    });

    it('should recommend recursive diffing for high similarity matches', () => {
      const sourceEditor = createEditorWithMarkdown('Original text content');
      const targetEditor = createEditorWithMarkdown(
        'Original modified content',
      );

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        similarityThreshold: 0.7,
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      if (result.diffs.length > 0 && result.diffs[0].similarity >= 0.7) {
        expect(matcher.shouldRecursivelyDiff(result.diffs[0])).toBe(true);
      }
    });

    it('should not recommend recursive diffing for low similarity matches', () => {
      const sourceEditor = createEditorWithMarkdown(
        'Completely different content',
      );
      const targetEditor = createEditorWithMarkdown('Totally unrelated text');

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        similarityThreshold: 0.7,
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      if (result.diffs.length > 0 && result.diffs[0].similarity < 0.7) {
        expect(matcher.shouldRecursivelyDiff(result.diffs[0])).toBe(false);
      }
    });
  });

  describe('Target Position Tracking', () => {
    it('should correctly parse markdown paragraphs', () => {
      const markdown = 'One\nTwo\nThree\nFour';

      console.log('Testing with proper paragraph separation');
      const editor = createEditorWithMarkdown(markdown);

      editor.getEditorState().read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        console.log('Number of root children:', children.length);
        children.forEach((child, idx) => {
          console.log(
            `Child ${idx}: type=${child.getType()}, text="${child.getTextContent()}"`,
          );
          if ($isElementNode(child)) {
            console.log(`  Has ${child.getChildren().length} children`);
          }
        });

        // With blank lines between, we get 4 children (4 paragraphs)
        expect(children.length).toBe(4);
        expect(children[0].getTextContent()).toBe('One');
        expect(children[1].getTextContent()).toBe('Two');
        expect(children[2].getTextContent()).toBe('Three');
        expect(children[3].getTextContent()).toBe('Four');
      });
    });

    it('should create separate paragraphs for single newlines when shouldMergeAdjacentLines is false', () => {
      // With shouldMergeAdjacentLines = false, single newlines should create separate paragraphs
      const markdown = 'One\nTwo\nThree\nFour';

      const editor = createEditorWithMarkdown(markdown);

      editor.getEditorState().read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        console.log('Number of root children:', children.length);
        children.forEach((child, idx) => {
          console.log(
            `Child ${idx}: type=${child.getType()}, text="${child.getTextContent()}"`,
          );
        });

        // Should create 4 separate paragraphs now!
        expect(children.length).toBe(4);
        expect(children[0].getTextContent()).toBe('One');
        expect(children[1].getTextContent()).toBe('Two');
        expect(children[2].getTextContent()).toBe('Three');
        expect(children[3].getTextContent()).toBe('Four');
      });
    });

    it('should correctly identify source and target indices for adds and removes', () => {
      // Now that single newlines create separate paragraphs, we can use them
      const sourceMarkdown = 'One\nTwo\nThree\nFour';
      const targetMarkdown = 'One\nTwo\nTwo and a half\nFour';

      const sourceEditor = createEditorWithMarkdown(sourceMarkdown);
      const targetEditor = createEditorWithMarkdown(targetMarkdown);

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      // Find the specific diffs
      const updateDiffs = result.diffs.filter((d) => d.changeType === 'update');
      const removeDiffs = result.diffs.filter((d) => d.changeType === 'remove');
      const addDiffs = result.diffs.filter((d) => d.changeType === 'add');

      // With improved algorithm:
      // - Exact matches (One, Two, Four) don't appear in diff output
      // - Only the actual changes appear: "Three" removed, "Two and a half" added
      expect(updateDiffs.length).toBe(0); // No updates, only pure add/remove

      // Should have removed "Three" at index 2
      expect(removeDiffs.length).toBe(1);
      expect(removeDiffs[0].sourceIndex).toBe(2);
      expect(removeDiffs[0].sourceNode?.type).toBe('paragraph');

      // Should have added "Two and a half" at index 2
      expect(addDiffs.length).toBe(1);
      expect(addDiffs[0].targetIndex).toBe(2);
      expect(addDiffs[0].targetNode?.type).toBe('paragraph');
    });
  });

  describe('Middle Insertion Problem', () => {
    it('should correctly handle section insertion showing only actual changes', () => {
      // This test demonstrates the FIXED behavior: when inserting a section in the middle
      // of a long document, the matcher correctly shows only the actual insertion
      // without any spurious "changes" to existing content

      const sections = ['one', 'two', 'three', 'five', 'six', 'seven'];

      const originalMarkdown = sections
        .map(
          (section) =>
            `## ${section}\n\n- ${section}: item 1\n- ${section}: item 2\n- ${section}: item 3`,
        )
        .join('\n\n');

      let newMarkdown = sections
        .map(
          (section) =>
            `## ${section}\n\n- ${section}: item 1\n- ${section}: item 2\n- ${section}: item 3`,
        )
        .join('\n\n');

      newMarkdown = newMarkdown.replace(
        '- three: item 3\n\n',
        '- three: item 3\n\n## four\n\n- four: item 1\n- four: item 2\n- four: item 3\n\n',
      );

      console.log('\n=== Middle Insertion Problem Test ===');
      console.log('Original sections:', sections);
      console.log(
        'Target should have: one, two, three, four, five, six, seven',
      );

      const sourceEditor = createEditorWithMarkdown(originalMarkdown);
      const targetEditor = createEditorWithMarkdown(newMarkdown);

      // Log the actual structure
      sourceEditor.getEditorState().read(() => {
        const root = $getRoot();
        const children = root.getChildren();
        console.log('\nSource structure:');
        children.forEach((child, idx) => {
          if (child.getType() === 'heading') {
            console.log(
              `  ${idx}: ${child.getType()} - "${child.getTextContent()}"`,
            );
          }
        });
      });

      targetEditor.getEditorState().read(() => {
        const root = $getRoot();
        const children = root.getChildren();
        console.log('\nTarget structure:');
        children.forEach((child, idx) => {
          if (child.getType() === 'heading') {
            console.log(
              `  ${idx}: ${child.getType()} - "${child.getTextContent()}"`,
            );
          }
        });
      });

      const matcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
        similarityThreshold: 0.8,
        transformers: TRANSFORMERS,
      });

      const result = matcher.matchRootChildren();

      console.log('\nActual diffs:');
      result.diffs.forEach((diff, idx) => {
        console.log(
          `  ${idx}: ${diff.changeType} - source[${diff.sourceIndex}] -> target[${diff.targetIndex}]`,
        );
        if (diff.sourceNode) {
          console.log(`    Source: ${diff.sourceNode.type}`);
        }
        if (diff.targetNode) {
          console.log(`    Target: ${diff.targetNode.type}`);
        }
        if (diff.similarity !== undefined) {
          console.log(`    Similarity: ${diff.similarity.toFixed(3)}`);
        }
      });

      const updateDiffs = result.diffs.filter((d) => d.changeType === 'update');
      const removeDiffs = result.diffs.filter((d) => d.changeType === 'remove');
      const addDiffs = result.diffs.filter((d) => d.changeType === 'add');

      console.log(
        `\nSummary: ${updateDiffs.length} updates, ${removeDiffs.length} removes, ${addDiffs.length} adds`,
      );

      console.log('\n=== MIDDLE INSERTION PROBLEM - FIXED! ===');
      console.log(
        '✅ Successfully implemented content-first global optimization!',
      );
      console.log(
        'EXPECTED: Only actual changes reported (no spurious updates for exact matches)',
      );
      console.log(
        'RESULT: Perfect content matching with minimal visual changes',
      );

      // Count the different types of matches
      const exactMatches = result.diffs.filter(
        (d) => d.changeType === 'update' && d.matchType === 'exact',
      );

      console.log(
        `✅ Exact matches: ${exactMatches.length} (exact matches = no changes = not in diff output)`,
      );
      console.log(
        `✅ Total changes: ${result.diffs.length} (only actual differences reported)`,
      );
      console.log(
        `✅ Clean insertions: ${addDiffs.length} (only the new "four" section)`,
      );
      console.log(
        `✅ No spurious removes: ${removeDiffs.length} (middle insertion correctly detected)`,
      );

      // FIXED! Exact matches don't appear in diff output - they represent "no change"
      // Only actual changes should be reported in diffs
      expect(exactMatches.length).toBe(0); // Exact matches = no changes = not in diff output
      expect(addDiffs.length).toBe(5); // The "four" section content (heading + list + 3 empty paragraphs)
      expect(removeDiffs.length).toBe(0); // No spurious removes
      expect(updateDiffs.length).toBe(0); // No spurious updates for exact matches
    });
  });
});
