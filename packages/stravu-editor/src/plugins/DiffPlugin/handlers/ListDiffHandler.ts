/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {NodeStructureValidator} from '../core/NodeStructureValidator';
import type {
  DiffHandlerContext,
  DiffHandlerResult,
  DiffNodeHandler,
} from './DiffNodeHandler';

import {$isListItemNode, $isListNode} from '@lexical/list';
import {
  $createTextNode,
  $isElementNode,
  $isTextNode,
  ElementNode,
  LexicalNode,
  SerializedLexicalNode,
} from 'lexical';

import {createNodeFromSerialized} from '../core/createNodeFromSerialized';
import {$setDiffState, $getDiffState, $clearDiffState} from '../core/DiffState';
import {$applyInlineTextDiff} from '../core/inlineTextDiff';
import {$applySubTreeDiff} from '../core/diffUtils';

/**
 * Handler for list node types using DiffState-based approach with recursive sub-tree matching
 * Supports both bullet and numbered lists with proper diff visualization
 * Now includes recursive sub-tree diffing for fine-grained list item changes
 */
export class ListDiffHandler implements DiffNodeHandler {
  readonly nodeType = 'list';

  canHandle(context: DiffHandlerContext): boolean {
    return $isListNode(context.liveNode) || $isListItemNode(context.liveNode);
  }

  handleUpdate(context: DiffHandlerContext): DiffHandlerResult {
    const {liveNode, sourceNode, targetNode} = context;

    if ($isListNode(liveNode)) {
      return this.handleListNodeUpdate(
        liveNode,
        sourceNode,
        targetNode,
        context,
      );
    }

    if ($isListItemNode(liveNode)) {
      return this.handleListItemUpdate(
        liveNode,
        sourceNode,
        targetNode,
        context,
      );
    }

    return {handled: false};
  }

  handleAdd(
    targetNode: SerializedLexicalNode,
    parentNode: ElementNode,
    position: number,
    validator: NodeStructureValidator,
  ): DiffHandlerResult {
    try {
      const newNode = createNodeFromSerialized(targetNode);
      if (!$isElementNode(newNode)) {
        return {handled: false};
      }

      // Mark as added using DiffState
      $setDiffState(newNode, 'added');

      // Insert at the correct position
      const children = parentNode.getChildren();
      if (position < children.length) {
        children[position].insertBefore(newNode);
      } else {
        parentNode.append(newNode);
      }

      return {handled: true};
    } catch (error) {
      return {error: String(error), handled: false};
    }
  }

  handleRemove(
    liveNode: LexicalNode,
    validator: NodeStructureValidator,
  ): DiffHandlerResult {
    try {
      if ($isElementNode(liveNode)) {
        // Mark as removed using DiffState
        $setDiffState(liveNode, 'removed');
        return {handled: true};
      }
      return {handled: false};
    } catch (error) {
      return {error: String(error), handled: false};
    }
  }

  /**
   * Handle approval for list nodes
   */
  handleApprove(
    liveNode: LexicalNode,
    validator: NodeStructureValidator,
  ): DiffHandlerResult {
    if ($isElementNode(liveNode)) {
      this.processListApproval(liveNode);
      return {handled: true, skipChildren: true};
    }
    return {handled: false};
  }

  /**
   * Handle rejection for list nodes
   */
  handleReject(
    liveNode: LexicalNode,
    validator: NodeStructureValidator,
  ): DiffHandlerResult {
    if ($isElementNode(liveNode)) {
      this.processListRejection(liveNode);
      return {handled: true, skipChildren: true};
    }
    return {handled: false};
  }

  /**
   * Handle list node updates with recursive sub-tree matching
   */
  private handleListNodeUpdate(
    liveNode: ElementNode,
    sourceNode: SerializedLexicalNode,
    targetNode: SerializedLexicalNode,
    context: DiffHandlerContext,
  ): DiffHandlerResult {
    // Handle list type changes
    if ($isListNode(liveNode)) {
      const sourceListType = (sourceNode as any).listType;
      const targetListType = (targetNode as any).listType;

      if (sourceListType !== targetListType) {
        // Store the original list type for rejection purposes
        (liveNode as any).__originalListType = sourceListType;
        // Update to the target list type
        (liveNode as any).setListType(targetListType);

        // Mark the list as modified
        $setDiffState(liveNode, 'modified');
      }
    }

    // Extract children from source and target nodes
    const sourceChildren =
      'children' in sourceNode && Array.isArray(sourceNode.children)
        ? sourceNode.children
        : [];
    const targetChildren =
      'children' in targetNode && Array.isArray(targetNode.children)
        ? targetNode.children
        : [];

    // Check if we need to apply recursive sub-tree diffing
    if (sourceChildren.length > 0 || targetChildren.length > 0) {
      // Mark the list as modified since we're updating its contents
      $setDiffState(liveNode, 'modified');

      // Use recursive sub-tree diffing for better insertion positioning and index alignment
      if (
        context.sourceEditor &&
        context.targetEditor &&
        context.transformers
      ) {
        console.log(
          '\n🔄 Applying recursive sub-tree diff to list for better insertion positioning...',
        );

        try {
          // Apply recursive sub-tree diffing to the list children
          $applySubTreeDiff(
            liveNode,
            sourceNode,
            targetNode,
            context.sourceEditor,
            context.targetEditor,
            context.transformers,
          );

          console.log('✅ Recursive sub-tree diff completed successfully');
          return {handled: true, skipChildren: true};
        } catch (error) {
          console.warn(
            'Sub-tree diff failed, falling back to traditional approach:',
            error,
          );
          // Fall through to traditional approach
        }
      } else {
        console.log(
          '⚠️  Editor references not available, using traditional approach',
        );
      }

      // Traditional approach (fallback)
      // Process each list item individually
      const liveChildren = liveNode.getChildren();
      const maxLength = Math.max(
        sourceChildren.length,
        targetChildren.length,
        liveChildren.length,
      );

      for (let i = 0; i < maxLength; i++) {
        const sourceChild =
          i < sourceChildren.length ? sourceChildren[i] : null;
        const targetChild =
          i < targetChildren.length ? targetChildren[i] : null;
        const liveChild = i < liveChildren.length ? liveChildren[i] : null;

        if (
          sourceChild &&
          targetChild &&
          liveChild &&
          $isElementNode(liveChild)
        ) {
          // Update existing list item
          this.handleListItemUpdate(
            liveChild,
            sourceChild,
            targetChild,
            context,
          );
        } else if (targetChild && !sourceChild) {
          // Add new list item
          const newItem = createNodeFromSerialized(targetChild);
          if ($isElementNode(newItem)) {
            $setDiffState(newItem, 'added');
            liveNode.append(newItem);
          }
        } else if (sourceChild && !targetChild && liveChild) {
          // Remove list item
          $setDiffState(liveChild, 'removed');
        }
      }
    }

    // Skip children since we handled them manually
    return {handled: true, skipChildren: true};
  }

  /**
   * Handle list item updates
   */
  private handleListItemUpdate(
    liveNode: ElementNode,
    sourceNode: SerializedLexicalNode,
    targetNode: SerializedLexicalNode,
    context: DiffHandlerContext,
  ): DiffHandlerResult {
    const sourceChildren =
      'children' in sourceNode && Array.isArray(sourceNode.children)
        ? sourceNode.children
        : [];
    const targetChildren =
      'children' in targetNode && Array.isArray(targetNode.children)
        ? targetNode.children
        : [];

    // Check if this list item has nested lists (ListNode children)
    const hasNestedList =
      sourceChildren.some((child) => child.type === 'list') ||
      targetChildren.some((child) => child.type === 'list');

    if (hasNestedList) {
      // For list items with nested lists, don't use inline text diff
      // as it would destroy the nested list structure with clear()
      // Instead, just mark as modified and let the recursive system handle the rest
      console.log(
        '🏗️ List item contains nested list - preserving structure, letting recursive system handle nested content',
      );
      $setDiffState(liveNode, 'modified');
      return {handled: true, skipChildren: false}; // Let the system recurse into children
    } else {
      // For regular list items (text, links, formatting), use the inline text diff system
      $applyInlineTextDiff(liveNode, sourceChildren, targetChildren);
      $setDiffState(liveNode, 'modified');
      return {handled: true, skipChildren: true};
    }
  }

  /**
   * Process approval for lists and list items
   */
  private processListApproval(element: ElementNode): void {
    // Clear any diff state on the element itself
    $clearDiffState(element);

    // Handle list type changes
    if ($isListNode(element) && (element as any).__originalListType) {
      // Keep the new list type (approval)
      delete (element as any).__originalListType;
    }

    // Process children
    const children = [...element.getChildren()];

    for (const child of children) {
      const diffState = $getDiffState(child);

      if (diffState === 'added') {
        // Approve addition - clear diff state
        $clearDiffState(child);
      } else if (diffState === 'removed') {
        // Approve removal - remove the node
        child.remove();
        continue;
      } else if (diffState === 'modified') {
        // Approve modification - clear diff state and handle text nodes
        $clearDiffState(child);

        if ($isElementNode(child)) {
          // Process list item children for inline diff markers
          this.approveTextDiffMarkers(child);
        }
      }

      // Recursively process if it's an element
      if ($isElementNode(child)) {
        this.processListApproval(child);
      }
    }
  }

  /**
   * Process rejection for lists and list items
   */
  private processListRejection(element: ElementNode): void {
    // Clear any diff state on the element itself
    $clearDiffState(element);

    // Handle list type changes
    if ($isListNode(element) && (element as any).__originalListType) {
      // Restore the original list type (rejection)
      const originalListType = (element as any).__originalListType;
      (element as any).setListType(originalListType);
      delete (element as any).__originalListType;
    }

    // Process children
    const children = [...element.getChildren()];

    for (const child of children) {
      const diffState = $getDiffState(child);

      if (diffState === 'added') {
        // Reject addition - remove the node
        child.remove();
        continue;
      } else if (diffState === 'removed') {
        // Reject removal - clear diff state
        $clearDiffState(child);
      } else if (diffState === 'modified') {
        // Reject modification - clear diff state and handle text nodes
        $clearDiffState(child);

        if ($isElementNode(child)) {
          // Process list item children for inline diff markers
          this.rejectTextDiffMarkers(child);
        }
      }

      // Recursively process if it's an element
      if ($isElementNode(child)) {
        this.processListRejection(child);
      }
    }
  }

  /**
   * Approve text diff markers within a list item
   */
  private approveTextDiffMarkers(element: ElementNode): void {
    const children = [...element.getChildren()];

    for (const child of children) {
      if ($isTextNode(child)) {
        const diffState = $getDiffState(child);

        if (diffState === 'removed') {
          // Approve removal - remove the text node
          child.remove();
        } else if (diffState === 'added') {
          // Approve addition - clear the diff state (keep the text)
          $clearDiffState(child);
        }
        // Note: nodes without diff state are unchanged and should remain
      } else if ($isElementNode(child)) {
        this.approveTextDiffMarkers(child);
      }
    }
  }

  /**
   * Reject text diff markers within a list item
   */
  private rejectTextDiffMarkers(element: ElementNode): void {
    const children = [...element.getChildren()];

    for (const child of children) {
      if ($isTextNode(child)) {
        const diffState = $getDiffState(child);

        if (diffState === 'added') {
          // Reject addition - remove the text node
          child.remove();
        } else if (diffState === 'removed') {
          // Reject removal - clear the diff state (keep the text)
          $clearDiffState(child);
        }
        // Note: nodes without diff state are unchanged and should remain
      } else if ($isElementNode(child)) {
        this.rejectTextDiffMarkers(child);
      }
    }
  }
}
