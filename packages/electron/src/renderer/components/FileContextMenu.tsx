import React, { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { NewFileType, ExtensionFileType } from './NewFileMenu';
import {
  hasExternalEditorAtom,
  externalEditorNameAtom,
  openInExternalEditorAtom,
  revealInFinderAtom,
  copyFilePathAtom,
} from '../store/atoms/appSettings';

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
  onNewFile?: (folderPath: string, fileType: NewFileType) => void;
  onNewFolder?: (folderPath: string) => void;
  onViewHistory?: (filePath: string) => void;
  onViewWorkspaceHistory?: (folderPath: string) => void;
  selectedPaths?: Set<string>;
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
  onNewFile,
  onNewFolder,
  onViewHistory,
  onViewWorkspaceHistory,
  selectedPaths,
  extensionFileTypes = []
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(fileName);
  const inputRef = useRef<HTMLInputElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y });

  // File action atoms
  const hasExternalEditor = useAtomValue(hasExternalEditorAtom);
  const externalEditorName = useAtomValue(externalEditorNameAtom);
  const openInExternalEditor = useSetAtom(openInExternalEditorAtom);
  const revealInFinder = useSetAtom(revealInFinderAtom);
  const copyFilePath = useSetAtom(copyFilePathAtom);

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

  const handleOpenInExternalEditor = () => {
    openInExternalEditor(filePath);
    onClose();
  };

  const handleShowInFinder = () => {
    revealInFinder(filePath);
    onClose();
  };

  const handleCopyPath = () => {
    copyFilePath(filePath);
    onClose();
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
        className="file-context-menu file-context-menu-rename fixed p-2 min-w-[250px] rounded-md z-[10000] backdrop-blur-[10px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
        style={{
          left: adjustedPosition.x,
          top: adjustedPosition.y,
          background: 'var(--nim-bg)',
          border: '1px solid var(--nim-border)',
        }}
      >
        <div className="rename-input-container flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameSubmit}
            className="rename-input w-full px-2 py-1.5 rounded text-[13px] outline-none transition-colors"
            style={{
              background: 'var(--nim-bg-secondary)',
              border: '1px solid var(--nim-primary)',
              color: 'var(--nim-text)',
            }}
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
        className="file-context-menu fixed p-1 min-w-[200px] max-h-[calc(100vh-20px)] overflow-y-auto rounded-md z-[10000] text-[13px] backdrop-blur-[10px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
        style={{
          left: adjustedPosition.x,
          top: adjustedPosition.y,
          background: 'var(--nim-bg)',
          border: '1px solid var(--nim-border)',
        }}
      >
        <div
          className="file-context-menu-item file-context-menu-item-danger flex items-center gap-2.5 px-3 py-1.5 rounded cursor-pointer transition-colors text-[var(--nim-error)] hover:bg-[var(--nim-error-subtle)]"
          onClick={handleDelete}
        >
          <MaterialSymbol icon="delete" size={18} />
          <span>Delete {selectedPaths.size} Items</span>
        </div>
      </div>
    );
  }

  const menuItemClasses = "file-context-menu-item flex items-center gap-2.5 px-3 py-1.5 rounded cursor-pointer transition-colors text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]";
  const dangerItemClasses = "file-context-menu-item file-context-menu-item-danger flex items-center gap-2.5 px-3 py-1.5 rounded cursor-pointer transition-colors text-[var(--nim-error)] hover:bg-[var(--nim-error-subtle)]";
  const separatorClasses = "context-menu-separator h-px my-1 mx-2 bg-[var(--nim-border)]";

  return (
    <div
      ref={menuRef}
      className="file-context-menu fixed p-1 min-w-[200px] max-h-[calc(100vh-20px)] overflow-y-auto rounded-md z-[10000] text-[13px] backdrop-blur-[10px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
      data-testid="file-context-menu"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        background: 'var(--nim-bg)',
        border: '1px solid var(--nim-border)',
      }}
    >
      {fileType === 'directory' && (
        <>
          {onNewFile && (
            <>
              <div className={menuItemClasses} onClick={() => { onNewFile(filePath, 'markdown'); onClose(); }}>
                <MaterialSymbol icon="description" size={18} />
                <span>New Markdown File</span>
              </div>
              <div className={menuItemClasses} onClick={() => { onNewFile(filePath, 'mockup'); onClose(); }}>
                <MaterialSymbol icon="web" size={18} />
                <span>New Mockup</span>
              </div>
              {extensionFileTypes.map((extType) => (
                <div
                  key={extType.extension}
                  className={menuItemClasses}
                  onClick={() => { onNewFile(filePath, `ext:${extType.extension}`); onClose(); }}
                >
                  <MaterialSymbol icon={extType.icon} size={18} />
                  <span>New {extType.displayName}</span>
                </div>
              ))}
              <div className={menuItemClasses} onClick={() => { onNewFile(filePath, 'any'); onClose(); }}>
                <MaterialSymbol icon="note_add" size={18} />
                <span>New File...</span>
              </div>
            </>
          )}
          {onNewFolder && (
            <div className={menuItemClasses} onClick={() => { onNewFolder(filePath); onClose(); }}>
              <MaterialSymbol icon="create_new_folder" size={18} />
              <span>New Folder</span>
            </div>
          )}
          {(onNewFile || onNewFolder) && <div className={separatorClasses} />}
          {hasExternalEditor && (
            <div className={menuItemClasses} onClick={handleOpenInExternalEditor}>
              <MaterialSymbol icon="open_in_new" size={18} />
              <span>Open in {externalEditorName}</span>
            </div>
          )}
          {onViewWorkspaceHistory && (
            <div className={menuItemClasses} onClick={() => { onViewWorkspaceHistory(filePath); onClose(); }}>
              <MaterialSymbol icon="history" size={18} />
              <span>View Folder History...</span>
            </div>
          )}
        </>
      )}

      {fileType === 'file' && (
        <>
          <div className={menuItemClasses} onClick={handleOpenInDefaultApp}>
            <MaterialSymbol icon="launch" size={18} />
            <span>Open in Default App</span>
          </div>
          {hasExternalEditor && (
            <div className={menuItemClasses} onClick={handleOpenInExternalEditor}>
              <MaterialSymbol icon="open_in_new" size={18} />
              <span>Open in {externalEditorName}</span>
            </div>
          )}
          {onViewHistory && (
            <div className={menuItemClasses} onClick={() => { onViewHistory(filePath); onClose(); }}>
              <MaterialSymbol icon="history" size={18} />
              <span>View History...</span>
            </div>
          )}
        </>
      )}

      <div className={menuItemClasses} onClick={handleRenameClick}>
        <MaterialSymbol icon="edit" size={18} />
        <span>Rename</span>
      </div>

      <div className={separatorClasses} />

      <div className={menuItemClasses} onClick={handleShowInFinder}>
        <MaterialSymbol icon="folder_open" size={18} />
        <span>Show in Finder</span>
      </div>

      <div className={menuItemClasses} onClick={handleCopyPath}>
        <MaterialSymbol icon="content_copy" size={18} />
        <span>Copy Path</span>
      </div>

      <div className={separatorClasses} />

      <div
        className={dangerItemClasses}
        data-testid="context-menu-delete"
        onClick={handleDelete}
      >
        <MaterialSymbol icon="delete" size={18} />
        <span>Delete</span>
      </div>
    </div>
  );
}