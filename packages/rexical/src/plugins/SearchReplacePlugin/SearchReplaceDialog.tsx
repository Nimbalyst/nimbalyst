/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import * as React from 'react';
import {useCallback, useEffect, useRef, useState, useMemo, useImperativeHandle, forwardRef} from 'react';

import type {SearchMatch} from './index';

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

interface SearchReplaceDialogProps {
  searchString: string;
  replaceString: string;
  caseInsensitive: boolean;
  useRegex: boolean;
  matches: SearchMatch[];
  currentMatchIndex: number;
  onSearchChange: (value: string) => void;
  onReplaceChange: (value: string) => void;
  onCaseInsensitiveChange: (value: boolean) => void;
  onUseRegexChange: (value: boolean) => void;
  onNext: () => void;
  onPrevious: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export interface SearchReplaceDialogHandle {
  focusSearchInput: () => void;
}

export const SearchReplaceDialog = forwardRef<SearchReplaceDialogHandle, SearchReplaceDialogProps>(({
  searchString,
  replaceString,
  caseInsensitive = true,
  useRegex,
  matches,
  currentMatchIndex,
  onSearchChange,
  onReplaceChange,
  onCaseInsensitiveChange,
  onUseRegexChange,
  onNext,
  onPrevious,
  onReplace,
  onReplaceAll,
  onClose,
}, ref) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const [showReplaceHistory, setShowReplaceHistory] = useState(false);
  const [searchHistoryIndex, setSearchHistoryIndex] = useState(-1);
  const [replaceHistoryIndex, setReplaceHistoryIndex] = useState(-1);
  const [theme, setTheme] = useState<string>('light');

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  const searchHistory = useMemo(() => getHistory(SEARCH_HISTORY_KEY), [showSearchHistory]);
  const replaceHistory = useMemo(() => getHistory(REPLACE_HISTORY_KEY), [showReplaceHistory]);

  useEffect(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();

    // Detect theme from .stravu-editor element
    const editorElement = document.querySelector('.stravu-editor');
    if (editorElement) {
      const currentTheme = editorElement.getAttribute('data-theme') || 'light';
      setTheme(currentTheme);

      // Watch for theme changes
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
            const newTheme = editorElement.getAttribute('data-theme') || 'light';
            setTheme(newTheme);
          }
        });
      });

      observer.observe(editorElement, { attributes: true });

      return () => observer.disconnect();
    }
    return undefined;
  }, []);
  
  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focusSearchInput: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }), []);
  
  // Save to history when performing search/replace actions
  useEffect(() => {
    if (matches.length > 0 && searchString) {
      addToHistory(SEARCH_HISTORY_KEY, searchString);
    }
  }, [matches.length, searchString]);
  
  const handleReplace = useCallback(() => {
    if (replaceString) {
      addToHistory(REPLACE_HISTORY_KEY, replaceString);
    }
    onReplace();
  }, [replaceString, onReplace]);
  
  const handleReplaceAll = useCallback(() => {
    if (replaceString) {
      addToHistory(REPLACE_HISTORY_KEY, replaceString);
    }
    onReplaceAll();
  }, [replaceString, onReplaceAll]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          onPrevious();
        } else {
          onNext();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onNext, onPrevious, onClose],
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      handleKeyDown(e);
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          onPrevious();
        } else {
          onNext();
        }
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        setShowSearchHistory(true);
        setSearchHistoryIndex(-1);
      } else if (showSearchHistory) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const newIndex = Math.min(searchHistoryIndex + 1, searchHistory.length - 1);
          setSearchHistoryIndex(newIndex);
          if (newIndex >= 0) {
            onSearchChange(searchHistory[newIndex]);
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const newIndex = Math.max(searchHistoryIndex - 1, -1);
          setSearchHistoryIndex(newIndex);
          if (newIndex >= 0) {
            onSearchChange(searchHistory[newIndex]);
          }
        } else if (e.key === 'Enter' && searchHistoryIndex >= 0) {
          e.preventDefault();
          onSearchChange(searchHistory[searchHistoryIndex]);
          setShowSearchHistory(false);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setShowSearchHistory(false);
        }
      }
    },
    [handleKeyDown, onNext, onPrevious, onSearchChange, showSearchHistory, searchHistory, searchHistoryIndex],
  );

  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      handleKeyDown(e);
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey || e.altKey) {
          handleReplaceAll();
        } else {
          handleReplace();
        }
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        setShowReplaceHistory(true);
        setReplaceHistoryIndex(-1);
      } else if (showReplaceHistory) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const newIndex = Math.min(replaceHistoryIndex + 1, replaceHistory.length - 1);
          setReplaceHistoryIndex(newIndex);
          if (newIndex >= 0) {
            onReplaceChange(replaceHistory[newIndex]);
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const newIndex = Math.max(replaceHistoryIndex - 1, -1);
          setReplaceHistoryIndex(newIndex);
          if (newIndex >= 0) {
            onReplaceChange(replaceHistory[newIndex]);
          }
        } else if (e.key === 'Enter' && replaceHistoryIndex >= 0) {
          e.preventDefault();
          onReplaceChange(replaceHistory[replaceHistoryIndex]);
          setShowReplaceHistory(false);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setShowReplaceHistory(false);
        }
      }
    },
    [handleKeyDown, handleReplace, handleReplaceAll, onReplaceChange, showReplaceHistory, replaceHistory, replaceHistoryIndex],
  );

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from the header
    if (!(e.target as HTMLElement).closest('.search-replace-header')) {
      return;
    }
    // Don't drag if clicking the close button
    if ((e.target as HTMLElement).closest('.search-replace-close')) {
      return;
    }
    
    setIsDragging(true);
    // Store the initial mouse position and the current dialog position
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    // Calculate new position based on mouse movement
    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;
    
    setPosition({ x: newX, y: newY });
  }, [isDragging, dragOffset]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
    return undefined;
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={dialogRef}
      className={`search-replace-dialog fixed top-20 right-5 w-[520px] max-w-[calc(100%-40px)] bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.15)] z-[500] font-sans text-sm select-none transition-shadow ${
        isDragging ? 'shadow-[0_8px_24px_rgba(0,0,0,0.35)] opacity-95' : ''
      }`}
      data-theme={theme}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        cursor: isDragging ? 'grabbing' : 'auto'
      }}
      onMouseDown={handleMouseDown}
    >
      <div className={`search-replace-header flex justify-between items-center px-4 py-1.5 border-b border-[var(--nim-border)] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}>
        <span className="search-replace-title font-semibold text-[var(--nim-text)]">Find and Replace</span>
        <span className="search-replace-count text-xs text-[var(--nim-text-muted)] whitespace-nowrap px-2 flex items-center">
          {matches.length > 0 ? (
            <>
              {currentMatchIndex + 1} of {matches.length}
            </>
          ) : searchString ? (
            'No results'
          ) : null}
        </span>
        <button
          className="search-replace-close w-6 h-6 flex items-center justify-center bg-transparent border-none rounded cursor-pointer text-xl text-[var(--nim-text)] transition-colors hover:bg-[var(--nim-bg-hover)]"
          onClick={onClose}
          aria-label="Close search"
          title="Close (Esc)"
        >
          x
        </button>
      </div>

      <div className="search-replace-content p-4 flex flex-col gap-3">
        <div className="search-replace-row flex gap-2 items-center flex-nowrap">
          <div className="search-replace-input-group flex-[0_0_290px] min-w-0 relative">
            <input
              ref={searchInputRef}
              type="text"
              className="search-replace-input w-full py-2 px-3 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm outline-none transition-colors h-8 box-border focus:border-[var(--nim-border-focus)]"
              placeholder="Find..."
              value={searchString}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onBlur={() => setTimeout(() => setShowSearchHistory(false), 200)}
              aria-label="Search input"
              tabIndex={1}
            />
            {showSearchHistory && searchHistory.length > 0 && (
              <div className="search-history-dropdown absolute top-full left-0 right-0 mt-1 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded shadow-[0_4px_12px_rgba(0,0,0,0.15)] max-h-[200px] overflow-y-auto z-[501]">
                {searchHistory.map((item, index) => (
                  <div
                    key={index}
                    className={`history-item py-2 px-3 cursor-pointer text-sm text-[var(--nim-text)] transition-colors whitespace-nowrap overflow-hidden text-ellipsis hover:bg-[var(--nim-bg-hover)] ${
                      index === searchHistoryIndex ? 'bg-[var(--nim-bg-selected)]' : ''
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSearchChange(item);
                      setShowSearchHistory(false);
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="search-replace-options flex gap-1 shrink-0">
            <button
              className={`search-replace-option w-8 h-8 flex items-center justify-center border rounded cursor-pointer text-xs font-semibold transition-all shrink-0 ${
                caseInsensitive
                  ? 'bg-[var(--nim-bg)] border-[var(--nim-border)] text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'
                  : 'bg-[var(--nim-primary)] border-[var(--nim-primary)] text-white'
              }`}
              onClick={() => onCaseInsensitiveChange(!caseInsensitive)}
              title={caseInsensitive ? 'Case insensitive' : 'Case sensitive'}
              aria-label={caseInsensitive ? 'Case insensitive' : 'Case sensitive'}
              tabIndex={3}
            >
              Aa
            </button>
            <button
              className={`search-replace-option w-8 h-8 flex items-center justify-center border rounded cursor-pointer text-xs font-semibold transition-all shrink-0 ${
                useRegex
                  ? 'bg-[var(--nim-primary)] border-[var(--nim-primary)] text-white'
                  : 'bg-[var(--nim-bg)] border-[var(--nim-border)] text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'
              }`}
              onClick={() => onUseRegexChange(!useRegex)}
              title={useRegex ? 'Regular expression' : 'Plain text'}
              aria-label={useRegex ? 'Regular expression' : 'Plain text'}
              tabIndex={4}
            >
              .*
            </button>
          </div>

          <div className="search-replace-nav flex gap-1 shrink-0">
            <button
              className="search-replace-nav-button w-8 h-8 flex items-center justify-center bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded cursor-pointer text-[var(--nim-text)] text-base transition-all shrink-0 hover:bg-[var(--nim-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onPrevious}
              disabled={matches.length === 0}
              title="Previous match (Shift+Enter)"
              aria-label="Previous match"
            >
              <span className="up-arrow"></span>
            </button>
            <button
              className="search-replace-nav-button w-8 h-8 flex items-center justify-center bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded cursor-pointer text-[var(--nim-text)] text-base transition-all shrink-0 hover:bg-[var(--nim-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onNext}
              disabled={matches.length === 0}
              title="Next match (Enter)"
              aria-label="Next match"
            >
              <span className="down-arrow"></span>
            </button>
          </div>
        </div>

        <div className="search-replace-row flex gap-2 items-center flex-nowrap">
          <div className="search-replace-input-group flex-[0_0_290px] min-w-0 relative">
            <input
              ref={replaceInputRef}
              type="text"
              className="search-replace-input w-full py-2 px-3 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-sm outline-none transition-colors h-8 box-border focus:border-[var(--nim-border-focus)]"
              placeholder="Replace..."
              value={replaceString}
              onChange={(e) => onReplaceChange(e.target.value)}
              onKeyDown={handleReplaceKeyDown}
              onBlur={() => setTimeout(() => setShowReplaceHistory(false), 200)}
              aria-label="Replace input"
              tabIndex={2}
            />
            {showReplaceHistory && replaceHistory.length > 0 && (
              <div className="search-history-dropdown absolute top-full left-0 right-0 mt-1 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded shadow-[0_4px_12px_rgba(0,0,0,0.15)] max-h-[200px] overflow-y-auto z-[501]">
                {replaceHistory.map((item, index) => (
                  <div
                    key={index}
                    className={`history-item py-2 px-3 cursor-pointer text-sm text-[var(--nim-text)] transition-colors whitespace-nowrap overflow-hidden text-ellipsis hover:bg-[var(--nim-bg-hover)] ${
                      index === replaceHistoryIndex ? 'bg-[var(--nim-bg-selected)]' : ''
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onReplaceChange(item);
                      setShowReplaceHistory(false);
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="search-replace-actions flex gap-2 shrink-0">
            <button
              className="search-replace-button py-2.5 px-4 bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] border-none rounded text-sm cursor-pointer transition-colors whitespace-nowrap hover:bg-[var(--nim-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleReplace}
              disabled={matches.length === 0}
              title="Replace (Cmd/Ctrl+Enter)"
            >
              Replace
            </button>
            <button
              className="search-replace-button py-2.5 px-4 bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)] border-none rounded text-sm cursor-pointer transition-colors whitespace-nowrap hover:bg-[var(--nim-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleReplaceAll}
              disabled={matches.length === 0}
              title="Replace all (Cmd/Ctrl+Shift+Enter)"
            >
              Replace All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

SearchReplaceDialog.displayName = 'SearchReplaceDialog';
