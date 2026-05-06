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

import {$createTextNode, $isElementNode, $isTextNode, $parseSerializedNode} from 'lexical';

import {diffWords} from './diffWords';
import type {DiffSegment} from './diffUtils';
import {$setDiffState} from './DiffState';

/**
 * Split a text into sentences. Each returned element includes the sentence's
 * terminator (`.`, `!`, `?`) and the whitespace separating it from the next
 * sentence, so concatenating the result reproduces the original input.
 *
 * The split rule is intentionally simple: a terminator immediately followed
 * by whitespace ends a sentence. This mishandles abbreviations like "Mr. " --
 * those will register as a sentence break -- but it's good enough for the
 * common case (paragraph rewrites without abbreviations) and avoids the
 * complexity of a full NLP-aware splitter.
 */
function splitSentences(text: string): string[] {
  if (!text) return [];
  const result: string[] = [];
  const re = /[.!?]\s+/g;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    result.push(text.substring(cursor, end));
    cursor = end;
  }
  if (cursor < text.length) {
    result.push(text.substring(cursor));
  }
  return result;
}

interface SentenceTrimResult {
  prefix: string;
  middleSource: string;
  middleTarget: string;
  suffix: string;
}

/**
 * If source and target share an identical opening and/or closing run of
 * whole sentences, peel those off so the diff applies only to the middle.
 * Without this, a 3-sentence paragraph where only the middle sentence is
 * heavily rewritten gets dragged into the whole-paragraph block fallback,
 * unnecessarily highlighting the unchanged framing sentences as well.
 *
 * Returns null when there's no common sentence context to anchor on -- in
 * that case the caller should fall back to whole-text diffing.
 */
function trimCommonSentenceContext(
  source: string,
  target: string,
): SentenceTrimResult | null {
  const sourceSentences = splitSentences(source);
  const targetSentences = splitSentences(target);

  // Trimming is only useful when there are multiple sentences to compare.
  if (sourceSentences.length < 2 && targetSentences.length < 2) {
    return null;
  }

  const minLen = Math.min(sourceSentences.length, targetSentences.length);

  let prefixCount = 0;
  while (
    prefixCount < minLen &&
    sourceSentences[prefixCount] === targetSentences[prefixCount]
  ) {
    prefixCount++;
  }

  let suffixCount = 0;
  while (
    suffixCount < minLen - prefixCount &&
    sourceSentences[sourceSentences.length - 1 - suffixCount] ===
      targetSentences[targetSentences.length - 1 - suffixCount]
  ) {
    suffixCount++;
  }

  if (prefixCount === 0 && suffixCount === 0) {
    return null;
  }

  const prefix = sourceSentences.slice(0, prefixCount).join('');
  const suffix = sourceSentences
    .slice(sourceSentences.length - suffixCount)
    .join('');
  const middleSource = sourceSentences
    .slice(prefixCount, sourceSentences.length - suffixCount)
    .join('');
  const middleTarget = targetSentences
    .slice(prefixCount, targetSentences.length - suffixCount)
    .join('');

  // If both middles are empty, the texts are sentence-identical (the
  // pure-formatting branch should have caught this, but defend here too).
  if (!middleSource && !middleTarget) {
    return null;
  }

  return {prefix, middleSource, middleTarget, suffix};
}

/**
 * Decide whether a word-level diff is too fragmented to read inline.
 *
 * `diffWords` (LCS over whitespace-tolerant tokens) finds the longest common
 * subsequence between source and target. When the two strings are mostly
 * unrelated rewrites, the LCS is dominated by accidental matches on short
 * tokens like "the", "is", and bare spaces. The output is a long chain of
 * {delete, insert, short-equal, delete, insert, short-equal, ...} which
 * renders as red/green words mashed together with no place for the eye to
 * land.
 *
 * Two signals together trigger block fallback:
 *   1. The diff has more than 5 distinct change clusters (a "cluster" is
 *      a maximal run of non-equal segments). Three to five word swaps in a
 *      paragraph are always readable inline -- even when each swapped word
 *      shares nothing with its replacement, the surrounding whitespace and
 *      untouched words still anchor each pair visually. Beyond 5 clusters,
 *      anchoring depends on the equal segments themselves.
 *   2. Less than half the longer paragraph is part of a meaningfully-long
 *      unchanged run (>= 5 chars after trim). Lone spaces, punctuation,
 *      and short stop-words don't anchor anything; they just sit between
 *      change clusters and contribute to interleaving noise.
 *
 * Both conditions must hold. A 50-character sentence with 6 case changes
 * keeps its inline diff even though anchors are short, because we
 * overwhelmingly preserve the "many small swaps" character test cases.
 * The 30-character lower bound exists so very short edits (one-line labels,
 * two-word titles) always go through word-level diff -- block fallback on
 * those produces no readability benefit and harms accept/reject granularity.
 */
function shouldFallbackToBlockDiff(
  diffSegments: DiffSegment[],
  sourceText: string,
  targetText: string,
): boolean {
  const longerLength = Math.max(sourceText.length, targetText.length);
  if (longerLength < 30) {
    return false;
  }

  let meaningfulEqualChars = 0;
  let clusterCount = 0;
  let inCluster = false;
  for (const seg of diffSegments) {
    if (seg.type === 'equal') {
      if (seg.text.trim().length >= 5) {
        meaningfulEqualChars += seg.text.length;
      }
      inCluster = false;
    } else if (!inCluster) {
      clusterCount++;
      inCluster = true;
    }
  }

  if (clusterCount <= 5) {
    return false;
  }

  return meaningfulEqualChars / longerLength < 0.5;
}

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
  // Debug logging (commented out - enable for debugging inline diff issues)
  // const hasHashtag = [...sourceChildren, ...targetChildren].some(c => c.type === 'hashtag');
  // if (hasHashtag) {
  //   console.log('[inlineTextDiff] Processing paragraph with hashtag');
  //   console.log('  sourceChildren:', sourceChildren.map(c => `${c.type}:${(c as any).text || ''}`));
  //   console.log('  targetChildren:', targetChildren.map(c => `${c.type}:${(c as any).text || ''}`));
  // }

  // Clear the container to rebuild it
  containerNode.clear();

  // Check if all children are text nodes (can have mixed formatting)
  const allSourceAreText = sourceChildren.every(c => c.type === 'text');
  const allTargetAreText = targetChildren.every(c => c.type === 'text');

  if (allSourceAreText && allTargetAreText && sourceChildren.length > 0 && targetChildren.length > 0) {
    // Extract text and build formatting map for target
    const sourceText = sourceChildren.map(c => (c as SerializedTextNode).text).join('');
    const targetText = targetChildren.map(c => (c as SerializedTextNode).text).join('');

    // Check if this is a pure formatting change (text is identical)
    if (sourceText === targetText) {
      // Before marking as a formatting change, check if children are actually identical
      // (same count, same text, same format). If so, there's no change at all -
      // just rebuild the children without diff markers. This prevents false positives
      // where bold list items show as changed even when they haven't been modified.
      let childrenIdentical = sourceChildren.length === targetChildren.length;
      if (childrenIdentical) {
        for (let i = 0; i < sourceChildren.length; i++) {
          const s = sourceChildren[i] as SerializedTextNode;
          const t = targetChildren[i] as SerializedTextNode;
          if (s.text !== t.text || (s.format || 0) !== (t.format || 0)) {
            childrenIdentical = false;
            break;
          }
        }
      }

      if (childrenIdentical) {
        // Children are identical - no formatting change, just rebuild without markers
        for (const targetChild of targetChildren) {
          const node = $parseSerializedNode(targetChild);
          containerNode.append(node);
        }
        return;
      }

      // Pure formatting change. Walk char-by-char comparing per-character
      // formats; equal-format runs become plain text nodes (no diff marker)
      // and differing-format runs emit a removed-node (source format) plus
      // added-node (target format) covering just that span. This way bolding
      // one word in a long bullet only flashes that word red+green instead
      // of the entire line. Accept/reject still round-trip correctly because
      // the unchanged portions are unaffected and the changed-format span has
      // matching paired removed+added nodes.
      const sourceFormatMap: number[] = [];
      for (const child of sourceChildren) {
        const fmt = (child as SerializedTextNode).format || 0;
        for (let k = 0; k < (child as SerializedTextNode).text.length; k++) {
          sourceFormatMap.push(fmt);
        }
      }
      const targetFormatMap: number[] = [];
      for (const child of targetChildren) {
        const fmt = (child as SerializedTextNode).format || 0;
        for (let k = 0; k < (child as SerializedTextNode).text.length; k++) {
          targetFormatMap.push(fmt);
        }
      }

      let pos = 0;
      const len = sourceText.length;
      while (pos < len) {
        const startPos = pos;
        const sFmtAtStart = sourceFormatMap[pos];
        const tFmtAtStart = targetFormatMap[pos];
        if (sFmtAtStart === tFmtAtStart) {
          // Equal-format run: extend until either format diverges or its value changes.
          while (
            pos < len &&
            sourceFormatMap[pos] === targetFormatMap[pos] &&
            sourceFormatMap[pos] === sFmtAtStart
          ) {
            pos++;
          }
          const node = $createTextNode(sourceText.slice(startPos, pos));
          node.setFormat(sFmtAtStart);
          containerNode.append(node);
        } else {
          // Differs run: extend while both source and target formats stay
          // constant AND continue to differ. (If either side's format
          // transitions mid-run, end here so the next iteration emits the
          // new pair with correct formats.)
          while (
            pos < len &&
            sourceFormatMap[pos] !== targetFormatMap[pos] &&
            sourceFormatMap[pos] === sFmtAtStart &&
            targetFormatMap[pos] === tFmtAtStart
          ) {
            pos++;
          }
          const text = sourceText.slice(startPos, pos);
          const removed = $createTextNode(text);
          removed.setFormat(sFmtAtStart);
          $setDiffState(removed, 'removed');
          containerNode.append(removed);
          const added = $createTextNode(text);
          added.setFormat(tFmtAtStart);
          $setDiffState(added, 'added');
          containerNode.append(added);
        }
      }
      return;
    }

    // Text has changed - use inline diff with formatting preservation
    // Build a map of character position -> formatting for target text
    const targetFormatMap: number[] = [];
    let pos = 0;
    for (const child of targetChildren) {
      const textNode = child as SerializedTextNode;
      const format = textNode.format || 0;
      for (let i = 0; i < textNode.text.length; i++) {
        targetFormatMap[pos++] = format;
      }
    }

    // For source, use first node's format (or 0 if no children)
    const sourceFormat = sourceChildren.length > 0
      ? ((sourceChildren[0] as SerializedTextNode).format || 0)
      : 0;

    // Sentence-level pre-pass. If source and target share an identical
    // opening or closing run of sentences, peel those off and apply the
    // diff only to the differing middle. Without this, "S1. [rewritten S2.]
    // S3." gets dragged into a whole-paragraph block fallback that
    // unnecessarily highlights the framing sentences as well.
    const trim = trimCommonSentenceContext(sourceText, targetText);
    if (trim) {
      $emitSentenceTrimmedDiff(
        containerNode,
        trim,
        targetFormatMap,
        sourceFormat,
      );
      return;
    }

    // No common sentence context. Diff the whole text and decide whether
    // to render inline (word-level) or fall back to a block split.
    const diffSegments = diffWords(sourceText, targetText);

    // When two paragraphs are near-complete rewrites of each other, LCS will
    // still find tiny shared tokens (single short words like "the"/"is",
    // stray spaces, punctuation) and emit them as `equal` segments wedged
    // between insert/delete pairs. The result reads as garbled interleaved
    // text -- "MalleableWe're software:hosting Theit teamswith using..." --
    // because no segment is long enough to anchor the eye. In that case
    // render the source as one removed sibling container and the target as
    // one added sibling container, so each version is readable on its own.
    //
    // We split into two sibling containers (rather than stacking source-as-
    // removed and target-as-added inside the same paragraph) for two reasons:
    //   - Approve/reject stay clean. The diff machinery removes 'removed'-
    //     state nodes wholesale on approve and 'added'-state nodes wholesale
    //     on reject. With two siblings, approve drops the source container
    //     and keeps the target; reject drops the target and keeps the source
    //     -- no stray content on either side. Stacking inside one container
    //     with a separator (e.g. a <br>) would leave a stray linebreak after
    //     whichever side wins, since a separator can't be marked to vanish
    //     on both approve AND reject.
    //   - Visually the two paragraphs sit on their own lines instead of
    //     running into each other ("...prints the error.The migration script
    //     streams..."), which is what made the inline-stacked rendering
    //     unreadable at the boundary.
    if (shouldFallbackToBlockDiff(diffSegments, sourceText, targetText)) {
      $applyBlockFallback(containerNode, sourceChildren, targetChildren);
      return;
    }

    $applyWordLevelInlineDiff(
      containerNode,
      diffSegments,
      targetFormatMap,
      sourceFormat,
      0,
    );
    return;
  }

  // Complex case: handle mixed content (text with different formatting, links, hashtags, etc.)

  // Check if source and target are IDENTICAL (same structure and content)
  // This prevents false positives where hashtag/emoji nodes cause unnecessary red/green
  if (sourceChildren.length === targetChildren.length) {
    let identical = true;
    for (let i = 0; i < sourceChildren.length; i++) {
      const source = sourceChildren[i];
      const target = targetChildren[i];

      // Compare type
      if (source.type !== target.type) {
        identical = false;
        break;
      }

      // Compare text content (works for text, hashtag, emoji nodes)
      const sourceText = (source as any).text || '';
      const targetText = (target as any).text || '';
      if (sourceText !== targetText) {
        identical = false;
        break;
      }

      // Compare format for text nodes
      if (source.type === 'text') {
        const sourceFormat = (source as SerializedTextNode).format || 0;
        const targetFormat = (target as SerializedTextNode).format || 0;
        if (sourceFormat !== targetFormat) {
          identical = false;
          break;
        }
      }
    }

    // If identical, just add target children without diff markers
    if (identical) {
      // if (hasHashtag) {
      //   console.log('[inlineTextDiff] Children are IDENTICAL! Adding without diff markers');
      // }
      for (const targetChild of targetChildren) {
        const node = $parseSerializedNode(targetChild);
        containerNode.append(node);
      }
      return;
    }
    // else if (hasHashtag) {
    //   console.log('[inlineTextDiff] Children are NOT identical, falling back to remove+add');
    // }
  }

  // Content is different -- the two children sequences contain inline
  // elements (links, hashtags, etc.) that aren't amenable to word-level
  // diffing. Render as a block fallback (source container removed wholesale,
  // target container added wholesale) instead of stacking both in one
  // container, so the boundary doesn't run together visually and approve/
  // reject can each cleanly drop one entire side.
  $applyBlockFallback(containerNode, sourceChildren, targetChildren);
}

/**
 * Render a block-level diff: clone the live container, fill the live one with
 * source children all marked removed, fill the clone with target children all
 * marked added, and insert the clone as the live container's next sibling.
 *
 * Works for any element type the host editor can round-trip through
 * exportJSON/$parseSerializedNode -- paragraphs, headings, list items,
 * blockquotes, etc. Falls back to stacking source-then-target inside the
 * existing container if the round-trip fails, so unusual container types
 * still get *some* diff visualization rather than an exception.
 */
function $applyBlockFallback(
  containerNode: ElementNode,
  sourceChildren: SerializedLexicalNode[],
  targetChildren: SerializedLexicalNode[],
): void {
  let targetContainer: ElementNode | null = null;
  try {
    // exportJSON typings don't expose `children`, but ElementNodes serialize
    // it. Override to [] so the cloned container starts empty.
    const containerJson = {
      ...(containerNode.exportJSON() as Record<string, unknown>),
      children: [],
    } as unknown as SerializedLexicalNode;
    const cloned = $parseSerializedNode(containerJson);
    if ($isElementNode(cloned)) {
      targetContainer = cloned;
    }
  } catch {
    targetContainer = null;
  }

  if (targetContainer) {
    for (const sourceChild of sourceChildren) {
      $appendChildAsRemoved(containerNode, sourceChild);
    }
    // Override any 'modified' state set by the caller -- the container is
    // being removed wholesale on approve, not modified in place.
    $setDiffState(containerNode, 'removed');

    $setDiffState(targetContainer, 'added');
    for (const targetChild of targetChildren) {
      $appendChildAsAdded(targetContainer, targetChild);
    }
    containerNode.insertAfter(targetContainer);
    return;
  }

  // Fallback path: cloning failed (custom container type without a working
  // exportJSON/parseSerializedNode round-trip). Stack inline so the diff is
  // still visible -- the visual jam at the boundary is the lesser evil
  // versus throwing.
  for (const sourceChild of sourceChildren) {
    $appendChildAsRemoved(containerNode, sourceChild);
  }
  for (const targetChild of targetChildren) {
    $appendChildAsAdded(containerNode, targetChild);
  }
}

/**
 * Render the word-level diff segments inline into the container, preserving
 * per-character target formatting on equal/insert runs and source formatting
 * on delete runs. Equal/insert runs walk through `targetFormatMap` starting
 * at `targetMapOffset` so this can be used either over the full target text
 * (offset 0) or over a slice of it (offset = prefix length, when applied to
 * the differing middle inside a sentence-trimmed paragraph).
 */
function $applyWordLevelInlineDiff(
  containerNode: ElementNode,
  diffSegments: DiffSegment[],
  targetFormatMap: number[],
  sourceFormat: number,
  targetMapOffset: number,
): void {
  let targetPos = targetMapOffset;

  for (const segment of diffSegments) {
    if (segment.type === 'equal') {
      for (let i = 0; i < segment.text.length; i++) {
        const char = segment.text[i];
        const format = targetFormatMap[targetPos++] || 0;
        if (i === 0 || targetFormatMap[targetPos - 2] !== format) {
          const textNode = $createTextNode(char);
          textNode.setFormat(format);
          containerNode.append(textNode);
        } else {
          const lastChild = containerNode.getLastChild();
          if (lastChild && $isTextNode(lastChild)) {
            lastChild.setTextContent(lastChild.getTextContent() + char);
          }
        }
      }
    } else if (segment.type === 'delete') {
      const textNode = $createTextNode(segment.text);
      textNode.setFormat(sourceFormat);
      $setDiffState(textNode, 'removed');
      containerNode.append(textNode);
    } else {
      // insert
      for (let i = 0; i < segment.text.length; i++) {
        const char = segment.text[i];
        const format = targetFormatMap[targetPos++] || 0;
        if (i === 0 || targetFormatMap[targetPos - 2] !== format) {
          const textNode = $createTextNode(char);
          textNode.setFormat(format);
          $setDiffState(textNode, 'added');
          containerNode.append(textNode);
        } else {
          const lastChild = containerNode.getLastChild();
          if (lastChild && $isTextNode(lastChild)) {
            lastChild.setTextContent(lastChild.getTextContent() + char);
          }
        }
      }
    }
  }
}

/**
 * Render a sentence-trimmed diff: emit the unchanged opening sentences as
 * plain text, diff the differing middle (word-level if it isn't fragmented,
 * inline block remove+add if it is), then emit the unchanged closing
 * sentences as plain text.
 *
 * The middle uses an inline block remove+add (rather than the sibling-split
 * used by whole-paragraph block fallback) because we can't sibling-split a
 * mid-paragraph slice without breaking the framing sentences out into their
 * own paragraphs. The unchanged framing sentences provide enough visual
 * anchoring that the in-paragraph remove+add reads cleanly even when source
 * and target middles run adjacent.
 */
function $emitSentenceTrimmedDiff(
  containerNode: ElementNode,
  trim: SentenceTrimResult,
  fullTargetFormatMap: number[],
  sourceFormat: number,
): void {
  const {prefix, middleSource, middleTarget, suffix} = trim;

  if (prefix) {
    const node = $createTextNode(prefix);
    node.setFormat(sourceFormat);
    containerNode.append(node);
  }

  if (middleSource || middleTarget) {
    const middleSegments = diffWords(middleSource, middleTarget);
    if (
      shouldFallbackToBlockDiff(middleSegments, middleSource, middleTarget)
    ) {
      if (middleSource) {
        const removed = $createTextNode(middleSource);
        removed.setFormat(sourceFormat);
        $setDiffState(removed, 'removed');
        containerNode.append(removed);
      }
      if (middleTarget) {
        const added = $createTextNode(middleTarget);
        added.setFormat(sourceFormat);
        $setDiffState(added, 'added');
        containerNode.append(added);
      }
    } else {
      // Word-level for the middle. The prefix is text-identical between
      // source and target, so the middle's bytes start at `prefix.length`
      // in the (full-text) target format map.
      $applyWordLevelInlineDiff(
        containerNode,
        middleSegments,
        fullTargetFormatMap,
        sourceFormat,
        prefix.length,
      );
    }
  }

  if (suffix) {
    const node = $createTextNode(suffix);
    node.setFormat(sourceFormat);
    containerNode.append(node);
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
