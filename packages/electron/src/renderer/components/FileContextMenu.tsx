import React, { useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './FileContextMenu.css';

interface FileContextMenuProps {
  x: number;
  y: number;
  filePath: string;
  fileName: string;
  fileType: 'file' | 'directory';
  onClose: () => void;
  onRename: (filePath: string, newName: string) => void;
  onDelete: (filePath: string) => void;
  onOpenInNewWindow: (filePath: string) => void;
  onShowInFinder: (filePath: string) => void;
  onNewFile?: (folderPath: string) => void;
  onNewFolder?: (folderPath: string) => void;
  onViewHistory?: (filePath: string) => void;
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
  onOpenInNewWindow,
  onShowInFinder,
  onNewFile,
  onNewFolder,
  onViewHistory
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

      let newX = x;
      let newY = y;

      if (x + rect.width > viewportWidth) {
        newX = x - rect.width;
      }
      if (y + rect.height > viewportHeight) {
        newY = y - rect.height;
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

  const handleOpenInNewWindow = () => {
    onOpenInNewWindow(filePath);
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
    const confirmMessage = fileType === 'directory'
      ? `Are you sure you want to delete the folder "${fileName}" and all its contents?`
      : `Are you sure you want to delete "${fileName}"?`;

    if (window.confirm(confirmMessage)) {
      onDelete(filePath);
      onClose();
    }
  };

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

  return (
    <div
      ref={menuRef}
      className="file-context-menu"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {fileType === 'directory' && (
        <>
          {onNewFile && (
            <div className="context-menu-item" onClick={() => { onNewFile(filePath); onClose(); }}>
              <MaterialSymbol icon="edit_square" size={18} />
              <span>New File</span>
            </div>
          )}
          {onNewFolder && (
            <div className="context-menu-item" onClick={() => { onNewFolder(filePath); onClose(); }}>
              <MaterialSymbol icon="create_new_folder" size={18} />
              <span>New Folder</span>
            </div>
          )}
          {(onNewFile || onNewFolder) && <div className="context-menu-separator" />}
        </>
      )}
      
      {fileType === 'file' && (
        <>
          <div className="context-menu-item" onClick={handleOpenInNewWindow}>
            <MaterialSymbol icon="open_in_new" size={18} />
            <span>Open in New Window</span>
          </div>
          {onViewHistory && (
            <div className="context-menu-item" onClick={() => { onViewHistory(filePath); onClose(); }}>
              <MaterialSymbol icon="history" size={18} />
              <span>View History...</span>
            </div>
          )}
        </>
      )}

      <div className="context-menu-item" onClick={handleRenameClick}>
        <MaterialSymbol icon="edit" size={18} />
        <span>Rename</span>
      </div>
      
      <div className="context-menu-separator" />
      
      <div className="context-menu-item" onClick={handleShowInFinder}>
        <MaterialSymbol icon="folder_open" size={18} />
        <span>Show in Finder</span>
      </div>

      <div className="context-menu-item" onClick={handleCopyPath}>
        <MaterialSymbol icon="content_copy" size={18} />
        <span>Copy Path</span>
      </div>

      <div className="context-menu-separator" />

      <div className="context-menu-item context-menu-item-danger" onClick={handleDelete}>
        <MaterialSymbol icon="delete" size={18} />
        <span>Delete</span>
      </div>
    </div>
  );
}