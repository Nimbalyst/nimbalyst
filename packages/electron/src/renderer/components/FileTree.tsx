import React, { useState, useCallback } from 'react';
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
  onNewFile?: (folderPath: string) => void;
  onNewFolder?: (folderPath: string) => void;
  onRefreshFileTree?: () => void;
}

function getFileIcon(fileName: string) {
  const lowerName = fileName.toLowerCase();
  
  // Special files
  if (lowerName === 'readme.md' || lowerName === 'readme.markdown') {
    return <MaterialSymbol icon="info" size={18} />;
  }
  
  // Default markdown icon
  return <MaterialSymbol icon="description" size={18} />;
}

export function FileTree({ items, currentFilePath, onFileSelect, level, onNewFile, onNewFolder, onRefreshFileTree }: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    filePath: string;
    fileName: string;
    fileType: 'file' | 'directory';
  } | null>(null);
  // Initialize expanded directories to show path to current file
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    const initialExpanded = new Set<string>();
    
    if (currentFilePath && level === 0) {
      // Find all parent directories of the current file
      const findParentDirs = (items: FileTreeItem[], targetPath: string, parents: string[] = []): string[] | null => {
        for (const item of items) {
          if (item.type === 'file' && item.path === targetPath) {
            return parents;
          } else if (item.type === 'directory' && item.children) {
            const result = findParentDirs(item.children, targetPath, [...parents, item.path]);
            if (result) return result;
          }
        }
        return null;
      };
      
      const parentDirs = findParentDirs(items, currentFilePath);
      if (parentDirs) {
        parentDirs.forEach(dir => initialExpanded.add(dir));
      }
    }
    
    return initialExpanded;
  });

  const toggleDirectory = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);

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

  return (
    <>
      <ul className="file-tree" style={{ paddingLeft: level > 0 ? '16px' : '0' }}>
      {items.map((item) => {
        const isExpanded = expandedDirs.has(item.path);
        
        return (
          <li key={item.path} className="file-tree-item">
            {item.type === 'directory' ? (
              <>
                <div
                  className="file-tree-directory"
                  onClick={() => toggleDirectory(item.path)}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                >
                  <span className="file-tree-chevron">
                    <MaterialSymbol 
                      icon={isExpanded ? "keyboard_arrow_down" : "keyboard_arrow_right"} 
                      size={16} 
                    />
                  </span>
                  <span className="file-tree-icon">
                    <MaterialSymbol 
                      icon={isExpanded ? "folder_open" : "folder"} 
                      size={18} 
                    />
                  </span>
                  <span className="file-tree-name">{item.name}</span>
                </div>
                {isExpanded && item.children && (
                  <FileTree
                    items={item.children}
                    currentFilePath={currentFilePath}
                    onFileSelect={onFileSelect}
                    level={level + 1}
                    onNewFile={onNewFile}
                    onNewFolder={onNewFolder}
                    onRefreshFileTree={onRefreshFileTree}
                  />
                )}
              </>
            ) : (
              <div
                className={`file-tree-file ${currentFilePath === item.path ? 'active' : ''}`}
                onClick={() => onFileSelect(item.path)}
                onContextMenu={(e) => handleContextMenu(e, item)}
              >
                <span className="file-tree-spacer"></span>
                <span className="file-tree-icon">
                  {getFileIcon(item.name)}
                </span>
                <span className="file-tree-name">{item.name}</span>
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
        />
      )}
    </>
  );
}