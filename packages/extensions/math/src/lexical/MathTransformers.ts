import type {
  MultilineElementTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';

import {
  $createMathBlockNode,
  $isMathBlockNode,
  MathBlockNode,
  type MathBlockDelimiter,
} from './MathBlockNode';
import {
  $createMathInlineNode,
  $isMathInlineNode,
  MathInlineNode,
} from './MathInlineNode';

const INLINE_MATH_IMPORT_REGEXP = /\$(?!\$)([^$\n]+?)\$(?!\$)/;
const INLINE_MATH_SHORTCUT_REGEXP = /\$(?!\$)([^$\n]+?)\$(?!\$)$/;
const BLOCK_MATH_DELIMITER_REGEXP = /^[ \t]*(\${1,2})[ \t]*$/;

export const INLINE_MATH_TRANSFORMER: TextMatchTransformer = {
  dependencies: [MathInlineNode],
  export: (node) => {
    if (!$isMathInlineNode(node)) {
      return null;
    }

    return `$${node.getSource()}$`;
  },
  importRegExp: INLINE_MATH_IMPORT_REGEXP,
  regExp: INLINE_MATH_SHORTCUT_REGEXP,
  replace: (textNode, match) => {
    const [, source] = match;
    textNode.replace($createMathInlineNode(source));
  },
  trigger: '$',
  type: 'text-match',
};

export const BLOCK_MATH_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [MathBlockNode],
  export: (node) => {
    if (!$isMathBlockNode(node)) {
      return null;
    }

    const delimiter = node.getDelimiter();
    return `${delimiter}\n${node.getSource()}\n${delimiter}`;
  },
  regExpStart: BLOCK_MATH_DELIMITER_REGEXP,
  regExpEnd: {
    regExp: BLOCK_MATH_DELIMITER_REGEXP,
  },
  replace: (_rootNode, _children, _startMatch, _endMatch, _linesInBetween) => {
    return false;
  },
  handleImportAfterStartMatch: ({
    lines,
    rootNode,
    startLineIndex,
    startMatch,
  }) => {
    const delimiter = normalizeDelimiter(startMatch[1]);
    const contentLines: string[] = [];

    for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      const endMatch = lines[lineIndex].match(BLOCK_MATH_DELIMITER_REGEXP);
      if (endMatch && normalizeDelimiter(endMatch[1]) === delimiter) {
        rootNode.append($createMathBlockNode(contentLines.join('\n'), delimiter));
        return [true, lineIndex];
      }

      contentLines.push(lines[lineIndex]);
    }

    return null;
  },
  type: 'multiline-element',
};

function normalizeDelimiter(value: string): MathBlockDelimiter {
  return value === '$' ? '$' : '$$';
}
