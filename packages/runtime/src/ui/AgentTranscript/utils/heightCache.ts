import type { Message } from '../../../ai/server/types';

/**
 * Height cache for virtualized message list.
 * Stores measured heights and provides estimates for unmeasured items.
 */

// Base heights for different message types (in pixels)
const BASE_HEIGHTS = {
  user: 60,
  assistant: 80,
  tool: 50,
  toolExpanded: 200,
};

// Per-line height estimate for content
const LINE_HEIGHT = 20;

// Estimate characters per line for content calculation
const CHARS_PER_LINE = 80;

/**
 * Estimate height for a message based on its content
 */
export function estimateMessageHeight(
  message: Message,
  isExpanded: boolean = false,
  settings?: { compactMode?: boolean }
): number {
  const compactMultiplier = settings?.compactMode ? 0.85 : 1;

  if (message.role === 'tool') {
    // Tool messages have expandable content
    const baseHeight = isExpanded ? BASE_HEIGHTS.toolExpanded : BASE_HEIGHTS.tool;

    if (isExpanded && message.toolCall) {
      // Add height for arguments and results
      const argsSize = message.toolCall.arguments
        ? JSON.stringify(message.toolCall.arguments).length
        : 0;
      const resultSize = message.toolCall.result
        ? (typeof message.toolCall.result === 'string'
            ? message.toolCall.result.length
            : JSON.stringify(message.toolCall.result).length)
        : 0;

      const argsLines = Math.ceil(argsSize / CHARS_PER_LINE);
      const resultLines = Math.ceil(resultSize / CHARS_PER_LINE);

      // Cap estimate to prevent huge values
      const additionalHeight = Math.min((argsLines + resultLines) * LINE_HEIGHT, 500);
      return Math.round((baseHeight + additionalHeight) * compactMultiplier);
    }

    return Math.round(baseHeight * compactMultiplier);
  }

  // User or assistant message
  const baseHeight = message.role === 'user' ? BASE_HEIGHTS.user : BASE_HEIGHTS.assistant;
  const contentLength = message.content?.length || 0;
  const estimatedLines = Math.ceil(contentLength / CHARS_PER_LINE);
  const contentHeight = estimatedLines * LINE_HEIGHT;

  // Account for code blocks (they tend to be taller)
  const codeBlockCount = (message.content?.match(/```/g) || []).length / 2;
  const codeBlockExtra = codeBlockCount * 50;

  return Math.round((baseHeight + contentHeight + codeBlockExtra) * compactMultiplier);
}

/**
 * HeightCache class for managing measured and estimated heights
 */
export class HeightCache {
  private measuredHeights: Map<number, number> = new Map();
  private estimatedHeights: Map<number, number> = new Map();
  private totalHeight: number = 0;
  private offsets: number[] = [];
  private isDirty: boolean = true;

  /**
   * Set measured height for a message index
   */
  setMeasuredHeight(index: number, height: number): void {
    const oldHeight = this.measuredHeights.get(index) ?? this.estimatedHeights.get(index) ?? 0;
    if (Math.abs(oldHeight - height) > 1) {
      this.measuredHeights.set(index, height);
      this.isDirty = true;
    }
  }

  /**
   * Set estimated height for a message index (used before measurement)
   */
  setEstimatedHeight(index: number, height: number): void {
    if (!this.measuredHeights.has(index)) {
      this.estimatedHeights.set(index, height);
      this.isDirty = true;
    }
  }

  /**
   * Get height for a message index (measured or estimated)
   */
  getHeight(index: number): number {
    return this.measuredHeights.get(index) ?? this.estimatedHeights.get(index) ?? BASE_HEIGHTS.assistant;
  }

  /**
   * Check if a height has been measured (vs estimated)
   */
  isMeasured(index: number): boolean {
    return this.measuredHeights.has(index);
  }

  /**
   * Recalculate offsets if cache is dirty
   */
  private recalculateOffsets(itemCount: number): void {
    if (!this.isDirty && this.offsets.length === itemCount) return;

    this.offsets = new Array(itemCount);
    let offset = 0;

    for (let i = 0; i < itemCount; i++) {
      this.offsets[i] = offset;
      offset += this.getHeight(i);
    }

    this.totalHeight = offset;
    this.isDirty = false;
  }

  /**
   * Get the offset (top position) for a message index
   */
  getOffset(index: number, itemCount: number): number {
    this.recalculateOffsets(itemCount);
    return this.offsets[index] ?? 0;
  }

  /**
   * Get total height of all items
   */
  getTotalHeight(itemCount: number): number {
    this.recalculateOffsets(itemCount);
    return this.totalHeight;
  }

  /**
   * Find the index of the message at a given scroll offset
   * Uses binary search for efficiency
   */
  findIndexAtOffset(offset: number, itemCount: number): number {
    this.recalculateOffsets(itemCount);

    if (itemCount === 0) return 0;
    if (offset <= 0) return 0;
    if (offset >= this.totalHeight) return itemCount - 1;

    // Binary search
    let low = 0;
    let high = itemCount - 1;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.offsets[mid] <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    return low;
  }

  /**
   * Calculate visible range for a given viewport
   */
  getVisibleRange(
    scrollTop: number,
    viewportHeight: number,
    itemCount: number,
    overscan: number = 3
  ): { startIndex: number; endIndex: number } {
    if (itemCount === 0) {
      return { startIndex: 0, endIndex: 0 };
    }

    this.recalculateOffsets(itemCount);

    const startIndex = Math.max(0, this.findIndexAtOffset(scrollTop, itemCount) - overscan);
    const endIndex = Math.min(
      itemCount - 1,
      this.findIndexAtOffset(scrollTop + viewportHeight, itemCount) + overscan
    );

    return { startIndex, endIndex };
  }

  /**
   * Invalidate height for a specific index (e.g., when tool expands/collapses)
   */
  invalidateHeight(index: number): void {
    this.measuredHeights.delete(index);
    this.isDirty = true;
  }

  /**
   * Invalidate all heights from a given index onwards
   * Useful when messages are added or removed
   */
  invalidateFrom(index: number): void {
    for (const key of this.measuredHeights.keys()) {
      if (key >= index) {
        this.measuredHeights.delete(key);
      }
    }
    for (const key of this.estimatedHeights.keys()) {
      if (key >= index) {
        this.estimatedHeights.delete(key);
      }
    }
    this.isDirty = true;
  }

  /**
   * Clear all cached heights
   */
  clear(): void {
    this.measuredHeights.clear();
    this.estimatedHeights.clear();
    this.offsets = [];
    this.totalHeight = 0;
    this.isDirty = true;
  }

  /**
   * Get debug info about cache state
   */
  getDebugInfo(): {
    measuredCount: number;
    estimatedCount: number;
    totalHeight: number;
  } {
    return {
      measuredCount: this.measuredHeights.size,
      estimatedCount: this.estimatedHeights.size,
      totalHeight: this.totalHeight,
    };
  }
}

/**
 * Create a new HeightCache instance
 */
export function createHeightCache(): HeightCache {
  return new HeightCache();
}
