/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {$createHeadingNode, HeadingNode} from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  ElementNode,
  LexicalEditor,
} from 'lexical';

import {
  $approveDiffs,
  $rejectDiffs,
  $setDiffState,
  $getDiffState,
} from '../../core/index';

describe('Approve and reject diff functionality', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createEditor({
      nodes: [HeadingNode],
      onError: (error) => {
        throw error;
      },
    });
  });

  test('$approveDiffs - added text node keeps content and clears diff state', async () => {
    // Initialize with a text node marked as added
    await editor.update(() => {
      const root = $getRoot();
      root.clear();

      const paragraph = $createParagraphNode();
      const textNode = $createTextNode('Added text');
      $setDiffState(textNode, 'added');
      paragraph.append(textNode);
      root.append(paragraph);
    });

    // Verify initial state
    await editor.getEditorState().read(() => {
      const root = $getRoot();
      const paragraph = root.getFirstChild() as ElementNode;
      expect(paragraph).not.toBeNull();

      const children = paragraph.getChildren();
      expect(children.length).toBe(1);
      expect($getDiffState(children[0])).toBe('added');
      expect(children[0].getTextContent()).toBe('Added text');
    });

    // Approve using the helper function
    $approveDiffs(editor);

    // Force a new read to ensure we see the latest state
    await editor.getEditorState().read(() => {
      const root = $getRoot();
      const paragraph = root.getFirstChild() as ElementNode;
      expect(paragraph).not.toBeNull();

      const children = paragraph.getChildren();
      expect(children.length).toBe(1);
      expect($getDiffState(children[0])).toBe(null); // Diff state should be cleared
      expect(children[0].getTextContent()).toBe('Added text');
    });
  });

  test('$approveDiffs - removed text node is removed', async () => {
    // Initialize with a text node marked as removed
    await editor.update(() => {
      const root = $getRoot();
      root.clear();

      const paragraph = $createParagraphNode();
      const textNode = $createTextNode('Removed text');
      $setDiffState(textNode, 'removed');
      paragraph.append(textNode);
      root.append(paragraph);
    });

    // Verify initial state
    await editor.getEditorState().read(() => {
      const root = $getRoot();
      const paragraph = root.getFirstChild() as ElementNode;
      expect(paragraph).not.toBeNull();

      const children = paragraph.getChildren();
      expect(children.length).toBe(1);
      expect($getDiffState(children[0])).toBe('removed');
      expect(children[0].getTextContent()).toBe('Removed text');
    });

    // Approve using the helper function
    $approveDiffs(editor);

    // Force a new read to ensure we see the latest state
    await editor.getEditorState().read(() => {
      const root = $getRoot();
      const paragraph = root.getFirstChild() as ElementNode;
      expect(paragraph).not.toBeNull();

      const children = paragraph.getChildren();
      expect(children.length).toBe(0); // Node should be removed
    });
  });

  test('$rejectDiffs - added text node is removed', async () => {
    // Initialize with a text node marked as added
    await editor.update(() => {
      const root = $getRoot();
      root.clear();

      const paragraph = $createParagraphNode();
      const textNode = $createTextNode('Added text');
      $setDiffState(textNode, 'added');
      paragraph.append(textNode);
      root.append(paragraph);
    });

    // Verify initial state
    await editor.getEditorState().read(() => {
      const root = $getRoot();
      const paragraph = root.getFirstChild() as ElementNode;
      expect(paragraph).not.toBeNull();

      const children = paragraph.getChildren();
      expect(children.length).toBe(1);
      expect($getDiffState(children[0])).toBe('added');
      expect(children[0].getTextContent()).toBe('Added text');
    });

    // Reject using the helper function
    $rejectDiffs(editor);

    // Force a new read to ensure we see the latest state
    await editor.getEditorState().read(() => {
      const root = $getRoot();
      const paragraph = root.getFirstChild() as ElementNode;
      expect(paragraph).not.toBeNull();

      const children = paragraph.getChildren();
      expect(children.length).toBe(0); // Node should be removed
    });
  });

  test('$rejectDiffs - removed text node keeps content and clears diff state', async () => {
    // Initialize with a text node marked as removed
    await editor.update(() => {
      const root = $getRoot();
      root.clear();

      const paragraph = $createParagraphNode();
      const textNode = $createTextNode('Removed text');
      $setDiffState(textNode, 'removed');
      paragraph.append(textNode);
      root.append(paragraph);
    });

    // Verify initial state
    await editor.getEditorState().read(() => {
      const root = $getRoot();
      const paragraph = root.getFirstChild() as ElementNode;
      expect(paragraph).not.toBeNull();

      const children = paragraph.getChildren();
      expect(children.length).toBe(1);
      expect($getDiffState(children[0])).toBe('removed');
      expect(children[0].getTextContent()).toBe('Removed text');
    });

    // Reject using the helper function
    $rejectDiffs(editor);

    // Force a new read to ensure we see the latest state
    await editor.getEditorState().read(() => {
      const root = $getRoot();
      const paragraph = root.getFirstChild() as ElementNode;
      expect(paragraph).not.toBeNull();

      const children = paragraph.getChildren();
      expect(children.length).toBe(1);
      expect($getDiffState(children[0])).toBe(null); // Diff state should be cleared
      expect(children[0].getTextContent()).toBe('Removed text');
    });
  });

  test('Nested diffs can be processed', async () => {
    // Initialize with nested diff nodes
    await editor.update(() => {
      const root = $getRoot();
      root.clear();

      // Create a valid nested structure
      const outerParagraph = $createParagraphNode();
      const heading = $createHeadingNode('h2');

      // Add diff nodes at different levels
      const outerTextNode = $createTextNode('Outer add');
      $setDiffState(outerTextNode, 'added');

      const innerTextNode = $createTextNode('Inner add');
      $setDiffState(innerTextNode, 'added');

      heading.append(innerTextNode);
      outerParagraph.append(outerTextNode);

      // Valid structure: root -> paragraph AND root -> heading
      root.append(outerParagraph);
      root.append(heading);
    });

    // Verify initial state
    await editor.getEditorState().read(() => {
      const root = $getRoot();
      const outerParagraph = root.getFirstChild() as ElementNode;
      expect(outerParagraph).not.toBeNull();

      const outerChildren = outerParagraph.getChildren();
      expect(outerChildren.length).toBe(1);

      expect($getDiffState(outerChildren[0])).toBe('added');
      expect(outerChildren[0].getTextContent()).toBe('Outer add');

      const heading = root.getChildAtIndex(1) as ElementNode;
      const innerChildren = heading.getChildren();

      expect(innerChildren.length).toBe(1);
      expect($getDiffState(innerChildren[0])).toBe('added');
      expect(innerChildren[0].getTextContent()).toBe('Inner add');
    });

    // Process the nested diff nodes using the helper function
    $approveDiffs(editor);

    // Force a new read to ensure we see the latest state
    await editor.getEditorState().read(() => {
      const root = $getRoot();
      const outerParagraph = root.getFirstChild() as ElementNode;
      expect(outerParagraph).not.toBeNull();

      const outerChildren = outerParagraph.getChildren();
      expect(outerChildren.length).toBe(1);

      // Outer diff state should be cleared
      expect($getDiffState(outerChildren[0])).toBe(null);
      expect(outerChildren[0].getTextContent()).toBe('Outer add');

      const heading = root.getChildAtIndex(1) as ElementNode;
      const innerChildren = heading.getChildren();

      // Inner diff state should also be cleared
      expect(innerChildren.length).toBe(1);
      expect($getDiffState(innerChildren[0])).toBe(null);
      expect(innerChildren[0].getTextContent()).toBe('Inner add');
    });
  });
});
