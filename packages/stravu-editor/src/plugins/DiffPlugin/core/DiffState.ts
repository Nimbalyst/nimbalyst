/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {createState, $getState, $setState, type LexicalNode} from 'lexical';

/**
 * The possible diff states for a node
 */
export type DiffStateType = 'added' | 'removed' | 'modified' | null;

/**
 * Configuration for tracking diff state on nodes using NodeState API.
 * This allows us to mark entire nodes as added, removed, or modified
 * without changing their structure or creating wrapper nodes.
 */
export const DiffState = createState('diff', {
  parse: (value): DiffStateType => {
    if (value === 'added' || value === 'removed' || value === 'modified') {
      return value;
    }
    return null; // default value
  },
});

/**
 * Helper functions for working with DiffState
 */

/**
 * Check if a node has any diff state
 */
export function $hasDiffState(node: LexicalNode): boolean {
  const diffState = $getState(node, DiffState);
  return diffState !== null;
}

/**
 * Get the diff state of a node
 */
export function $getDiffState(node: LexicalNode): DiffStateType {
  return $getState(node, DiffState);
}

/**
 * Set the diff state of a node
 */
export function $setDiffState(
  node: LexicalNode,
  state: DiffStateType,
): LexicalNode {
  return $setState(node, DiffState, state);
}

/**
 * Clear the diff state of a node
 */
export function $clearDiffState(node: LexicalNode): LexicalNode {
  return $setDiffState(node, null);
}
