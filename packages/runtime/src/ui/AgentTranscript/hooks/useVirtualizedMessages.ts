import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { Message } from '../../../ai/server/types';
import { HeightCache, estimateMessageHeight, createHeightCache } from '../utils/heightCache';

export interface VirtualizationConfig {
  /** Number of items to render outside the visible viewport */
  overscan?: number;
  /** Minimum number of messages before enabling virtualization */
  virtualizationThreshold?: number;
  /** Whether compact mode is enabled */
  compactMode?: boolean;
}

export interface VirtualizedRange {
  /** Start index of visible range (inclusive) */
  startIndex: number;
  /** End index of visible range (inclusive) */
  endIndex: number;
  /** Height of spacer above visible items */
  topSpacerHeight: number;
  /** Height of spacer below visible items */
  bottomSpacerHeight: number;
  /** Total scrollable height */
  totalHeight: number;
}

export interface UseVirtualizedMessagesResult {
  /** The range of messages to render */
  virtualizedRange: VirtualizedRange;
  /** Whether virtualization is currently active */
  isVirtualized: boolean;
  /** Callback to handle scroll events */
  handleScroll: (scrollTop: number, viewportHeight: number) => void;
  /** Callback when a message is measured */
  onMessageMeasured: (index: number, height: number) => void;
  /** Scroll to a specific message index */
  scrollToIndex: (index: number) => { offset: number; height: number } | null;
  /** Invalidate a specific message height (e.g., after expansion) */
  invalidateHeight: (index: number) => void;
  /** Check if user is at bottom of scroll container */
  isAtBottom: boolean;
  /** Update isAtBottom state */
  setIsAtBottom: (value: boolean) => void;
  /** Get the scroll offset for being at the bottom */
  getBottomOffset: () => number;
}

const DEFAULT_CONFIG: Required<VirtualizationConfig> = {
  overscan: 3,
  virtualizationThreshold: 50, // Only virtualize with 50+ messages
  compactMode: false,
};

/**
 * Hook for managing virtualized message rendering
 */
export function useVirtualizedMessages(
  messages: Message[],
  expandedTools: Set<string>,
  config: VirtualizationConfig = {}
): UseVirtualizedMessagesResult {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const { overscan, virtualizationThreshold, compactMode } = mergedConfig;

  // Height cache persists across renders
  const heightCacheRef = useRef<HeightCache>(createHeightCache());
  const heightCache = heightCacheRef.current;

  // Track scroll position
  const [scrollState, setScrollState] = useState({
    scrollTop: 0,
    viewportHeight: 0,
  });

  // Track if user is at bottom
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Whether virtualization could be active (meets threshold)
  const meetsVirtualizationThreshold = messages.length >= virtualizationThreshold;

  // Whether virtualization is actually active (also requires valid viewport dimensions)
  const isVirtualized = meetsVirtualizationThreshold && scrollState.viewportHeight > 0;

  // Initialize height estimates for new messages
  useEffect(() => {
    messages.forEach((message, index) => {
      if (!heightCache.isMeasured(index)) {
        const isToolExpanded = message.toolCall?.id
          ? expandedTools.has(message.toolCall.id)
          : false;
        const estimated = estimateMessageHeight(message, isToolExpanded, { compactMode });
        heightCache.setEstimatedHeight(index, estimated);
      }
    });
  }, [messages, expandedTools, compactMode, heightCache]);

  // Calculate virtualized range
  const virtualizedRange = useMemo((): VirtualizedRange => {
    const itemCount = messages.length;
    const totalHeight = heightCache.getTotalHeight(itemCount);
    const { scrollTop, viewportHeight } = scrollState;

    // Don't virtualize until we have valid viewport dimensions
    // This ensures content always renders on first load
    if (!isVirtualized || itemCount === 0 || viewportHeight === 0) {
      // No virtualization - render all items
      return {
        startIndex: 0,
        endIndex: Math.max(0, itemCount - 1),
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        totalHeight,
      };
    }

    const { startIndex, endIndex } = heightCache.getVisibleRange(
      scrollTop,
      viewportHeight,
      itemCount,
      overscan
    );

    const topSpacerHeight = heightCache.getOffset(startIndex, itemCount);
    const endOffset = heightCache.getOffset(endIndex, itemCount) + heightCache.getHeight(endIndex);
    const bottomSpacerHeight = totalHeight - endOffset;

    return {
      startIndex,
      endIndex,
      topSpacerHeight,
      bottomSpacerHeight,
      totalHeight,
    };
  }, [messages.length, isVirtualized, scrollState, overscan, heightCache]);

  // Handle scroll events
  const handleScroll = useCallback((scrollTop: number, viewportHeight: number) => {
    setScrollState({ scrollTop, viewportHeight });
  }, []);

  // Handle message measurement
  const onMessageMeasured = useCallback((index: number, height: number) => {
    heightCache.setMeasuredHeight(index, height);
  }, [heightCache]);

  // Get scroll offset for a specific index
  const scrollToIndex = useCallback((index: number): { offset: number; height: number } | null => {
    if (index < 0 || index >= messages.length) return null;

    const offset = heightCache.getOffset(index, messages.length);
    const height = heightCache.getHeight(index);

    return { offset, height };
  }, [messages.length, heightCache]);

  // Invalidate height for a specific index
  const invalidateHeight = useCallback((index: number) => {
    heightCache.invalidateHeight(index);
  }, [heightCache]);

  // Get the scroll offset that represents "at bottom"
  const getBottomOffset = useCallback(() => {
    return heightCache.getTotalHeight(messages.length);
  }, [messages.length, heightCache]);

  // Clear cache when messages change significantly (e.g., session switch)
  const prevSessionRef = useRef<number>(messages.length);
  useEffect(() => {
    // If message count dropped significantly, clear cache (likely session switch)
    if (messages.length < prevSessionRef.current * 0.5) {
      heightCache.clear();
    }
    prevSessionRef.current = messages.length;
  }, [messages.length, heightCache]);

  return {
    virtualizedRange,
    isVirtualized,
    handleScroll,
    onMessageMeasured,
    scrollToIndex,
    invalidateHeight,
    isAtBottom,
    setIsAtBottom,
    getBottomOffset,
  };
}
