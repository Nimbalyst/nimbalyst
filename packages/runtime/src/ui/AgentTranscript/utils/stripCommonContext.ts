/**
 * Strips common prefix and suffix from old and new text to show only the actual changes.
 * This is useful for diff displays where the LLM includes extra context for accuracy,
 * but we only want to show users what actually changed.
 */
export interface StrippedContext {
  oldText: string;
  newText: string;
  commonPrefix: string;
  commonSuffix: string;
}

export function stripCommonContext(oldText: string, newText: string): StrippedContext {
  if (!oldText || !newText) {
    return {
      oldText,
      newText,
      commonPrefix: '',
      commonSuffix: '',
    };
  }

  // Find common prefix
  let prefixLength = 0;
  const minLength = Math.min(oldText.length, newText.length);

  while (prefixLength < minLength && oldText[prefixLength] === newText[prefixLength]) {
    prefixLength++;
  }

  // Find common suffix (but don't overlap with prefix)
  let suffixLength = 0;
  const maxSuffixLength = minLength - prefixLength;

  while (
    suffixLength < maxSuffixLength &&
    oldText[oldText.length - 1 - suffixLength] === newText[newText.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  const commonPrefix = oldText.substring(0, prefixLength);
  const commonSuffix = oldText.substring(oldText.length - suffixLength);

  const strippedOld = oldText.substring(prefixLength, oldText.length - suffixLength);
  const strippedNew = newText.substring(prefixLength, newText.length - suffixLength);

  return {
    oldText: strippedOld,
    newText: strippedNew,
    commonPrefix,
    commonSuffix,
  };
}
