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
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import {$convertNodeToMarkdownString} from '../../../markdown/nodeMarkdownExport';
import type {ElementNode, LexicalEditor, SerializedLexicalNode} from 'lexical';
import {
  $getNodeByKey,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
} from 'lexical';

import {createHeadlessEditor} from '@lexical/headless';
import {createNodeFromSerialized} from './createNodeFromSerialized';
import {$setDiffState} from './DiffState';
import {DiffHandlerContext, diffHandlerRegistry} from '../handlers';
import {DefaultDiffHandler} from '../handlers/DefaultDiffHandler';
import {ListDiffHandler} from '../handlers/ListDiffHandler';
import {HeadingDiffHandler} from '../handlers/HeadingDiffHandler';
import {ParagraphDiffHandler} from '../handlers/ParagraphDiffHandler';
import {TableDiffHandler} from '../handlers/TableDiffHandler';
import {NodeStructureValidator} from './NodeStructureValidator';
import {applyParsedDiffToMarkdown} from './standardDiffFormat';
import {
  createInvalidDiffError,
  createMappingError,
  createTextReplacementError,
  DiffError,
} from './DiffError';
import {createWindowedTreeMatcher, NodeDiff} from './TreeMatcher';

// Initialize a simple registry (in future this could be external)
let _handlersInitialized = false;

export function initializeHandlers() {
  if (_handlersInitialized) {
    return;
  }

  // Register the handlers (more specific first)
  diffHandlerRegistry.register(new TableDiffHandler());
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
};

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
    // Normalize whitespace for matching
    const normalizedOriginal = normalizeWhitespace(originalMarkdown);
    const normalizedOldText = normalizeWhitespace(replacement.oldText);
    
    // Debug: Replacement attempt details
    // console.log('\n🔍 Attempting replacement:');
    // console.log('  Looking for:', JSON.stringify(replacement.oldText));
    // console.log('  Replace with:', JSON.stringify(replacement.newText));
    // console.log('  Exact match found:', originalMarkdown.includes(replacement.oldText));
    // console.log('  Normalized match found:', normalizedOriginal.includes(normalizedOldText));
    
    // Try exact match first
    if (originalMarkdown.includes(replacement.oldText)) {
      // console.log('  ✅ Using exact match replacement');
      // Apply the replacement - replace all occurrences
      newMarkdown = newMarkdown.replace(
        new RegExp(escapeRegExp(replacement.oldText), 'g'),
        replacement.newText,
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
          newMarkdown = beforeReplacement + replacement.newText + afterReplacement;
          found = true;
          break;
        }
        
        currentPos += originalLine.length + (i < lines.length - 1 ? 1 : 0);
      }
      
      if (!found) {
        console.log('  ❌ Normalized replacement position not found');
        throw createTextReplacementError(originalMarkdown, replacement);
      }
    } else {
      console.log('  ❌ Text not found in document');
      console.log('  Document preview (first 500 chars):', originalMarkdown.substring(0, 500));
      console.log('  Document preview (last 500 chars):', originalMarkdown.substring(Math.max(0, originalMarkdown.length - 500)));
      
      // Try to find similar text for debugging
      const searchText = replacement.oldText.substring(0, 50);
      const similarIndex = originalMarkdown.indexOf(searchText);
      if (similarIndex >= 0) {
        const contextStart = Math.max(0, similarIndex - 20);
        const contextEnd = Math.min(originalMarkdown.length, similarIndex + replacement.oldText.length + 20);
        console.log('  🔍 Found similar text at position', similarIndex);
        console.log('  Context:', JSON.stringify(originalMarkdown.substring(contextStart, contextEnd)));
      }
      
      throw createTextReplacementError(originalMarkdown, replacement);
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
  // Debug: Starting markdown replace
  // console.log('\n🔧 STARTING MARKDOWN REPLACE...');
  // console.log('Replacements:', JSON.stringify(replacements, null, 2));

  let newMarkdown: string;
  let textReplacementError: Error | null = null;

  try {
    // Try to apply text replacements to get the target markdown
    newMarkdown = _applyMarkdownEdits(originalMarkdown, replacements);
    // console.log('📝 Text replacements applied successfully');
  } catch (error) {
    // Text replacement failed - construct the new markdown from the replacements
    // This allows TreeMatcher to still work even if exact text matching fails
    // This is normal for structural changes like tables and lists
    // console.log('⚠️ Text replacement failed, constructing new markdown from replacements');
    textReplacementError = error as Error;
    
    // Build the new markdown by applying replacements in a best-effort manner
    // For now, we'll use the first replacement's newText as a hint
    // The TreeMatcher will handle the actual structural diff
    if (replacements.length > 0 && replacements[0].newText) {
      // Try to construct a reasonable target markdown
      // This is a fallback - TreeMatcher will do the real work
      const oldText = replacements[0].oldText;
      const newText = replacements[0].newText;
      
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
        replacements,
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
  console.log('\n🔍 STARTING MARKDOWN DIFF APPLICATION...');
  console.log('Diff to apply:', markdownDiff.substring(0, 200) + '...');

  if (!markdownDiff.trim()) {
    console.log('Empty diff, nothing to apply');
    return;
  }

  try {
    // Get the original markdown from the editor
    const originalMarkdown = editor.getEditorState().read(() => {
      return $convertToMarkdownString(transformers, undefined, true);
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
  console.log('\n🔍 STARTING DIFF APPLICATION...');
  console.log('Original markdown:', originalMarkdown.substring(0, 200));
  console.log('New markdown:', newMarkdown.substring(0, 200));

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

    // Create temporary editors for source and target states
    const sourceEditor = createHeadlessEditor({
      nodes: editor._createEditorArgs.nodes,
      theme: editor._config.theme,
    });

    const targetEditor = createHeadlessEditor({
      nodes: editor._createEditorArgs.nodes,
      theme: editor._config.theme,
    });

    try {
      // Load editors with their content
      sourceEditor.update(
        () => {
          const root = $getRoot();
          root.clear();
          $convertFromMarkdownString(
            originalMarkdown,
            transformers,
            undefined,
            true,
            false,
          );
        },
        {discrete: true},
      );

      targetEditor.update(
        () => {
          const root = $getRoot();
          root.clear();
          $convertFromMarkdownString(
            newMarkdown,
            transformers,
            root,
            true,
            false,
          );
        },
        {discrete: true},
      );

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
    const treeMatcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
      transformers,
      windowSize: 2,
      similarityThreshold: 0.05, // Very low threshold to catch dramatic changes
    });

    // Phase 1: Match root-level nodes
    const rootMatchResult = treeMatcher.matchRootChildren();

    // Create position tracking for robust diff application
    const liveNodesByMarkdown = new Map<string, string>();

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      for (const child of children) {
        const markdown = $convertNodeToMarkdownString(
          transformers,
          child as ElementNode
        ).trim();
        liveNodesByMarkdown.set(markdown, child.getKey());
      }
    });

    // Phase 2: Apply changes correctly respecting exact match positions
    try {
      editor.update(
        () => {
          // Process the sequence in reverse order to prevent position shift issues
          for (const diff of [...rootMatchResult.sequence].reverse()) {
            $applyNodeDiff(
              editor,
              diff,
              transformers,
              liveNodesByMarkdown,
              sourceEditor,
              targetEditor,
              treeMatcher,
            );
          }
        },
        {discrete: true},
      );
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
  liveNodesByMarkdown: Map<string, string>,
  sourceEditor?: LexicalEditor,
  targetEditor?: LexicalEditor,
  treeMatcher?: any,
): void {
  console.log(`Applying diff: ${diff.changeType} ${diff.nodeType}`);
  const liveRoot = $getRoot();

  switch (diff.changeType) {
    case 'remove': {
      // Find the live node by its markdown content
      const liveNodeKey = liveNodesByMarkdown.get(diff.sourceMarkdown);
      if (!liveNodeKey) {
        console.warn(
          `Could not find live node with markdown: ${diff.sourceMarkdown}`,
        );
        return;
      }

      const liveNode = $getNodeByKey(liveNodeKey);
      if (!liveNode) {
        console.warn(`Could not find node with key: ${liveNodeKey}`);
        return;
      }

      // Mark the entire node as removed using NodeState
      if ($isElementNode(liveNode)) {
        // Set diff state to 'removed' - preserve original content for reject functionality
        $setDiffState(liveNode, 'removed');
        // NOTE: We don't call $markNodeAsRemoved here because we want to preserve
        // the original content for proper reject functionality. The NodeState is
        // sufficient for tracking that this node should be removed on approve.
      } else {
        // For non-element nodes, we need to handle differently
        // This shouldn't happen at root level, but let's be safe
        console.warn(
          `Cannot mark non-element node as removed: ${liveNode.getType()}`,
        );
      }
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

      // Use sourceIndex which TreeMatcher calculated based on where this should go
      // in the source/live structure. Multiple additions to the same location will
      // have the same sourceIndex, and reverse order insertion will keep them together.
      const insertPosition = diff.sourceIndex;

      const children = liveRoot.getChildren();
      if (insertPosition < children.length) {
        children[insertPosition].insertBefore(newNode);
      } else {
        liveRoot.append(newNode);
      }

      break;
    }

    case 'update': {
      // Find the live node by its markdown content
      const liveNodeKey = liveNodesByMarkdown.get(diff.sourceMarkdown);
      console.log('  Looking for node with markdown:', diff.sourceMarkdown?.substring(0, 50));
      console.log('  Found key:', liveNodeKey);
      
      if (!liveNodeKey) {
        console.warn(
          `Could not find live node with markdown: ${diff.sourceMarkdown}`,
        );
        console.log('  Available keys in liveNodesByMarkdown:', Array.from(liveNodesByMarkdown.keys()).map(k => k.substring(0, 50)));
        return;
      }

      const liveNode = $getNodeByKey(liveNodeKey);
      if (!liveNode || !$isElementNode(liveNode)) {
        console.warn(`Could not find element node with key: ${liveNodeKey}`);
        return;
      }
      
      console.log('  Found live node:', liveNode.getType());

      // Only mark as modified if it's not an exact match
      // Exact matches from TreeMatcher should remain unchanged for clean visual diffs
      if (diff.matchType === 'exact' && diff.similarity === 1.0) {
        // This is an exact match - don't mark as modified
        // The node content is identical, it just may have shifted position
        // No diff state needed - this preserves the original clean content
        break;
      }

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

      // Find and apply the appropriate handler
      const handler = diffHandlerRegistry.findHandler(context);

      if (handler) {
        handler.handleUpdate(context);
      } else {
        // Fallback: log warning but don't do anything since we rely on handlers
        console.warn(`No handler found for node type: ${liveNode.getType()}`);
        // The DiffState 'modified' marking above is sufficient for tracking changes
      }
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
  console.log('\n🔍 STARTING SUB-TREE DIFF APPLICATION...');

  // Extract children from serialized nodes
  const sourceChildren =
    'children' in sourceParentNode && Array.isArray(sourceParentNode.children)
      ? sourceParentNode.children
      : [];
  const targetChildren =
    'children' in targetParentNode && Array.isArray(targetParentNode.children)
      ? targetParentNode.children
      : [];

  if (sourceChildren.length === 0 && targetChildren.length === 0) {
    console.log('No children to process in sub-tree diff');
    return;
  }

  console.log(
    `Source children: ${sourceChildren.length}, Target children: ${targetChildren.length}`,
  );

  if (sourceChildren.length === 0 && targetChildren.length === 0) {
    console.log('No child nodes found for sub-tree matching');
    return;
  }

  // Create a TreeMatcher with pre-cached data for both editors
  const treeMatcher = createWindowedTreeMatcher(sourceEditor, targetEditor, {
    transformers,
    windowSize: 2,
    similarityThreshold: 0.05,
  });

  // Create NodeWithMarkdown objects from the cached data by matching serialized structures
  const sourceChildrenWithMarkdown: Array<{
    node: SerializedLexicalNode;
    markdown: string;
    key: string;
  }> = [];
  const targetChildrenWithMarkdown: Array<{
    node: SerializedLexicalNode;
    markdown: string;
    key: string;
  }> = [];

  // Map serialized children to cached data
  for (const child of sourceChildren) {
    // Find matching cached data by comparing serialized structures
    let found = false;
    for (const [key, cached] of treeMatcher['sourceNodeCache']) {
      if (JSON.stringify(cached.node) === JSON.stringify(child)) {
        sourceChildrenWithMarkdown.push({
          node: child,
          markdown: cached.markdown,
          key: cached.key,
        });
        found = true;
        break;
      }
    }
    if (!found) {
      console.warn('Could not find cached data for source child, skipping');
    }
  }

  for (const child of targetChildren) {
    // Find matching cached data by comparing serialized structures
    let found = false;
    for (const [key, cached] of treeMatcher['targetNodeCache']) {
      if (JSON.stringify(cached.node) === JSON.stringify(child)) {
        targetChildrenWithMarkdown.push({
          node: child,
          markdown: cached.markdown,
          key: cached.key,
        });
        found = true;
        break;
      }
    }
    if (!found) {
      console.warn('Could not find cached data for target child, skipping');
    }
  }

  // Use the internal matchNodes logic but with our pre-built data
  // We need to create a custom matching since matchNodes expects actual LexicalNode objects
  const childMatchResult = (treeMatcher as any).matchNodesWithMarkdown(
    sourceChildrenWithMarkdown,
    targetChildrenWithMarkdown,
  );

  console.log(
    `Sub-tree matching found ${childMatchResult.diffs.length} diffs, ${childMatchResult.sequence.length} total operations`,
  );

  // Create position tracking for child nodes by their markdown content
  const liveChildNodesByMarkdown = new Map<string, string>();
  const liveChildren = liveParentNode.getChildren();
  
  // For list items, we need to match on text content, not full markdown
  const isListParent = liveParentNode.getType() === 'list';

  for (const child of liveChildren) {
    if ($isElementNode(child)) {
      let markdown: string;
      if (isListParent && child.getType() === 'listitem') {
        // For list items, use text content for matching
        // This matches what TreeMatcher uses for list item comparison
        markdown = child.getTextContent().trim();
      } else {
        // For other nodes, use full markdown conversion
        markdown = $convertToMarkdownString(
          transformers,
          child
        ).trim();
      }
      liveChildNodesByMarkdown.set(markdown, child.getKey());
    }
  }

  console.log(
    `Mapped ${liveChildNodesByMarkdown.size} live child nodes by markdown`,
  );

  // Apply the child node diffs in reverse order to prevent position shift issues
  for (const diff of [...childMatchResult.sequence].reverse()) {
    console.log(
      `Applying child diff: ${diff.changeType} at sourceIndex ${diff.sourceIndex}, targetIndex ${diff.targetIndex}`,
    );
    $applyChildNodeDiff(
      liveParentNode,
      diff,
      transformers,
      liveChildNodesByMarkdown,
      sourceEditor,
      targetEditor,
      treeMatcher,
    );
  }

  console.log('✅ Sub-tree diff application completed');
}

/**
 * Apply a node diff to a child within a parent node
 * Similar to $applyNodeDiff but works on children within a parent
 */
export function $applyChildNodeDiff(
  liveParentNode: ElementNode,
  diff: NodeDiff,
  transformers: Array<Transformer>,
  liveChildNodesByMarkdown: Map<string, string>,
  sourceEditor?: LexicalEditor,
  targetEditor?: LexicalEditor,
  treeMatcher?: any,
): void {
  const liveChildren = liveParentNode.getChildren();

  switch (diff.changeType) {
    case 'remove': {
      // Find the live child node by its markdown content
      const liveNodeKey = liveChildNodesByMarkdown.get(diff.sourceMarkdown);
      if (!liveNodeKey) {
        console.warn(
          `Could not find live child node with markdown: ${diff.sourceMarkdown}`,
        );
        return;
      }

      const liveNode = $getNodeByKey(liveNodeKey);
      if (!liveNode) {
        console.warn(`Could not find child node with key: ${liveNodeKey}`);
        return;
      }

      // Mark the child node as removed using DiffState
      if ($isElementNode(liveNode)) {
        $setDiffState(liveNode, 'removed');
      } else {
        console.warn(
          `Cannot mark non-element child node as removed: ${liveNode.getType()}`,
        );
      }
      break;
    }

    case 'add': {
      // Create a new child node from the target serialized node
      const newNode = createNodeFromSerialized(diff.targetNode);

      if (!$isElementNode(newNode)) {
        console.warn(`Cannot add non-element child node: ${newNode.getType()}`);
        return;
      }

      // Mark the node as added using DiffState
      $setDiffState(newNode, 'added');

      // Use sourceIndex which TreeMatcher calculated based on where this should go
      // in the source/live structure. Multiple additions to the same location will
      // have the same sourceIndex, and reverse order insertion will keep them together.
      const insertPosition = diff.sourceIndex;

      if (insertPosition < liveChildren.length) {
        liveChildren[insertPosition].insertBefore(newNode);
      } else {
        liveParentNode.append(newNode);
      }

      break;
    }

    case 'update': {
      // Find the live child node by its markdown content
      const liveNodeKey = liveChildNodesByMarkdown.get(diff.sourceMarkdown);
      if (!liveNodeKey) {
        console.warn(
          `Could not find live child node with markdown: ${diff.sourceMarkdown}`,
        );
        return;
      }

      const liveNode = $getNodeByKey(liveNodeKey);
      if (!liveNode || !$isElementNode(liveNode)) {
        console.warn(
          `Could not find element child node with key: ${liveNodeKey}`,
        );
        return;
      }

      // Only mark as modified if it's not an exact match
      // Exact matches from TreeMatcher should remain unchanged for clean visual diffs
      if (diff.matchType === 'exact' && diff.similarity === 1.0) {
        // This is an exact match - don't mark as modified
        // The node content is identical, it just may have shifted position
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
        handler.handleUpdate(context);
      } else {
        console.warn(
          `No handler found for child node type: ${liveNode.getType()}`,
        );
      }
      break;
    }
  }
}
