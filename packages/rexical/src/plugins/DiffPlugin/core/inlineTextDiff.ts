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

import {$createTextNode, $isElementNode, $parseSerializedNode} from 'lexical';

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
  // Clear the container to rebuild it
  containerNode.clear();

  // Simple case: both have single text nodes
  if (
    sourceChildren.length === 1 &&
    targetChildren.length === 1 &&
    sourceChildren[0].type === 'text' &&
    targetChildren[0].type === 'text'
  ) {
    const sourceTextNode = sourceChildren[0] as SerializedTextNode;
    const targetTextNode = targetChildren[0] as SerializedTextNode;
    const sourceText = sourceTextNode.text;
    const targetText = targetTextNode.text;

    // Check if formatting is the same
    const sourceFormat = sourceTextNode.format || 0;
    const targetFormat = targetTextNode.format || 0;

    if (sourceFormat === targetFormat) {
      // Use word-level diff when no formatting changes
      const diffSegments = diffWords(sourceText, targetText);
      for (const segment of diffSegments) {
        if (segment.type === 'equal') {
          const textNode = $createTextNode(segment.text);
          textNode.setFormat(sourceFormat);
          containerNode.append(textNode);
        } else if (segment.type === 'delete') {
          const textNode = $createTextNode(segment.text);
          textNode.setFormat(sourceFormat);
          // Mark as removed content using DiffState
          $setDiffState(textNode, 'removed');
          containerNode.append(textNode);
        } else {
          const textNode = $createTextNode(segment.text);
          textNode.setFormat(targetFormat);
          // Mark as added content using DiffState
          $setDiffState(textNode, 'added');
          containerNode.append(textNode);
        }
      }
      return;
    }
  }

  // Complex case: handle mixed content (text with different formatting, links, etc.)
  // Show the entire source content as removed and target content as added

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
