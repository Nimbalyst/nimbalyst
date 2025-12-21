import React, { useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './FileContextMenu.css';
import type { NewFileType, ExtensionFileType } from './NewFileMenu';

interface FileContextMenuProps {
  x: number;
  y: number;
  filePath: string;
  fileName: string;
  fileType: 'file' | 'directory';
  onClose: () => void;
  onRename: (filePath: string, newName: string) => void;
  onDelete: (filePath: string) => void;
  onDeleteMultiple?: (filePaths: string[]) => void;
  onOpenInDefaultApp: (filePath: string) => void;
  onShowInFinder: (filePath: string) => void;
  onNewFile?: (folderPath: string, fileType: NewFileType) => void;
  onNewFolder?: (folderPath: string) => void;
  onViewHistory?: (filePath: string) => void;
  onViewWorkspaceHistory?: (folderPath: string) => void;
  selectedPaths?: Set<string>;
  /** Whether mockup files are enabled */
  mockupEnabled?: boolean;
  /** Extension-contributed file types */
  extensionFileTypes?: ExtensionFileType[];
}

export function FileContextMenu({
  x,
  y,
  filePath,
  fileName,
  fileType,
  onClose,
  onRename,
  onDelete,
  onDeleteMultiple,
  onOpenInDefaultApp,
  onShowInFinder,
  onNewFile,
  onNewFolder,
  onViewHistory,
  onViewWorkspaceHistory,
  selectedPaths,
  mockupEnabled = false,
  extensionFileTypes = []
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(fileName);
  const inputRef = useRef<HTMLInputElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        if (!isRenaming) {
          onClose();
        }
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isRenaming) {
          setIsRenaming(false);
          setNewName(fileName);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose, isRenaming, fileName]);

  // Adjust position after menu is mounted
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 10; // Minimum padding from viewport edges

      let newX = x;
      let newY = y;

      // Horizontal: prefer right of cursor, flip left if needed, clamp to viewport
      if (x + rect.width > viewportWidth - padding) {
        newX = x - rect.width;
      }
      if (newX < padding) {
        newX = padding;
      }

      // Vertical: prefer below cursor, but clamp to viewport (don't flip above)
      if (y + rect.height > viewportHeight - padding) {
        // Try to show as much as possible, but don't go above viewport top
        newY = Math.max(padding, viewportHeight - rect.height - padding);
      }
      if (newY < padding) {
        newY = padding;
      }

      if (newX !== x || newY !== y) {
        setAdjustedPosition({ x: newX, y: newY });
      }
    }
  }, [x, y]);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      // Select filename without extension for files
      if (fileType === 'file') {
        const lastDotIndex = fileName.lastIndexOf('.');
        if (lastDotIndex > 0) {
          inputRef.current.setSelectionRange(0, lastDotIndex);
        } else {
          inputRef.current.select();
        }
      } else {
        inputRef.current.select();
      }
    }
  }, [isRenaming]); // Only run when isRenaming changes, not when typing

  const handleRenameClick = () => {
    setIsRenaming(true);
  };

  const handleRenameSubmit = () => {
    if (newName && newName !== fileName) {
      onRename(filePath, newName);
    }
    setIsRenaming(false);
    onClose();
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    }
  };

  const handleOpenInDefaultApp = () => {
    onOpenInDefaultApp(filePath);
    onClose();
  };

  const handleShowInFinder = () => {
    onShowInFinder(filePath);
    onClose();
  };

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(filePath);
      onClose();
    } catch (error) {
      console.error('Failed to copy path to clipboard:', error);
    }
  };

  const handleDelete = () => {
    // Check if we have multiple items selected
    const hasMultipleSelected = selectedPaths && selectedPaths.size > 1;

    if (hasMultipleSelected && onDeleteMultiple) {
      const selectedArray = Array.from(selectedPaths);
      const confirmMessage = `Are you sure you want to delete ${selectedArray.length} items?`;

      if (window.confirm(confirmMessage)) {
        onDeleteMultiple(selectedArray);
        onClose();
      }
    } else {
      const confirmMessage = fileType === 'directory'
        ? `Are you sure you want to delete the folder "${fileName}" and all its contents?`
        : `Are you sure you want to delete "${fileName}"?`;

      if (window.confirm(confirmMessage)) {
        onDelete(filePath);
        onClose();
      }
    }
  };

  const hasMultipleSelected = selectedPaths && selectedPaths.size > 1;

  if (isRenaming) {
    return (
      <div
        ref={menuRef}
        className="file-context-menu file-context-menu-rename"
        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      >
        <div className="rename-input-container">
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameSubmit}
            className="rename-input"
          />
        </div>
      </div>
    );
  }

  // When multiple items are selected, show only batch-compatible options
  if (hasMultipleSelected) {
    return (
      <div
        ref={menuRef}
        className="file-context-menu"
        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      >
        <div className="file-context-menu-item file-context-menu-item-danger" onClick={handleDelete}>
          <MaterialSymbol icon="delete" size={18} />
          <span>Delete {selectedPaths.size} Items</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="file-context-menu"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {fileType === 'directory' && (
        <>
          {onNewFile && (
            <>
              <div className="file-context-menu-item" onClick={() => { onNewFile(filePath, 'markdown'); onClose(); }}>
                <MaterialSymbol icon="description" size={18} />
                <span>New Markdown File</span>
              </div>
              {mockupEnabled && (
                <div className="file-context-menu-item" onClick={() => { onNewFile(filePath, 'mockup'); onClose(); }}>
                  <MaterialSymbol icon="web" size={18} />
                  <span>New Mockup</span>
                </div>
              )}
              {extensionFileTypes.map((extType) => (
                <div
                  key={extType.extension}
                  className="file-context-menu-item"
                  onClick={() => { onNewFile(filePath, `ext:${extType.extension}`); onClose(); }}
                >
                  <MaterialSymbol icon={extType.icon} size={18} />
                  <span>New {extType.displayName}</span>
                </div>
              ))}
              <div className="file-context-menu-item" onClick={() => { onNewFile(filePath, 'any'); onClose(); }}>
                <MaterialSymbol icon="note_add" size={18} />
                <span>New File...</span>
              </div>
            </>
          )}
          {onNewFolder && (
            <div className="file-context-menu-item" onClick={() => { onNewFolder(filePath); onClose(); }}>
              <MaterialSymbol icon="create_new_folder" size={18} />
              <span>New Folder</span>
            </div>
          )}
          {(onNewFile || onNewFolder) && <div className="context-menu-separator" />}
          {onViewWorkspaceHistory && (
            <div className="file-context-menu-item" onClick={() => { onViewWorkspaceHistory(filePath); onClose(); }}>
              <MaterialSymbol icon="history" size={18} />
              <span>View Folder History...</span>
            </div>
          )}
        </>
      )}

      {fileType === 'file' && (
        <>
          <div className="file-context-menu-item" onClick={handleOpenInDefaultApp}>
            <MaterialSymbol icon="launch" size={18} />
            <span>Open in Default App</span>
          </div>
          {onViewHistory && (
            <div className="file-context-menu-item" onClick={() => { onViewHistory(filePath); onClose(); }}>
              <MaterialSymbol icon="history" size={18} />
              <span>View History...</span>
            </div>
          )}
        </>
      )}

      <div className="file-context-menu-item" onClick={handleRenameClick}>
        <MaterialSymbol icon="edit" size={18} />
        <span>Rename</span>
      </div>

      <div className="context-menu-separator" />

      <div className="file-context-menu-item" onClick={handleShowInFinder}>
        <MaterialSymbol icon="folder_open" size={18} />
        <span>Show in Finder</span>
      </div>

      <div className="file-context-menu-item" onClick={handleCopyPath}>
        <MaterialSymbol icon="content_copy" size={18} />
        <span>Copy Path</span>
      </div>

      <div className="context-menu-separator" />

      <div className="file-context-menu-item file-context-menu-item-danger" onClick={handleDelete}>
        <MaterialSymbol icon="delete" size={18} />
        <span>Delete</span>
      </div>
    </div>
  );
}