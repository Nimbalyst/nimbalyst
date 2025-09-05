/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* eslint-disable @typescript-eslint/no-explicit-any, lexical/no-optional-chaining */

import {type TextReplacement} from '../../core/diffUtils';
import {
  assertApproveProducesTarget,
  assertRejectProducesOriginal,
  assertReplacementApplied,
  setupMarkdownReplaceTest,
} from '../utils/replaceTestUtils';

describe('Test Diff Errors', () => {
  test('Handles non-matching text gracefully', () => {
    const originalMarkdown = `This is some text that we are trying to edit`;

    const replacements: TextReplacement[] = [
      {
        oldText: 'This is some text that does not match',
        newText: 'replaced text',
      }, // purposefully does not match
    ];

    // The diff system is designed to be resilient
    // It should handle non-matching text without throwing
    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);
    
    // The system should continue and create a diff even when text doesn't match
    expect(result).toBeDefined();
    expect(result.originalMarkdown).toBe(originalMarkdown);
    
    // The target markdown should remain the same as original when replacement fails
    expect(result.targetMarkdown).toBe(originalMarkdown);
  });

  test('Non-matching replacements still produce valid diff state', () => {
    const originalMarkdown = `This is some text that we are trying to edit`;
    const targetOldText = 'This is some text that does not match';

    const replacements: TextReplacement[] = [
      {oldText: targetOldText, newText: 'replaced text'}, // purposefully does not match
    ];

    // The system should handle non-matching text gracefully
    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);
    
    // Verify the result is still valid
    expect(result).toBeDefined();
    expect(result.replaceEditor).toBeDefined();
    expect(result.originalMarkdown).toBe(originalMarkdown);
    
    // Since the text doesn't match, target should be same as original
    expect(result.targetMarkdown).toBe(originalMarkdown);
    
    // The editor should still be functional
    const {addNodes, removeNodes} = result.getDiffNodes();
    expect(Array.isArray(addNodes)).toBe(true);
    expect(Array.isArray(removeNodes)).toBe(true);
  });
});
