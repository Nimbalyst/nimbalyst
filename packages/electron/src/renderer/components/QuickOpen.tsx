import React, { useState, useEffect, useRef, useCallback } from 'react';
import './QuickOpen.css';

interface FileItem {
  path: string;
  name: string;
  lastOpened?: Date;
  isRecent?: boolean;
}

interface QuickOpenProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
  recentFiles: string[];
  onFileSelect: (filePath: string) => void;
}

export const QuickOpen: React.FC<QuickOpenProps> = ({
  isOpen,
  onClose,
  projectPath,
  recentFiles,
  onFileSelect,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();

  // Convert recent files to FileItems
  const recentFileItems: FileItem[] = recentFiles.map(path => ({
    path,
    name: path.split('/').pop() || path,
    isRecent: true,
  }));

  // Combined list of files to display
  const displayFiles = searchQuery ? searchResults : recentFileItems;

  // Search for files in the project
  const searchFiles = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    console.log('Searching for files with query:', query, 'in project:', projectPath);
    setIsSearching(true);
    try {
      // Use electron API to search files (check both window.electronAPI and window.electron)
      const api = (window as any).electronAPI || (window as any).electron;
      if (!api) {
        console.error('Electron API not available at all');
        setSearchResults([]);
        return;
      }
      
      if (!api.searchProjectFiles) {
        console.error('searchProjectFiles method not available on API');
        setSearchResults([]);
        return;
      }
      
      const results = await api.searchProjectFiles(projectPath, query);
      console.log('Search results:', results);
      setSearchResults(results.map((path: string) => ({
        path,
        name: path.split('/').pop() || path,
        isRecent: recentFiles.includes(path),
      })));
    } catch (error) {
      console.error('Error searching files:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [projectPath, recentFiles]);

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
            placeholder="Search files by name..."
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
            <ul className="quick-open-list">
              {displayFiles.map((file, index) => (
                <li
                  key={file.path}
                  className={`quick-open-item ${
                    index === selectedIndex ? 'selected' : ''
                  }`}
                  onClick={() => handleFileSelect(file.path)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="quick-open-item-name">
                    {file.name}
                    {file.isRecent && !searchQuery && (
                      <span className="quick-open-badge">Recent</span>
                    )}
                  </div>
                  <div className="quick-open-item-path">
                    {file.path.replace(projectPath, '').replace(/^\//, '')}
                  </div>
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