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
  
  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  const searchHistory = useMemo(() => getHistory(SEARCH_HISTORY_KEY), [showSearchHistory]);
  const replaceHistory = useMemo(() => getHistory(REPLACE_HISTORY_KEY), [showReplaceHistory]);

  useEffect(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
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
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div 
      ref={dialogRef} 
      className={`search-replace-dialog ${isDragging ? 'is-dragging' : ''}`}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        cursor: isDragging ? 'grabbing' : 'auto'
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="search-replace-header" style={{ cursor: 'grab' }}>
        <span className="search-replace-title">Find and Replace</span>
        <button
          className="search-replace-close"
          onClick={onClose}
          aria-label="Close search"
          title="Close (Esc)"
        >
          ×
        </button>
      </div>

      <div className="search-replace-content">
        <div className="search-replace-row">
          <div className="search-replace-input-group">
            <input
              ref={searchInputRef}
              type="text"
              className="search-replace-input"
              placeholder="Find..."
              value={searchString}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onBlur={() => setTimeout(() => setShowSearchHistory(false), 200)}
              aria-label="Search input"
              tabIndex={1}
            />
            {showSearchHistory && searchHistory.length > 0 && (
              <div className="search-history-dropdown">
                {searchHistory.map((item, index) => (
                  <div
                    key={index}
                    className={`history-item ${index === searchHistoryIndex ? 'selected' : ''}`}
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

          <div className="search-replace-count">
            {matches.length > 0 ? (
              <>
                {currentMatchIndex + 1} of {matches.length}
              </>
            ) : searchString ? (
              'No results'
            ) : null}
          </div>

          <div className="search-replace-options">
            <button
              className={`search-replace-option ${caseInsensitive ? '' : 'active'}`}
              onClick={() => onCaseInsensitiveChange(!caseInsensitive)}
              title={caseInsensitive ? 'Case insensitive' : 'Case sensitive'}
              aria-label={caseInsensitive ? 'Case insensitive' : 'Case sensitive'}
              tabIndex={3}
            >
              Aa
            </button>
            <button
              className={`search-replace-option ${useRegex ? 'active' : ''}`}
              onClick={() => onUseRegexChange(!useRegex)}
              title={useRegex ? 'Regular expression' : 'Plain text'}
              aria-label={useRegex ? 'Regular expression' : 'Plain text'}
              tabIndex={4}
            >
              .*
            </button>
          </div>

          <div className="search-replace-nav">
            <button
              className="search-replace-nav-button"
              onClick={onPrevious}
              disabled={matches.length === 0}
              title="Previous match (Shift+Enter)"
              aria-label="Previous match"
            >
              ↑
            </button>
            <button
              className="search-replace-nav-button"
              onClick={onNext}
              disabled={matches.length === 0}
              title="Next match (Enter)"
              aria-label="Next match"
            >
              ↓
            </button>
          </div>
        </div>

        <div className="search-replace-row">
          <div className="search-replace-input-group">
            <input
              ref={replaceInputRef}
              type="text"
              className="search-replace-input search-replace-input-replace"
              placeholder="Replace..."
              value={replaceString}
              onChange={(e) => onReplaceChange(e.target.value)}
              onKeyDown={handleReplaceKeyDown}
              onBlur={() => setTimeout(() => setShowReplaceHistory(false), 200)}
              aria-label="Replace input"
              tabIndex={2}
            />
            {showReplaceHistory && replaceHistory.length > 0 && (
              <div className="search-history-dropdown">
                {replaceHistory.map((item, index) => (
                  <div
                    key={index}
                    className={`history-item ${index === replaceHistoryIndex ? 'selected' : ''}`}
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

          <div className="search-replace-actions">
            <button
              className="search-replace-button"
              onClick={handleReplace}
              disabled={matches.length === 0}
              title="Replace (Cmd/Ctrl+Enter)"
            >
              Replace
            </button>
            <button
              className="search-replace-button"
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
