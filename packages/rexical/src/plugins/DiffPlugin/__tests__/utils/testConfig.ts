

import type {Transformer} from '@lexical/markdown';
import type {Klass, LexicalEditor, LexicalNode} from 'lexical';
import {createEditor} from 'lexical';
import {createHeadlessEditor} from '@lexical/headless';

// Import existing editor nodes
import EditorNodes from '../../../../nodes/EditorNodes';

// Import transformers from the project
import {MARKDOWN_TRANSFORMERS} from '../../../../markdown';

/**
 * Test transformers for diff plugin testing.
 * Uses the same transformers as the main editor for consistency.
 */
export const MARKDOWN_TEST_TRANSFORMERS: Transformer[] = MARKDOWN_TRANSFORMERS;

/**
 * Test nodes for diff plugin testing.
 * Uses the same nodes as the main editor for consistency.
 */
export const TEST_NODES: Array<Klass<LexicalNode>> = EditorNodes;

/**
 * Creates a test editor with diff plugin requirements.
 * This function mimics the createTestEditor from lexical but uses our project's nodes.
 */
export function createTestEditor(
  config: {
    namespace?: string;
    theme?: any;
    nodes?: ReadonlyArray<Klass<LexicalNode>>;
    onError?: (error: Error) => void;
  } = {},
): LexicalEditor {
  const customNodes = config.nodes || [];
  const editorConfig = {
    namespace: config.namespace || 'test',
    theme: config.theme || {},
    onError: config.onError || ((e) => {
      throw e;
    }),
    nodes: TEST_NODES.concat(customNodes as any),
  };
  
  const editor = createEditor(editorConfig);
  
  // Store the config so createHeadlessEditorFromEditor can access it
  (editor as any)._createEditorArgs = editorConfig;
  
  return editor;
}

/**
 * Creates a headless test editor for state comparisons.
 */
export function createTestHeadlessEditor(
  config: {
    nodes?: ReadonlyArray<Klass<LexicalNode>>;
    onError?: (error: Error) => void;
  } = {},
): LexicalEditor {
  const customNodes = config.nodes || [];
  return createHeadlessEditor({
    onError: config.onError || ((error) => {
      throw error;
    }),
    nodes: TEST_NODES.concat(customNodes as any),
  });
}
