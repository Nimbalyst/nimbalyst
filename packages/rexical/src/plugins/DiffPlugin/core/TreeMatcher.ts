/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {Transformer} from '@lexical/markdown';
import { $convertNodeToEnhancedMarkdownString } from "../../../markdown";
import {
  $getNodeByKey,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
} from 'lexical';
import {$getRoot, $isElementNode} from 'lexical';
import {$getSerializedNode} from '../utils/getSerializedNode';

// Types for windowed matching
export type NodeDiff = {
  changeType: 'add' | 'remove' | 'update';

  sourceIndex: number;
  sourceNode: SerializedLexicalNode;
  sourceKey: string;
  sourceMarkdown: string;

  targetIndex: number;
  targetNode: SerializedLexicalNode;
  targetKey: string;
  targetMarkdown: string;

  nodeType: string;
  similarity: number;
  matchType: 'exact' | 'similar' | 'none';
};

export interface WindowedMatchResult {
  // Only actual changes (adds, removes, similarity-based updates)
  diffs: NodeDiff[];
  // Complete ordered list of ALL operations including exact matches
  sequence: NodeDiff[];
}

// Configuration for matching behavior
export interface MatchingConfig {
  // How far to look ahead/behind for matches (default: 2)
  windowSize: number;

  // Minimum similarity for considering nodes "the same" (default: 0.7)
  similarityThreshold: number;

  // Whether to match by type only first (default: true)
  requireSameType: boolean;

  // Transformers for markdown conversion
  transformers: Transformer[];
}

const DEFAULT_CONFIG: Partial<MatchingConfig> = {
  windowSize: 2,
  similarityThreshold: 0.2, // Lowered from 0.3 to be more forgiving
  requireSameType: true,
};

// Pre-calculated node with its markdown representation
type NodeWithMarkdown = {
  node: SerializedLexicalNode;
  markdown: string;
  key: string;
};

/**
 * Performs content-first matching between source and target editor content for optimal visual diffs.
 *
 * PROBLEM: Traditional position-based diff algorithms suffer from the "middle insertion problem" -
 * when content is inserted in the middle of a document, everything after the insertion appears as
 * changed rather than correctly identified as a single insertion. This creates confusing visual
 * diffs for users.
 *
 * SOLUTION: This implementation uses a content-first, globally-optimized matching approach with
 * source-position-based insertion mapping. Key innovations:
 *
 * 1. **Content-First Matching**: Find exact content matches regardless of position
 * 2. **Similarity-Based Updates**: Compute similarity scores for remaining unmatched nodes
 * 3. **Source-Position Insertion Mapping**: Calculate where insertions should go in the SOURCE
 *    structure, not target. Multiple insertions that belong together get the same sourceIndex.
 * 4. **Reverse-Order Application**: Apply insertions in reverse order to prevent position drift
 * 5. **Dual-Match Position Anchoring**: Use both exact AND similar matches as position anchors
 *
 * MIDDLE INSERTION FIX:
 * The key insight is that when inserting content in the middle, we need to calculate insertion
 * positions based on where nodes should go in the LIVE/SOURCE editor, not the target. For example:
 * - Source: [one, two, three, five, six, seven]
 * - Target: [one, two, three, **four-header**, **four-list**, five, six, seven]
 *
 * Both "four" nodes should map to sourceIndex=3 (before "five" in the source). When applied in
 * reverse order, they stay together and don't affect each other's insertion positions.
 *
 * PHASES:
 * 1. **Exact Matching**: Global content-based matching (not positional)
 * 2. **Similarity Matching**: Global optimization for remaining nodes (threshold: 0.05)
 * 3. **Insertion Mapping**: Map additions to source positions using exact+similar anchors
 * 4. **Sequential Application**: Apply in reverse order to preserve groupings
 *
 * This produces semantically minimal diffs where:
 * - Identical content always matches (even when repositioned)
 * - Similar content shows as updates, not remove+add pairs
 * - Insertions are properly grouped and positioned
 * - Complex formatting changes are detected (very low similarity threshold)
 * - Visual diff display shows the minimum number of apparent changes
 */
export class WindowedTreeMatcher {
  private config: MatchingConfig;
  private sourceEditor: LexicalEditor;
  private targetEditor: LexicalEditor;

  private neverMatchNodes: Set<string> = new Set([
    // 'code',
    'formula',
    'matrix',
    'diagram',
  ]);

  // Pre-cached node data for the entire tree
  private sourceNodeCache: Map<string, NodeWithMarkdown> = new Map();
  private targetNodeCache: Map<string, NodeWithMarkdown> = new Map();
  private sourceTreeStructure: Map<string, string[]> = new Map(); // nodeKey -> childKeys
  private targetTreeStructure: Map<string, string[]> = new Map(); // nodeKey -> childKeys

  constructor(
    sourceEditor: LexicalEditor,
    targetEditor: LexicalEditor,
    config: Partial<MatchingConfig>,
  ) {
    if (!config.transformers) {
      throw new Error('WindowedTreeMatcher requires transformers in config');
    }

    this.sourceEditor = sourceEditor;
    this.targetEditor = targetEditor;
    this.config = {...DEFAULT_CONFIG, ...config} as MatchingConfig;

    // Pre-cache all node data for both editors
    this.buildCompleteCache();
  }

  /**
   * Build complete cache of all nodes in both editors with their markdown and serialized forms
   */
  private buildCompleteCache(): void {
    this.sourceEditor.getEditorState().read(() => {
      const root = $getRoot();
      this.cacheNodeRecursively(
        root,
        this.sourceNodeCache,
        this.sourceTreeStructure,
      );
    });

    this.targetEditor.getEditorState().read(() => {
      const root = $getRoot();
      this.cacheNodeRecursively(
        root,
        this.targetNodeCache,
        this.targetTreeStructure,
      );
    });
  }

  /**
   * Recursively cache a node and all its descendants
   */
  private cacheNodeRecursively(
    node: LexicalNode,
    cache: Map<string, NodeWithMarkdown>,
    treeStructure: Map<string, string[]>,
  ): void {
    const key = node.getKey();

    // Generate markdown for this node
    let markdown: string;
    try {
      if ($isElementNode(node)) {
        // For element nodes, convert to markdown using our custom function
        markdown = $convertNodeToEnhancedMarkdownString(
          this.config.transformers,
          node
        );
      } else {
        // For text nodes, we need to preserve markdown formatting
        // Text nodes don't have markdown conversion, but their parent might contain links
        const parent = node.getParent();
        if (parent && $isElementNode(parent) && parent.getType() === 'paragraph') {
          try {
            // Convert parent to markdown to preserve link formatting
            markdown = $convertNodeToEnhancedMarkdownString(
              this.config.transformers,
              parent
            );
          } catch {
            markdown = node.getTextContent();
          }
        } else {
          markdown = node.getTextContent();
        }
      }
    } catch (error) {
      // Fallback for error cases
      console.warn('Error converting node to markdown:', error);
      markdown = node.getTextContent();
    }

    // Cache this node
    cache.set(key, {
      node: $getSerializedNode(node),
      markdown: markdown.trim(),
      key: key,
    });

    // Cache children structure
    if ($isElementNode(node)) {
      const children = node.getChildren();
      const childKeys = children.map((child) => child.getKey());
      treeStructure.set(key, childKeys);

      // Recursively cache all children
      for (const child of children) {
        this.cacheNodeRecursively(child, cache, treeStructure);
      }
    } else {
      treeStructure.set(key, []);
    }
  }

  /**
   * Get cached data for a source node by key
   */
  getSourceNodeData(key: string): NodeWithMarkdown | undefined {
    return this.sourceNodeCache.get(key);
  }

  /**
   * Get cached data for a target node by key
   */
  getTargetNodeData(key: string): NodeWithMarkdown | undefined {
    return this.targetNodeCache.get(key);
  }

  /**
   * Get cached children keys for a source node
   */
  getSourceChildren(parentKey: string): string[] {
    return this.sourceTreeStructure.get(parentKey) || [];
  }

  /**
   * Get cached children keys for a target node
   */
  getTargetChildren(parentKey: string): string[] {
    return this.targetTreeStructure.get(parentKey) || [];
  }

  /**
   * Get cached children data for a source node
   */
  getSourceChildrenData(parentKey: string): NodeWithMarkdown[] {
    const childKeys = this.getSourceChildren(parentKey);
    return childKeys
      .map((key) => this.sourceNodeCache.get(key)!)
      .filter(Boolean);
  }

  /**
   * Get cached children data for a target node
   */
  getTargetChildrenData(parentKey: string): NodeWithMarkdown[] {
    const childKeys = this.getTargetChildren(parentKey);
    return childKeys
      .map((key) => this.targetNodeCache.get(key)!)
      .filter(Boolean);
  }

  /**
   * Match the children of root nodes between source and target editors
   */
  matchRootChildren(): WindowedMatchResult {
    // Pre-calculate all markdown and serialized nodes WITHIN their own editor contexts
    const sourceNodesWithMarkdown = this.sourceEditor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      const results: NodeWithMarkdown[] = [];

      for (const child of children) {
        try {
          const serialized = $getSerializedNode(child);
          let markdown = '';

          if ($isElementNode(child)) {
            if (child.getType() === 'table') {
              console.log('🔍 SOURCE: Converting table node to markdown');
              console.log('  Number of transformers:', this.config.transformers.length);
              const tableTransformer = this.config.transformers.find(t =>
                t.type === 'element' && t.dependencies?.some?.(d =>
                  typeof d === 'function' ? d.name === 'TableNode' : d === 'TableNode'
                )
              );
              console.log('  Found TABLE_TRANSFORMER:', !!tableTransformer);
              if (tableTransformer) {
                console.log('  Transformer export function exists:', !!tableTransformer.export);
              }
            }
            // Debug: check if transformers include TABLE_TRANSFORMER
            if (child.getType() === 'table') {
              console.log('  Calling $convertNodeToMarkdownString with', this.config.transformers.length, 'transformers');
              const hasTableTransformer = this.config.transformers.some(t => 
                t.type === 'element' && t.dependencies?.some?.(d => 
                  typeof d === 'function' ? d.name === 'TableNode' : d === 'TableNode'
                )
              );
              console.log('  Has TABLE_TRANSFORMER?', hasTableTransformer);
            }
            markdown = $convertNodeToEnhancedMarkdownString(this.config.transformers, child);
            // try {
            //   markdown = $convertNodeToEnhancedMarkdownString(this.config.transformers, child);
            // } catch (error) {
            //   console.error('  Error converting node to markdown:', error);
            //   markdown = child.getTextContent();
            // }
            if (child.getType() === 'table') {
              console.log('  Result markdown before trim:', markdown);
              console.log('  Result markdown after trim:', markdown.trim());
            }
          } else {
            // For text nodes within paragraphs, we need the parent's markdown
            // to preserve link formatting
            const parent = child.getParent();
            if (parent && $isElementNode(parent) && parent.getType() === 'paragraph') {
              try {
                markdown = $convertNodeToEnhancedMarkdownString(this.config.transformers, parent);
              } catch {
                markdown = child.getTextContent();
              }
            } else {
              markdown = child.getTextContent();
            }
          }

          results.push({
            node: serialized,
            markdown: markdown.trim(),
            key: child.getKey(),
          });
        } catch (error) {
          // console.warn('Failed to process source node:', error);
        }
      }
      return results;
    });

    const targetNodesWithMarkdown = this.targetEditor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      const results: NodeWithMarkdown[] = [];

      for (const child of children) {
        try {
          const serialized = $getSerializedNode(child);
          let markdown = '';

          if ($isElementNode(child)) {
            if (child.getType() === 'table') {
              console.log('🔍 TARGET: Converting table node to markdown');
              console.log('  Number of transformers:', this.config.transformers.length);
              const tableTransformer = this.config.transformers.find(t =>
                t.type === 'element' && t.dependencies?.some?.(d =>
                  typeof d === 'function' ? d.name === 'TableNode' : d === 'TableNode'
                )
              );
              console.log('  Found TABLE_TRANSFORMER:', !!tableTransformer);
              if (tableTransformer) {
                console.log('  Transformer export function exists:', !!tableTransformer.export);
              }
            }
            // Debug: check if transformers include TABLE_TRANSFORMER
            if (child.getType() === 'table') {
              console.log('  Calling $convertNodeToMarkdownString with', this.config.transformers.length, 'transformers');
              const hasTableTransformer = this.config.transformers.some(t => 
                t.type === 'element' && t.dependencies?.some?.(d => 
                  typeof d === 'function' ? d.name === 'TableNode' : d === 'TableNode'
                )
              );
              console.log('  Has TABLE_TRANSFORMER?', hasTableTransformer);
            }
            markdown = $convertNodeToEnhancedMarkdownString(this.config.transformers, child);
            // try {
            //   markdown = $convertNodeToEnhancedMarkdownString(this.config.transformers, child);
            // } catch (error) {
            //   console.error('  Error converting node to markdown:', error);
            //   markdown = child.getTextContent();
            // }
            if (child.getType() === 'table') {
              console.log('  Result markdown before trim:', markdown);
              console.log('  Result markdown after trim:', markdown.trim());
            }
          } else {
            // For text nodes within paragraphs, we need the parent's markdown
            // to preserve link formatting
            const parent = child.getParent();
            if (parent && $isElementNode(parent)) {
              try {
                markdown = $convertNodeToEnhancedMarkdownString(this.config.transformers, parent);
              } catch {
                markdown = child.getTextContent();
              }
            } else {
              markdown = child.getTextContent();
            }
          }

          results.push({
            node: serialized,
            markdown: markdown.trim(),
            key: child.getKey(),
          });
        } catch (error) {
          // console.warn('Failed to process target node:', error);
        }
      }
      return results;
    });

    const result = this.matchNodesWithMarkdown(
      sourceNodesWithMarkdown,
      targetNodesWithMarkdown,
    );

    console.log('TreeMatcher results:');
    console.log('  Source nodes:', sourceNodesWithMarkdown.map(n => `${n.node.type}: ${n.markdown.substring(0, 50)}`));
    console.log('  Target nodes:', targetNodesWithMarkdown.map(n => `${n.node.type}: ${n.markdown.substring(0, 50)}`));
    console.log('  Diffs found:', result.diffs.length);
    result.diffs.forEach(diff => {
      console.log(`    ${diff.changeType} ${diff.nodeType}: "${diff.sourceMarkdown?.substring(0, 30)}" -> "${diff.targetMarkdown?.substring(0, 30)}"`);
    });

    return result;
  }


  /**
   * Match nodes using pre-calculated NodeWithMarkdown data (used for cached sub-tree diffing)
   */
  matchNodesWithMarkdown(
    sourceNodesWithMarkdown: NodeWithMarkdown[],
    targetNodesWithMarkdown: NodeWithMarkdown[],
  ): WindowedMatchResult {
    // FILTER OUT EMPTY PARAGRAPHS FOR MATCHING - they're just spacing artifacts, not real content
    // We'll handle spacing automatically based on where real content gets placed
    const sourceContentNodes = sourceNodesWithMarkdown.filter(
      (node) => !this.isEmptySpacingNode(node),
    );
    const targetContentNodes = targetNodesWithMarkdown.filter(
      (node) => !this.isEmptySpacingNode(node),
    );

    // Create index mappings between content-only and full arrays (including blank lines)
    const sourceContentToFull = new Map<number, number>();
    const targetContentToFull = new Map<number, number>();

    let sourceContentIdx = 0;
    let targetContentIdx = 0;

    for (let i = 0; i < sourceNodesWithMarkdown.length; i++) {
      if (!this.isEmptySpacingNode(sourceNodesWithMarkdown[i])) {
        sourceContentToFull.set(sourceContentIdx++, i);
      }
    }

    for (let i = 0; i < targetNodesWithMarkdown.length; i++) {
      if (!this.isEmptySpacingNode(targetNodesWithMarkdown[i])) {
        targetContentToFull.set(targetContentIdx++, i);
      }
    }

    // Special case: single content node pairs
    if (
      sourceContentNodes.length === 1 &&
      targetContentNodes.length === 1 &&
      sourceContentNodes[0].node.type === targetContentNodes[0].node.type &&
      !this.neverMatchNodes.has(sourceContentNodes[0].node.type)
    ) {
      // If they're identical, no diff needed (exact match = no change)
      if (sourceContentNodes[0].markdown === targetContentNodes[0].markdown) {
        const fullSourceIdx = sourceContentToFull.get(0)!;
        const fullTargetIdx = targetContentToFull.get(0)!;

        // Exact matches are NOT changes - but include them in sequence for positioning
        // Mark them so diff application knows to skip them while using them for anchoring
        const exactMatch: NodeDiff = {
          changeType: 'update',
          sourceIndex: fullSourceIdx,
          sourceNode: sourceContentNodes[0].node,
          sourceKey: sourceContentNodes[0].key,
          sourceMarkdown: sourceContentNodes[0].markdown,
          targetIndex: fullTargetIdx,
          targetNode: sourceContentNodes[0].node,
          targetKey: sourceContentNodes[0].key,
          targetMarkdown: sourceContentNodes[0].markdown,
          nodeType: sourceContentNodes[0].node.type,
          similarity: 1.0,
          matchType: 'exact',
        };

        return {diffs: [], sequence: [exactMatch]};
      }

      // If they're different, it's an actual update
      const fullSourceIdx = sourceContentToFull.get(0)!;
      const fullTargetIdx = targetContentToFull.get(0)!;

      const similarity = this.calculateMarkdownSimilarity(
        sourceContentNodes[0].markdown,
        targetContentNodes[0].markdown,
      );

      const match = this.createNodeMatch(
        sourceContentNodes[0],
        fullSourceIdx,
        targetContentNodes[0],
        fullTargetIdx,
        similarity,
        similarity >= this.config.similarityThreshold ? 'similar' : 'none',
      );

      return {
        diffs: [match], // Show change in diffs
        sequence: [match], // Single change
      };
    }

    const diffs: NodeDiff[] = [];
    const sequence: NodeDiff[] = [];
    let sourceContentMatched = new Set<number>();
    let targetContentMatched = new Set<number>();

    // PHASE 1: Exact content matching - CONTENT NODES ONLY
    // This should be much simpler now - no empty paragraphs to confuse us!
    for (
      let sourceIdx = 0;
      sourceIdx < sourceContentNodes.length;
      sourceIdx++
    ) {
      const sourceNode = sourceContentNodes[sourceIdx];

      // Skip nodes that should never match
      if (this.neverMatchNodes.has(sourceNode.node.type)) continue;

      // Find exact content match
      for (
        let targetIdx = 0;
        targetIdx < targetContentNodes.length;
        targetIdx++
      ) {
        if (targetContentMatched.has(targetIdx)) continue;

        const targetNode = targetContentNodes[targetIdx];

        if (sourceNode.markdown === targetNode.markdown) {
          // console.log(`  EXACT MATCH [${sourceIdx}]->[${targetIdx}]:`);
          // console.log(`    Type: ${sourceNode.node.type}`);
          // console.log(`    Markdown: "${sourceNode.markdown.substring(0, 80)}..."`);
          // Exact match found!
          // Include exact matches in sequence as position anchors, but not as changes
          sourceContentMatched.add(sourceIdx);
          targetContentMatched.add(targetIdx);

          const fullSourceIdx = sourceContentToFull.get(sourceIdx)!;
          const fullTargetIdx = targetContentToFull.get(targetIdx)!;

          const exactMatch: NodeDiff = {
            changeType: 'update',
            sourceIndex: fullSourceIdx,
            sourceNode: sourceNode.node,
            sourceKey: sourceNode.key,
            sourceMarkdown: sourceNode.markdown,
            targetIndex: fullTargetIdx,
            targetNode: targetNode.node,
            targetKey: targetNode.key,
            targetMarkdown: targetNode.markdown,
            nodeType: sourceNode.node.type,
            similarity: 1.0,
            matchType: 'exact',
          };

          sequence.push(exactMatch); // Include as position anchor
          // Don't add to diffs - exact matches aren't changes
          break;
        }
      }
    }

    // PHASE 2: Similarity-based matching for remaining unmatched nodes
    const similarityMatches = this.findOptimalSimilarityMatches(
      sourceContentNodes,
      targetContentNodes,
      sourceContentMatched,
      targetContentMatched,
    );

    // Add similarity matches to our results
    for (const match of similarityMatches.selectedMatches) {
      const fullSourceIdx = sourceContentToFull.get(match.sourceIndex)!;
      const fullTargetIdx = targetContentToFull.get(match.targetIndex)!;

      // Update the match with full indices
      const updatedMatch: NodeDiff = {
        ...match,
        sourceIndex: fullSourceIdx,
        targetIndex: fullTargetIdx,
      };

      diffs.push(updatedMatch);
      sequence.push(updatedMatch);
    }

    // Update matched sets with similarity matches
    sourceContentMatched = new Set([
      ...sourceContentMatched,
      ...similarityMatches.sourceMatched,
    ]);
    targetContentMatched = new Set([
      ...targetContentMatched,
      ...similarityMatches.targetMatched,
    ]);

    // PHASE 3: Handle remaining unmatched content nodes as pure adds/removes
    // Any remaining unmatched source content nodes are removes
    for (
      let sourceIdx = 0;
      sourceIdx < sourceContentNodes.length;
      sourceIdx++
    ) {
      if (!sourceContentMatched.has(sourceIdx)) {
        const sourceNode = sourceContentNodes[sourceIdx];
        const fullSourceIdx = sourceContentToFull.get(sourceIdx)!;

        const removeMatch: NodeDiff = {
          changeType: 'remove',
          sourceIndex: fullSourceIdx,
          sourceNode: sourceNode.node,
          sourceKey: sourceNode.key,
          sourceMarkdown: sourceNode.markdown,
          targetIndex: -1,
          targetNode: null as any,
          targetKey: null as any,
          targetMarkdown: '',
          nodeType: sourceNode.node.type,
          similarity: 0,
          matchType: 'none',
        };

        // Show in diffs
        diffs.push(removeMatch);
        // Include in sequence
        sequence.push(removeMatch);
      }
    }

    // Any remaining unmatched target content nodes are adds
    for (
      let targetIdx = 0;
      targetIdx < targetContentNodes.length;
      targetIdx++
    ) {
      if (!targetContentMatched.has(targetIdx)) {
        const targetNode = targetContentNodes[targetIdx];
        const fullTargetIdx = targetContentToFull.get(targetIdx)!;

        // NEW: Calculate the insertion position in the SOURCE/LIVE structure
        // Find the first matched node AFTER this position in target
        let insertPositionInSource = sourceNodesWithMarkdown.length; // Default to end

        for (
          let searchIdx = targetIdx + 1;
          searchIdx < targetContentNodes.length;
          searchIdx++
        ) {
          if (targetContentMatched.has(searchIdx)) {
            // Found a matched node after our insertion point
            // Find where this matched node is in the source
            const matchedTargetNode = targetContentNodes[searchIdx];

            // Find this node's source position by looking through our matches (exact or similar)
            for (const seqItem of sequence) {
              if (
                (seqItem.matchType === 'exact' ||
                  seqItem.matchType === 'similar') &&
                seqItem.targetMarkdown === matchedTargetNode.markdown
              ) {
                insertPositionInSource = seqItem.sourceIndex;
                break;
              }
            }
            break;
          }
        }

        const addMatch: NodeDiff = {
          changeType: 'add',
          sourceIndex: insertPositionInSource, // Use calculated position
          sourceNode: null as any,
          sourceKey: null as any,
          sourceMarkdown: '',
          targetIndex: fullTargetIdx,
          targetNode: targetNode.node,
          targetKey: targetNode.key,
          targetMarkdown: targetNode.markdown,
          nodeType: targetNode.node.type,
          similarity: 0,
          matchType: 'none',
        };

        // Show in diffs
        diffs.push(addMatch);
        // Include in sequence
        sequence.push(addMatch);
      }
    }

    // ALSO ADD: Handle empty paragraphs that are part of insertions
    // Look for empty paragraphs that are between or adjacent to added content
    for (let i = 0; i < targetNodesWithMarkdown.length; i++) {
      if (this.isEmptySpacingNode(targetNodesWithMarkdown[i])) {
        // Check if this empty paragraph is part of an insertion block
        // It's part of an insertion if it's between added content nodes
        let isPartOfInsertion = false;

        // Check if there's added content before this empty paragraph
        let hasAddedBefore = false;
        for (let j = i - 1; j >= 0; j--) {
          const contentIdx = Array.from(targetContentToFull.entries()).find(
            ([_contentIdx, fullIdx]) => fullIdx === j,
          )?.[0];
          if (
            contentIdx !== undefined &&
            !targetContentMatched.has(contentIdx)
          ) {
            hasAddedBefore = true;
            break;
          }
          // Stop if we hit matched content
          if (
            contentIdx !== undefined &&
            targetContentMatched.has(contentIdx)
          ) {
            break;
          }
        }

        // Check if there's added content after this empty paragraph
        let hasAddedAfter = false;
        for (let j = i + 1; j < targetNodesWithMarkdown.length; j++) {
          const contentIdx = Array.from(targetContentToFull.entries()).find(
            ([_contentIdx, fullIdx]) => fullIdx === j,
          )?.[0];
          if (
            contentIdx !== undefined &&
            !targetContentMatched.has(contentIdx)
          ) {
            hasAddedAfter = true;
            break;
          }
          // Stop if we hit matched content
          if (
            contentIdx !== undefined &&
            targetContentMatched.has(contentIdx)
          ) {
            break;
          }
        }

        // Include this empty paragraph if it's adjacent to added content
        if (hasAddedBefore || hasAddedAfter) {
          // Find insertion position similar to content nodes
          let insertPositionInSource = sourceNodesWithMarkdown.length;

          // Look for the next matched content node to determine position
          for (let j = i + 1; j < targetNodesWithMarkdown.length; j++) {
            const contentIdx = Array.from(targetContentToFull.entries()).find(
              ([_contentIdx, fullIdx]) => fullIdx === j,
            )?.[0];
            if (
              contentIdx !== undefined &&
              targetContentMatched.has(contentIdx)
            ) {
              // Found matched content after this empty paragraph
              const matchedNode = targetContentNodes[contentIdx];
              for (const seqItem of sequence) {
                if (
                  (seqItem.matchType === 'exact' ||
                    seqItem.matchType === 'similar') &&
                  seqItem.targetMarkdown === matchedNode.markdown
                ) {
                  insertPositionInSource = seqItem.sourceIndex;
                  break;
                }
              }
              break;
            }
          }

          const emptyParaMatch: NodeDiff = {
            changeType: 'add',
            sourceIndex: insertPositionInSource,
            sourceNode: null as any,
            sourceKey: null as any,
            sourceMarkdown: '',
            targetIndex: i,
            targetNode: targetNodesWithMarkdown[i].node,
            targetKey: targetNodesWithMarkdown[i].key,
            targetMarkdown: '',
            nodeType: 'paragraph',
            similarity: 0,
            matchType: 'none',
          };

          diffs.push(emptyParaMatch);
          sequence.push(emptyParaMatch);
        }
      }
    }

    // Sort sequence by target index to maintain proper ordering
    sequence.sort((a, b) => a.targetIndex - b.targetIndex);

    return {diffs, sequence};
  }

  /**
   * Create a NodeDiff match object
   */
  private createNodeMatch(
    sourceNode: NodeWithMarkdown,
    sourceIndex: number,
    targetNode: NodeWithMarkdown,
    targetIndex: number,
    similarity: number,
    matchType: 'exact' | 'similar' | 'none',
  ): NodeDiff {
    return {
      changeType: 'update',
      sourceIndex,
      sourceNode: sourceNode.node,
      sourceMarkdown: sourceNode.markdown,
      sourceKey: sourceNode.key,
      targetIndex,
      targetNode: targetNode.node,
      targetMarkdown: targetNode.markdown,
      targetKey: targetNode.key,
      similarity,
      matchType,
      nodeType: sourceNode.node.type,
    };
  }

  /**
   * Check if a node is just empty spacing (empty paragraph) that shouldn't be matched
   */
  private isEmptySpacingNode(node: NodeWithMarkdown): boolean {
    // Yes, matching arbitrary numbers of spaces is on purpose
    // indents of spaces between list items is common and should not be matched
    return node.node.type === 'paragraph' && node.markdown.trim() === '';
  }

  /**
   * Find optimal similarity-based matches using global optimization
   */
  private findOptimalSimilarityMatches(
    sourceNodesWithMarkdown: NodeWithMarkdown[],
    targetNodesWithMarkdown: NodeWithMarkdown[],
    sourceMatched: Set<number>,
    targetMatched: Set<number>,
  ): {
    selectedMatches: NodeDiff[];
    sourceMatched: Set<number>;
    targetMatched: Set<number>;
  } {
    // Collect all possible matches above threshold
    const possibleMatches: Array<{
      sourceIdx: number;
      targetIdx: number;
      similarity: number;
      match: NodeDiff;
    }> = [];

    // console.log('\n=== SIMILARITY MATCHING DEBUG ===');
    // console.log(
    //   `Checking ${sourceNodesWithMarkdown.length} source nodes against ${targetNodesWithMarkdown.length} target nodes`,
    // );

    // Debug: Show what nodes we're comparing
          // console.log('Source nodes (unmatched):');
    sourceNodesWithMarkdown.forEach((node, idx) => {
      if (!sourceMatched.has(idx)) {
          // console.log(`  [${idx}] ${node.node.type}: "${node.markdown}"`);
      }
    });
          // console.log('Target nodes (unmatched):');
    targetNodesWithMarkdown.forEach((node, idx) => {
      if (!targetMatched.has(idx)) {
          // console.log(`  [${idx}] ${node.node.type}: "${node.markdown}"`);
      }
    });

    // Also show ALL nodes for debugging
          // console.log('\nALL Source nodes:');
    sourceNodesWithMarkdown.forEach((node, idx) => {
          // console.log(`  [${idx}] ${node.node.type}: "${node.markdown}"`);
    });
          // console.log('ALL Target nodes:');
    targetNodesWithMarkdown.forEach((node, idx) => {
          // console.log(`  [${idx}] ${node.node.type}: "${node.markdown}"`);
    });

    for (
      let sourceIdx = 0;
      sourceIdx < sourceNodesWithMarkdown.length;
      sourceIdx++
    ) {
      if (sourceMatched.has(sourceIdx)) continue;

      const sourceNode = sourceNodesWithMarkdown[sourceIdx];
      if (this.neverMatchNodes.has(sourceNode.node.type)) continue;
      for (
        let targetIdx = 0;
        targetIdx < targetNodesWithMarkdown.length;
        targetIdx++
      ) {
        if (targetMatched.has(targetIdx)) continue;

        const targetNode = targetNodesWithMarkdown[targetIdx];

        // Skip if types don't match and we require same type
        if (
          this.config.requireSameType &&
          sourceNode.node.type !== targetNode.node.type
        ) {
          continue;
        }

        const similarity = this.calculateMarkdownSimilarity(
          sourceNode.markdown,
          targetNode.markdown,
        );

        // Apply position penalty to favor closer positions
        const positionDistance = Math.abs(sourceIdx - targetIdx);
        const maxDistance = Math.max(
          sourceNodesWithMarkdown.length,
          targetNodesWithMarkdown.length,
        );
        const positionPenalty = (positionDistance / maxDistance) * 0.2; // 20% penalty for distance
        const adjustedSimilarity = similarity - positionPenalty;

        // DEBUG: Log similarity calculations for paragraph nodes
        if (
          sourceNode.node.type === 'paragraph' &&
          targetNode.node.type === 'paragraph'
        ) {
          // console.log(`\nParagraph similarity [${sourceIdx}->${targetIdx}]:`);
          // console.log(`  Source: "${sourceNode.markdown.substring(0, 50)}..."`);
          // console.log(`  Target: "${targetNode.markdown.substring(0, 50)}..."`);
          // console.log(`  Source normalized: "${sourceNode.markdown.replace(/\s+/g, ' ').trim().substring(0, 50)}..."`);
          // console.log(`  Target normalized: "${targetNode.markdown.replace(/\s+/g, ' ').trim().substring(0, 50)}..."`);
          // console.log(`  Raw similarity: ${similarity.toFixed(3)}`);
          // console.log(`  Position penalty: ${positionPenalty.toFixed(3)}`);
          // console.log(
          //   `  Adjusted similarity: ${adjustedSimilarity.toFixed(3)}`,
          // );
          // console.log(`  Threshold: ${this.config.similarityThreshold}`);
          // console.log(
          //   `  Above threshold: ${
          //     adjustedSimilarity >= this.config.similarityThreshold
          //   }`,
          // );
        }

        if (adjustedSimilarity >= this.config.similarityThreshold) {
          const match = this.createNodeMatch(
            sourceNode,
            sourceIdx,
            targetNode,
            targetIdx,
            similarity, // Use original similarity for display, not adjusted
            'similar',
          );

          possibleMatches.push({
            sourceIdx,
            targetIdx,
            similarity: adjustedSimilarity, // Use adjusted for selection
            match,
          });
        }
      }
    }

    // console.log(
    //   `Found ${possibleMatches.length} possible matches above threshold`,
    // );
    // console.log('=====================================\n');

    // Greedy selection with position penalties - pick highest scoring non-conflicting matches
    // NOTE: Hungarian algorithm would provide theoretical global optimization, but current
    // approach works well for typical document sizes and is much simpler to maintain
    possibleMatches.sort((a, b) => b.similarity - a.similarity);

    const selectedMatches: NodeDiff[] = [];
    const newSourceMatched = new Set<number>();
    const newTargetMatched = new Set<number>();

    for (const possibleMatch of possibleMatches) {
      if (
        !newSourceMatched.has(possibleMatch.sourceIdx) &&
        !newTargetMatched.has(possibleMatch.targetIdx)
      ) {
        selectedMatches.push(possibleMatch.match);
        newSourceMatched.add(possibleMatch.sourceIdx);
        newTargetMatched.add(possibleMatch.targetIdx);
      }
    }

    return {
      selectedMatches: selectedMatches,
      sourceMatched: newSourceMatched,
      targetMatched: newTargetMatched,
    };
  }

  /**
   * Find the best match for a source node within a position window
   */
  private findBestMatchInWindow(
    sourceNodeWithMarkdown: NodeWithMarkdown,
    sourceIndex: number,
    targetNodesWithMarkdown: NodeWithMarkdown[],
    targetMatched: Set<number>,
  ): NodeDiff | null {
    let bestMatch: NodeDiff | null = null;
    let bestSimilarity = 0;

    // First check exact position
    if (
      sourceIndex < targetNodesWithMarkdown.length &&
      !targetMatched.has(sourceIndex)
    ) {
      const targetNodeWithMarkdown = targetNodesWithMarkdown[sourceIndex];
      const similarity = this.calculateMarkdownSimilarity(
        sourceNodeWithMarkdown.markdown,
        targetNodeWithMarkdown.markdown,
      );

      if (similarity === 1.0) {
        // Exact match at same position - prioritize this
        return {
          changeType: 'update',
          sourceIndex,
          sourceNode: sourceNodeWithMarkdown.node,
          sourceMarkdown: sourceNodeWithMarkdown.markdown,
          sourceKey: sourceNodeWithMarkdown.key,

          targetIndex: sourceIndex,
          targetNode: targetNodeWithMarkdown.node,
          targetMarkdown: targetNodeWithMarkdown.markdown,
          targetKey: targetNodeWithMarkdown.key,

          similarity: 1.0,
          matchType: 'exact',
          nodeType: sourceNodeWithMarkdown.node.type,
        };
      }

      if (similarity > bestSimilarity) {
        bestMatch = {
          changeType: 'update',
          sourceIndex,
          sourceNode: sourceNodeWithMarkdown.node,
          sourceMarkdown: sourceNodeWithMarkdown.markdown,
          sourceKey: sourceNodeWithMarkdown.key,

          targetIndex: sourceIndex,
          targetNode: targetNodeWithMarkdown.node,
          targetMarkdown: targetNodeWithMarkdown.markdown,
          targetKey: targetNodeWithMarkdown.key,

          similarity,
          matchType:
            similarity >= this.config.similarityThreshold ? 'similar' : 'none',
          nodeType: sourceNodeWithMarkdown.node.type,
        };
        bestSimilarity = similarity;
      }
    }

    // Check within window
    for (let offset = 1; offset <= this.config.windowSize; offset++) {
      // Check positions before and after
      for (const targetIdx of [sourceIndex + offset, sourceIndex - offset]) {
        if (
          targetIdx >= 0 &&
          targetIdx < targetNodesWithMarkdown.length &&
          !targetMatched.has(targetIdx)
        ) {
          const targetNodeWithMarkdown = targetNodesWithMarkdown[targetIdx];

          // Skip if types don't match and we require same type
          if (
            this.config.requireSameType &&
            sourceNodeWithMarkdown.node.type !==
              targetNodeWithMarkdown.node.type
          ) {
            continue;
          }

          const similarity = this.calculateMarkdownSimilarity(
            sourceNodeWithMarkdown.markdown,
            targetNodeWithMarkdown.markdown,
          );

          if (similarity > bestSimilarity) {
            bestMatch = {
              changeType: 'update',
              sourceIndex,
              sourceNode: sourceNodeWithMarkdown.node,
              sourceMarkdown: sourceNodeWithMarkdown.markdown,
              sourceKey: sourceNodeWithMarkdown.key,

              targetIndex: targetIdx,
              targetNode: targetNodeWithMarkdown.node,
              targetMarkdown: targetNodeWithMarkdown.markdown,
              targetKey: targetNodeWithMarkdown.key,

              similarity,
              matchType:
                similarity >= this.config.similarityThreshold
                  ? 'similar'
                  : 'none',
              nodeType: sourceNodeWithMarkdown.node.type,
            };
            bestSimilarity = similarity;
          }
        }
      }
    }

    // Only return matches above threshold
    return bestMatch && bestMatch.matchType !== 'none' ? bestMatch : null;
  }

  /**
   * Calculate similarity between two markdown strings
   */
  private calculateMarkdownSimilarity(
    sourceMarkdown: string,
    targetMarkdown: string,
  ): number {
    // Exact markdown match = perfect similarity
    if (sourceMarkdown === targetMarkdown) {
      return 1.0;
    }

    // Use content similarity on the markdown strings
    return this.calculateContentSimilarity(sourceMarkdown, targetMarkdown);
  }

  /**
   * Calculate content similarity between two strings using word-based comparison
   */
  private calculateContentSimilarity(source: string, target: string): number {
    if (source === target) return 1.0;
    if (!source || !target) return 0.0;

    // Normalize whitespace for comparison
    const sourceNormalized = source.replace(/\s+/g, ' ').trim();
    const targetNormalized = target.replace(/\s+/g, ' ').trim();

    // If normalized versions match, consider it a very high match
    if (sourceNormalized === targetNormalized) return 0.95;

    // Check if one is a prefix of the other (common case for additions)
    // Remove trailing punctuation for comparison
    const sourceTrimmed = sourceNormalized.replace(/[.,!?;:\s]+$/, '');
    const targetTrimmed = targetNormalized.replace(/[.,!?;:\s]+$/, '');

    if (target.startsWith(sourceTrimmed) || source.startsWith(targetTrimmed)) {
      const shorter = source.length < target.length ? source : target;
      const longer = source.length < target.length ? target : source;
      // High similarity if one is a prefix of the other
      return shorter.length / longer.length;
    }

    // Simple word-based similarity - use normalized versions
    const sourceWords = sourceNormalized.toLowerCase().split(/\s+/);
    const targetWords = targetNormalized.toLowerCase().split(/\s+/);

    if (sourceWords.length === 0 && targetWords.length === 0) return 1.0;
    if (sourceWords.length === 0 || targetWords.length === 0) return 0.0;

    const sourceSet = new Set(sourceWords);
    const targetSet = new Set(targetWords);

    const intersection = new Set(
      [...sourceSet].filter((word) => targetSet.has(word)),
    );
    const union = new Set([...sourceSet, ...targetSet]);

    const similarity = intersection.size / union.size;

    return similarity;
  }

  /**
   * Check if two nodes should be considered for recursive diffing
   * This is used after matching to determine if we should dive into the children
   */
  shouldRecursivelyDiff(match: NodeDiff): boolean {
    // Always recursively diff exact matches
    if (match.matchType === 'exact') {
      return true;
    }

    // For similar matches, only recurse if similarity is high enough
    // This prevents us from trying to diff completely different content
    return (
      match.matchType === 'similar' &&
      match.similarity >= this.config.similarityThreshold
    );
  }
}

// Export a function to create a matcher with proper configuration
export function createWindowedTreeMatcher(
  sourceEditor: LexicalEditor,
  targetEditor: LexicalEditor,
  config: Partial<MatchingConfig> = {},
): WindowedTreeMatcher {
  return new WindowedTreeMatcher(sourceEditor, targetEditor, config);
}
