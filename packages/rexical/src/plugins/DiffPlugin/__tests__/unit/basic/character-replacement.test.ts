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

import {applyMarkdownReplace, type TextReplacement} from '../../../core/diffUtils';
import {
  assertApproveProducesTarget,
  assertRejectProducesOriginal,
  assertReplacementApplied,
  setupMarkdownReplaceTest,
} from '../../utils/replaceTestUtils';

describe('Converting characters', () => {
  test('p', () => {
    // Test replacement where 'p' might cause regex issues with word boundaries
    const originalMarkdown = `The app is peppered with problems`;
    const replacements: TextReplacement[] = [{oldText: 'p', newText: 'P'}];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // This should replace ALL instances of 'p' including in middle of words
    // Expected: "The aPP is PePPered with Problems"
    assertReplacementApplied(
      result,
      ['The aPP is PePPered with Problems'],
      ['The app is peppered with problems'],
    );

    // Test approve/reject functionality
    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });

  test('b', () => {
    // Test replacement where 'b' might cause regex issues
    const originalMarkdown = `Bob bought a big bottle of beer`;
    const replacements: TextReplacement[] = [{oldText: 'b', newText: 'B'}];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // This should replace ALL instances of 'b' including in middle of words
    // Expected: "BoB Bought a Big Bottle of Beer"
    assertReplacementApplied(
      result,
      ['BoB Bought a Big Bottle of Beer'],
      ['Bob bought a big bottle of beer'],
    );

    // Test approve/reject functionality
    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });

  test('strong', () => {
    // Test replacement where 'strong' might be part of a longer word
    const originalMarkdown = `He has strong muscles and stronghold defenses`;
    const replacements: TextReplacement[] = [
      {oldText: 'strong', newText: 'STRONG'},
    ];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // This should replace ALL instances of 'strong' even when part of other words
    // The diff algorithm correctly identifies only the changed portions
    // "He has " stays unchanged, only "strong muscles and stronghold" changes to "STRONG muscles and STRONGhold", " defenses" stays unchanged
    assertReplacementApplied(
      result,
      ['STRONG muscles and STRONGhold'],
      ['strong muscles and stronghold'],
    );

    // Test approve/reject functionality
    assertApproveProducesTarget(result);
    assertRejectProducesOriginal(result);
  });
});
