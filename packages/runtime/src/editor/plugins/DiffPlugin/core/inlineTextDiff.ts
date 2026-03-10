/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {
  ElementNode,
  SerializedLexicalNode,
  SerializedTextNode,
} from 'lexical';

import {$createTextNode, $isElementNode, $isTextNode, $parseSerializedNode} from 'lexical';

import {diffWords} from './diffWords';
import {$setDiffState} from './DiffState';

/**
 * Unified inline text diff system for any container node.
 * Uses DiffState-based approach for clean diff visualization.
 * Handles text, formatting, links, and other inline elements generically.
 */
export function $applyInlineTextDiff(
  containerNode: ElementNode,
  sourceChildren: SerializedLexicalNode[],
  targetChildren: SerializedLexicalNode[],
): void {
  // Debug logging (commented out - enable for debugging inline diff issues)
  // const hasHashtag = [...sourceChildren, ...targetChildren].some(c => c.type === 'hashtag');
  // if (hasHashtag) {
  //   console.log('[inlineTextDiff] Processing paragraph with hashtag');
  //   console.log('  sourceChildren:', sourceChildren.map(c => `${c.type}:${(c as any).text || ''}`));
  //   console.log('  targetChildren:', targetChildren.map(c => `${c.type}:${(c as any).text || ''}`));
  // }

  // Clear the container to rebuild it
  containerNode.clear();

  // Check if all children are text nodes (can have mixed formatting)
  const allSourceAreText = sourceChildren.every(c => c.type === 'text');
  const allTargetAreText = targetChildren.every(c => c.type === 'text');

  if (allSourceAreText && allTargetAreText && sourceChildren.length > 0 && targetChildren.length > 0) {
    // Extract text and build formatting map for target
    const sourceText = sourceChildren.map(c => (c as SerializedTextNode).text).join('');
    const targetText = targetChildren.map(c => (c as SerializedTextNode).text).join('');

    // Check if this is a pure formatting change (text is identical)
    if (sourceText === targetText) {
      // Before marking as a formatting change, check if children are actually identical
      // (same count, same text, same format). If so, there's no change at all -
      // just rebuild the children without diff markers. This prevents false positives
      // where bold list items show as changed even when they haven't been modified.
      let childrenIdentical = sourceChildren.length === targetChildren.length;
      if (childrenIdentical) {
        for (let i = 0; i < sourceChildren.length; i++) {
          const s = sourceChildren[i] as SerializedTextNode;
          const t = targetChildren[i] as SerializedTextNode;
          if (s.text !== t.text || (s.format || 0) !== (t.format || 0)) {
            childrenIdentical = false;
            break;
          }
        }
      }

      if (childrenIdentical) {
        // Children are identical - no formatting change, just rebuild without markers
        for (const targetChild of targetChildren) {
          const node = $parseSerializedNode(targetChild);
          containerNode.append(node);
        }
        return;
      }

      // Pure formatting change - use full replacement approach for proper accept/reject
      // This ensures reject can revert to original formatting
      for (const sourceChild of sourceChildren) {
        $appendChildAsRemoved(containerNode, sourceChild);
      }
      for (const targetChild of targetChildren) {
        $appendChildAsAdded(containerNode, targetChild);
      }
      return;
    }

    // Text has changed - use inline diff with formatting preservation
    // Build a map of character position -> formatting for target text
    const targetFormatMap: number[] = [];
    let pos = 0;
    for (const child of targetChildren) {
      const textNode = child as SerializedTextNode;
      const format = textNode.format || 0;
      for (let i = 0; i < textNode.text.length; i++) {
        targetFormatMap[pos++] = format;
      }
    }

    // For source, use first node's format (or 0 if no children)
    const sourceFormat = sourceChildren.length > 0
      ? ((sourceChildren[0] as SerializedTextNode).format || 0)
      : 0;

    // Use word-level diff
    const diffSegments = diffWords(sourceText, targetText);

    let targetPos = 0; // Track position in target text for format lookup

    for (const segment of diffSegments) {
      if (segment.type === 'equal') {
        // Unchanged text - use target formatting to show if formatting changed
        // Split by formatting boundaries in target
        for (let i = 0; i < segment.text.length; i++) {
          const char = segment.text[i];
          const format = targetFormatMap[targetPos++] || 0;

          // Check if this format is different from previous or start of segment
          if (i === 0 || targetFormatMap[targetPos - 2] !== format) {
            // Start new text node with this format
            const text = segment.text[i];
            const textNode = $createTextNode(text);
            textNode.setFormat(format);

            // Note: We don't mark as 'modified' for formatting changes here
            // Pure formatting changes are handled separately (full replacement)
            // This code only handles text changes with formatting preservation

            containerNode.append(textNode);
          } else {
            // Continue current text node
            const lastChild = containerNode.getLastChild();
            if (lastChild && $isTextNode(lastChild)) {
              lastChild.setTextContent(lastChild.getTextContent() + char);
            }
          }
        }
      } else if (segment.type === 'delete') {
        // Removed text - use source formatting
        const textNode = $createTextNode(segment.text);
        textNode.setFormat(sourceFormat);
        $setDiffState(textNode, 'removed');
        containerNode.append(textNode);
      } else {
        // Added text - use target formatting for each character
        for (let i = 0; i < segment.text.length; i++) {
          const char = segment.text[i];
          const format = targetFormatMap[targetPos++] || 0;

          // Check if this format is different from previous or start of segment
          if (i === 0 || targetFormatMap[targetPos - 2] !== format) {
            const textNode = $createTextNode(char);
            textNode.setFormat(format);
            $setDiffState(textNode, 'added');
            containerNode.append(textNode);
          } else {
            // Continue current text node
            const lastChild = containerNode.getLastChild();
            if (lastChild && $isTextNode(lastChild)) {
              lastChild.setTextContent(lastChild.getTextContent() + char);
            }
          }
        }
      }
    }
    return;
  }

  // Complex case: handle mixed content (text with different formatting, links, hashtags, etc.)

  // Check if source and target are IDENTICAL (same structure and content)
  // This prevents false positives where hashtag/emoji nodes cause unnecessary red/green
  if (sourceChildren.length === targetChildren.length) {
    let identical = true;
    for (let i = 0; i < sourceChildren.length; i++) {
      const source = sourceChildren[i];
      const target = targetChildren[i];

      // Compare type
      if (source.type !== target.type) {
        identical = false;
        break;
      }

      // Compare text content (works for text, hashtag, emoji nodes)
      const sourceText = (source as any).text || '';
      const targetText = (target as any).text || '';
      if (sourceText !== targetText) {
        identical = false;
        break;
      }

      // Compare format for text nodes
      if (source.type === 'text') {
        const sourceFormat = (source as SerializedTextNode).format || 0;
        const targetFormat = (target as SerializedTextNode).format || 0;
        if (sourceFormat !== targetFormat) {
          identical = false;
          break;
        }
      }
    }

    // If identical, just add target children without diff markers
    if (identical) {
      // if (hasHashtag) {
      //   console.log('[inlineTextDiff] Children are IDENTICAL! Adding without diff markers');
      // }
      for (const targetChild of targetChildren) {
        const node = $parseSerializedNode(targetChild);
        containerNode.append(node);
      }
      return;
    }
    // else if (hasHashtag) {
    //   console.log('[inlineTextDiff] Children are NOT identical, falling back to remove+add');
    // }
  }

  // Content is different - show the entire source content as removed and target content as added

  // Add all source children as removed
  for (const sourceChild of sourceChildren) {
    $appendChildAsRemoved(containerNode, sourceChild);
  }

  // Add all target children as added
  for (const targetChild of targetChildren) {
    $appendChildAsAdded(containerNode, targetChild);
  }
}

/**
 * Append a serialized node as removed content.
 * Handles text nodes, links, and other inline elements generically.
 */
function $appendChildAsRemoved(
  containerNode: ElementNode,
  serializedChild: SerializedLexicalNode,
): void {
  if (serializedChild.type === 'text') {
    const textNode = serializedChild as SerializedTextNode;
    const node = $createTextNode(textNode.text);
    node.setFormat(textNode.format || 0);
    // Mark as removed content using DiffState
    $setDiffState(node, 'removed');
    containerNode.append(node);
  } else {
    // For non-text nodes (links, etc.), recreate the node and mark it as removed using DiffState
    const node = $parseSerializedNode(serializedChild);
    $setDiffState(node, 'removed');
    containerNode.append(node);
  }
}

/**
 * Append a serialized node as added content.
 * Handles text nodes, links, and other inline elements generically.
 */
function $appendChildAsAdded(
  containerNode: ElementNode,
  serializedChild: SerializedLexicalNode,
): void {
  if (serializedChild.type === 'text') {
    const textNode = serializedChild as SerializedTextNode;
    const node = $createTextNode(textNode.text);
    node.setFormat(textNode.format || 0);
    // Mark as added content using DiffState
    $setDiffState(node, 'added');
    containerNode.append(node);
  } else {
    // For non-text nodes (links, etc.), recreate the node and mark it as added using DiffState
    const node = $parseSerializedNode(serializedChild);
    $setDiffState(node, 'added');
    containerNode.append(node);
  }
}
