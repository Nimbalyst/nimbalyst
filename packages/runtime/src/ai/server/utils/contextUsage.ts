import type { TokenUsageCategory } from '../types';

export interface ParsedContextUsage {
  totalTokens: number;
  contextWindow: number;
  categories?: TokenUsageCategory[];
}

const TOKEN_LINE_REGEX = /\*\*Tokens:\*\*\s+([\d.,]+)([kKmM]?)\s*\/\s*([\d.,]+)([kKmM]?)\s*\((\d+)%\)/i;

/**
 * Parse the markdown emitted by the `/context` command to extract token usage information.
 * Returns undefined if the expected token line cannot be parsed.
 */
export function parseContextUsageMessage(content?: string): ParsedContextUsage | undefined {
  if (!content) {
    return undefined;
  }

  const tokenMatch = content.match(TOKEN_LINE_REGEX);
  if (!tokenMatch) {
    return undefined;
  }

  const totalTokens = convertToTokens(tokenMatch[1], tokenMatch[2]);
  const contextWindow = convertToTokens(tokenMatch[3], tokenMatch[4]);
  const categories = extractCategories(content);

  return {
    totalTokens,
    contextWindow,
    categories: categories.length > 0 ? categories : undefined
  };
}

function extractCategories(content: string): TokenUsageCategory[] {
  const categoriesStart = content.indexOf('### Categories');
  if (categoriesStart === -1) {
    return [];
  }

  const section = content.slice(categoriesStart);
  const rowRegex = /\|\s*([^|]+?)\s*\|\s*([\d.,]+)([kKmM]?)\s*\|\s*([\d.,]+)%\s*\|/g;
  const categories: TokenUsageCategory[] = [];
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(section)) !== null) {
    const name = match[1].trim();
    const tokens = convertToTokens(match[2], match[3]);
    const percentage = Number.parseFloat(match[4]);

    if (!name || Number.isNaN(tokens) || Number.isNaN(percentage)) {
      continue;
    }

    categories.push({
      name,
      tokens,
      percentage
    });
  }

  return categories;
}

function convertToTokens(value: string, suffix?: string): number {
  const normalized = value.replace(/,/g, '').trim();
  const numericValue = Number.parseFloat(normalized);
  if (Number.isNaN(numericValue)) {
    return 0;
  }

  const multiplier = suffix?.toLowerCase() === 'm'
    ? 1_000_000
    : suffix?.toLowerCase() === 'k'
      ? 1_000
      : 1;

  return Math.round(numericValue * multiplier);
}
