/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * OUR FORKED VERSION OF LEXICAL'S MARKDOWN IMPORT
 * Modified to handle 2-space indents properly.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
    $createLineBreakNode,
    $createParagraphNode,
    $createTextNode,
    $getRoot,
    $getSelection,
    $isParagraphNode,
    ElementNode,
    LexicalNode,
    ParagraphNode,
} from 'lexical';
import { $isListItemNode, $isListNode, ListItemNode, ListNode } from '@lexical/list';
import { $isQuoteNode, QuoteNode } from '@lexical/rich-text';
import { $findMatchingParent } from '@lexical/utils';
import type {
    ElementTransformer,
    MultilineElementTransformer,
    TextFormatTransformer,
    TextMatchTransformer,
    Transformer,
} from '@lexical/markdown';
import { importTextTransformers } from './importTextTransformers';

function isEmptyParagraph(node: LexicalNode): boolean {
  if (!$isParagraphNode(node)) {
    return false;
  }
  const children = node.getChildren();
  return children.length === 0 ||
    (children.length === 1 && children[0].getTextContent().trim() === '');
}

interface TransformersByType {
  element: Array<ElementTransformer>;
  textFormat: Array<TextFormatTransformer>;
  textMatch: Array<TextMatchTransformer>;
  multilineElement: Array<MultilineElementTransformer>;
}

function transformersByType(transformers: Array<Transformer>): TransformersByType {
  const byType: TransformersByType = {
    element: [],
    textFormat: [],
    textMatch: [],
    multilineElement: [],
  };

  for (const transformer of transformers) {
    const type = transformer.type;
    if (type === 'element') {
      byType.element.push(transformer as ElementTransformer);
    } else if (type === 'text-format') {
      byType.textFormat.push(transformer as TextFormatTransformer);
    } else if (type === 'text-match') {
      byType.textMatch.push(transformer as TextMatchTransformer);
    } else if (type === 'multiline-element') {
      byType.multilineElement.push(transformer as MultilineElementTransformer);
    }
  }

  return byType;
}

export interface TextFormatTransformersIndex {
  fullMatchRegExpByTag: { [tag: string]: RegExp };
  openTagsRegExp: RegExp;
  transformersByTag: { [tag: string]: TextFormatTransformer };
}

function createTextFormatTransformersIndex(
  textTransformers: Array<TextFormatTransformer>
): TextFormatTransformersIndex {
  const transformersByTag: { [tag: string]: TextFormatTransformer } = {};
  const fullMatchRegExpByTag: { [tag: string]: RegExp } = {};
  const openTagsRegExp: string[] = [];
  const escapeRegExp = `(?<![\\\\])`;

  for (const transformer of textTransformers) {
    const { tag } = transformer;
    transformersByTag[tag] = transformer;
    const tagRegExp = tag.replace(/(\*|\^|\+)/g, '\\$1');
    openTagsRegExp.push(tagRegExp);

    // Single-char tag (e.g. "*")
    if (tag.length === 1) {
      fullMatchRegExpByTag[tag] = new RegExp(
        `(?<![\\\\${tagRegExp}])(${tagRegExp})((\\\\${tagRegExp})?.*?[^${tagRegExp}\\s](\\\\${tagRegExp})?)((?<!\\\\)|(?<=\\\\\\\\))(${tagRegExp})(?![\\\\${tagRegExp}])`
      );
    } else {
      // Multi-char tags (e.g. "**")
      fullMatchRegExpByTag[tag] = new RegExp(
        `(?<!\\\\)(${tagRegExp})((\\\\${tagRegExp})?.*?[^\\s](\\\\${tagRegExp})?)((?<!\\\\)|(?<=\\\\\\\\))(${tagRegExp})(?!\\\\)`
      );
    }
  }

  return {
    fullMatchRegExpByTag,
    openTagsRegExp: new RegExp(`${escapeRegExp}(${openTagsRegExp.join('|')})`, 'g'),
    transformersByTag,
  };
}

// importTextTransformers is now imported from './importTextTransformers'

function $importMultiline(
  lines: string[],
  startLineIndex: number,
  multilineElementTransformers: Array<MultilineElementTransformer>,
  rootNode: ElementNode
): [boolean, number] {
  for (const transformer of multilineElementTransformers) {
    const { handleImportAfterStartMatch, regExpEnd, regExpStart, replace } = transformer;
    const startMatch = lines[startLineIndex].match(regExpStart);

    if (!startMatch) {
      continue;
    }

    if (handleImportAfterStartMatch) {
      const result = handleImportAfterStartMatch({
        lines,
        rootNode,
        startLineIndex,
        startMatch,
        transformer,
      });
      if (result === null) {
        continue;
      } else if (result) {
        return result;
      }
    }

    const regexpEndRegex = typeof regExpEnd === 'object' && 'regExp' in regExpEnd
      ? regExpEnd.regExp
      : regExpEnd;
    const isEndOptional = regExpEnd && typeof regExpEnd === 'object' && 'optional' in regExpEnd
      ? regExpEnd.optional
      : !regExpEnd;

    let endLineIndex = startLineIndex;
    const linesLength = lines.length;

    while (endLineIndex < linesLength) {
      const endMatch = regexpEndRegex ? lines[endLineIndex].match(regexpEndRegex) : null;

      if (!endMatch) {
        if (!isEndOptional || (isEndOptional && endLineIndex < linesLength - 1)) {
          endLineIndex++;
          continue;
        }
      }

      if (endMatch && startLineIndex === endLineIndex && endMatch.index === startMatch.index) {
        endLineIndex++;
        continue;
      }

      const linesInBetween: string[] = [];
      if (endMatch && startLineIndex === endLineIndex) {
        linesInBetween.push(lines[startLineIndex].slice(startMatch[0].length, -endMatch[0].length));
      } else {
        for (let i = startLineIndex; i <= endLineIndex; i++) {
          if (i === startLineIndex) {
            const text = lines[i].slice(startMatch[0].length);
            linesInBetween.push(text);
          } else if (i === endLineIndex && endMatch) {
            const text = lines[i].slice(0, -endMatch[0].length);
            linesInBetween.push(text);
          } else {
            linesInBetween.push(lines[i]);
          }
        }
      }

      if (replace(rootNode, null, startMatch, endMatch, linesInBetween, true) !== false) {
        return [true, endLineIndex];
      }

      break;
    }
  }

  return [false, startLineIndex];
}

function $importBlocks(
  lineText: string,
  rootNode: ElementNode,
  elementTransformers: Array<ElementTransformer>,
  textFormatTransformersIndex: TextFormatTransformersIndex,
  textMatchTransformers: Array<TextMatchTransformer>,
  shouldPreserveNewLines: boolean
): void {
  const textNode = $createTextNode(lineText);
  const elementNode = $createParagraphNode();
  elementNode.append(textNode);
  rootNode.append(elementNode);

  for (const { regExp, replace } of elementTransformers) {
    const match = lineText.match(regExp);
    if (match) {
      textNode.setTextContent(lineText.slice(match[0].length));
      if (replace(elementNode, [textNode], match, true) !== false) {
        // Successfully processed by a transformer
        // Apply text format transformers to the text node after element transformation
        importTextTransformers(textNode, textFormatTransformersIndex, textMatchTransformers);
        // Make sure the temporary paragraph is removed
        if (elementNode.isAttached()) {
          elementNode.remove();
        }
        return;
      }
    }
  }

  importTextTransformers(textNode, textFormatTransformersIndex, textMatchTransformers);

  // CRITICAL FIX: This is where Lexical combines indented lines!
  // We're completely disabling line merging for now
  // because our transformers should have already handled list items
  const DISABLE_LINE_MERGING = true;

  if (DISABLE_LINE_MERGING) {
    return; // Don't merge any lines
  }

  if (elementNode.isAttached() && lineText.length > 0) {
    const previousNode = elementNode.getPreviousSibling();

    if (!shouldPreserveNewLines &&
        ($isParagraphNode(previousNode) || $isQuoteNode(previousNode) || $isListNode(previousNode))) {

      let targetNode: ListNode | ParagraphNode | QuoteNode | ListItemNode | null = previousNode;
      if ($isListNode(previousNode)) {
        const lastDescendant = previousNode.getLastDescendant();
        if (lastDescendant == null) {
          targetNode = null;
        } else {
          targetNode = $findMatchingParent(lastDescendant, $isListItemNode);
        }
      }

      if (targetNode != null && targetNode.getTextContentSize() > 0) {
        targetNode.splice(targetNode.getChildrenSize(), 0, [$createLineBreakNode(), ...elementNode.getChildren()]);
        elementNode.remove();
      }
    }
  }
}

export function createMarkdownImport(
  transformers: Array<Transformer>,
  shouldPreserveNewLines: boolean = false
): (markdownString: string, node?: ElementNode) => void {
  const byType = transformersByType(transformers);
  const textFormatTransformersIndex = createTextFormatTransformersIndex(byType.textFormat);

  return (markdownString: string, node?: ElementNode) => {
    const lines = markdownString.split('\n');
    const linesLength = lines.length;
    const root = node || $getRoot();
    root.clear();

    for (let i = 0; i < linesLength; i++) {
      const lineText = lines[i];
      const [imported, shiftedIndex] = $importMultiline(lines, i, byType.multilineElement, root);

      if (imported) {
        i = shiftedIndex;
        continue;
      }

      $importBlocks(
        lineText,
        root,
        byType.element,
        textFormatTransformersIndex,
        byType.textMatch,
        shouldPreserveNewLines
      );
    }

    // Remove empty paragraphs
    const children = root.getChildren();
    for (const child of children) {
      if (!shouldPreserveNewLines && isEmptyParagraph(child) && root.getChildrenSize() > 1) {
        child.remove();
      }
    }

    if ($getSelection() !== null) {
      root.selectStart();
    }
  };
}

/**
 * OUR VERSION of markdown import - uses 2-space indents
 * NEVER use Lexical's $convertFromMarkdownString!
 */
export function $convertFromMarkdownStringRexical(
  markdown: string,
  transformers: Array<Transformer>,
  node?: ElementNode,
  shouldPreserveNewLines: boolean = false
): void {
  const importMarkdown = createMarkdownImport(transformers, shouldPreserveNewLines);
  return importMarkdown(markdown, node);
}
