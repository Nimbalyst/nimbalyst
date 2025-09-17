import React, { useState, useEffect, useRef, useCallback } from 'react';
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

interface QuickOpenProps {
  isOpen: boolean;
  onClose: () => void;
  workspacePath: string;
  currentFilePath?: string | null;
  recentFiles: string[];
  onFileSelect: (filePath: string) => void;
}

export const QuickOpen: React.FC<QuickOpenProps> = ({
  isOpen,
  onClose,
  workspacePath,
  currentFilePath,
  recentFiles,
  onFileSelect,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isContentSearch, setIsContentSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const resultsListRef = useRef<HTMLUListElement>(null);

  // Convert recent files to FileItems (excluding current file)
  const recentFileItems: FileItem[] = recentFiles
    .filter(path => path !== currentFilePath)
    .map(path => ({
      path,
      name: path.split('/').pop() || path,
      isRecent: true,
    }));

  // Combined list of files to display
  const displayFiles = searchQuery ? searchResults : recentFileItems;

  // Search for files in the workspace
  const searchFiles = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsContentSearch(false);
      return;
    }

    // Check if it's a content search (starts with >)
    const isContent = query.startsWith('>');
    setIsContentSearch(isContent);

    console.log('Searching for files with query:', query, 'in workspace:', workspacePath, 'content search:', isContent);
    setIsSearching(true);

    try {
      // Use electron API to search files (check both window.electronAPI and window.electron)
      const api = (window as any).electronAPI || (window as any).electron;
      if (!api) {
        console.error('Electron API not available at all');
        setSearchResults([]);
        return;
      }

      // First, get file name matches immediately
      if (api.searchWorkspaceFileNames) {
        const fileNameResults = await api.searchWorkspaceFileNames(workspacePath, query);
        // console.log('File name results:', fileNameResults);

        // Process and display file name results immediately
        if (Array.isArray(fileNameResults)) {
          const processedFileNames = fileNameResults
            .map((result: any) => ({
              path: result.path,
              name: result.path.split('/').pop() || result.path,
              isRecent: recentFiles.includes(result.path),
              matches: result.matches || [],
              isFileNameMatch: result.isFileNameMatch || false,
              isContentMatch: false,
            }));

          // Set file name results immediately
          setSearchResults(processedFileNames);
          setIsSearching(false); // Stop showing "Searching..." for file names
        }
      }

      // Then search content in the background (don't await!)
      if (api.searchWorkspaceFileContent) {
        // Run content search asynchronously without blocking
        api.searchWorkspaceFileContent(workspacePath, query).then((contentResults: any) => {
          // console.log('Content search results:', contentResults);

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
                    name: contentResult.path.split('/').pop() || contentResult.path,
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
          }
        }).catch((error: any) => {
          console.error('Error in content search:', error);
          // Don't clear results on content search error, keep file name results
        });
      }
    } catch (error) {
      console.error('Error searching files:', error);
      setSearchResults([]);
      setIsSearching(false);
    }
  }, [workspacePath, recentFiles, currentFilePath]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

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

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setSearchResults([]);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
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
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, displayFiles, onClose]);

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
            placeholder={isContentSearch ? "Searching content..." : "Search files by name and content..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {isSearching && (
            <div className="quick-open-searching">Searching...</div>
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
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="quick-open-item-name">
                    {file.name}
                    {file.isRecent && !searchQuery && (
                      <span className="quick-open-badge">Recent</span>
                    )}
                    {file.isFileNameMatch && (
                      <span className="quick-open-badge name-badge">Name</span>
                    )}
                    {file.matches && file.matches.length > 0 && (
                      <span className="quick-open-badge content-badge">{file.matches.length} match{file.matches.length > 1 ? 'es' : ''}</span>
                    )}
                  </div>
                  <div className="quick-open-item-path">
                    {file.path.replace(workspacePath, '').replace(/^\//, '')}
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
          <span className="quick-open-hint">
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </>
  );
};
