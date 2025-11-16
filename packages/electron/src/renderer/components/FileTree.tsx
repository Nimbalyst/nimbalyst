import React, { useState, useCallback, useRef, useEffect } from 'react';
import { MaterialSymbol } from './MaterialSymbol';
import { FileContextMenu } from './FileContextMenu';

interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

interface FileTreeProps {
  items: FileTreeItem[];
  currentFilePath: string | null;
  onFileSelect: (filePath: string) => void;
  level: number;
  showIcons?: boolean;
  onNewFile?: (folderPath: string) => void;
  onNewFolder?: (folderPath: string) => void;
  onRefreshFileTree?: () => void;
  onViewHistory?: (filePath: string) => void;
  selectedFolder?: string | null;
  onFolderSelect?: (folderPath: string) => void;
  sharedDragState?: {
    draggedItem: FileTreeItem | null;
    setDraggedItem: (item: FileTreeItem | null) => void;
    dragOverItem: string | null;
    setDragOverItem: (path: string | null) => void;
    isDragCopy: boolean;
    setIsDragCopy: (copy: boolean) => void;
  };
  sharedExpandedDirs?: {
    expandedDirs: Set<string>;
    setExpandedDirs: React.Dispatch<React.SetStateAction<Set<string>>>;
  };
}

function getFileIcon(fileName: string) {
  const lowerName = fileName.toLowerCase();

  // Special files
  if (lowerName === 'readme.md' || lowerName === 'readme.markdown') {
    return <MaterialSymbol icon="info" size={18} />;
  }
  if (lowerName === 'package.json') {
    return <MaterialSymbol icon="inventory_2" size={18} />;
  }
  if (lowerName === '.gitignore' || lowerName === '.gitattributes') {
    return <MaterialSymbol icon="folder_managed" size={18} />;
  }
  if (lowerName === 'license' || lowerName === 'license.md' || lowerName === 'license.txt') {
    return <MaterialSymbol icon="gavel" size={18} />;
  }

  // Programming languages
  if (lowerName.endsWith('.ts') || lowerName.endsWith('.tsx')) {
    return <MaterialSymbol icon="code" size={18} />;
  }
  if (lowerName.endsWith('.js') || lowerName.endsWith('.jsx') || lowerName.endsWith('.mjs') || lowerName.endsWith('.cjs')) {
    return <MaterialSymbol icon="javascript" size={18} />;
  }
  if (lowerName.endsWith('.json')) {
    return <MaterialSymbol icon="data_object" size={18} />;
  }
  if (lowerName.endsWith('.py')) {
    return <MaterialSymbol icon="code" size={18} />;
  }
  if (lowerName.endsWith('.java')) {
    return <MaterialSymbol icon="code" size={18} />;
  }
  if (lowerName.endsWith('.go')) {
    return <MaterialSymbol icon="code" size={18} />;
  }
  if (lowerName.endsWith('.rs')) {
    return <MaterialSymbol icon="code" size={18} />;
  }
  if (lowerName.endsWith('.cpp') || lowerName.endsWith('.c') || lowerName.endsWith('.h') || lowerName.endsWith('.hpp')) {
    return <MaterialSymbol icon="code" size={18} />;
  }

  // Markup and styling
  if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
    return <MaterialSymbol icon="html" size={18} />;
  }
  if (lowerName.endsWith('.css') || lowerName.endsWith('.scss') || lowerName.endsWith('.sass') || lowerName.endsWith('.less')) {
    return <MaterialSymbol icon="css" size={18} />;
  }
  if (lowerName.endsWith('.xml')) {
    return <MaterialSymbol icon="code" size={18} />;
  }
  if (lowerName.endsWith('.svg')) {
    return <MaterialSymbol icon="image" size={18} />;
  }

  // Data formats
  if (lowerName.endsWith('.yaml') || lowerName.endsWith('.yml')) {
    return <MaterialSymbol icon="settings" size={18} />;
  }
  if (lowerName.endsWith('.toml')) {
    return <MaterialSymbol icon="settings" size={18} />;
  }
  if (lowerName.endsWith('.csv')) {
    return <MaterialSymbol icon="table_chart" size={18} />;
  }

  // Images
  if (lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') ||
      lowerName.endsWith('.gif') || lowerName.endsWith('.webp') || lowerName.endsWith('.bmp') ||
      lowerName.endsWith('.ico') || lowerName.endsWith('.tiff')) {
    return <MaterialSymbol icon="image" size={18} />;
  }

  // Documents
  if (lowerName.endsWith('.pdf')) {
    return <MaterialSymbol icon="picture_as_pdf" size={18} />;
  }
  if (lowerName.endsWith('.doc') || lowerName.endsWith('.docx')) {
    return <MaterialSymbol icon="article" size={18} />;
  }
  if (lowerName.endsWith('.xls') || lowerName.endsWith('.xlsx')) {
    return <MaterialSymbol icon="table_chart" size={18} />;
  }
  if (lowerName.endsWith('.ppt') || lowerName.endsWith('.pptx')) {
    return <MaterialSymbol icon="slideshow" size={18} />;
  }

  // Text files
  if (lowerName.endsWith('.txt') || lowerName.endsWith('.log')) {
    return <MaterialSymbol icon="notes" size={18} />;
  }

  // Markdown (default for .md and .markdown)
  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
    return <MaterialSymbol icon="description" size={18} />;
  }

  // Archives
  if (lowerName.endsWith('.zip') || lowerName.endsWith('.tar') || lowerName.endsWith('.gz') ||
      lowerName.endsWith('.7z') || lowerName.endsWith('.rar')) {
    return <MaterialSymbol icon="folder_zip" size={18} />;
  }

  // Shell scripts
  if (lowerName.endsWith('.sh') || lowerName.endsWith('.bash') || lowerName.endsWith('.zsh')) {
    return <MaterialSymbol icon="terminal" size={18} />;
  }

  // Video/Audio
  if (lowerName.endsWith('.mp4') || lowerName.endsWith('.avi') || lowerName.endsWith('.mov') ||
      lowerName.endsWith('.mkv') || lowerName.endsWith('.webm')) {
    return <MaterialSymbol icon="videocam" size={18} />;
  }
  if (lowerName.endsWith('.mp3') || lowerName.endsWith('.wav') || lowerName.endsWith('.ogg') ||
      lowerName.endsWith('.flac') || lowerName.endsWith('.m4a')) {
    return <MaterialSymbol icon="audio_file" size={18} />;
  }

  // Fonts
  if (lowerName.endsWith('.ttf') || lowerName.endsWith('.otf') || lowerName.endsWith('.woff') ||
      lowerName.endsWith('.woff2') || lowerName.endsWith('.eot')) {
    return <MaterialSymbol icon="font_download" size={18} />;
  }

  // Lock files
  if (lowerName.endsWith('.lock') || lowerName === 'package-lock.json' || lowerName === 'yarn.lock' || lowerName === 'pnpm-lock.yaml') {
    return <MaterialSymbol icon="lock" size={18} />;
  }

  // Default file icon
  return <MaterialSymbol icon="insert_drive_file" size={18} />;
}

export function FileTree({ items, currentFilePath, onFileSelect, level, showIcons = true, onNewFile, onNewFolder, onRefreshFileTree, onViewHistory, selectedFolder, onFolderSelect, sharedDragState, sharedExpandedDirs }: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    filePath: string;
    fileName: string;
    fileType: 'file' | 'directory';
  } | null>(null);

  // Create local drag state for root level, or use shared state for nested levels
  const [localDraggedItem, setLocalDraggedItem] = useState<FileTreeItem | null>(null);
  const [localDragOverItem, setLocalDragOverItem] = useState<string | null>(null);
  const [localIsDragCopy, setLocalIsDragCopy] = useState(false);

  // Use shared state if provided (nested), otherwise use local state (root)
  const draggedItem = sharedDragState?.draggedItem ?? localDraggedItem;
  const setDraggedItem = sharedDragState?.setDraggedItem ?? setLocalDraggedItem;
  const dragOverItem = sharedDragState?.dragOverItem ?? localDragOverItem;
  const setDragOverItem = sharedDragState?.setDragOverItem ?? setLocalDragOverItem;
  const isDragCopy = sharedDragState?.isDragCopy ?? localIsDragCopy;
  const setIsDragCopy = sharedDragState?.setIsDragCopy ?? setLocalIsDragCopy;

  // Helper function to find parent directories of a file
  const findParentDirs = useCallback((items: FileTreeItem[], targetPath: string, parents: string[] = []): string[] | null => {
    for (const item of items) {
      if (item.type === 'file' && item.path === targetPath) {
        return parents;
      } else if (item.type === 'directory' && item.children) {
        const result = findParentDirs(item.children, targetPath, [...parents, item.path]);
        if (result) return result;
      }
    }
    return null;
  }, []);

  // Create local expanded state for root level, or use shared state for nested levels
  const [localExpandedDirs, setLocalExpandedDirs] = useState<Set<string>>(() => {
    const initialExpanded = new Set<string>();

    if (currentFilePath && level === 0) {
      const parentDirs = findParentDirs(items, currentFilePath);
      if (parentDirs) {
        parentDirs.forEach(dir => initialExpanded.add(dir));
      }
    }

    return initialExpanded;
  });

  // Use shared state if provided (nested), otherwise use local state (root)
  const expandedDirs = sharedExpandedDirs?.expandedDirs ?? localExpandedDirs;
  const setExpandedDirs = sharedExpandedDirs?.setExpandedDirs ?? setLocalExpandedDirs;

  // Update expanded directories when current file changes
  useEffect(() => {
    if (currentFilePath && level === 0) {
      const parentDirs = findParentDirs(items, currentFilePath);
      if (parentDirs && parentDirs.length > 0) {
        setExpandedDirs(prev => {
          const newSet = new Set(prev);
          let hasChanges = false;
          parentDirs.forEach(dir => {
            if (!newSet.has(dir)) {
              newSet.add(dir);
              hasChanges = true;
            }
          });
          // Only update state if we actually added new directories
          return hasChanges ? newSet : prev;
        });
      }

      // Scroll the active file into view after a brief delay to allow for expansion
      setTimeout(() => {
        const activeFileElement = document.querySelector('.file-tree-file.active');
        if (activeFileElement) {
          activeFileElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
    }
  }, [currentFilePath, items, level, findParentDirs, setExpandedDirs]);

  const toggleDirectory = useCallback(async (path: string) => {
    setExpandedDirs(prev => {
      const newSet = new Set(prev);
      const wasExpanded = newSet.has(path);

      if (wasExpanded) {
        newSet.delete(path);
        // Notify main process that folder was collapsed
        if (window.electronAPI) {
          window.electronAPI.invoke('workspace-folder-collapsed', path);
        }
      } else {
        newSet.add(path);
        // Notify main process that folder was expanded
        if (window.electronAPI) {
          window.electronAPI.invoke('workspace-folder-expanded', path);
        }

        // Refresh folder contents when opening (in case file watcher missed changes)
        if (window.electronAPI?.refreshFolderContents) {
          window.electronAPI.refreshFolderContents(path).then((refreshedContents) => {
            if (refreshedContents && onRefreshFileTree) {
              // Trigger a full tree refresh to incorporate the new data
              // This ensures the file watcher and UI are in sync
              onRefreshFileTree();
            }
          }).catch((error) => {
            console.error('Error refreshing folder contents:', error);
          });
        }
      }
      return newSet;
    });
  }, [onRefreshFileTree]);

  const handleFolderClick = useCallback((e: React.MouseEvent, path: string) => {
    // Toggle the folder when clicking anywhere on the row
    toggleDirectory(path);

    // Also select the folder
    if (onFolderSelect) {
      onFolderSelect(path);
    }
  }, [onFolderSelect, toggleDirectory]);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: FileTreeItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      filePath: item.path,
      fileName: item.name,
      fileType: item.type
    });
  }, []);

  const handleRename = useCallback(async (filePath: string, newName: string) => {
    const result = await window.electronAPI.renameFile(filePath, newName);
    if (!result.success) {
      console.error('Failed to rename file:', result.error);
    }
  }, []);

  const handleDelete = useCallback(async (filePath: string) => {
    const result = await window.electronAPI.deleteFile(filePath);
    if (!result.success) {
      console.error('Failed to delete file:', result.error);
    }
  }, []);

  const handleOpenInNewWindow = useCallback(async (filePath: string) => {
    const result = await window.electronAPI.openFileInNewWindow(filePath);
    if (!result.success) {
      console.error('Failed to open in new window:', result.error);
    }
  }, []);

  const handleShowInFinder = useCallback(async (filePath: string) => {
    const result = await window.electronAPI.showInFinder(filePath);
    if (!result.success) {
      console.error('Failed to show in finder:', result.error);
    }
  }, []);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, item: FileTreeItem) => {
    // Prevent dragging by the icon
    const target = e.target as HTMLElement;
    if (target.closest('.file-tree-icon') || target.closest('.file-tree-chevron')) {
      e.preventDefault();
      return;
    }

    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', item.path);
    setDraggedItem(item);

    // Add a custom drag image with just the text
    const dragImage = document.createElement('div');
    dragImage.textContent = item.name;
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    dragImage.style.left = '-1000px';
    dragImage.style.padding = '4px 8px';
    dragImage.style.backgroundColor = '#ffffff';
    dragImage.style.border = '1px solid #e5e7eb';
    dragImage.style.borderRadius = '4px';
    dragImage.style.fontSize = '13px';
    dragImage.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    dragImage.style.color = '#1f2937';
    dragImage.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    dragImage.style.zIndex = '10000';
    dragImage.style.pointerEvents = 'none';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 10, 10);

    // Clean up the drag image after a brief delay
    setTimeout(() => {
      if (document.body.contains(dragImage)) {
        document.body.removeChild(dragImage);
      }
    }, 0);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDragOverItem(null);
    setIsDragCopy(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, item: FileTreeItem) => {
    e.preventDefault();
    e.stopPropagation(); // Stop event from bubbling to parent folders

      // console.log("Drag over:", draggedItem?.path, item.path);

    // Only allow dropping on directories
    if (draggedItem && item.type === 'directory' && item.path !== draggedItem.path) {
      // Don't allow dropping a folder into its own descendants
      if (draggedItem.type === 'directory' && item.path.startsWith(draggedItem.path + '/')) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }

      // Check if Option/Alt key is held for copy
      const isCopy = e.altKey || e.metaKey;
      setIsDragCopy(isCopy);
      e.dataTransfer.dropEffect = isCopy ? 'copy' : 'move';
      setDragOverItem(item.path);
    } else {
      e.dataTransfer.dropEffect = 'none';
    }
  }, [draggedItem]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if we're leaving the element entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setDragOverItem(null);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetItem: FileTreeItem) => {
    e.preventDefault();
    e.stopPropagation();

    // Only allow dropping on directories
    if (!draggedItem || targetItem.type !== 'directory' || draggedItem.path === targetItem.path) {
      setDragOverItem(null);
      return;
    }

    const isCopy = e.altKey || e.metaKey;

    try {
      const targetPath = targetItem.path;

      if (isCopy) {
        const result = await window.electronAPI.copyFile(draggedItem.path, targetPath);
        if (!result.success) {
          console.error('Failed to copy file:', result.error);
        } else {
          // Refresh the file tree if callback is provided
          if (onRefreshFileTree) {
            onRefreshFileTree();
          }
        }
      } else {
        const result = await window.electronAPI.moveFile(draggedItem.path, targetPath);
        if (!result.success) {
          console.error('Failed to move file:', result.error);
        } else {
          // Refresh the file tree if callback is provided
          if (onRefreshFileTree) {
            onRefreshFileTree();
          }
        }
      }
    } catch (error) {
      console.error('Error during drag and drop:', error);
    } finally {
      setDragOverItem(null);
      setDraggedItem(null);
      setIsDragCopy(false);
    }
  }, [draggedItem, onRefreshFileTree]);

  // Update drag effect based on keyboard modifiers
  useEffect(() => {
    const handleKeyChange = (e: KeyboardEvent) => {
      if (draggedItem) {
        setIsDragCopy(e.altKey || e.metaKey);
      }
    };

    window.addEventListener('keydown', handleKeyChange);
    window.addEventListener('keyup', handleKeyChange);

    return () => {
      window.removeEventListener('keydown', handleKeyChange);
      window.removeEventListener('keyup', handleKeyChange);
    };
  }, [draggedItem]);

  return (
    <>
      <ul className="file-tree" style={{ paddingLeft: level > 0 ? '16px' : '0' }}>
      {items.map((item) => {
        const isExpanded = expandedDirs.has(item.path);
        const isDragOver = dragOverItem === item.path;
        const isSelected = selectedFolder === item.path;

        return (
          <li
            key={item.path}
            className="file-tree-item"
            {...(item.type === 'directory' ? {
              onDragOver: (e) => handleDragOver(e, item),
              onDragLeave: handleDragLeave,
              onDrop: (e) => handleDrop(e, item),
            } : {})}
          >
            {item.type === 'directory' ? (
              <>
                <div
                  className={`file-tree-directory ${isDragOver ? 'drag-over' : ''} ${isSelected ? 'selected' : ''}`}
                  onClick={(e) => handleFolderClick(e, item.path)}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  onDragEnd={handleDragEnd}
                  style={{
                    opacity: draggedItem?.path === item.path ? 0.5 : 1
                  }}
                >
                  <span className="file-tree-chevron">
                    <MaterialSymbol
                      icon={isExpanded ? "keyboard_arrow_down" : "keyboard_arrow_right"}
                      size={16}
                    />
                  </span>
                  {showIcons && (
                    <span className="file-tree-icon">
                      <MaterialSymbol
                        icon={isExpanded ? "folder_open" : "folder"}
                        size={18}
                      />
                    </span>
                  )}
                  <span className="file-tree-name">
                    {item.name}
                    {isDragOver && isDragCopy && <span style={{ marginLeft: '4px', fontSize: '10px', opacity: 0.7 }}>(copy)</span>}
                  </span>
                </div>
                {isExpanded && item.children && (
                  <FileTree
                    items={item.children}
                    currentFilePath={currentFilePath}
                    onFileSelect={onFileSelect}
                    level={level + 1}
                    showIcons={showIcons}
                    onNewFile={onNewFile}
                    onNewFolder={onNewFolder}
                    onRefreshFileTree={onRefreshFileTree}
                    onViewHistory={onViewHistory}
                    selectedFolder={selectedFolder}
                    onFolderSelect={onFolderSelect}
                    sharedDragState={{
                      draggedItem,
                      setDraggedItem,
                      dragOverItem,
                      setDragOverItem,
                      isDragCopy,
                      setIsDragCopy
                    }}
                    sharedExpandedDirs={{
                      expandedDirs,
                      setExpandedDirs
                    }}
                  />
                )}
              </>
            ) : (
              <div
                className={`file-tree-file ${currentFilePath === item.path ? 'active' : ''}`}
                onClick={() => {
                  // Clear folder selection when clicking a file
                  if (onFolderSelect) {
                    onFolderSelect(null);
                  }
                  onFileSelect(item.path);
                }}
                onContextMenu={(e) => handleContextMenu(e, item)}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                onDragEnd={handleDragEnd}
                style={{
                  opacity: draggedItem?.path === item.path ? 0.5 : 1
                }}
              >
                <span className="file-tree-spacer"></span>
                {showIcons && (
                  <span className="file-tree-icon">
                    {getFileIcon(item.name)}
                  </span>
                )}
                <span className="file-tree-name">
                  {item.name}
                </span>
              </div>
            )}
          </li>
        );
      })}
      </ul>
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          filePath={contextMenu.filePath}
          fileName={contextMenu.fileName}
          fileType={contextMenu.fileType}
          onClose={() => setContextMenu(null)}
          onRename={handleRename}
          onDelete={handleDelete}
          onOpenInNewWindow={handleOpenInNewWindow}
          onShowInFinder={handleShowInFinder}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onViewHistory={onViewHistory}
        />
      )}
    </>
  );
}
