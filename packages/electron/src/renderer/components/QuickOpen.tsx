import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import { getFileName, getRelativeDir } from '../utils/pathUtils';
import './QuickOpen.css';

interface FileItem {
  path: string;
  name: string;
  lastOpened?: Date;
  isRecent?: boolean;
  matches?: Array<{
    line: number;
    text: string;
    start: number;
    end: number;
  }>;
  isFileNameMatch?: boolean;
  isContentMatch?: boolean;
}

// QuickOpen works in all modes (Editor, Agent, Files)
interface QuickOpenProps {
  isOpen: boolean;
  onClose: () => void;
  workspacePath: string;
  currentFilePath?: string | null;
  onFileSelect: (filePath: string) => void;
}

export const QuickOpen: React.FC<QuickOpenProps> = ({
  isOpen,
  onClose,
  workspacePath,
  currentFilePath,
  onFileSelect,
}) => {
  const posthog = usePostHog();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isContentSearch, setIsContentSearch] = useState(false);
  const [contentSearchTriggered, setContentSearchTriggered] = useState(false);
  const [mouseHasMoved, setMouseHasMoved] = useState(false);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const resultsListRef = useRef<HTMLUListElement>(null);

  // Convert recent files to FileItems (excluding current file)
  const recentFileItems: FileItem[] = recentFiles
    .filter(path => path !== currentFilePath)
    .map(path => ({
      path,
      name: getFileName(path),
      isRecent: true,
    }));

  // Combined list of files to display
  const displayFiles = searchQuery ? searchResults : recentFileItems;

  // Search for files in the workspace (name search only)
  const searchFiles = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsContentSearch(false);
      return;
    }

    setIsSearching(true);

    try {
      // Use electron API to search files (check both window.electronAPI and window.electron)
      const api = (window as any).electronAPI || (window as any).electron;
      if (!api) {
        console.error('Electron API not available');
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      if (!workspacePath) {
        console.error('No workspace path available');
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      // Get file name matches
      if (!api.searchWorkspaceFileNames) {
        console.error('searchWorkspaceFileNames method not available');
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      const fileNameResults = await api.searchWorkspaceFileNames(workspacePath, query);

      // Process and display file name results
      if (Array.isArray(fileNameResults)) {
        const processedFileNames = fileNameResults
          .map((result: any) => ({
            path: result.path,
            name: getFileName(result.path),
            isRecent: recentFiles.includes(result.path),
            matches: result.matches || [],
            isFileNameMatch: result.isFileNameMatch || false,
            isContentMatch: false,
          }));

        setSearchResults(processedFileNames);
        setIsSearching(false);

        // Track workspace search analytics (file name search)
        try {
          const resultCount = processedFileNames.length;
          const queryLength = query.length;
          let queryLengthCategory = 'short';
          if (queryLength > 20) queryLengthCategory = 'long';
          else if (queryLength > 10) queryLengthCategory = 'medium';

          let resultCountBucket = '0';
          if (resultCount > 0) {
            if (resultCount <= 10) resultCountBucket = '1-10';
            else if (resultCount <= 50) resultCountBucket = '11-50';
            else if (resultCount <= 100) resultCountBucket = '51-100';
            else resultCountBucket = '100+';
          }

          posthog?.capture('workspace_search_used', {
            resultCount: resultCountBucket,
            queryLength: queryLengthCategory,
            searchType: 'file_name',
          });
        } catch (error) {
          console.error('Error tracking workspace_search_used event:', error);
        }
      } else {
        console.warn('Results is not an array:', fileNameResults);
        setSearchResults([]);
        setIsSearching(false);
      }
    } catch (error) {
      console.error('Error searching files:', error);
      setSearchResults([]);
      setIsSearching(false);
    }
  }, [workspacePath, recentFiles]);

  // Search file contents (triggered manually)
  const searchFileContents = useCallback(async () => {
    if (!searchQuery.trim() || contentSearchTriggered) {
      return; // Don't search if already triggered or no query
    }

    setContentSearchTriggered(true);
    setIsSearching(true);

    try {
      const api = (window as any).electronAPI || (window as any).electron;
      if (!api || !api.searchWorkspaceFileContent) {
        setIsSearching(false);
        return;
      }

      const contentResults = await api.searchWorkspaceFileContent(workspacePath, searchQuery);

      // Merge content results with existing file name results
      if (Array.isArray(contentResults)) {
        setSearchResults(prevResults => {
          const mergedResults = [...prevResults];

          // Process content results
          for (const contentResult of contentResults) {
            const existingIndex = mergedResults.findIndex(r => r.path === contentResult.path);

            if (existingIndex >= 0) {
              // File already in results from name match, add content matches
              mergedResults[existingIndex].matches = contentResult.matches || [];
              mergedResults[existingIndex].isContentMatch = true;
            } else {
              // New file found only by content
              mergedResults.push({
                path: contentResult.path,
                name: getFileName(contentResult.path),
                isRecent: recentFiles.includes(contentResult.path),
                matches: contentResult.matches || [],
                isFileNameMatch: false,
                isContentMatch: true,
              });
            }
          }

          // Sort merged results: prioritize file name matches over content matches
          mergedResults.sort((a, b) => {
            // File name matches come first
            if (a.isFileNameMatch && !b.isFileNameMatch) return -1;
            if (!a.isFileNameMatch && b.isFileNameMatch) return 1;

            // Then sort by number of matches (more matches = higher priority)
            const aMatchCount = a.matches?.length || 0;
            const bMatchCount = b.matches?.length || 0;
            if (aMatchCount !== bMatchCount) {
              return bMatchCount - aMatchCount;
            }

            // Finally, sort alphabetically by file name
            return a.name.localeCompare(b.name);
          });

          return mergedResults;
        });

        // Track workspace search analytics (content search)
        try {
          const queryLength = searchQuery.length;
          let queryLengthCategory = 'short';
          if (queryLength > 20) queryLengthCategory = 'long';
          else if (queryLength > 10) queryLengthCategory = 'medium';

          const resultCount = contentResults.length;
          let resultCountBucket = '0';
          if (resultCount > 0) {
            if (resultCount <= 10) resultCountBucket = '1-10';
            else if (resultCount <= 50) resultCountBucket = '11-50';
            else if (resultCount <= 100) resultCountBucket = '51-100';
            else resultCountBucket = '100+';
          }

          posthog?.capture('workspace_search_used', {
            resultCount: resultCountBucket,
            queryLength: queryLengthCategory,
            searchType: 'content',
          });
        } catch (error) {
          console.error('Error tracking workspace_search_used event:', error);
        }
      }
      setIsSearching(false);
    } catch (error) {
      console.error('Error in content search:', error);
      setIsSearching(false);
    }
  }, [workspacePath, searchQuery, contentSearchTriggered, recentFiles, posthog]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Reset content search trigger when query changes
    setContentSearchTriggered(false);

    if (searchQuery) {
      searchTimeoutRef.current = setTimeout(() => {
        searchFiles(searchQuery);
      }, 150);
    } else {
      setSearchResults([]);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, searchFiles]);

  // Load recent files when modal opens
  useEffect(() => {
    if (isOpen && window.electronAPI?.getRecentWorkspaceFiles) {
      window.electronAPI.getRecentWorkspaceFiles()
        .then(files => {
          setRecentFiles(files || []);
        })
        .catch(error => {
          console.error('[QuickOpen] Failed to load recent files:', error);
          setRecentFiles([]);
        });
    }
  }, [isOpen]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setSearchResults([]);
      setContentSearchTriggered(false);
      setMouseHasMoved(false);
      setTimeout(() => searchInputRef.current?.focus(), 100);

      // Build file name cache in background
      const api = (window as any).electronAPI || (window as any).electron;
      if (api?.buildQuickOpenCache && workspacePath) {
        api.buildQuickOpenCache(workspacePath).catch((error: any) => {
          console.error('Failed to build quick open cache:', error);
        });
      }
    }
  }, [isOpen, workspacePath]);

  // Track mouse movement to distinguish between mouse hover and mouse at rest
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseMove = () => {
      setMouseHasMoved(true);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsListRef.current) return;

    const items = resultsListRef.current.querySelectorAll('.quick-open-item');
    const selectedItem = items[selectedIndex] as HTMLElement;

    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev =>
            prev < displayFiles.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
          break;
        case 'Enter':
          e.preventDefault();
          if (displayFiles[selectedIndex]) {
            handleFileSelect(displayFiles[selectedIndex].path);
          }
          break;
        case 'Tab':
          e.preventDefault();
          if (searchQuery && !contentSearchTriggered) {
            searchFileContents();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, displayFiles, searchQuery, contentSearchTriggered, onClose, searchFileContents]);

  const handleFileSelect = (filePath: string) => {
    onFileSelect(filePath);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="quick-open-backdrop" onClick={onClose} />
      <div className="quick-open-modal">
        <div className="quick-open-header">
          <input
            ref={searchInputRef}
            type="text"
            className="quick-open-search"
            placeholder="Search files by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {isSearching && (
            <div className="quick-open-searching">
              {contentSearchTriggered ? 'Searching file contents...' : 'Searching...'}
            </div>
          )}
          {!isSearching && searchQuery && !contentSearchTriggered && (
            <button
              className="quick-open-content-search-hint"
              onClick={() => searchFileContents()}
              title="Search in file contents"
            >
              <kbd>Tab</kbd> Search in file contents
            </button>
          )}
        </div>

        <div className="quick-open-results">
          {displayFiles.length === 0 ? (
            <div className="quick-open-empty">
              {searchQuery ? 'No files found' : 'No recent files'}
            </div>
          ) : (
            <ul className="quick-open-list" ref={resultsListRef}>
              {displayFiles.map((file, index) => (
                <li
                  key={`${file.path}-${index}`}
                  className={`quick-open-item ${
                    index === selectedIndex ? 'selected' : ''
                  } ${file.isContentMatch ? 'content-match' : ''} ${file.isFileNameMatch ? 'name-match' : ''}`}
                  onClick={() => handleFileSelect(file.path)}
                  onMouseEnter={() => {
                    if (mouseHasMoved) {
                      setSelectedIndex(index);
                    }
                  }}
                >
                  <div className="quick-open-item-name">
                    {file.name}
                    {file.isRecent && !searchQuery && (
                      <span className="quick-open-badge">Recent</span>
                    )}
                    {/*{file.isFileNameMatch && (*/}
                    {/*  <span className="quick-open-badge name-badge">Name</span>*/}
                    {/*)}*/}
                    {file.matches && file.matches.length > 0 && (
                      <span className="quick-open-badge content-badge">{file.matches.length} match{file.matches.length > 1 ? 'es' : ''}</span>
                    )}
                  </div>
                  <div className="quick-open-item-path">
                    {getRelativeDir(file.path, workspacePath)}
                  </div>
                  {file.matches && file.matches.length > 0 && (
                    <div className="quick-open-item-matches">
                      {file.matches.slice(0, 2).map((match, i) => (
                        <div key={i} className="quick-open-match">
                          <span className="quick-open-line-number">Line {match.line}:</span>
                          <span className="quick-open-match-text">
                            {match.text.substring(0, match.start)}
                            <mark>{match.text.substring(match.start, match.end)}</mark>
                            {match.text.substring(match.end)}
                          </span>
                        </div>
                      ))}
                      {file.matches.length > 2 && (
                        <div className="quick-open-more-matches">
                          ...and {file.matches.length - 2} more match{file.matches.length - 2 > 1 ? 'es' : ''}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="quick-open-footer">
          <span className="quick-open-hint">
            <kbd>↑↓</kbd> Navigate
          </span>
          <span className="quick-open-hint">
            <kbd>Enter</kbd> Open
          </span>
          {searchQuery && !contentSearchTriggered && (
            <span className="quick-open-hint">
              <kbd>Tab</kbd> Search in file contents
            </span>
          )}
          <span className="quick-open-hint">
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </>
  );
};
