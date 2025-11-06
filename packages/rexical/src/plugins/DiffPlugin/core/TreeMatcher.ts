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

    // Run order-preserving diff
    // Use high pairAlignThreshold (2.0) to allow matching nodes at same position
    // even if text content is completely different (e.g., "two" → "deux")
    // This preserves document structure and minimizes false delete+add pairs
    const diffOps = diffTrees(sourceRoot, targetRoot, {
      pairAlignThreshold: 2.0,  // Was 0.8 - raised to prioritize position over similarity
      equalThreshold: 0.1,
    });

    const diffs: NodeDiff[] = [];
    const sequence: NodeDiff[] = [];

    const sourceMatched = new Set<number>();
    const targetMatched = new Set<number>();
    const targetToSource = new Map<number, number>();

    // Convert DiffOp to NodeDiff
    // Process root children only (skip root itself)
    for (const op of diffOps) {
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

    for (let i = 0; i < sourceNodes.length; i++) {
      if (sourceMatched.has(i)) continue;
      const sourceNode = sourceNodes[i];
      for (let j = 0; j < targetNodes.length; j++) {
        if (targetMatched.has(j)) continue;
        const targetNode = targetNodes[j];
        if (sourceNode.type !== targetNode.type) continue;

        const similarity = calculateSimilarity(sourceNode, targetNode);
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

    // Convert matching remove/add pairs with identical content into updates (handle moves)
    const removeDiffs = diffs.filter((d) => d.changeType === 'remove');
    const addDiffs = diffs.filter((d) => d.changeType === 'add');
    const newUpdates: NodeDiff[] = [];

    for (const removeDiff of removeDiffs) {
      const sourceNode = sourceNodes[removeDiff.sourceIndex];

      let matchedAdd: NodeDiff | null = null;
      for (const addDiff of addDiffs) {
        if (convertedAdds.has(addDiff)) continue;
        const targetNode = targetNodes[addDiff.targetIndex];
        if (!targetNode || targetNode.type !== sourceNode.type) continue;

        const attrsEqual =
          JSON.stringify(sourceNode.attrs) === JSON.stringify(targetNode.attrs);
        const textEqual = (sourceNode.text || '') === (targetNode.text || '');

        if (attrsEqual && textEqual) {
          matchedAdd = addDiff;
          break;
        }
      }

      if (matchedAdd) {
        convertedRemoves.add(removeDiff);
        convertedAdds.add(matchedAdd);

        const targetNode = targetNodes[matchedAdd.targetIndex];

        const updateDiff: NodeDiff = {
          changeType: 'update',
          sourceIndex: removeDiff.sourceIndex,
          sourceNode: removeDiff.sourceNode,
          sourceKey: removeDiff.sourceKey,
          sourceMarkdown: removeDiff.sourceMarkdown,
          sourceLiveKey: removeDiff.sourceLiveKey,
          targetIndex: matchedAdd.targetIndex,
          targetNode: targetNode ? targetNode.serialized : matchedAdd.targetNode,
          targetKey: targetNode ? targetNode.key : matchedAdd.targetKey,
          targetMarkdown: matchedAdd.targetMarkdown,
          nodeType: removeDiff.nodeType,
          similarity: 1,
          matchType: 'exact',
        };

        newUpdates.push(updateDiff);
      }
    }

    if (convertedRemoves.size > 0 || convertedAdds.size > 0) {
      const filteredSequence = sequence.filter(
        (diff) => !convertedRemoves.has(diff) && !convertedAdds.has(diff),
      );
      const filteredDiffs = diffs.filter(
        (diff) => !convertedRemoves.has(diff) && !convertedAdds.has(diff),
      );

      filteredDiffs.push(...newUpdates);
      filteredSequence.push(...newUpdates);

      diffs.splice(0, diffs.length, ...filteredDiffs);
      sequence.splice(0, sequence.length, ...filteredSequence);
    }

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
