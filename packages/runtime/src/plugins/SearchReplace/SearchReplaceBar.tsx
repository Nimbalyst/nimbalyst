import { useEffect, useState, useCallback, useRef } from 'react';
import type { LexicalEditor } from 'lexical';
import { $getRoot, $getNodeByKey, $isTextNode, $createRangeSelection, $setSelection } from 'lexical';
import { SearchReplaceStateManager } from './SearchReplaceStateManager';
import './SearchReplaceBar.css';

interface SearchReplaceBarProps {
  filePath: string;
  fileName: string;
  editor?: LexicalEditor;
}

interface SearchMatch {
  key: string;
  offset: number;
  length: number;
  text: string;
}

const SEARCH_HISTORY_KEY = 'stravu-search-history';
const REPLACE_HISTORY_KEY = 'stravu-replace-history';
const MAX_HISTORY_ITEMS = 10;

function getHistory(key: string): string[] {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addToHistory(key: string, value: string) {
  if (!value.trim()) return;

  const history = getHistory(key);
  const filtered = history.filter(item => item !== value);
  const updated = [value, ...filtered].slice(0, MAX_HISTORY_ITEMS);

  try {
    localStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

// Helper to find all text nodes in the editor
function $findTextNodes(root: ReturnType<typeof $getRoot>, callback: (node: any) => void) {
  const traverse = (node: any) => {
    if ($isTextNode(node)) {
      callback(node);
    }
    const children = node.getChildren?.();
    if (children) {
      children.forEach((child: any) => traverse(child));
    }
  };
  traverse(root);
}

// HighlightManager class for creating visual highlights over search matches
class HighlightManager {
  private editor: LexicalEditor;
  private highlightElements: HTMLElement[] = [];
  private wrapperElement: HTMLElement;
  private observer: MutationObserver | null = null;
  private rootElement: HTMLElement | null = null;
  private parentElement: HTMLElement | null = null;

  constructor(editor: LexicalEditor) {
    this.editor = editor;
    this.wrapperElement = document.createElement('div');
    this.wrapperElement.className = 'search-highlights-wrapper';
    this.wrapperElement.style.position = 'relative';
    this.wrapperElement.style.pointerEvents = 'none';
  }

  updateHighlights(matches: SearchMatch[], currentIndex: number) {
    const rootElement = this.editor.getRootElement();
    if (!rootElement) return;

    const parentElement = rootElement.parentElement;
    if (!parentElement) return;

    if (this.rootElement !== rootElement || this.parentElement !== parentElement) {
      this.setupObserver(rootElement, parentElement);
    }

    this.clearHighlights();

    if (!this.wrapperElement.isConnected) {
      parentElement.insertBefore(this.wrapperElement, parentElement.firstChild);
    }

    const { left: parentLeft, top: parentTop } = parentElement.getBoundingClientRect();

    matches.forEach((match, index) => {
      this.editor.getEditorState().read(() => {
        const node = $getNodeByKey(match.key);
        if (!$isTextNode(node)) return;

        const domElement = this.editor.getElementByKey(match.key);
        if (!domElement) return;

        const textNode = domElement.firstChild as Text;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

        const range = document.createRange();
        try {
          range.setStart(textNode, match.offset);
          range.setEnd(textNode, match.offset + match.length);
        } catch (e) {
          return;
        }

        const rects = Array.from(range.getClientRects());
        rects.forEach((rect) => {
          const highlightElement = document.createElement('div');
          highlightElement.className = index === currentIndex ? 'search-highlight-current' : 'search-highlight';
          highlightElement.style.position = 'absolute';
          highlightElement.style.left = `${rect.left - parentLeft}px`;
          highlightElement.style.top = `${rect.top - parentTop}px`;
          highlightElement.style.width = `${rect.width}px`;
          highlightElement.style.height = `${rect.height}px`;
          highlightElement.style.pointerEvents = 'none';

          this.wrapperElement.appendChild(highlightElement);
          this.highlightElements.push(highlightElement);
        });
      });
    });
  }

  clearHighlights() {
    this.highlightElements.forEach((element) => element.remove());
    this.highlightElements = [];
  }

  destroy() {
    this.clearHighlights();
    this.wrapperElement.remove();
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  private setupObserver(rootElement: HTMLElement, parentElement: HTMLElement) {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.rootElement = rootElement;
    this.parentElement = parentElement;

    this.observer = new MutationObserver(() => {
      const currentRoot = this.editor.getRootElement();
      const currentParent = currentRoot?.parentElement;

      if (currentRoot !== this.rootElement || currentParent !== this.parentElement) {
        this.clearHighlights();
      }
    });

    this.observer.observe(parentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }
}

export function SearchReplaceBar({ filePath, editor }: SearchReplaceBarProps) {
  // console.log('[SearchReplaceBar] RENDER - filePath:', filePath);

  // Use filePath as the tabId for consistency with the registry's shouldRender check
  // Note: This means tabs with the same file will share search state
  // To get per-tab isolation, we'd need a unique tab instance ID from the parent
  const tabId = filePath;

  const [isOpen, setIsOpen] = useState(false);
  const [searchString, setSearchString] = useState('');
  const [replaceString, setReplaceString] = useState('');
  const [caseInsensitive, setCaseInsensitive] = useState(true); // Case insensitive by default (Match case button OFF)
  const [useRegex, setUseRegex] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const highlightManagerRef = useRef<HighlightManager | null>(null);

  // Listen to state changes from SearchReplaceStateManager
  useEffect(() => {
    const handleStateChange = (changedTabId: string, state: any) => {
      if (changedTabId === tabId) {
        setIsOpen(state.isOpen);
      }
    };

    SearchReplaceStateManager.addListener(handleStateChange);

    // Initialize state
    const initialState = SearchReplaceStateManager.getState(tabId);
    setIsOpen(initialState.isOpen);

    return () => {
      SearchReplaceStateManager.removeListener(handleStateChange);
    };
  }, [tabId]);

  // Focus search input when bar opens
  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [isOpen]);

  // Initialize and cleanup HighlightManager
  useEffect(() => {
    if (editor) {
      highlightManagerRef.current = new HighlightManager(editor);
    }
    return () => {
      highlightManagerRef.current?.destroy();
      highlightManagerRef.current = null;
    };
  }, [editor]);

  // Clear highlights when closing
  useEffect(() => {
    if (!isOpen) {
      highlightManagerRef.current?.clearHighlights();
    }
  }, [isOpen]);

  // Navigate to a specific match - MUST be defined before performSearch
  const navigateToMatchInternal = useCallback(
    (matchList: SearchMatch[], index: number) => {
      if (!editor || matchList.length === 0 || index < 0 || index >= matchList.length) {
        return;
      }

      const match = matchList[index];
      editor.update(() => {
        const node = $getNodeByKey(match.key);
        if ($isTextNode(node)) {
          const selection = $createRangeSelection();
          selection.anchor.set(match.key, match.offset, 'text');
          selection.focus.set(match.key, match.offset + match.length, 'text');
          $setSelection(selection);

          const domNode = editor.getElementByKey(match.key);
          if (domNode) {
            domNode.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }
        }
      });

      // Keep focus on search input after navigation
      setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }, 0);
    },
    [editor]
  );

  // Perform search
  const performSearch = useCallback(
    (searchStr: string, caseSensitive: boolean, regex: boolean) => {
      if (!editor || !searchStr) {
        setMatches([]);
        setCurrentMatchIndex(-1);
        return;
      }

      editor.getEditorState().read(() => {
        const foundMatches: SearchMatch[] = [];
        let searchPattern: RegExp;

        try {
          if (regex) {
            searchPattern = new RegExp(searchStr, caseSensitive ? 'g' : 'gi');
          } else {
            const escapedSearchString = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            searchPattern = new RegExp(escapedSearchString, caseSensitive ? 'g' : 'gi');
          }
        } catch (e) {
          return;
        }

        const root = $getRoot();
        $findTextNodes(root, (textNode) => {
          const text = textNode.getTextContent();
          const key = textNode.getKey();
          let match;

          searchPattern.lastIndex = 0;
          while ((match = searchPattern.exec(text)) !== null) {
            foundMatches.push({
              key,
              offset: match.index,
              length: match[0].length,
              text: match[0],
            });
          }
        });

        setMatches(foundMatches);
        setCurrentMatchIndex(foundMatches.length > 0 ? 0 : -1);

        // Update highlights
        highlightManagerRef.current?.updateHighlights(foundMatches, foundMatches.length > 0 ? 0 : -1);

        // Navigate to first match if found
        if (foundMatches.length > 0) {
          navigateToMatchInternal(foundMatches, 0);
        }
      });
    },
    [editor, navigateToMatchInternal]
  );

  // Handle search input change
  const handleSearchChange = useCallback(
    (value: string) => {
      // Save focus state before updating
      const hadFocus = document.activeElement === searchInputRef.current;
      const selectionStart = searchInputRef.current?.selectionStart ?? 0;
      const selectionEnd = searchInputRef.current?.selectionEnd ?? 0;

      setSearchString(value);
      performSearch(value, !caseInsensitive, useRegex);

      // Restore focus after state updates
      if (hadFocus && searchInputRef.current) {
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.setSelectionRange(selectionStart, selectionEnd);
        });
      }
    },
    [performSearch, caseInsensitive, useRegex]
  );

  // Handle replace input change
  const handleReplaceChange = useCallback((value: string) => {
    setReplaceString(value);
  }, []);

  // Handle previous match navigation
  const handlePrevious = useCallback(() => {
    if (matches.length === 0) return;
    const newIndex = currentMatchIndex <= 0 ? matches.length - 1 : currentMatchIndex - 1;
    setCurrentMatchIndex(newIndex);
    highlightManagerRef.current?.updateHighlights(matches, newIndex);
    navigateToMatchInternal(matches, newIndex);
  }, [matches, currentMatchIndex, navigateToMatchInternal]);

  // Handle next match navigation
  const handleNext = useCallback(() => {
    if (matches.length === 0) return;
    const newIndex = currentMatchIndex >= matches.length - 1 ? 0 : currentMatchIndex + 1;
    setCurrentMatchIndex(newIndex);
    highlightManagerRef.current?.updateHighlights(matches, newIndex);
    navigateToMatchInternal(matches, newIndex);
  }, [matches, currentMatchIndex, navigateToMatchInternal]);

  // Replace current match
  const handleReplace = useCallback(() => {
    if (!editor || currentMatchIndex < 0 || currentMatchIndex >= matches.length) return;

    const match = matches[currentMatchIndex];
    editor.update(() => {
      const node = $getNodeByKey(match.key);
      if ($isTextNode(node)) {
        const text = node.getTextContent();
        const before = text.substring(0, match.offset);
        const after = text.substring(match.offset + match.length);
        const newText = before + replaceString + after;
        node.setTextContent(newText);
      }
    });

    addToHistory(REPLACE_HISTORY_KEY, replaceString);

    // Re-perform search after replacement
    setTimeout(() => {
      performSearch(searchString, !caseInsensitive, useRegex);
    }, 50);
  }, [editor, matches, currentMatchIndex, replaceString, searchString, caseInsensitive, useRegex, performSearch]);

  // Replace all matches
  const handleReplaceAll = useCallback(() => {
    if (!editor || matches.length === 0) return;

    editor.update(() => {
      // Group matches by node key to handle multiple replacements in the same node
      const matchesByKey = new Map<string, SearchMatch[]>();
      matches.forEach(match => {
        if (!matchesByKey.has(match.key)) {
          matchesByKey.set(match.key, []);
        }
        matchesByKey.get(match.key)!.push(match);
      });

      // Replace in reverse order within each node to maintain offsets
      matchesByKey.forEach((nodeMatches, key) => {
        const node = $getNodeByKey(key);
        if ($isTextNode(node)) {
          let text = node.getTextContent();
          // Sort matches by offset in descending order
          const sortedMatches = [...nodeMatches].sort((a, b) => b.offset - a.offset);

          sortedMatches.forEach(match => {
            const before = text.substring(0, match.offset);
            const after = text.substring(match.offset + match.length);
            text = before + replaceString + after;
          });

          node.setTextContent(text);
        }
      });
    });

    addToHistory(REPLACE_HISTORY_KEY, replaceString);

    // Clear search after replace all
    setMatches([]);
    setCurrentMatchIndex(-1);
    setSearchString('');
  }, [editor, matches, replaceString]);

  // Handle close
  const handleClose = useCallback(() => {
    if (searchString) {
      addToHistory(SEARCH_HISTORY_KEY, searchString);
    }
    SearchReplaceStateManager.close(tabId);
  }, [tabId, searchString]);

  // Handle keyboard shortcuts in search input
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Let Cmd/Ctrl+Number shortcuts bubble up to menu handlers for tab switching
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        return; // Don't prevent default or stop propagation
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          handlePrevious();
        } else {
          handleNext();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    },
    [handleNext, handlePrevious, handleClose]
  );

  // Handle keyboard shortcuts in replace input
  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Let Cmd/Ctrl+Number shortcuts bubble up to menu handlers for tab switching
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        return; // Don't prevent default or stop propagation
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) {
          if (e.shiftKey) {
            handleReplaceAll();
          } else {
            handleReplace();
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    },
    [handleReplace, handleReplaceAll, handleClose]
  );

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div className="search-replace-bar" data-testid="search-replace-bar">
      {/* First row: search input + options + navigation + close */}
      <div className="search-replace-bar-content">
        {/* Search icon */}
        <span className="search-replace-bar-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </span>

        {/* Search input */}
        <div className="search-replace-input-group">
          <input
            ref={searchInputRef}
            type="text"
            className="search-replace-input"
            placeholder="Find..."
            value={searchString}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              // Only stop propagation if we're actually handling the event
              // Let Cmd+Number and other unhandled shortcuts bubble up
              const shouldHandle = (
                e.key === 'Enter' ||
                e.key === 'Escape' ||
                (!((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9'))
              );
              if (shouldHandle && e.key !== 'Enter' && e.key !== 'Escape') {
                e.stopPropagation();
              }
              handleSearchKeyDown(e);
            }}
            data-testid="search-input"
          />
        </div>

        {/* Options */}
        <div className="search-replace-options">
          <button
            className={`search-option-button ${!caseInsensitive ? 'active' : ''}`}
            onClick={() => {
              const newValue = !caseInsensitive;
              setCaseInsensitive(newValue);
              performSearch(searchString, !newValue, useRegex);
            }}
            title="Match case"
            data-testid="case-toggle"
          >
            Aa
          </button>
          <button
            className={`search-option-button ${useRegex ? 'active' : ''}`}
            onClick={() => {
              const newValue = !useRegex;
              setUseRegex(newValue);
              performSearch(searchString, !caseInsensitive, newValue);
            }}
            title="Use regular expression"
            data-testid="regex-toggle"
          >
            .*
          </button>
        </div>

        {/* Navigation */}
        <div className="search-replace-navigation">
          <button
            onClick={handlePrevious}
            disabled={matches.length === 0}
            aria-label="Previous match"
            className="search-nav-button"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 9L3 6L6 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span className="search-match-counter" data-testid="match-counter">
            {matches.length > 0 ? `${currentMatchIndex + 1} of ${matches.length}` : searchString ? 'No results' : ''}
          </span>
          <button
            onClick={handleNext}
            disabled={matches.length === 0}
            aria-label="Next match"
            className="search-nav-button"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 3L9 6L6 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Close button */}
        <button
          className="search-replace-close"
          onClick={handleClose}
          aria-label="Close search"
          title="Close (Esc)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M10 4L4 10M4 4L10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Second row: replace input + actions */}
      <div className="search-replace-bar-content">
        {/* Spacer to align with search input */}
        <span className="search-replace-bar-icon" style={{ visibility: 'hidden' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 10L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </span>

        {/* Replace input */}
        <div className="search-replace-input-group">
          <input
            type="text"
            className="search-replace-input"
            placeholder="Replace..."
            value={replaceString}
            onChange={(e) => handleReplaceChange(e.target.value)}
            onKeyDown={(e) => {
              // Only stop propagation if we're actually handling the event
              // Let Cmd+Number and other unhandled shortcuts bubble up
              const shouldHandle = (
                e.key === 'Enter' ||
                e.key === 'Escape' ||
                (!((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9'))
              );
              if (shouldHandle && e.key !== 'Enter' && e.key !== 'Escape') {
                e.stopPropagation();
              }
              handleReplaceKeyDown(e);
            }}
            data-testid="replace-input"
          />
        </div>

        {/* Actions */}
        <div className="search-replace-actions">
          <button
            className="search-replace-button"
            onClick={handleReplace}
            disabled={currentMatchIndex < 0}
            title="Replace (Cmd+Enter)"
          >
            Replace
          </button>
          <button
            className="search-replace-button"
            onClick={handleReplaceAll}
            disabled={matches.length === 0}
            title="Replace All (Cmd+Shift+Enter)"
          >
            Replace All
          </button>
        </div>
      </div>
    </div>
  );
}
