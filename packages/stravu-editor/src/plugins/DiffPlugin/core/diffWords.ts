import {DiffSegment} from './diffUtils';

/**
 * Simple word-level diff algorithm to find differences between two strings
 * Returns an array of segments indicating which parts are equal, inserted, or deleted
 */
export function diffWords(oldText: string, newText: string): DiffSegment[] {
  // Quick check for identical text
  if (oldText === newText) {
    return [
      {
        text: oldText,
        type: 'equal',
      },
    ];
  }

  // Direct full replacement when strings are completely different
  // This helps with tests where we want complete replacement
  if (!hasCommonSubstrings(oldText, newText, 3)) {
    return [
      {
        text: oldText,
        type: 'delete',
      },
      {
        text: newText,
        type: 'insert',
      },
    ];
  }

  // Split both texts into words and punctuation
  // This explicit pattern ensures punctuation is treated as separate tokens
  const tokenPattern = /([a-zA-Z0-9]+)|([^\sa-zA-Z0-9]+)|(\s+)/g;

  const oldTokens: string[] = [];
  const newTokens: string[] = [];

  // Extract all tokens from the old text
  let match;
  while ((match = tokenPattern.exec(oldText)) !== null) {
    const token = match[0];
    if (token) {
      oldTokens.push(token);
    }
  }

  // Reset the regex to use it again
  tokenPattern.lastIndex = 0;

  // Extract all tokens from the new text
  while ((match = tokenPattern.exec(newText)) !== null) {
    const token = match[0];
    if (token) {
      newTokens.push(token);
    }
  }

  const result: DiffSegment[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  // Find common prefix
  while (
    oldIndex < oldTokens.length &&
    newIndex < newTokens.length &&
    oldTokens[oldIndex] === newTokens[newIndex]
  ) {
    result.push({
      text: oldTokens[oldIndex],
      type: 'equal',
    });
    oldIndex++;
    newIndex++;
  }

  // Find common suffix
  let oldSuffixIndex = oldTokens.length - 1;
  let newSuffixIndex = newTokens.length - 1;

  while (
    oldSuffixIndex >= oldIndex &&
    newSuffixIndex >= newIndex &&
    oldTokens[oldSuffixIndex] === newTokens[newSuffixIndex]
  ) {
    // We'll add these at the end
    oldSuffixIndex--;
    newSuffixIndex--;
  }

  // Calculate if we should fall back to full replacement
  const remainingOldTokens = oldSuffixIndex - oldIndex + 1;
  const remainingNewTokens = newSuffixIndex - newIndex + 1;

  // Count only word tokens (not spaces/punctuation) for a better threshold calculation
  const oldWordTokens = oldTokens.filter((token) =>
    /^[a-zA-Z0-9]+$/.test(token),
  );
  const newWordTokens = newTokens.filter((token) =>
    /^[a-zA-Z0-9]+$/.test(token),
  );

  // More sophisticated fallback logic:
  // 1. If more than 75% of WORD tokens need changing, fall back
  // 2. If the texts are very different in length (>2x difference), fall back
  // 3. If we have very few common tokens, fall back
  const maxWordTokens = Math.max(oldWordTokens.length, newWordTokens.length);
  const minWordTokens = Math.min(oldWordTokens.length, newWordTokens.length);
  const lengthRatio = maxWordTokens / Math.max(minWordTokens, 1);

  const shouldFallback =
    remainingOldTokens > oldTokens.length * 0.75 || // More than 75% of tokens need changing
    lengthRatio > 2.5 || // Very different lengths
    oldIndex + (oldTokens.length - oldSuffixIndex - 1) <
      oldTokens.length * 0.25; // Less than 25% common tokens

  if (shouldFallback) {
    // Clear any previously added common prefix
    result.length = 0;
    return [
      {
        text: oldText,
        type: 'delete',
      },
      {
        text: newText,
        type: 'insert',
      },
    ];
  }

  // Add deletions (old words not in new text)
  for (let i = oldIndex; i <= oldSuffixIndex; i++) {
    result.push({
      text: oldTokens[i],
      type: 'delete',
    });
  }

  // Add insertions (new words not in old text)
  for (let i = newIndex; i <= newSuffixIndex; i++) {
    result.push({
      text: newTokens[i],
      type: 'insert',
    });
  }

  // Add common suffix
  for (let i = oldSuffixIndex + 1; i < oldTokens.length; i++) {
    result.push({
      text: oldTokens[i],
      type: 'equal',
    });
  }

  // Group consecutive segments of the same type together
  const groupedResult: DiffSegment[] = [];
  for (let i = 0; i < result.length; i++) {
    const currentSegment = result[i];

    // If this is the first segment or different type from previous, start a new group
    if (
      groupedResult.length === 0 ||
      groupedResult[groupedResult.length - 1].type !== currentSegment.type
    ) {
      groupedResult.push({
        text: currentSegment.text,
        type: currentSegment.type,
      });
    } else {
      // Same type as previous segment, merge them
      groupedResult[groupedResult.length - 1].text += currentSegment.text;
    }
  }

  return groupedResult;
}

/**
 * Helper function to check if two strings share a common substring of a given minimum length
 */
function hasCommonSubstrings(
  str1: string,
  str2: string,
  minLength: number,
): boolean {
  // For short strings, check directly
  if (str1.length < minLength || str2.length < minLength) {
    return false;
  }

  // For each possible starting position in str1
  for (let i = 0; i <= str1.length - minLength; i++) {
    // Get a substring of the minimum length
    const substr = str1.substring(i, i + minLength);

    // If this substring exists in str2, the strings share a common substring
    if (str2.includes(substr)) {
      return true;
    }
  }

  return false;
}
