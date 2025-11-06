/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/**
 * MARKDOWN DIFF ARCHITECTURE
 *
 * The core approach for applying markdown diffs to Lexical editors:
 *
 * 1. Get the original markdown from the live editor
 *
 * 2. Apply the unified diff to the orignal markdown to get the target markdown
 *
 * 3. Create a target headless editor from the updated markdown
 *
 * 4. Create a source headless editor from the original markdown
 *    CRITICAL: The source editor has IDENTICAL content to the live editor at this point
 *
 * 5. Use TreeMatcher to compare source and target editors:
 *    - TreeMatcher pre-calculates markdown for all nodes in both editors
 *    - Performs windowed matching to handle position shifts
 *    - Returns matches, unmatched source nodes (to remove), and unmatched target nodes (to add)
 *
 * 6. Node-to-Node Tree Diffing Strategy:
 *    - TreeMatcher identifies which nodes match between source and target
 *    - Match nodes based on markdown content similarity, not just position
 *    - Apply surgical changes to the live editor without disrupting node references
 *
 * 7. Tree Structure Matching Techniques:
 *    - Markdown-based matching: Compare pre-calculated markdown representations
 *    - Windowed matching: Look within a position window to handle shifts
 *    - Type checking: Nodes of different types cannot match
 *    - For lists: Match by list type and content
 *    - Similarity threshold: Configurable threshold for considering nodes "the same"
 *
 * 8. Why Markdown-Based Matching Instead of Positional Matching:
 *    - Source and live editors start identical, BUT as we apply changes, positions shift!
 *    - When we remove a node at position 0, all subsequent nodes shift up
 *    - When we add a node at position 1, all subsequent nodes shift down
 *    - Example: Source has [A, B, C], target wants [B, C, D]
 *      - After removing A, live has [B, C] at positions [0, 1] (not [1, 2]!)
 *      - When updating B, it's no longer at its original position
 *    - Solution: Match by MARKDOWN CONTENT which remains stable
 *    - Pre-cache markdown for every node in live editor
 *    - Find matching live nodes by comparing markdown, not position
 *
 * 9. Applying Changes to the Live Editor:
 *    - For each node in the source, find its corresponding node in live by markdown
 *    - If matched: Update content in-place using diff markers (add/remove/change nodes)
 *    - If no match found: Mark with removal nodes
 *    - For nodes in target with no match in source: Insert at correct position
 *
 * 10. Preserving Node Relationships:
 *    - Use NodeStructureValidator rules to maintain proper parent-child relationships
 *    - For special node types (ListItem, TableCell), ensure containment within required parents
 *    - When inserting new nodes, respect structural rules (e.g., ListItems inside Lists)
 *    - For complex structures, preserve the entire subtree hierarchy
 *
 * Key principles:
 * - NEVER clear the editor or root node during diff application
 * - Apply changes to the existing structure while maintaining node references
 * - Use content and structural similarity for robust node matching
 * - Handle index shifts caused by insertions/deletions
 * - Apply structural rules during the diffing process, not as post-processing
 * - No post-hoc validation or fixing of broken structures
 *
 *
 * Diff State Management:
 * - Uses DiffState to track node changes (added, removed, modified)
 * - No special node types needed - state is tracked via metadata
 *
 *
 * Special Node Rules (these are just examples, not exhaustive):
 * - RootNode -> ListNode -> ListItemNode -> TextNode
 * - RootNode -> ListNode -> ListItemNode -> ListNode -> ListItemNode -> TextNode
 * - RootNode -> HeadingNode -> TextNode
 * - RootNode -> ParagraphNode -> TextNode
 * - RootNode -> TableNode -> TableRowNode -> TableCellNode -> TextNode
 * - RootNode -> TableNode -> TableRowNode -> TableCellNode -> TextNode
 *
 *
 * Notes for AI:
 * - You don't have to run extra editor update cycles, just pass discrete: true to the update calls for synchronous updates in tests
 * - Run all tests for lexical-diff package with: npm run test-unit -- lexical-diff
 * - Serialized nodes don't have ids or keys
 *
 */

/**
 * CRITICAL: Why We Use Markdown-Based Matching Instead of Positional Matching
 *
 * The source editor and live editor start with IDENTICAL content (created from the same markdown).
 * However, we CANNOT use simple positional matching (index-based) because:
 *
 * As we apply changes in sequence (removes, adds, updates), the live editor's structure changes!
 * - When we remove a node at position 0, all subsequent nodes shift up
 * - When we add a node at position 1, all subsequent nodes shift down
 *
 * Example:
 * 1. Source has [A, B, C] at positions [0, 1, 2]
 * 2. Target wants to remove A and add D after C: [B, C, D]
 * 3. After removing A, live editor has [B, C] at positions [0, 1]
 * 4. When we process "update B", it's no longer at position 1 in live!
 *
 * Solution: Match nodes by their MARKDOWN CONTENT, not position
 * - Pre-cache markdown representation for every node in the live editor
 * - When applying a change to a source node, find the matching live node by markdown
 * - This finds the correct node even if it has moved due to previous operations
 *
 * This is why TreeMatcher pre-calculates markdown for all nodes and why we use
 * content-based signatures for node matching.
 */

/* eslint-disable @typescript-eslint/no-unused-vars, no-shadow */

import type {Transformer} from '@lexical/markdown';
import {
  $convertFromEnhancedMarkdownString,
  $convertToEnhancedMarkdownString,
} from '../../../markdown';
import type {ElementNode, LexicalEditor, SerializedLexicalNode} from 'lexical';
import {
  $getNodeByKey,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  createState,
  $getState,
  $setState,
} from 'lexical';

import {createHeadlessEditor} from '@lexical/headless';
import {createNodeFromSerialized} from './createNodeFromSerialized';
import {DiffState, $setDiffState, $getDiffState, LiveNodeKeyState} from './DiffState';
import {DiffHandlerContext, diffHandlerRegistry} from '../handlers';
import {DefaultDiffHandler} from '../handlers/DefaultDiffHandler';
import {ListDiffHandler} from '../handlers/ListDiffHandler';
import {HeadingDiffHandler} from '../handlers/HeadingDiffHandler';
import {ParagraphDiffHandler} from '../handlers/ParagraphDiffHandler';
import {TableDiffHandler} from '../handlers/TableDiffHandler';
import {CodeBlockDiffHandler} from '../handlers/CodeBlockDiffHandler';
import {NodeStructureValidator} from './NodeStructureValidator';
import {applyParsedDiffToMarkdown} from './standardDiffFormat';
import {
  createInvalidDiffError,
  createMappingError,
  createTextReplacementError,
  DiffError,
} from './DiffError';
import {createWindowedTreeMatcher, NodeDiff} from './TreeMatcher';
import { applyFrontmatterUpdateIfNeeded } from './diffFrontmatter';

// Initialize a simple registry (in future this could be external)
let _handlersInitialized = false;

export function initializeHandlers() {
  if (_handlersInitialized) {
    return;
  }

  // Register the handlers (more specific first)
  diffHandlerRegistry.register(new TableDiffHandler());
  diffHandlerRegistry.register(new CodeBlockDiffHandler());
  diffHandlerRegistry.register(new ParagraphDiffHandler());
  diffHandlerRegistry.register(new HeadingDiffHandler());
  diffHandlerRegistry.register(new ListDiffHandler());
  diffHandlerRegistry.register(new DefaultDiffHandler());

  _handlersInitialized = true;
}

// Add escapeRegExp function near the top of the file
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Type for text replacement edits
export type TextReplacement = {
  oldText: string;
  newText: string;
} & Record<string, unknown>;

export type ReplacementLike = {
  oldText?: string;
  newText?: string;
  search?: string;
  replace?: string;
  [key: string]: unknown;
};

export function resolveReplacementTexts(replacement: ReplacementLike): {
  oldText: string;
  newText: string;
} {
  let oldText = typeof (replacement as any).oldText === 'string'
    ? (replacement as any).oldText as string
    : undefined;
  let newText = typeof (replacement as any).newText === 'string'
    ? (replacement as any).newText as string
    : undefined;

  if (oldText === undefined && typeof (replacement as any).search === 'string') {
    oldText = (replacement as any).search as string;
    (replacement as any).oldText = oldText;
  }

  if (newText === undefined && typeof (replacement as any).replace === 'string') {
    newText = (replacement as any).replace as string;
    (replacement as any).newText = newText;
  }

  if (typeof oldText !== 'string' || typeof newText !== 'string') {
    throw createInvalidDiffError(
      JSON.stringify({ replacement }),
      'Invalid replacement received: missing oldText/newText'
    );
  }

  return {oldText, newText};
}


/**
 * Normalize whitespace for more flexible matching
 * - Normalize line endings to \n
 * - Trim trailing whitespace from each line
 * - Preserve the number of newlines at the end
 */
function normalizeWhitespace(text: string): string {
  // Count trailing newlines
  const trailingNewlines = text.match(/\n*$/)?.[0] || '';

  // Normalize line endings and trim trailing spaces from each line
  const normalized = text
    .replace(/\r\n/g, '\n')  // Windows -> Unix
    .replace(/\r/g, '\n')    // Old Mac -> Unix
    .split('\n')
    .map(line => line.trimEnd())  // Remove trailing spaces from each line
    .join('\n');

  // Preserve original trailing newlines
  return normalized.trimEnd() + trailingNewlines;
}

function _applyMarkdownEdits(
  originalMarkdown: string,
  replacements: TextReplacement[],
) {
  let newMarkdown = originalMarkdown;

  for (const replacement of replacements) {
    const {oldText, newText} = resolveReplacementTexts(replacement);
    // Normalize whitespace for matching
    const normalizedOriginal = normalizeWhitespace(originalMarkdown);
    const normalizedOldText = normalizeWhitespace(oldText);

    // Debug: Replacement attempt details
    // console.log('\n🔍 Attempting replacement:');
    // console.log('  Looking for:', JSON.stringify(replacement.oldText));
    // console.log('  Replace with:', JSON.stringify(replacement.newText));
    // console.log('  Exact match found:', originalMarkdown.includes(replacement.oldText));
    // console.log('  Normalized match found:', normalizedOriginal.includes(normalizedOldText));

    // Try exact match first
    if (originalMarkdown.includes(oldText)) {
      // console.log('  ✅ Using exact match replacement');
      // Apply the replacement - replace all occurrences
      newMarkdown = newMarkdown.replace(
        new RegExp(escapeRegExp(oldText), 'g'),
        newText,
      );
    }
    // Try normalized match if exact match fails
    else if (normalizedOriginal.includes(normalizedOldText)) {
      // console.log('  ⚠️ Using normalized match replacement');
      // Find the position in the normalized text
      const normalizedIndex = normalizedOriginal.indexOf(normalizedOldText);

      // Try to find the corresponding position in the original text
      // This is a best-effort approach
      const lines = originalMarkdown.split(/\r?\n/);
      const normalizedLines = lines.map(line => line.trimEnd());

      // Reconstruct with normalized matching
      let currentPos = 0;
      let found = false;

      for (let i = 0; i < lines.length; i++) {
        const normalizedLine = normalizedLines[i];
        const originalLine = lines[i];

        // Check if this is where our replacement should start
        const lineStart = normalizedLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        const lineEnd = lineStart + normalizedLine.length;

        if (!found && normalizedIndex >= lineStart && normalizedIndex < lineEnd + 1) {
          // This is where the replacement starts
          const beforeReplacement = originalMarkdown.substring(0, currentPos);

          // Find the end of the replacement in the original
          let endPos = currentPos;
          let replacementLines = normalizedOldText.split('\n');

          for (let j = 0; j < replacementLines.length; j++) {
            if (i + j < lines.length) {
              endPos += lines[i + j].length + (j > 0 ? 1 : 0);
            }
          }

          const afterReplacement = originalMarkdown.substring(endPos);
          newMarkdown = beforeReplacement + newText + afterReplacement;
          found = true;
          break;
        }

        currentPos += originalLine.length + (i < lines.length - 1 ? 1 : 0);
      }

      if (!found) {
        console.log('  ❌ Normalized replacement position not found');
        throw createTextReplacementError(originalMarkdown, {
          ...replacement,
          oldText,
          newText,
        });
      }
    } else {
      // console.log('  ❌ Text not found in document');
      // console.log('  Document preview (first 500 chars):', originalMarkdown.substring(0, 500));
      // console.log('  Document preview (last 500 chars):', originalMarkdown.substring(Math.max(0, originalMarkdown.length - 500)));

      // Try to find similar text for debugging
      const searchText = oldText.substring(0, 50);
      const similarIndex = originalMarkdown.indexOf(searchText);
      if (similarIndex >= 0) {
        const contextStart = Math.max(0, similarIndex - 20);
        const contextEnd = Math.min(originalMarkdown.length, similarIndex + replacement.oldText.length + 20);
        // console.log('  🔍 Found similar text at position', similarIndex);
        // console.log('  Context:', JSON.stringify(originalMarkdown.substring(contextStart, contextEnd)));
      }

      throw createTextReplacementError(originalMarkdown, {
        ...replacement,
        oldText,
        newText,
      });
    }
  }
  return newMarkdown;
}

/**
 * Apply a set of text replacements to an editor
 * This is an alternative to applyMarkdownDiff that takes direct text replacements
 * instead of unified diff strings
 */
export function applyMarkdownReplace(
  editor: LexicalEditor,
  originalMarkdown: string,
  replacements: TextReplacement[],
  transformers: Transformer[],
): void {
  // console.log('[applyMarkdownReplace] CALLED with', replacements.length, 'replacements');
  const normalizedReplacements = replacements.map((replacement) => {
    const {oldText, newText} = resolveReplacementTexts(replacement);
    console.log('[applyMarkdownReplace] Replacement:', {
      oldTextLength: oldText.length,
      newTextLength: newText.length,
      oldTextStart: oldText.substring(0, 100),
      newTextStart: newText.substring(0, 100),
    });
    return {
      ...(replacement as any),
      oldText,
      newText,
    } as TextReplacement;
  });

  console.log('[applyMarkdownReplace] originalMarkdown:', {
    length: originalMarkdown.length,
    start: originalMarkdown.substring(0, 100),
  });

  // Debug: Starting markdown replace
  // console.log('\n🔧 STARTING MARKDOWN REPLACE...');
  // console.log('Replacements:', JSON.stringify(replacements, null, 2));

  let newMarkdown: string;
  let textReplacementError: Error | null = null;

  try {
    // Try to apply text replacements to get the target markdown
    newMarkdown = _applyMarkdownEdits(originalMarkdown, normalizedReplacements);
    console.log('[applyMarkdownReplace] Text replacement succeeded, newMarkdown length:', newMarkdown.length);
  } catch (error) {
    // Text replacement failed - construct the new markdown from the replacements
    // This allows TreeMatcher to still work even if exact text matching fails
    // This is normal for structural changes like tables and lists
    console.log('[applyMarkdownReplace] Text replacement FAILED:', error);
    textReplacementError = error as Error;

    // Build the new markdown by applying replacements in a best-effort manner
    // For now, we'll use the first replacement's newText as a hint
    // The TreeMatcher will handle the actual structural diff
    if (normalizedReplacements.length > 0 && normalizedReplacements[0].newText) {
      // Try to construct a reasonable target markdown
      // This is a fallback - TreeMatcher will do the real work
      const oldText = normalizedReplacements[0].oldText;
      const newText = normalizedReplacements[0].newText;

      // For list replacements, try to identify and replace the list
      if (oldText.startsWith('- ') && newText.startsWith('- ')) {
        // Find the list in the original markdown
        const lines = originalMarkdown.split('\n');
        let listStart = -1;
        let listEnd = -1;

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('- ')) {
            if (listStart === -1) listStart = i;
            listEnd = i;
          } else if (listStart !== -1) {
            // List has ended
            break;
          }
        }

        if (listStart !== -1 && listEnd !== -1) {
          // Replace the list section
          const newLines = [...lines];
          newLines.splice(listStart, listEnd - listStart + 1, ...newText.split('\n'));
          newMarkdown = newLines.join('\n');
          // console.log('📝 Constructed new markdown with list replacement');
        } else {
          newMarkdown = originalMarkdown;
        }
      }
      // Look for table markers
      else if (oldText.includes('|') && newText.includes('|')) {
        // Find the table in the original markdown
        const lines = originalMarkdown.split('\n');
        let tableStart = -1;
        let tableEnd = -1;

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('|')) {
            if (tableStart === -1) tableStart = i;
            tableEnd = i;
          } else if (tableStart !== -1) {
            // Table has ended
            break;
          }
        }

        if (tableStart !== -1 && tableEnd !== -1) {
          // Replace the table section
          const newLines = [...lines];
          newLines.splice(tableStart, tableEnd - tableStart + 1, ...newText.split('\n'));
          newMarkdown = newLines.join('\n');
          // console.log('📊 Constructed new markdown with table replacement');
        } else {
          newMarkdown = originalMarkdown;
        }
      } else {
        // Default: try a simple text replacement
        newMarkdown = originalMarkdown.replace(oldText, newText);
      }
    } else {
      // No replacements or empty newText - use original
      newMarkdown = originalMarkdown;
    }
  }

  // If text replacement failed and we couldn't construct meaningful new markdown,
  // throw the error immediately - don't try to apply a diff that won't work
  if (textReplacementError && originalMarkdown === newMarkdown) {
    throw textReplacementError;
  }

  let {frontmatterUpdated, bodyChanged} = applyFrontmatterUpdateIfNeeded(editor, originalMarkdown, newMarkdown);

  if (!bodyChanged && frontmatterUpdated) {
    return;
  }

  if (originalMarkdown === newMarkdown) {
    // No error but also no changes - just return
    return;
  }

  // Debug: Markdown diff info
  // console.log('📝 Original markdown length:', originalMarkdown.length);
  // console.log('📝 New markdown length:', newMarkdown.length);
  // console.log('🎯 About to call applyMarkdownDiffToDocument...');

  // Apply the markdown diff to the document using existing infrastructure
  // TreeMatcher will handle structural differences even if text replacement failed
  try {
    applyMarkdownDiffToDocument(
      editor,
      originalMarkdown,
      newMarkdown,
      transformers,
    );
    // console.log('✅ applyMarkdownDiffToDocument completed successfully');

    // If we got here, the diff was applied successfully
    // Text replacement error is expected when TreeMatcher handles structural changes
    // Don't log this as it's normal behavior and causes confusion
    // if (textReplacementError) {
    //   console.log('ℹ️ Text replacement failed but TreeMatcher succeeded:', textReplacementError.message);
    // }
  } catch (error) {
    console.error('❌ Error in applyMarkdownDiffToDocument:', error);

    // If both text replacement and TreeMatcher failed, throw the original error
    if (textReplacementError) {
      throw textReplacementError;
    }

    // Wrap in DiffError if not already one
    if (error instanceof DiffError) {
      error.context.additionalInfo = {
        ...error.context.additionalInfo,
      replacements: normalizedReplacements,
      };
      throw error;
    } else {
      const diffError = createMappingError(
        `Failed to apply replacements to document: ${
          error instanceof Error ? error.message : String(error)
        }`,
        undefined,
        {newMarkdown},
      );
      diffError.context.originalMarkdown = originalMarkdown;
      diffError.context.targetMarkdown = newMarkdown;
      diffError.context.additionalInfo = {
        ...diffError.context.additionalInfo,
        replacements,
      };
      throw diffError;
    }
  }
}

/**
 * Apply a markdown diff to an editor
 * This supports only unified diff strings
 */
export function applyMarkdownDiff(
  editor: LexicalEditor,
  markdownDiff: string,
  transformers: Array<Transformer>,
): void {
  // console.log('\n🔍 STARTING MARKDOWN DIFF APPLICATION...');
  // console.log('Diff to apply:', markdownDiff.substring(0, 200) + '...');

  if (!markdownDiff.trim()) {
    // console.log('Empty diff, nothing to apply');
    return;
  }

  try {
    // Get the original markdown from the editor
    const originalMarkdown = editor.getEditorState().read(() => {
      return $convertToEnhancedMarkdownString(transformers);
    });

    let newMarkdown: string;

    // Check if input is a unified diff or direct markdown
    if (
      markdownDiff.includes('---') &&
      markdownDiff.includes('+++') &&
      markdownDiff.includes('@@ ')
    ) {
      // Input is a unified diff
      try {
        newMarkdown = applyParsedDiffToMarkdown(originalMarkdown, markdownDiff);
      } catch (error) {
        // Add context about which editor this failed on
        if (error instanceof DiffError) {
          error.context.operation = 'applyMarkdownDiff';
          error.context.additionalInfo = {
            ...error.context.additionalInfo,
            editorHasContent: originalMarkdown.length > 0,
            transformerCount: transformers.length,
          };
        }
        throw error;
      }
    } else {
      throw createInvalidDiffError(
        markdownDiff,
        'Input must be a unified diff format with ---, +++, and @@ markers',
      );
    }

    // Apply the markdown diff to the document
    try {
      applyMarkdownDiffToDocument(
        editor,
        originalMarkdown,
        newMarkdown,
        transformers,
      );
    } catch (error) {
      // Wrap in DiffError if not already one
      if (error instanceof DiffError) {
        error.context.targetMarkdown = newMarkdown;
        throw error;
      } else {
        const diffError = createMappingError(
          `Failed to apply diff to document: ${
            error instanceof Error ? error.message : String(error)
          }`,
          undefined,
          {newMarkdown},
        );
        diffError.context.originalMarkdown = originalMarkdown;
        diffError.context.targetMarkdown = newMarkdown;
        diffError.context.diffString = markdownDiff;
        throw diffError;
      }
    }
  } catch (error) {
    // If it's already a DiffError with detailed context, just re-throw
    if (error instanceof DiffError) {
      throw error;
    }

    // For unexpected errors, wrap in a DiffError
    throw createInvalidDiffError(
      markdownDiff,
      `Unexpected error in applyMarkdownDiff: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// Type for a segment in a word-level diff
export type DiffSegment = {
  type: 'equal' | 'insert' | 'delete';
  text: string;
};

// Type for a chunk in a markdown-level diff
export type MarkdownDiffChunk = {
  type: 'equal' | 'insert' | 'delete';
  content: string;
};

/**
 * ENHANCED DIFF ARCHITECTURE
 *
 * New Two-Phase Approach:
 *
 * Phase 1: Tree Matching
 * - Create complete node mappings between source and target trees
 * - Use structural fingerprinting and LCS-based matching
 * - Consider both content similarity and positional context
 * - Build a comprehensive change plan before making any modifications
 *
 * Phase 2: Apply Changes
 * - Execute all changes in a single editor.update() call
 * - Apply changes in dependency order (parents before children)
 * - Preserve node references and maintain structural integrity
 * - Handle special cases (list items, table cells) with proper containment
 */

// Node mapping types for the enhanced matching system

/**
 * Enhanced markdown diff application using two-phase approach
 */
export function applyMarkdownDiffToDocument(
  editor: LexicalEditor,
  originalMarkdown: string,
  newMarkdown: string,
  transformers: Array<Transformer>,
): void {
  // Debug: Starting diff application
  // console.log('\n🔍 STARTING DIFF APPLICATION...');
  // console.log('Original markdown:', originalMarkdown.substring(0, 200));
  // console.log('New markdown:', newMarkdown.substring(0, 200));

  if (originalMarkdown === newMarkdown) {
    return;
  }

  try {
    // Validate editor state before starting
    editor.update(
      () => {
        const liveRoot = $getRoot();
        if (liveRoot.getChildren().length === 0) {
          throw new Error('Live editor root has no children');
        }
      },
      {discrete: true},
    );

    if (!editor._createEditorArgs || !editor._createEditorArgs.nodes) {
      throw new Error('Editor must have nodes configured');
    }

    // Clone LIVE editor state to create SOURCE editor
    const liveState = editor.getEditorState().toJSON();

    const sourceEditor = createHeadlessEditor({
      nodes: editor._createEditorArgs.nodes,
      theme: editor._config.theme,
    });

    // Load the cloned state into SOURCE editor
    sourceEditor.setEditorState(sourceEditor.parseEditorState(liveState));

    // AUTOMATIC: Set LiveNodeKeyState on SOURCE nodes via parallel traversal
    // This walks both LIVE and SOURCE trees in parallel and sets each SOURCE node's
    // LiveNodeKeyState to point back to its corresponding LIVE node key.

    // First, collect all LIVE node keys in order
    const liveNodeKeys: string[] = [];
    editor.getEditorState().read(() => {
      const liveRoot = $getRoot();

      const collectKeys = (node: LexicalNode) => {
        liveNodeKeys.push(node.getKey());
        if ($isElementNode(node)) {
          for (const child of node.getChildren()) {
            collectKeys(child);
          }
        }
      };

      collectKeys(liveRoot);
    });

    // Then, set those keys on the SOURCE nodes in parallel order
    let keysSet = 0;
    sourceEditor.update(() => {
      const sourceRoot = $getRoot();
      let keyIndex = 0;

      const setKeys = (node: LexicalNode) => {
        if (keyIndex < liveNodeKeys.length) {
          $setState(node, LiveNodeKeyState, liveNodeKeys[keyIndex]);
          keyIndex++;
          keysSet++;
        }

        if ($isElementNode(node)) {
          for (const child of node.getChildren()) {
            setKeys(child);
          }
        }
      };

      setKeys(sourceRoot);
    }, { discrete: true });

    // console.log(`[applyMarkdownReplace] Automatically set LiveNodeKeyState on ${keysSet} SOURCE nodes via parallel traversal`);

    const targetEditor = createHeadlessEditor({
      nodes: editor._createEditorArgs.nodes,
      theme: editor._config.theme,
    });

    try {
      // Load TARGET editor with new markdown
      targetEditor.update(
        () => {
          const root = $getRoot();
          root.clear();
          $convertFromEnhancedMarkdownString(
            newMarkdown,
            transformers,
            undefined,
            true,
            true
          );
        },
        {discrete: true},
      );

      // DEBUG: Show what target editor contains
      // targetEditor.getEditorState().read(() => {
      //   const root = $getRoot();
      //   const children = root.getChildren();
      //   console.log(`[diffUtils] TARGET editor has ${children.length} children after parsing markdown:`);
      //   children.forEach((child, idx) => {
      //     if (idx >= 0 && idx <= 20) {
      //       console.log(`  [${idx}] ${child.getType()} "${child.getTextContent().substring(0, 30)}"`);
      //     }
      //   });
      // });

      // Get serialized states for diffing (unused but kept for potential future use)
      // sourceEditor.getEditorState().toJSON();
      // targetEditor.getEditorState().toJSON();
    } catch (error) {
      throw createMappingError(
        `Failed to create editor states from markdown: ${
          error instanceof Error ? error.message : String(error)
        }`,
        undefined,
        {
          originalMarkdown: originalMarkdown.substring(0, 200),
          newMarkdown: newMarkdown.substring(0, 200),
        },
      );
    }

    // NEW: Use TreeMatcher for root-level matching
    // Use a large window size to handle documents with many nodes
    // Window size determines how far apart nodes can be and still be considered for matching
    const sourceNodeCount = sourceEditor.getEditorState().read(() => $getRoot().getChildren().length);
    const targetNodeCount = targetEditor.getEditorState().read(() => $getRoot().getChildren().length);
    const maxNodeCount = Math.max(sourceNodeCount, targetNodeCount);
    // Use 50% of document size as window, with minimum of 10 and maximum of 100
    const windowSize = Math.min(100, Math.max(10, Math.floor(maxNodeCount * 0.5)));

    console.log('[diffUtils] Document sizes:', {
      sourceNodeCount,
      targetNodeCount,
      windowSize,
      originalMarkdownLength: originalMarkdown.length,
      newMarkdownLength: newMarkdown.length,
    });

    // Debug: show first few nodes of each
    sourceEditor.getEditorState().read(() => {
      const children = $getRoot().getChildren().slice(0, 5);
      console.log('[diffUtils] Source first 5 nodes:', children.map(c => ({
        type: c.getType(),
        text: c.getTextContent().substring(0, 40)
      })));
    });

    targetEditor.getEditorState().read(() => {
      const children = $getRoot().getChildren().slice(0, 5);
      console.log('[diffUtils] Target first 5 nodes:', children.map(c => ({
        type: c.getType(),
        text: c.getTextContent().substring(0, 40)
      })));
    });

    const treeMatcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
      transformers,
      windowSize,
      similarityThreshold: 0.05, // Very low threshold to catch dramatic changes
    });

    console.log('[diffUtils] Created TreeMatcher for applyMarkdownDiffToDocument');

    // Phase 1: Match root-level nodes
    const rootMatchResult = treeMatcher.matchRootChildren();

    console.log('[diffUtils] TreeMatcher results:', {
      diffs: rootMatchResult.diffs.length,
      sequence: rootMatchResult.sequence.length,
    });

    // Phase 2: Apply changes correctly respecting exact match positions
    try {
      editor.update(
        () => {
          // DEBUG: Log initial live tree state
          // const initialChildren = $getRoot().getChildren();
          // console.log(`\n[DIFF APPLICATION] Starting with ${initialChildren.length} children in live tree:`);
          // initialChildren.forEach((child, i) => {
          //   console.log(`  [${i}] ${child.getType().padEnd(12)} "${child.getTextContent().substring(0, 30)}"`);
          // });
          // console.log('');

          // Separate diffs by type for proper processing order
          const removes = rootMatchResult.sequence.filter(d => d.changeType === 'remove');
          const updates = rootMatchResult.sequence.filter(d => d.changeType === 'update');
          const adds = rootMatchResult.sequence.filter(d => d.changeType === 'add');

          // console.log(`[DIFF APPLICATION] Processing ${rootMatchResult.sequence.length} diffs:`);
          // console.log(`  ${removes.length} removes, ${updates.length} updates, ${adds.length} adds`);

          // Process REMOVEs in reverse order to avoid index shifting
          // console.log('  Processing REMOVEs in reverse order...');
          for (const diff of [...removes].reverse()) {
            $applyNodeDiff(editor, diff, transformers, sourceEditor, targetEditor, treeMatcher);
          }

          // Process UPDATEs (order doesn't matter, they use live keys)
          // console.log('  Processing UPDATEs...');
          for (const diff of updates) {
            $applyNodeDiff(editor, diff, transformers, sourceEditor, targetEditor, treeMatcher);
          }

          // Process ADDs - group by sourceIndex, sort each group by targetIndex ascending
          // console.log('  Processing ADDs in targetIndex order within each sourceIndex group...');
          const addsBySourceIndex = new Map<number, NodeDiff[]>();
          for (const add of adds) {
            if (!addsBySourceIndex.has(add.sourceIndex)) {
              addsBySourceIndex.set(add.sourceIndex, []);
            }
            addsBySourceIndex.get(add.sourceIndex)!.push(add);
          }

          // Sort each group by targetIndex and apply
          for (const [sourceIdx, group] of addsBySourceIndex.entries()) {
            const sorted = group.sort((a, b) => a.targetIndex - b.targetIndex);
            // console.log(`    sourceIndex=${sourceIdx}: processing ${sorted.length} adds in targetIndex order`);
            for (const diff of sorted) {
              $applyNodeDiff(editor, diff, transformers, sourceEditor, targetEditor, treeMatcher);
            }
          }
        },
        {discrete: true},
      );

      if (process?.env?.DIFF_DEBUG === '1') {
        editor.getEditorState().read(() => {
          const root = $getRoot();
          const snapshot = root.getChildren().map((child, idx) => ({
            index: idx,
            type: child.getType(),
            text: child.getTextContent(),
            diffState: $getDiffState(child),
          }));
          console.log('[applyMarkdownReplace] post-apply snapshot', snapshot);
        });
      }
    } catch (error) {
      const applyError = createMappingError(
        `Failed to apply node mappings to live editor: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      applyError.context.originalMarkdown = originalMarkdown;
      applyError.context.targetMarkdown = newMarkdown;
      applyError.context.additionalInfo = {
        ...applyError.context.additionalInfo,
        diffCount: rootMatchResult.diffs.length,
        sequenceCount: rootMatchResult.sequence.length,
      };
      throw applyError;
    }
  } catch (error) {
    // If it's already a DiffError, just re-throw with additional context
    if (error instanceof DiffError) {
      if (!error.context.originalMarkdown) {
        error.context.originalMarkdown = originalMarkdown;
      }
      if (!error.context.targetMarkdown) {
        error.context.targetMarkdown = newMarkdown;
      }
      throw error;
    }

    // For unexpected errors, wrap in a DiffError
    const diffError = createMappingError(
      `Unexpected error in applyMarkdownDiffToDocument: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    diffError.context.originalMarkdown = originalMarkdown;
    diffError.context.targetMarkdown = newMarkdown;
    throw diffError;
  }
}

export function $applyNodeDiff(
  editor: LexicalEditor,
  diff: NodeDiff,
  transformers: Array<Transformer>,
  sourceEditor?: LexicalEditor,
  targetEditor?: LexicalEditor,
  treeMatcher?: any,
): void {
  const liveRoot = $getRoot();

  switch (diff.changeType) {
    case 'remove': {
      const liveNodeKey = diff.sourceLiveKey;
      if (!liveNodeKey) {
        console.warn(
          `Could not find live node key for removal. sourceIndex=${diff.sourceIndex}`,
        );
        return;
      }
      // console.log('  Found live node:', liveNodeKey);

      const liveNode = $getNodeByKey(liveNodeKey);
      if (!liveNode) {
        console.warn(`Could not find node with key: ${liveNodeKey}`);
        return;
      }

      // Mark the entire node as removed using NodeState
      // Set diff state to 'removed' - preserve original content for reject functionality
      $setDiffState(liveNode, 'removed');
      // console.log('  ✅ Set diff state to REMOVED on node:', liveNode.getKey(), liveNode.getType());
      // Verify it was set
      const verifyState = $getDiffState(liveNode);
      // console.log('  🔍 Verified diff state immediately:', verifyState);
      // NOTE: We don't call $markNodeAsRemoved here because we want to preserve
      // the original content for proper reject functionality. The NodeState is
      // sufficient for tracking that this node should be removed on approve.
      break;
    }

    case 'add': {
      // Create a new node from the target serialized node
      const newNode = createNodeFromSerialized(diff.targetNode);

      if (
        !$isElementNode(newNode) &&
        !$isDecoratorNode(newNode) &&
        !$isDecoratorNode(newNode)
      ) {
        console.warn(
          `Cannot add non-element node at root level: ${newNode.getType()}`,
        );
        return;
      }

      // Mark the node as added using DiffState
      $setDiffState(newNode, 'added');

      // sourceIndex tells us which SOURCE node this should be inserted before
      // We need to find that SOURCE node's liveNodeKey, then find it in LIVE editor
      const insertBeforeSourceIndex = diff.sourceIndex;

      if (!sourceEditor) {
        console.warn('ADD diff requires sourceEditor to determine insertion position');
        liveRoot.append(newNode); // Fallback to append
        break;
      }

      // Get the SOURCE node at sourceIndex and extract its live key
      let liveKeyToInsertBefore: string | null = null;
      sourceEditor.getEditorState().read(() => {
        const sourceRoot = $getRoot();
        const sourceChildren = sourceRoot.getChildren();
        if (insertBeforeSourceIndex < sourceChildren.length) {
          const sourceNode = sourceChildren[insertBeforeSourceIndex];
          liveKeyToInsertBefore = $getState(sourceNode, LiveNodeKeyState);
        }
      });

      // Find the LIVE node with that key and insert before it
      if (liveKeyToInsertBefore) {
        let liveNodeToInsertBefore = $getNodeByKey(liveKeyToInsertBefore);
        if (liveNodeToInsertBefore) {
          // OPTIMIZATION: If we're about to insert before an empty paragraph,
          // look backwards to find any preceding empties and insert before ALL of them.
          // This keeps related content grouped together.
          while (liveNodeToInsertBefore) {
            // Check if this node is an empty paragraph
            const isEmptyParagraph = liveNodeToInsertBefore.getType() === 'paragraph' &&
              liveNodeToInsertBefore.getTextContent().trim() === '';

            if (!isEmptyParagraph) {
              break; // Not empty, stop here
            }

            // Check if there's a previous sibling that's also empty
            const prevSibling = liveNodeToInsertBefore.getPreviousSibling();
            if (!prevSibling) {
              break; // No previous sibling, stop here
            }

            const isPrevEmpty = prevSibling.getType() === 'paragraph' &&
              prevSibling.getTextContent().trim() === '';

            if (isPrevEmpty) {
              // Move back to insert before the previous empty too
              liveNodeToInsertBefore = prevSibling;
            } else {
              // Previous is not empty, stop here
              break;
            }
          }

          liveNodeToInsertBefore.insertBefore(newNode);
        } else {
          console.warn(`Could not find LIVE node with key: ${liveKeyToInsertBefore}`);
          liveRoot.append(newNode); // Fallback
        }
      } else {
        // No live key found (sourceIndex >= source children length), append to end
        liveRoot.append(newNode);
      }

      break;
    }

    case 'update': {
      const liveNodeKey = diff.sourceLiveKey;

      if (!liveNodeKey) {
        throw new Error(
          `UPDATE diff missing sourceLiveKey! This means LiveNodeKeyState was not set on LIVE nodes before diff application. ` +
          `sourceIndex=${diff.sourceIndex}, sourceMarkdown="${diff.sourceMarkdown?.substring(0, 30)}"`
        );
      }

      // const sourceText = diff.sourceMarkdown?.substring(0, 30);
      // const targetText = diff.targetMarkdown?.substring(0, 30);
      // console.log(`[UPDATE] liveKey=${liveNodeKey}, source="${sourceText}", target="${targetText}"`);

      const liveNode = $getNodeByKey(liveNodeKey);
      if (!liveNode) {
        console.warn(`Could not find node with key: ${liveNodeKey}`);
        return;
      }

      // Debug: show what we found
      // const currentText = liveNode.getTextContent().substring(0, 30);
      // console.log(`  Found node: text="${currentText}", type=${liveNode.getType()}`);

      // Debug: show where it is in the tree
      // const liveRoot = $getRoot();
      // const allChildren = liveRoot.getChildren();
      // const currentIndex = allChildren.findIndex(n => n.getKey() === liveNodeKey);
      // console.log(`  Current position in tree: ${currentIndex}`);

      // console.log('  Found live node:', liveNode.getType());

      // Only mark as modified if it's not an exact match
      // Exact matches from TreeMatcher should remain unchanged for clean visual diffs
      // Trust matchType === 'exact' from TreeMatcher (which uses ThresholdedOrderPreservingTree's EQUAL operations)
      // Don't require similarity === 1.0 because normalized content (like table separators) may have different text
      const isExactMatch = diff.matchType === 'exact';

      if (diff.sourceMarkdown?.includes('|---') || diff.targetMarkdown?.includes('|---')) {
        console.log('[diffUtils] Table separator diff:', {
          matchType: diff.matchType,
          similarity: diff.similarity,
          isExactMatch,
          willMark: !isExactMatch,
          source: diff.sourceMarkdown?.substring(0, 50),
          target: diff.targetMarkdown?.substring(0, 50),
        });
      }

      if (!isExactMatch) {
        // Mark the node as modified using NodeState for actual content changes
        $setDiffState(liveNode, 'modified');

        // Initialize handlers if not already done
        initializeHandlers();

        // Create handler context
        const context: DiffHandlerContext = {
          liveNode: liveNode,
          sourceNode: diff.sourceNode,
          targetNode: diff.targetNode,
          changeType: 'update',
          validator: new NodeStructureValidator(), // Keep for compatibility but handlers won't use it
          sourceEditor,
          targetEditor,
          transformers,
          treeMatcher,
        };

        // Find and apply the appropriate handler for non-exact matches
        const handler = diffHandlerRegistry.findHandler(context);

        if (handler) {
          handler.handleUpdate(context);
        } else {
          // For non-exact matches without a handler, warn
          console.warn(`No handler found for node type: ${liveNode.getType()}`);
          // The DiffState 'modified' marking above is sufficient for tracking changes
        }
      }
      // Exact matches: do nothing - children are already identical since markdown is identical
      break;
    }
  }
}

/**
 * Recursively apply tree matching to children of structured nodes
 * This allows fine-grained changes within complex structures like lists
 * without rebuilding editors or re-parsing markdown
 */
export function $applySubTreeDiff(
  liveParentNode: ElementNode,
  sourceParentNode: SerializedLexicalNode,
  targetParentNode: SerializedLexicalNode,
  sourceEditor: LexicalEditor,
  targetEditor: LexicalEditor,
  transformers: Array<Transformer>,
): void {
  // console.log('\n🔍 STARTING SUB-TREE DIFF APPLICATION...');

  // Extract children from serialized nodes
  const sourceChildren =
    'children' in sourceParentNode && Array.isArray(sourceParentNode.children)
      ? sourceParentNode.children
      : [];
  const targetChildren =
    'children' in targetParentNode && Array.isArray(targetParentNode.children)
      ? targetParentNode.children
      : [];

  // if (sourceChildren.length === 0 && targetChildren.length === 0) {
  //   console.log('No children to process in sub-tree diff');
  //   return;
  // }

  // console.log(
  //   `Source children: ${sourceChildren.length}, Target children: ${targetChildren.length}`,
  // );

  if (sourceChildren.length === 0 && targetChildren.length === 0) {
    // console.log('No child nodes found for sub-tree matching');
    return;
  }

  // Create a TreeMatcher with pre-cached data for both editors
  // Use adaptive window size based on child count
  const childWindowSize = Math.min(50, Math.max(5, Math.floor(sourceChildren.length * 0.5)));
  const treeMatcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
    transformers,
    windowSize: childWindowSize,
    similarityThreshold: 0.05,
  });

  // Create NodeWithMarkdown objects from the cached data by matching serialized structures
  const sourceCanonicalChildren = sourceChildren
    .map((child: any) => {
      const key = child?.__key ?? child?.key;
      if (!key) return null;
      return treeMatcher.getSourceNodeData(key);
    })
    .filter(Boolean);
  const targetCanonicalChildren = targetChildren
    .map((child: any) => {
      const key = child?.__key ?? child?.key;
      if (!key) return null;
      return treeMatcher.getTargetNodeData(key);
    })
    .filter(Boolean);

  // console.log(
  //   '[SubTreeDiff] source child keys',
  //   sourceChildren.map((child: any) => child?.__key ?? child?.key),
  // );
  // console.log(
  //   '[SubTreeDiff] target child keys',
  //   targetChildren.map((child: any) => child?.__key ?? child?.key),
  // );
  // console.log(
  //   '[SubTreeDiff] canonical children counts',
  //   sourceCanonicalChildren.length,
  //   targetCanonicalChildren.length,
  // );

  // Use TreeMatcher (TOPT) for all child matching
  // With pairAlignThreshold: 0.2, TOPT will correctly:
  // 1. Match exact content ("One"→"One", "Two"→"Two", "Three"→"Three")
  // 2. Insert new items in the correct position (nested list between "Two" and "Three")
  // 3. Handle text changes at same position ("two"→"deux")
  const childMatchResult = treeMatcher.matchCanonicalNodes(
    sourceCanonicalChildren,
    targetCanonicalChildren,
  );

  console.log(
    `[SubTreeDiff] Sub-tree matching found ${childMatchResult.diffs.length} diffs, ${childMatchResult.sequence.length} total operations`,
  );

  // Log each diff for debugging
  childMatchResult.sequence.forEach((diff, i) => {
    console.log(`  [${i}] ${diff.changeType.toUpperCase()} sourceIdx=${diff.sourceIndex} targetIdx=${diff.targetIndex} type=${diff.nodeType} similarity=${diff.similarity.toFixed(2)} matchType=${diff.matchType}`);
    console.log(`       source: "${(diff.sourceMarkdown || '').substring(0, 40)}"`);
    console.log(`       target: "${(diff.targetMarkdown || '').substring(0, 40)}"`);
  });

  // Create position tracking for child nodes by their markdown content
  // Apply the child node diffs in reverse order to prevent position shift issues
  for (const diff of [...childMatchResult.sequence].reverse()) {
    console.log(
      `[SubTreeDiff] Applying child diff: ${diff.changeType} at sourceIndex ${diff.sourceIndex}, targetIndex ${diff.targetIndex}`,
    );
    $applyChildNodeDiff(
      liveParentNode,
      diff,
      transformers,
      sourceEditor,
      targetEditor,
      treeMatcher,
    );
  }

  console.log('[SubTreeDiff] ✅ Sub-tree diff application completed');
}

/**
 * Apply a node diff to a child within a parent node
 * Similar to $applyNodeDiff but works on children within a parent
 */
export function $applyChildNodeDiff(
  liveParentNode: ElementNode,
  diff: NodeDiff,
  transformers: Array<Transformer>,
  sourceEditor?: LexicalEditor,
  targetEditor?: LexicalEditor,
  treeMatcher?: any,
): void {
  const liveChildren = liveParentNode.getChildren();

  switch (diff.changeType) {
    case 'remove': {
      const liveNodeKey = diff.sourceLiveKey;
      if (!liveNodeKey) {
        console.warn(
          `Could not find live child node for removal; missing live key. sourceIndex=${diff.sourceIndex}`,
        );
        return;
      }

      const liveNode = $getNodeByKey(liveNodeKey);
      if (!liveNode) {
        console.warn(`Could not find child node with key: ${liveNodeKey}`);
        return;
      }

      // Mark the child node as removed using DiffState
      $setDiffState(liveNode, 'removed');
      break;
    }

    case 'add': {
      // Create a new child node from the target serialized node
      const newNode = createNodeFromSerialized(diff.targetNode);

      // Mark the node as added using DiffState
      $setDiffState(newNode, 'added');

      // sourceIndex from TreeMatcher means "insert at this position" (insert before this index)
      // For example, sourceIndex=2 means "insert before liveChildren[2]"
      const insertBeforeIndex = diff.sourceIndex;

      if (insertBeforeIndex >= liveChildren.length) {
        // Append to end
        liveParentNode.append(newNode);
      } else if (insertBeforeIndex <= 0) {
        // Insert at the beginning
        if (liveChildren.length > 0) {
          liveChildren[0].insertBefore(newNode);
        } else {
          liveParentNode.append(newNode);
        }
      } else {
        // Insert before the specified index
        liveChildren[insertBeforeIndex].insertBefore(newNode);
      }

      break;
    }

    case 'update': {
      const liveNodeKey = diff.sourceLiveKey;
      if (!liveNodeKey) {
        console.warn(
          'Could not find live child node for update; missing live key.',
        );
        return;
      }

      const liveNode = $getNodeByKey(liveNodeKey);
      if (!liveNode) {
        console.warn(`Could not find child node with key: ${liveNodeKey}`);
        return;
      }

      // Only mark as modified if it's not an exact match
      // Exact matches from TreeMatcher should remain unchanged for clean visual diffs
      // Trust matchType === 'exact' from TreeMatcher (which uses ThresholdedOrderPreservingTree's EQUAL operations)
      if (diff.matchType === 'exact') {
        // This is an exact match - don't mark as modified
        // The node content is identical (or normalized to identical), it just may have shifted position
        // No diff state needed - this preserves the original clean content
        break;
      }

      // Mark the child node as modified using NodeState for actual content changes
      $setDiffState(liveNode, 'modified');

      // Initialize handlers if not already done
      initializeHandlers();

      // Create handler context for the child node
      const context: DiffHandlerContext = {
        liveNode: liveNode,
        sourceNode: diff.sourceNode,
        targetNode: diff.targetNode,
        changeType: 'update',
        validator: new NodeStructureValidator(),
        sourceEditor,
        targetEditor,
        transformers,
        treeMatcher,
      };

      // Find and apply the appropriate handler for the child
      const handler = diffHandlerRegistry.findHandler(context);

      if (handler) {
        const result = handler.handleUpdate(context);

        // If the handler says not to skip children, we need to recurse
        if (result.handled && result.skipChildren === false && sourceEditor && targetEditor) {
          // console.log(`Handler for ${liveNode.getType()} requests recursion into children`);
          // Recursively apply sub-tree diff to handle nested structures
          $applySubTreeDiff(
            liveNode,
            diff.sourceNode,
            diff.targetNode,
            sourceEditor,
            targetEditor,
            transformers
          );
        }
      } else {
        console.warn(
          `No handler found for child node type: ${liveNode.getType()}`,
        );
      }
      break;
    }
  }
}
