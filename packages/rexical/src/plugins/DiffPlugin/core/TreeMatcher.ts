import type {Transformer} from '@lexical/markdown';
import {
  $getRoot,
  type LexicalEditor,
  type SerializedLexicalNode,
} from 'lexical';

import {
  canonicalizeForest,
  getDiffTransformers,
  levenshteinDistance,
  type CanonicalTreeNode,
} from './canonicalTree';
import {diffTrees, type DiffOp} from './ThresholdedOrderPreservingTree';
import {generateUnifiedDiff, parseUnifiedDiff} from './standardDiffFormat';

export type NodeDiff = {
  changeType: 'add' | 'remove' | 'update';

  sourceIndex: number;
  sourceNode: SerializedLexicalNode | null;
  sourceKey: string | null;
  sourceMarkdown: string; // legacy field - now contains payload
  sourceLiveKey?: string;

  targetIndex: number;
  targetNode: SerializedLexicalNode | null;
  targetKey: string | null;
  targetMarkdown: string; // payload

  nodeType: string;
  similarity: number;
  matchType: 'exact' | 'similar' | 'none';
};

export interface WindowedMatchResult {
  diffs: NodeDiff[];
  sequence: NodeDiff[];
}

export interface MatchingConfig {
  windowSize: number;
  similarityThreshold: number;
  requireSameType: boolean;
  transformers: Transformer[];
}

const DEFAULT_CONFIG: MatchingConfig = {
  windowSize: 2,
  similarityThreshold: 0.2,
  requireSameType: true,
  transformers: [],
};

type CanonicalCache = Map<string, CanonicalTreeNode>;
type ChildrenCache = Map<string, string[]>;

function calculateSimilarity(
  source: CanonicalTreeNode,
  target: CanonicalTreeNode,
): number {
  if (source.type !== target.type) {
    return 0;
  }

  const textMatches = source.text === target.text;
  const attrsMatch = JSON.stringify(source.attrs) === JSON.stringify(target.attrs);

  if (textMatches && attrsMatch) {
    return 1;
  }

  // Debug: log why similarity is not 1.0
  if (process?.env?.DIFF_DEBUG === '1' && (!textMatches || !attrsMatch)) {
    console.log(`[calculateSimilarity] NOT exact match for ${source.type}:`);
    console.log(`  textMatches: ${textMatches} (source="${source.text?.substring(0, 30)}", target="${target.text?.substring(0, 30)}")`);
    console.log(`  attrsMatch: ${attrsMatch}`);
    if (!attrsMatch) {
      console.log(`  source.attrs:`, JSON.stringify(source.attrs)?.substring(0, 100));
      console.log(`  target.attrs:`, JSON.stringify(target.attrs)?.substring(0, 100));
    }
  }

  const textDistance = levenshteinDistance(source.text || '', target.text || '');
  const maxLength = Math.max((source.text || '').length, (target.text || '').length, 1);
  const textSimilarity = 1 - textDistance / maxLength;

  const attrsMismatch = attrsMatch ? 0 : 0.1;

  return Math.max(0, Math.min(1, textSimilarity - attrsMismatch));
}

function registerCanonicalNode(
  node: CanonicalTreeNode,
  cache: CanonicalCache,
  childrenCache: ChildrenCache,
) {
  cache.set(node.key, node);
  const children = node.children || [];
  childrenCache.set(
    node.key,
    children.map((child) => child.key),
  );

  for (const child of children) {
    registerCanonicalNode(child, cache, childrenCache);
  }
}

export class WindowedTreeMatcher {
  private config: MatchingConfig;
  private sourceEditor: LexicalEditor;
  private targetEditor: LexicalEditor;

  private sourceNodeCache: CanonicalCache = new Map();
  private targetNodeCache: CanonicalCache = new Map();
  private sourceChildrenCache: ChildrenCache = new Map();
  private targetChildrenCache: ChildrenCache = new Map();
  private sourceRootChildren: CanonicalTreeNode[] = [];
  private targetRootChildren: CanonicalTreeNode[] = [];

  constructor(
    sourceEditor: LexicalEditor,
    targetEditor: LexicalEditor,
    config: Partial<MatchingConfig>,
  ) {
    const transformers =
      config.transformers && config.transformers.length > 0
        ? config.transformers
        : getDiffTransformers();

    this.sourceEditor = sourceEditor;
    this.targetEditor = targetEditor;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      transformers,
    };

    this.buildCaches();
  }

  private buildCaches(): void {
    this.sourceNodeCache.clear();
    this.targetNodeCache.clear();
    this.sourceChildrenCache.clear();
    this.targetChildrenCache.clear();
    this.sourceRootChildren = [];
    this.targetRootChildren = [];

    this.sourceEditor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      this.sourceRootChildren = canonicalizeForest(children);
      for (const child of this.sourceRootChildren) {
        registerCanonicalNode(child, this.sourceNodeCache, this.sourceChildrenCache);
      }
    });

    this.targetEditor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      this.targetRootChildren = canonicalizeForest(children);
      for (const child of this.targetRootChildren) {
        registerCanonicalNode(child, this.targetNodeCache, this.targetChildrenCache);
      }
    });
  }

  getSourceNodeData(key: string): CanonicalTreeNode | undefined {
    return this.sourceNodeCache.get(key);
  }

  getTargetNodeData(key: string): CanonicalTreeNode | undefined {
    return this.targetNodeCache.get(key);
  }

  getSourceChildren(parentKey: string): string[] {
    return this.sourceChildrenCache.get(parentKey) || [];
  }

  getTargetChildren(parentKey: string): string[] {
    return this.targetChildrenCache.get(parentKey) || [];
  }

  /**
   * Build text-based guide posts by using unified diff to find exact line matches.
   * This provides reliable anchor points for tree matching, especially for content
   * added at the beginning or when there are many similar empty paragraphs.
   *
   * Returns a Map<targetIdx, sourceIdx> of node pairs that match exactly at the text level.
   */
  private buildTextBasedGuidePosts(
    sourceNodes: CanonicalTreeNode[],
    targetNodes: CanonicalTreeNode[],
  ): Map<number, number> {
    const guidePosts = new Map<number, number>();

    // Create context-aware hash using current node + neighbors
    // This disambiguates duplicate content by considering position
    const getContextHash = (
      nodes: CanonicalTreeNode[],
      idx: number,
    ): string => {
      const node = nodes[idx];
      const text = (node.text || '').trim();
      const nodeHash = `${node.type}:${text}`;

      // Add context from neighbors to make hash more specific
      const prevType = idx > 0 ? nodes[idx - 1].type : '<start>';
      const nextType = idx < nodes.length - 1 ? nodes[idx + 1].type : '<end>';

      return `${prevType}|${nodeHash}|${nextType}`;
    };

    // Build map of context hash -> indices
    const sourceHashMap = new Map<string, number[]>();
    sourceNodes.forEach((node, idx) => {
      const hash = getContextHash(sourceNodes, idx);
      if (!sourceHashMap.has(hash)) {
        sourceHashMap.set(hash, []);
      }
      sourceHashMap.get(hash)!.push(idx);
    });

    const targetHashMap = new Map<string, number[]>();
    targetNodes.forEach((node, idx) => {
      const hash = getContextHash(targetNodes, idx);
      if (!targetHashMap.has(hash)) {
        targetHashMap.set(hash, []);
      }
      targetHashMap.get(hash)!.push(idx);
    });

    // First pass: Match unique context-aware hashes
    let contextMatches = 0;
    targetHashMap.forEach((targetIndices, hash) => {
      const sourceIndices = sourceHashMap.get(hash);
      if (!sourceIndices || sourceIndices.length === 0) {
        return;
      }

      if (sourceIndices.length === 1 && targetIndices.length === 1) {
        const sourceIdx = sourceIndices[0];
        const targetIdx = targetIndices[0];
        guidePosts.set(targetIdx, sourceIdx);
        contextMatches++;
      }
    });

    console.log(`\n[TreeMatcher] Built ${guidePosts.size} guideposts from context-aware matching`);
    console.log(`  - ${contextMatches} unique context matches (node + neighbors)`);
    if (guidePosts.size === 0) {
      console.log('  ⚠️  WARNING: No guideposts! No unique content found.');
    } else {
      const pct = Math.round((guidePosts.size / sourceNodes.length) * 100);
      console.log(`  ✓ Matched ${guidePosts.size}/${sourceNodes.length} source nodes (${pct}%)`);
    }

    return guidePosts;
  }

  matchRootChildren(): WindowedMatchResult {
    return this.matchCanonicalNodes(
      this.sourceRootChildren,
      this.targetRootChildren,
    );
  }

  matchCanonicalNodes(
    sourceNodes: CanonicalTreeNode[],
    targetNodes: CanonicalTreeNode[],
  ): WindowedMatchResult {
    // Create root nodes for diffTrees
    const sourceRoot: CanonicalTreeNode = {
      id: -1,
      key: 'source-root',
      type: 'root',
      text: undefined,
      attrs: undefined,
      children: sourceNodes,
      serialized: { type: 'root', version: 1 } as SerializedLexicalNode,
    };

    const targetRoot: CanonicalTreeNode = {
      id: -2,
      key: 'target-root',
      type: 'root',
      text: undefined,
      attrs: undefined,
      children: targetNodes,
      serialized: { type: 'root', version: 1 } as SerializedLexicalNode,
    };

    // Debug: log source and target structures
    if (process?.env?.DIFF_DEBUG === '1') {
      console.log('\n[TreeMatcher] SOURCE STRUCTURE:');
      sourceNodes.forEach((n, i) => {
        console.log(`  [${i}] ${n.type}: "${(n.text || '').substring(0, 40)}"`);
      });
      console.log('\n[TreeMatcher] TARGET STRUCTURE:');
      targetNodes.forEach((n, i) => {
        console.log(`  [${i}] ${n.type}: "${(n.text || '').substring(0, 40)}"`);
      });
      console.log('');
    }

    // Build text-based guide posts before tree matching
    // This provides reliable anchor points from exact text matches
    const textGuidePosts = this.buildTextBasedGuidePosts(sourceNodes, targetNodes);

    // Run order-preserving diff
    const diffOps = diffTrees(sourceRoot, targetRoot, {
      pairAlignThreshold: 2.0,
      equalThreshold: 0.1,
      // Weight text similarity very heavily to prefer identity matches
      // For "MD Editor" vs "Feature Requests": cost = 3.0 * 1.0 = 3.0 (text mismatch)
      // For "MD Editor" vs "MD Editor": cost = 3.0 * 0 = 0 (text match)
      // This makes identity matches much cheaper than similar-but-different matches
      // With wText=3.0, mismatched headings get normalized cost > 0.8, preventing bad pairings
      wText: 3.0,  // Much higher than default 0.5
      wAttr: 0.15,
      wStruct: 0.35,
      // Mark nodes as textual so text similarity is weighted heavily
      // This makes TOPT prefer exact text matches over position-based matches
      // heading: "MD Editor" won't match "Feature Requests" (0% text similarity)
      // listitem: "Three" won't match "undefined" (for nested list cases)
      isTextual: (n) => n.type === 'text' || n.type === 'paragraph' || n.type === 'heading' || n.type === 'list' || n.type === 'listitem',
    });

    // console.log(`\n[TreeMatcher] TOPT produced ${diffOps.length} operations for ${sourceNodes.length} source → ${targetNodes.length} target nodes:`);
    // diffOps.filter(op => op.aPath?.length === 1 || op.bPath?.length === 1).forEach((op, i) => {
    //   if (op.op === 'equal' || op.op === 'replace') {
    //     const aIdx = op.aPath?.[0];
    //     const bIdx = op.bPath?.[0];
    //     console.log(`  [${i}] ${op.op.toUpperCase()}: source[${aIdx}] "${op.a.text?.substring(0, 30)}" → target[${bIdx}] "${op.b.text?.substring(0, 30)}"`);
    //   } else if (op.op === 'delete') {
    //     const aIdx = op.aPath?.[0];
    //     console.log(`  [${i}] DELETE: source[${aIdx}] "${op.a.text?.substring(0, 30)}"`);
    //   } else if (op.op === 'insert') {
    //     const bIdx = op.bPath?.[0];
    //     console.log(`  [${i}] INSERT: target[${bIdx}] "${op.b.text?.substring(0, 30)}"`);
    //   }
    // });

    const diffs: NodeDiff[] = [];
    const sequence: NodeDiff[] = [];

    const sourceMatched = new Set<number>();
    const targetMatched = new Set<number>();
    const targetToSource = new Map<number, number>();

    // FORCE EXACT MATCHES using text-based guideposts
    // Guideposts identify content that's identical but shifted in position
    // Override TOPT's decisions and force these to match as EQUAL operations
    console.log(`[TreeMatcher] Forcing ${textGuidePosts.size} guidepost matches to override TOPT`);

    const forcedEqualOps: typeof diffOps = [];
    textGuidePosts.forEach((sourceIdx, targetIdx) => {
      // Mark as matched immediately
      sourceMatched.add(sourceIdx);
      targetMatched.add(targetIdx);
      targetToSource.set(targetIdx, sourceIdx);

      // Create EQUAL operation for this guidepost
      if (sourceIdx < sourceNodes.length && targetIdx < targetNodes.length) {
        forcedEqualOps.push({
          op: 'equal',
          aPath: [sourceIdx],
          bPath: [targetIdx],
          a: sourceNodes[sourceIdx],
          b: targetNodes[targetIdx],
        });
      }
    });

    // Prepend forced equal ops so they're processed first
    const enhancedDiffOps = [...forcedEqualOps, ...diffOps];

    // Sort diffOps so that equal/replace operations come before insert/delete
    // This ensures targetToSource map is populated before determineInsertionIndex needs it
    const sortedDiffOps = enhancedDiffOps.slice().sort((a, b) => {
      const opOrder = { 'equal': 0, 'replace': 1, 'delete': 2, 'insert': 3 };
      return opOrder[a.op] - opOrder[b.op];
    });

    // Convert DiffOp to NodeDiff
    // Process root children only (skip root itself)
    for (const op of sortedDiffOps) {
      // Skip the root node operation
      if (op.op === 'equal' && op.a.type === 'root') continue;
      if (op.op === 'replace' && op.a.type === 'root') continue;

      // Only process direct children of root (depth 1)
      const depth = op.op === 'delete' ? op.aPath.length :
                   op.op === 'insert' ? op.bPath.length :
                   op.aPath.length;
      if (depth !== 1) continue; // Only process top-level nodes

      if (op.op === 'equal' || op.op === 'replace') {
        const sourceIdx = op.aPath[0];
        const targetIdx = op.bPath[0];

        if (sourceIdx >= sourceNodes.length || targetIdx >= targetNodes.length) continue;

        const similarity = calculateSimilarity(sourceNodes[sourceIdx], targetNodes[targetIdx]);

        if (similarity < this.config.similarityThreshold) continue;

        sourceMatched.add(sourceIdx);
        targetMatched.add(targetIdx);
        targetToSource.set(targetIdx, sourceIdx);

        const isExact = op.op === 'equal';

        // CRITICAL: Skip exact matches - they require no diff operations
        // When ThresholdedOrderPreservingTree marks as EQUAL (isExact=true), trust it
        // even if calculateSimilarity returns something < 1.0 due to different algorithms
        if (isExact) {
          // Debug: log skipped exact matches
          if (process?.env?.DIFF_DEBUG === '1') {
            console.log(`[TreeMatcher] Skipping exact match at source[${sourceIdx}] -> target[${targetIdx}]: ${sourceNodes[sourceIdx].type} "${(sourceNodes[sourceIdx].text || '').substring(0, 30)}" (similarity=${similarity.toFixed(4)})`);
          }
          // Still mark as matched to prevent false delete/add pairs,
          // but don't create a diff operation
          continue;
        }

        // Debug: log non-exact matches
        if (process?.env?.DIFF_DEBUG === '1') {
          console.log(`[TreeMatcher] Creating UPDATE for source[${sourceIdx}] -> target[${targetIdx}]: ${sourceNodes[sourceIdx].type} "${(sourceNodes[sourceIdx].text || '').substring(0, 30)}" (similarity=${similarity.toFixed(4)}, isExact=${isExact})`);
        }

        const diff: NodeDiff = {
          changeType: 'update',
          sourceIndex: sourceIdx,
          sourceNode: sourceNodes[sourceIdx].serialized,
          sourceKey: sourceNodes[sourceIdx].key,
          sourceMarkdown: sourceNodes[sourceIdx].text || '',
          sourceLiveKey: sourceNodes[sourceIdx].liveNodeKey,
          targetIndex: targetIdx,
          targetNode: targetNodes[targetIdx].serialized,
          targetKey: targetNodes[targetIdx].key,
          targetMarkdown: targetNodes[targetIdx].text || '',
          nodeType: sourceNodes[sourceIdx].type,
          similarity,
          matchType: isExact ? 'exact' : 'similar',
        };

        diffs.push(diff);
        sequence.push(diff);
      } else if (op.op === 'delete') {
        const sourceIdx = op.aPath[0];
        if (sourceIdx >= sourceNodes.length) continue;

        // SKIP if already matched by guidepost
        if (sourceMatched.has(sourceIdx)) {
          console.log(`  Skipping DELETE for source[${sourceIdx}] - already matched by guidepost`);
          continue;
        }

        sourceMatched.add(sourceIdx);

        // Create NodeDiff for delete
        const diff: NodeDiff = {
          changeType: 'remove',
          sourceIndex: sourceIdx,
          sourceNode: sourceNodes[sourceIdx].serialized,
          sourceKey: sourceNodes[sourceIdx].key,
          sourceMarkdown: sourceNodes[sourceIdx].text || '',
          sourceLiveKey: sourceNodes[sourceIdx].liveNodeKey,
          targetIndex: -1,
          targetNode: null,
          targetKey: null,
          targetMarkdown: '',
          nodeType: sourceNodes[sourceIdx].type,
          similarity: 0,
          matchType: 'none',
        };

        diffs.push(diff);
        sequence.push(diff);
      } else if (op.op === 'insert') {
        const targetIdx = op.bPath[0];
        if (targetIdx >= targetNodes.length) continue;

        // SKIP if already matched by guidepost
        if (targetMatched.has(targetIdx)) {
          console.log(`  Skipping INSERT for target[${targetIdx}] - already matched by guidepost`);
          continue;
        }

        targetMatched.add(targetIdx);

        // Determine insertion index
        const insertionIndex = this.determineInsertionIndex(
          targetIdx,
          sourceNodes.length,
          targetNodes.length,
          targetToSource,
        );

        // Create NodeDiff for insert
        const diff: NodeDiff = {
          changeType: 'add',
          sourceIndex: insertionIndex,
          sourceNode: null,
          sourceKey: null,
          sourceMarkdown: '',
          sourceLiveKey: undefined,
          targetIndex: targetIdx,
          targetNode: targetNodes[targetIdx].serialized,
          targetKey: targetNodes[targetIdx].key,
          targetMarkdown: targetNodes[targetIdx].text || '',
          nodeType: targetNodes[targetIdx].type,
          similarity: 0,
          matchType: 'none',
        };

        diffs.push(diff);
        sequence.push(diff);
      }
    }

    const candidateMatches: Array<{
      sourceIdx: number;
      targetIdx: number;
      similarity: number;
    }> = [];

    // Helper to check if a node is empty
    const isEmptyParagraph = (n: CanonicalTreeNode) => {
      return n.type === 'paragraph' && (!n.text || n.text.trim() === '');
    };

    for (let i = 0; i < sourceNodes.length; i++) {
      if (sourceMatched.has(i)) continue;
      const sourceNode = sourceNodes[i];
      for (let j = 0; j < targetNodes.length; j++) {
        if (targetMatched.has(j)) continue;
        const targetNode = targetNodes[j];
        if (sourceNode.type !== targetNode.type) continue;

        let similarity = calculateSimilarity(sourceNode, targetNode);

        // CRITICAL: For empty paragraphs, similarity alone isn't enough
        // Empty paragraphs should only match if they appear in similar contexts
        // Otherwise we get empty lines appearing at wrong positions
        if (isEmptyParagraph(sourceNode) && isEmptyParagraph(targetNode)) {
          // Check contextual similarity - do surrounding nodes match?
          let contextScore = 0;
          let contextChecks = 0;

          // Check previous sibling
          const prevSource = i > 0 ? sourceNodes[i - 1] : null;
          const prevTarget = j > 0 ? targetNodes[j - 1] : null;
          if (prevSource && prevTarget && prevSource.type === prevTarget.type && prevSource.text === prevTarget.text) {
            contextScore += 1;
            contextChecks += 1;
          } else if (!prevSource && !prevTarget) {
            contextScore += 1;
            contextChecks += 1;
          } else if (prevSource && prevTarget) {
            contextChecks += 1; // Context exists but doesn't match
          }

          // Check next sibling
          const nextSource = i < sourceNodes.length - 1 ? sourceNodes[i + 1] : null;
          const nextTarget = j < targetNodes.length - 1 ? targetNodes[j + 1] : null;
          if (nextSource && nextTarget && nextSource.type === nextTarget.type && nextSource.text === nextTarget.text) {
            contextScore += 1;
            contextChecks += 1;
          } else if (!nextSource && !nextTarget) {
            contextScore += 1;
            contextChecks += 1;
          } else if (nextSource && nextTarget) {
            contextChecks += 1; // Context exists but doesn't match
          }

          // Require strong contextual match for empty paragraphs
          // If context doesn't match well, reduce similarity drastically
          const contextMatch = contextChecks > 0 ? contextScore / contextChecks : 0;

          if (process?.env?.DIFF_DEBUG === '1') {
            console.log(`[TreeMatcher] Fallback empty paragraph pairing [${i}]->[${j}]: contextScore=${contextScore}, contextChecks=${contextChecks}, contextMatch=${contextMatch.toFixed(3)}`);
          }

          if (contextMatch < 0.5) {
            // Context doesn't match - don't pair these empty paragraphs
            if (process?.env?.DIFF_DEBUG === '1') {
              console.log(`[TreeMatcher] BLOCKED fallback pairing [${i}]->[${j}]: contextMatch=${contextMatch.toFixed(3)} < 0.5`);
            }
            continue;
          }

          // Adjust similarity based on context
          similarity = similarity * contextMatch;
        }

        if (similarity >= this.config.similarityThreshold) {
          candidateMatches.push({sourceIdx: i, targetIdx: j, similarity});
        }
      }
    }

    candidateMatches.sort((a, b) => b.similarity - a.similarity);

    for (const candidate of candidateMatches) {
      if (sourceMatched.has(candidate.sourceIdx)) continue;
      if (targetMatched.has(candidate.targetIdx)) continue;

      const sourceNode = sourceNodes[candidate.sourceIdx];
      const targetNode = targetNodes[candidate.targetIdx];
      const isExact =
        candidate.similarity === 1 &&
        JSON.stringify(sourceNode.attrs) === JSON.stringify(targetNode.attrs);

      sourceMatched.add(candidate.sourceIdx);
      targetMatched.add(candidate.targetIdx);
      targetToSource.set(candidate.targetIdx, candidate.sourceIdx);

      const diff: NodeDiff = {
        changeType: 'update',
        sourceIndex: candidate.sourceIdx,
        sourceNode: sourceNode.serialized,
        sourceKey: sourceNode.key,
        sourceMarkdown: sourceNode.text || '',
        sourceLiveKey: sourceNode.liveNodeKey,
        targetIndex: candidate.targetIdx,
        targetNode: targetNode.serialized,
        targetKey: targetNode.key,
        targetMarkdown: targetNode.text || '',
        nodeType: sourceNode.type,
        similarity: candidate.similarity,
        matchType: isExact ? 'exact' : 'similar',
      };

      diffs.push(diff);
      sequence.push(diff);
    }

    const convertedRemoves = new Set<NodeDiff>();
    const convertedAdds = new Set<NodeDiff>();

    for (let i = 0; i < sourceNodes.length; i++) {
      if (sourceMatched.has(i)) continue;

      const sourceNode = sourceNodes[i];
      const diff: NodeDiff = {
        changeType: 'remove',
        sourceIndex: i,
        sourceNode: sourceNode.serialized,
        sourceKey: sourceNode.key,
        sourceMarkdown: sourceNode.text || '',
        sourceLiveKey: sourceNode.liveNodeKey,
        targetIndex: -1,
        targetNode: null,
        targetKey: null,
        targetMarkdown: '',
        nodeType: sourceNode.type,
        similarity: 0,
        matchType: 'none',
      };

      diffs.push(diff);
      sequence.push(diff);
    }

    for (let j = 0; j < targetNodes.length; j++) {
      if (targetMatched.has(j)) continue;

      const targetNode = targetNodes[j];
      const insertionIndex = this.determineInsertionIndex(
        j,
        sourceNodes.length,
        targetNodes.length,
        targetToSource,
      );

      const diff: NodeDiff = {
        changeType: 'add',
        sourceIndex: insertionIndex,
        sourceNode: null,
        sourceKey: null,
        sourceMarkdown: '',
        sourceLiveKey: undefined,
        targetIndex: j,
        targetNode: targetNode.serialized,
        targetKey: targetNode.key,
        targetMarkdown: targetNode.text || '',
        nodeType: targetNode.type,
        similarity: 0,
        matchType: 'none',
      };

      diffs.push(diff);
      sequence.push(diff);
    }

    // DON'T convert DELETE+INSERT into UPDATE!
    // If a node moves position (different source/target index), it should be DELETE+INSERT
    // UPDATE is only for content changes at the same logical position
    // Keeping DELETE+INSERT allows the node to be physically moved

    sequence.sort((a, b) => a.targetIndex - b.targetIndex);

    if (process?.env?.DIFF_DEBUG === '1') {
      console.log(
        '[TreeMatcher] diff summary',
        diffs.map((d) => ({
          type: d.changeType,
          nodeType: d.nodeType,
          sourceIdx: d.sourceIndex,
          targetIdx: d.targetIndex,
          matchType: d.matchType,
          similarity: Number(d.similarity.toFixed(2)),
          sourceText: d.sourceMarkdown,
          targetText: d.targetMarkdown,
        })),
      );

      // Print a readable summary
      console.log('\n=== DIFF SUMMARY ===');
      console.log(`Total operations: ${diffs.length}`);
      const byType = {
        add: diffs.filter(d => d.changeType === 'add').length,
        remove: diffs.filter(d => d.changeType === 'remove').length,
        update: diffs.filter(d => d.changeType === 'update').length,
      };
      console.log(`  Adds: ${byType.add}`);
      console.log(`  Removes: ${byType.remove}`);
      console.log(`  Updates: ${byType.update}`);

      const updates = diffs.filter(d => d.changeType === 'update');
      if (updates.length > 0) {
        console.log('\n=== UPDATE OPERATIONS ===');
        updates.forEach((u, i) => {
          const preview = (u.sourceMarkdown || '').substring(0, 60);
          console.log(`[${i}] ${u.nodeType} [${u.sourceIndex}->${u.targetIndex}] sim=${u.similarity.toFixed(3)} match=${u.matchType}`);
          console.log(`    "${preview}${preview.length >= 60 ? '...' : ''}"`);
        });
      }

      console.log(`\nSkipped exact matches: ${sourceNodes.length + targetNodes.length - diffs.length - sourceNodes.length - targetNodes.length + diffs.filter(d => d.changeType === 'update').length}`);
    }

    return {diffs, sequence};
  }

  private determineInsertionIndex(
    targetIdx: number,
    sourceLength: number,
    targetLength: number,
    targetToSource: Map<number, number>,
  ): number {
    for (let prev = targetIdx - 1; prev >= 0; prev--) {
      const sourceIdx = targetToSource.get(prev);
      if (sourceIdx != null) {
        return Math.min(sourceIdx + 1, sourceLength);
      }
    }

    for (let next = targetIdx + 1; next < targetLength; next++) {
      const sourceIdx = targetToSource.get(next);
      if (sourceIdx != null) {
        return sourceIdx;
      }
    }

    // WARNING: No anchor found - defaulting to append at document end
    // This can cause content duplication if matching quality is poor
    console.error(
      `[TreeMatcher] CRITICAL: No insertion anchor found for targetIdx=${targetIdx}. ` +
      `Tree matcher failed to find any matched nodes before or after this position. ` +
      `Defaulting to insert at document end (sourceLength=${sourceLength}). ` +
      `This WILL cause content duplication if this node should have matched existing content.`
    );
    return sourceLength;
  }

  shouldRecursivelyDiff(match: NodeDiff): boolean {
    if (match.matchType === 'exact') {
      return true;
    }
    return (
      match.matchType === 'similar' &&
      match.similarity >= this.config.similarityThreshold
    );
  }
}

export function createWindowedTreeMatcher(
  sourceEditor: LexicalEditor,
  targetEditor: LexicalEditor,
  config: Partial<MatchingConfig> = {},
): WindowedTreeMatcher {
  return new WindowedTreeMatcher(sourceEditor, targetEditor, config);
}
