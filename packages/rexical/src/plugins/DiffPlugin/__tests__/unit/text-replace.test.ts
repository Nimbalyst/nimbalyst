/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* eslint-disable @typescript-eslint/no-explicit-any, lexical/no-optional-chaining */

import type {Transformer} from '@lexical/markdown';

import {TRANSFORMERS} from '@lexical/markdown';
import {createTestEditor} from '../utils';
import {
  $convertFromEnhancedMarkdownString,
  $convertToEnhancedMarkdownString,
} from '../../../../markdown';
import {parseFrontmatter} from '../../../../markdown/FrontmatterUtils';
import {MARKDOWN_TEST_TRANSFORMERS} from '../utils/testConfig';
import {$getRoot} from 'lexical';

import {applyMarkdownReplace, type TextReplacement} from '../../core/diffUtils';
import {
  assertApproveProducesTarget,
  assertRejectProducesOriginal,
  assertReplacementApplied,
  setupMarkdownReplaceTest,
} from '../utils/replaceTestUtils';

/**
 * Helper function to escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('Text Replacement Changes', () => {
  test('Simple word replacement in paragraph', () => {
    const originalMarkdown = `This is a simple paragraph.`;
    const replacements: TextReplacement[] = [
      {oldText: 'simple', newText: 'modified'},
    ];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // Test that the diff has been applied with correct add/remove nodes
    assertReplacementApplied(result, ['modified'], ['simple']);

    // Test approve/reject functionality
    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });

  test('Adding text to paragraph', () => {
    const originalMarkdown = `This is a paragraph.`;
    const replacements: TextReplacement[] = [
      {oldText: 'a paragraph', newText: 'a great paragraph'},
    ];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // When adding text, we should see the new text as an add node
    assertReplacementApplied(result, ['great '], []);
    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });

  test('Removing text from paragraph', () => {
    const originalMarkdown = `This is a very long paragraph.`;
    const replacements: TextReplacement[] = [
      {oldText: 'very long ', newText: ''},
    ];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // When removing text, we should see the removed text as a remove node
    assertReplacementApplied(result, [], ['very long ']);
    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });

  test('Multiple replacements in paragraph', () => {
    const originalMarkdown = `The quick brown fox jumps.`;
    const replacements: TextReplacement[] = [
      {oldText: 'quick', newText: 'fast'},
      {oldText: 'brown', newText: 'red'},
      {oldText: 'jumps', newText: 'leaps'},
    ];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // With multiple replacements, the diff algorithm may optimize and find common segments
    // The exact segmentation depends on the diffWords algorithm, but we should see
    // the combined changes reflected in the add/remove nodes
    assertReplacementApplied(
      result,
      ['fast red fox leaps'],
      ['quick brown fox jumps'],
    );
    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });

  test('Bold formatting addition', () => {
    const originalMarkdown = `This is a simple paragraph.`;
    const replacements: TextReplacement[] = [
      {oldText: 'simple', newText: '**simple**'},
    ];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // When formatting is added, the structure changes from a single text node
    // to multiple nodes with formatting, so we expect the whole sentence to be replaced
    assertReplacementApplied(
      result,
      ['This is a ', 'simple', ' paragraph.'], // New structure with formatting
      ['This is a simple paragraph.'], // Original single text node
    );

    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });

  test('Multiple word phrase replacement', () => {
    const originalMarkdown = `The quick brown fox jumps over the lazy dog.`;
    const replacements: TextReplacement[] = [
      {oldText: 'quick brown fox', newText: 'fast red fox'},
      {oldText: 'jumps', newText: 'leaps'},
    ];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // Multiple phrase replacements should be handled efficiently by the diff algorithm
    assertReplacementApplied(
      result,
      ['fast red fox leaps'],
      ['quick brown fox jumps'],
    );
    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });

  test('Error handling for non-existent text', () => {
    const originalMarkdown = `This is a simple paragraph.`;
    const replacements: TextReplacement[] = [
      {oldText: 'nonexistent', newText: 'replacement'},
    ];

    // Test that the error is thrown when trying to replace non-existent text
    expect(() => {
      const editor = createTestEditor();
      applyMarkdownReplace(
        editor,
        originalMarkdown,
        replacements,
        TRANSFORMERS,
      );
    }).toThrow(
      'Text replacement failed: Old text "nonexistent" not found in original markdown',
    );
  });

  test('Empty replacement (deletion)', () => {
    const originalMarkdown = `This is a very simple paragraph.`;
    const replacements: TextReplacement[] = [{oldText: 'very ', newText: ''}];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // Empty replacement should result in removal of the specified text
    assertReplacementApplied(result, [], ['very ']);
    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });

  test('Multiple instances of same text', () => {
    const originalMarkdown = `The cat and the cat went to the store.`;
    const replacements: TextReplacement[] = [{oldText: 'cat', newText: 'dog'}];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // All instances should be replaced according to the global replacement logic
    assertReplacementApplied(result, ['dog and the dog'], ['cat and the cat']);
    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });

  test('Special regex characters in replacement', () => {
    const originalMarkdown = `This has (special) characters: [brackets] and {braces}.`;
    const replacements: TextReplacement[] = [
      {oldText: '(special)', newText: '(modified)'},
      {oldText: '[brackets]', newText: '[updated]'},
      {oldText: '{braces}', newText: '{changed}'},
    ];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // Special regex characters should be properly escaped and handled
    assertReplacementApplied(
      result,
      ['modified) characters: [updated] and {changed'],
      ['special) characters: [brackets] and {braces'],
    );
    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });

  test('updates plan status field in frontmatter', () => {
    const originalMarkdown = `---\nplanStatus:\n  planType: bug-fix\n---\n\n# statustest\n\nContent before marker.\n\n---\nNot frontmatter block\n`;

    const editor = createTestEditor();

    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        $convertFromEnhancedMarkdownString(
          originalMarkdown,
          MARKDOWN_TEST_TRANSFORMERS,
          root,
          true,
          true,
        );
      },
      {discrete: true},
    );

    const actualOriginalMarkdown = editor.getEditorState().read(() =>
      $convertToEnhancedMarkdownString(MARKDOWN_TEST_TRANSFORMERS, {
        includeFrontmatter: true,
        shouldPreserveNewLines: true,
      }),
    );

    const frontmatterMatch = actualOriginalMarkdown.match(/^---\n[\s\S]*?\n---\n?/);
    expect(frontmatterMatch).not.toBeNull();
    const originalFrontmatter = frontmatterMatch![0];
    const updatedFrontmatter = originalFrontmatter.replace(
      'planType: bug-fix',
      'planType: documentation',
    );

    const replacements: TextReplacement[] = [
      {oldText: originalFrontmatter, newText: updatedFrontmatter},
    ];

    applyMarkdownReplace(
      editor,
      actualOriginalMarkdown,
      replacements,
      MARKDOWN_TEST_TRANSFORMERS,
    );

    const resultingMarkdown = editor.getEditorState().read(() =>
      $convertToEnhancedMarkdownString(MARKDOWN_TEST_TRANSFORMERS, {
        includeFrontmatter: true,
        shouldPreserveNewLines: true,
      }),
    );

    const expectedMarkdown = actualOriginalMarkdown.replace(
      originalFrontmatter,
      updatedFrontmatter,
    );

    expect(resultingMarkdown).toBe(expectedMarkdown);

    const {content: resultingBody, data: resultingData} = parseFrontmatter(resultingMarkdown);
    expect(resultingData?.planStatus?.planType).toBe('documentation');
    expect(resultingBody).toContain('# statustest');
    expect(resultingBody).toContain('Not frontmatter block');
  });
});
