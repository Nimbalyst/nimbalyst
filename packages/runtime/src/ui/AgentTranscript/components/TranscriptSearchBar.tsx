import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MaterialSymbol } from '../../icons/MaterialSymbol';

// Inject search highlight styles once
const injectHighlightStyles = () => {
  const styleId = 'transcript-search-highlight-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .transcript-search-highlight {
      background-color: color-mix(in srgb, var(--warning-color, #fbbf24) 30%, transparent);
      color: var(--nim-text);
      border-radius: 0.125rem;
      padding: 0 0.125rem;
    }
    .transcript-search-highlight-current {
      background-color: var(--warning-color, #fbbf24);
      color: var(--nim-bg);
      font-weight: 500;
    }
    .transcript-search-message-has-matches {
      outline: 1px solid color-mix(in srgb, var(--warning-color, #fbbf24) 25%, transparent);
      outline-offset: -1px;
    }
    .transcript-search-message-current {
      outline: 2px solid color-mix(in srgb, var(--warning-color, #fbbf24) 50%, transparent);
      outline-offset: -2px;
      background-color: color-mix(in srgb, var(--warning-color, #fbbf24) 5%, transparent) !important;
    }
  `;
  document.head.appendChild(style);
};

 /**
 * TranscriptSearchBar - Find-in-page search UI for agent transcript messages.
 *
 * Provides browser-style text search with highlighting, case sensitivity toggle,
 * and keyboard navigation (Enter/Shift+Enter, Cmd+G/Cmd+Shift+G, Escape).
 *
 * Features:
 * - Walks DOM tree to find all text matches across transcript messages
 * - Highlights matches with visual indicators (yellow for all, orange for current)
 * - Scrolls nested containers and main view to bring current match into view
 * - Supports case-sensitive and case-insensitive search modes
 * - Cleans up all highlights when search bar is closed
 */

interface SearchMatch {
  node: Node;
  offset: number;
  length: number;
  element: HTMLElement; // The message container element
}

interface TranscriptSearchBarProps {
  isVisible: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
}

export const TranscriptSearchBar: React.FC<TranscriptSearchBarProps> = ({
  isVisible,
  containerRef,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightClassName = 'transcript-search-highlight';
  const currentHighlightClassName = 'transcript-search-highlight-current';

  // Inject highlight styles on mount
  useEffect(() => {
    injectHighlightStyles();
  }, []);

  // Navigate to next match
  const goToNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  // Navigate to previous match
  const goToPrevMatch = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  // Focus input when search bar becomes visible
  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isVisible]);

  // Listen for Cmd+G navigation events from parent
  useEffect(() => {
    if (!isVisible) return;

    const handleNext = () => goToNextMatch();
    const handlePrev = () => goToPrevMatch();

    window.addEventListener('transcript-search-next', handleNext);
    window.addEventListener('transcript-search-prev', handlePrev);

    return () => {
      window.removeEventListener('transcript-search-next', handleNext);
      window.removeEventListener('transcript-search-prev', handlePrev);
    };
  }, [isVisible, goToNextMatch, goToPrevMatch]);

  // Clear highlights when component unmounts or becomes hidden
  useEffect(() => {
    if (!isVisible) {
      clearHighlights();
      setSearchQuery('');
      setMatches([]);
      setCurrentIndex(0);
    }
  }, [isVisible]);

  // Clear existing highlights
  const clearHighlights = useCallback(() => {
    if (!containerRef.current) return;

    // Remove highlight spans
    const highlightedElements = containerRef.current.querySelectorAll(
      `.${highlightClassName}, .${currentHighlightClassName}`
    );
    highlightedElements.forEach((element) => {
      const parent = element.parentNode;
      if (parent) {
        const textNode = document.createTextNode(element.textContent || '');
        parent.replaceChild(textNode, element);
        parent.normalize();
      }
    });

    // Remove message container highlight classes
    const messageElements = containerRef.current.querySelectorAll(
      '.transcript-search-message-has-matches, .transcript-search-message-current'
    );
    messageElements.forEach((element) => {
      element.classList.remove('transcript-search-message-has-matches');
      element.classList.remove('transcript-search-message-current');
    });
  }, [containerRef]);

  // Search for matches in the transcript
  const performSearch = useCallback(
    (query: string) => {
      clearHighlights();

      if (!query || !containerRef.current) {
        setMatches([]);
        setCurrentIndex(0);
        return;
      }

      const newMatches: SearchMatch[] = [];
      const searchRegex = new RegExp(
        query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        caseSensitive ? 'g' : 'gi'
      );

      // Walk through all text nodes in the container
      const walker = document.createTreeWalker(
        containerRef.current,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent || '';
        let match: RegExpExecArray | null;

        searchRegex.lastIndex = 0;
        while ((match = searchRegex.exec(text))) {
          const matchOffset = match.index;
          const matchLength = match[0].length;

          // Get the parent element for scrolling
          let element = node.parentElement;
          while (element && element !== containerRef.current) {
            if (element.classList.contains('rich-transcript-message')) {
              break;
            }
            element = element.parentElement;
          }

          if (element) {
            newMatches.push({
              node,
              offset: matchOffset,
              length: matchLength,
              element,
            });
          }
        }
      }

      setMatches(newMatches);
      setCurrentIndex(newMatches.length > 0 ? 0 : -1);

      // Highlight all matches
      if (newMatches.length > 0) {
        highlightMatches(newMatches, 0);
      }
    },
    [containerRef, caseSensitive, clearHighlights]
  );

  // Update which match is current (without rebuilding all highlights)
  const updateCurrentMatch = useCallback(
    (matchList: SearchMatch[], currentIdx: number) => {
      if (!containerRef.current) return;

      // Remove current match highlighting from all elements
      const currentHighlights = containerRef.current.querySelectorAll(
        `.${currentHighlightClassName}`
      );
      currentHighlights.forEach((el) => {
        el.classList.remove(currentHighlightClassName);
      });

      // Remove message current class
      const currentMessages = containerRef.current.querySelectorAll(
        '.transcript-search-message-current'
      );
      currentMessages.forEach((el) => {
        el.classList.remove('transcript-search-message-current');
      });

      // Add current highlight to the new current match
      if (currentIdx >= 0 && currentIdx < matchList.length) {
        const allHighlights = containerRef.current.querySelectorAll(
          `.${highlightClassName}`
        );
        if (allHighlights[currentIdx]) {
          allHighlights[currentIdx].classList.add(currentHighlightClassName);

          const currentMatch = matchList[currentIdx];
          currentMatch.element.classList.add('transcript-search-message-current');

          // Scroll nested containers
          const currentHighlight = allHighlights[currentIdx] as HTMLElement;
          let parent = currentHighlight.parentElement;
          while (parent && parent !== containerRef.current) {
            const hasScroll =
              parent.scrollHeight > parent.clientHeight ||
              parent.scrollWidth > parent.clientWidth;
            const overflowY = window.getComputedStyle(parent).overflowY;
            const isScrollable =
              hasScroll && (overflowY === 'auto' || overflowY === 'scroll');

            if (isScrollable) {
              const parentRect = parent.getBoundingClientRect();
              const highlightRect = currentHighlight.getBoundingClientRect();
              const relativeTop = highlightRect.top - parentRect.top;
              const relativeBottom = highlightRect.bottom - parentRect.bottom;

              if (relativeTop < 0) {
                parent.scrollTop += relativeTop - 20;
              } else if (relativeBottom > 0) {
                parent.scrollTop += relativeBottom + 20;
              }
            }

            parent = parent.parentElement;
          }

          // Scroll main container
          currentMatch.element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }
      }
    },
    [containerRef]
  );

  // Highlight all matches (called when search query changes)
  const highlightMatches = useCallback(
    (matchList: SearchMatch[], currentIdx: number) => {
      clearHighlights();

      // Track which message elements have matches
      const messageElementsWithMatches = new Set<HTMLElement>();

      matchList.forEach((match, index) => {
        const { node, offset, length, element } = match;
        const text = node.textContent || '';
        const parent = node.parentNode;

        if (!parent) return;

        // Add this message element to the set
        messageElementsWithMatches.add(element);

        // Create text nodes and highlight span
        const before = document.createTextNode(text.substring(0, offset));
        const matchText = text.substring(offset, offset + length);
        const after = document.createTextNode(text.substring(offset + length));

        const highlight = document.createElement('span');
        highlight.className = highlightClassName;
        highlight.textContent = matchText;

        // Replace the text node with the highlighted version
        const fragment = document.createDocumentFragment();
        if (before.textContent) fragment.appendChild(before);
        fragment.appendChild(highlight);
        if (after.textContent) fragment.appendChild(after);

        parent.replaceChild(fragment, node);

        // Update the match reference to point to the new highlight element
        match.node = highlight.firstChild || node;
      });

      // Add highlight class to message containers that have matches
      messageElementsWithMatches.forEach((element) => {
        element.classList.add('transcript-search-message-has-matches');
      });

      // Now update which one is current
      updateCurrentMatch(matchList, currentIdx);
    },
    [clearHighlights, updateCurrentMatch]
  );

  // Update which match is current when index changes (without rebuilding highlights)
  useEffect(() => {
    if (matches.length > 0 && currentIndex >= 0) {
      updateCurrentMatch(matches, currentIndex);
    }
  }, [currentIndex, matches, updateCurrentMatch]);

  // Perform search when query or case sensitivity changes
  useEffect(() => {
    performSearch(searchQuery);
  }, [searchQuery, caseSensitive, performSearch]);

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrevMatch();
      } else {
        goToNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isVisible) {
    return null;
  }

  const matchCount = matches.length;
  const displayIndex = matchCount > 0 ? currentIndex + 1 : 0;

  return (
    <div className="transcript-search-bar sticky top-0 z-10 bg-[var(--nim-bg-secondary)] border-b border-[var(--nim-border)] px-3 py-2">
      <div className="transcript-search-bar-content flex items-center gap-2 max-w-4xl mx-auto">
        <input
          ref={inputRef}
          type="text"
          className="transcript-search-input flex-1 min-w-0 px-2.5 py-1.5 text-sm bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md text-[var(--nim-text)] outline-none transition-colors focus:border-[var(--nim-primary)] placeholder:text-[var(--nim-text-faint)]"
          placeholder="Find in transcript..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="transcript-search-match-counter text-xs text-[var(--nim-text-muted)] whitespace-nowrap min-w-20 text-center">
          {matchCount > 0 ? `${displayIndex} of ${matchCount}` : 'No matches'}
        </div>

        <button
          className="transcript-search-button p-1.5 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md text-[var(--nim-text-muted)] cursor-pointer transition-all flex items-center justify-center hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] hover:text-[var(--nim-text)] disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={goToPrevMatch}
          disabled={matchCount === 0}
          title="Previous match (Shift+Enter or Cmd+Shift+G)"
        >
          <MaterialSymbol icon="keyboard_arrow_up" size={18} />
        </button>

        <button
          className="transcript-search-button p-1.5 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md text-[var(--nim-text-muted)] cursor-pointer transition-all flex items-center justify-center hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] hover:text-[var(--nim-text)] disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={goToNextMatch}
          disabled={matchCount === 0}
          title="Next match (Enter or Cmd+G)"
        >
          <MaterialSymbol icon="keyboard_arrow_down" size={18} />
        </button>

        <button
          className={`transcript-search-button transcript-search-case-button p-1.5 text-xs font-semibold font-mono bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md text-[var(--nim-text-muted)] cursor-pointer transition-all flex items-center justify-center hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] hover:text-[var(--nim-text)] ${caseSensitive ? 'bg-[var(--nim-primary)] border-[var(--nim-primary)] text-white' : ''}`}
          onClick={() => setCaseSensitive(!caseSensitive)}
          title={caseSensitive ? 'Case sensitive' : 'Case insensitive'}
          data-active={caseSensitive}
        >
          Aa
        </button>

        <button
          className="transcript-search-button transcript-search-close-button ml-1 p-1.5 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md text-[var(--nim-text-muted)] cursor-pointer transition-all flex items-center justify-center hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] hover:text-[var(--nim-text)]"
          onClick={onClose}
          title="Close (Escape)"
        >
          <MaterialSymbol icon="close" size={18} />
        </button>
      </div>
    </div>
  );
};
