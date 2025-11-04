import React, { useState } from 'react';
import { FileTree } from './FileTree';
import { InputModal } from './InputModal';
import { PlansPanel } from './PlansPanel/PlansPanel';
import { createInitialFileContent } from '../utils/fileUtils';
import '../WorkspaceSidebar.css';

interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

interface WorkspaceSidebarProps {
  workspaceName: string;
  workspacePath: string;
  fileTree: FileTreeItem[];
  currentFilePath: string | null;
  currentView: 'files' | 'plans';
  onFileSelect: (filePath: string) => void;
  onCloseWorkspace: () => void;
  onOpenQuickSearch?: () => void;
  onRefreshFileTree?: () => void;
  onViewHistory?: (filePath: string) => void;
  onNewPlan?: () => void;
  onOpenPlansTable?: () => void;
  onSelectedFolderChange?: (folderPath: string | null) => void;
}

// Generate a consistent color based on workspace path
function generateWorkspaceColor(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash) + path.charCodeAt(i);
    hash = hash & hash;
  }

  // Generate a hue value (0-360)
  const hue = Math.abs(hash) % 360;
  // Use consistent saturation and lightness for pleasant colors
  return `hsl(${hue}, 65%, 55%)`;
}

export function WorkspaceSidebar({
  workspaceName,
  workspacePath,
  fileTree,
  currentFilePath,
  currentView,
  onFileSelect,
  onCloseWorkspace,
  onOpenQuickSearch,
  onRefreshFileTree,
  onViewHistory,
  onNewPlan,
  onOpenPlansTable,
  onSelectedFolderChange
}: WorkspaceSidebarProps) {
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);
  const [draggedItem, setDraggedItem] = useState<any | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  // Notify parent when selected folder changes
  const handleSelectedFolderChange = (folderPath: string | null) => {
    setSelectedFolder(folderPath);
    onSelectedFolderChange?.(folderPath);
  };

  const handleNewFile = () => {
    // Priority: selected folder > parent of current file > workspace root
    if (selectedFolder) {
      setTargetFolder(selectedFolder);
    } else if (currentFilePath) {
      const parentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
      setTargetFolder(parentDir);
    }
    setIsFileModalOpen(true);
  };

  const handleNewFolder = () => {
    // Priority: selected folder > parent of current file > workspace root
    if (selectedFolder) {
      setTargetFolder(selectedFolder);
    } else if (currentFilePath) {
      const parentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
      setTargetFolder(parentDir);
    }
    setIsFolderModalOpen(true);
  };

  const [targetFolder, setTargetFolder] = useState<string | null>(null);

  const handleCreateFile = async (fileName: string) => {
    setIsFileModalOpen(false);

    // Ensure it has .md extension
    const fullFileName = fileName.endsWith('.md') || fileName.endsWith('.markdown')
      ? fileName
      : `${fileName}.md`;

    try {
      const basePath = targetFolder || workspacePath;
      const filePath = `${basePath}/${fullFileName}`;
      const content = createInitialFileContent(fullFileName);

      const result = await (window as any).electronAPI?.createFile?.(filePath, content);
      if (result?.success) {
        // Refresh file tree and open the new file
        if (onRefreshFileTree) {
          onRefreshFileTree();
        }
        onFileSelect(filePath);
      } else {
        alert('Failed to create file: ' + (result?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to create file:', error);
      alert('Failed to create file: ' + error);
    } finally {
      setTargetFolder(null);
    }
  };

  const handleCreateFolder = async (folderName: string) => {
    setIsFolderModalOpen(false);

    try {
      const basePath = targetFolder || workspacePath;
      const folderPath = `${basePath}/${folderName}`;

      const result = await (window as any).electronAPI?.createFolder?.(folderPath);
      if (result?.success) {
        // Refresh file tree
        if (onRefreshFileTree) {
          onRefreshFileTree();
        }
      } else {
        alert('Failed to create folder: ' + (result?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to create folder:', error);
      alert('Failed to create folder: ' + error);
    } finally {
      setTargetFolder(null);
    }
  };

  const handleNewFileInFolder = (folderPath: string) => {
    setTargetFolder(folderPath);
    setIsFileModalOpen(true);
  };

  const handleNewFolderInFolder = (folderPath: string) => {
    setTargetFolder(folderPath);
    setIsFolderModalOpen(true);
  };

  const handleFileSelect = (filePath: string) => {
    handleSelectedFolderChange(null); // Clear folder selection when a file is selected
    onFileSelect(filePath);
  };

  // Root folder drag and drop handlers
  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    // Check if we're over a folder or file item - if so, don't handle at root level
    const target = e.target as HTMLElement;
    const overFolderOrFile = target.closest('.file-tree-directory, .file-tree-file');

    if (overFolderOrFile) {
      // We're over a specific folder/file, let FileTree handle it
      setIsDragOverRoot(false);
      return;
    }

    // Get the drag data to check if it's a valid file/folder
    const dragPath = e.dataTransfer.types.includes('text/plain');
    if (dragPath) {
      setIsDragOverRoot(true);
      e.dataTransfer.dropEffect = e.altKey || e.metaKey ? 'copy' : 'move';
    }
  };

  const handleRootDragLeave = (e: React.DragEvent) => {
    // Only clear if we're leaving the root drop zone entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    const dropZone = e.currentTarget as HTMLElement;
    if (!dropZone.contains(relatedTarget)) {
      setIsDragOverRoot(false);
    }
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverRoot(false);

    const sourcePath = e.dataTransfer.getData('text/plain');
    if (!sourcePath) return;

    const isCopy = e.altKey || e.metaKey;

    try {
      if (isCopy) {
        const result = await (window as any).electronAPI.copyFile(sourcePath, workspacePath);
        if (!result.success) {
          console.error('Failed to copy to root:', result.error);
        } else if (onRefreshFileTree) {
          onRefreshFileTree();
        }
      } else {
        const result = await (window as any).electronAPI.moveFile(sourcePath, workspacePath);
        if (!result.success) {
          console.error('Failed to move to root:', result.error);
        } else if (onRefreshFileTree) {
          onRefreshFileTree();
        }
      }
    } catch (error) {
      console.error('Error during drop to root:', error);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    // Store the dragged item info for visual feedback
    const dragPath = e.dataTransfer.getData('text/plain');
    setDraggedItem({ path: dragPath });
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setIsDragOverRoot(false);
  };

  const workspaceColor = generateWorkspaceColor(workspacePath);

  return (
    <div className="workspace-sidebar"
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="workspace-color-accent" style={{ backgroundColor: workspaceColor }} />
      <div className="workspace-sidebar-header">
        <div className="workspace-identity">
          <h3 className="workspace-name">{workspaceName}</h3>
          <div className="workspace-path" title={workspacePath}>
            {workspacePath}
          </div>
        </div>
        <div className="workspace-sidebar-actions">
          {currentView === 'files' && (
            <>
              <button
                className="workspace-action-button"
                onClick={handleNewFile}
                title="New file"
                aria-label="New file"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  edit_square
                </span>
              </button>
              <button
                className="workspace-action-button"
                onClick={handleNewFolder}
                title="New folder"
                aria-label="New folder"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  create_new_folder
                </span>
              </button>
              {onOpenQuickSearch && (
                <button
                  className="workspace-action-button"
                  onClick={onOpenQuickSearch}
                  title="Search files (⌘K)"
                  aria-label="Search files"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    search
                  </span>
                </button>
              )}
            </>
          )}
          {currentView === 'plans' && (
            <>
              {onNewPlan && (
                <button
                  className="workspace-action-button"
                  onClick={onNewPlan}
                  title="New plan"
                  aria-label="New plan"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    note_add
                  </span>
                </button>
              )}
              {onOpenPlansTable && (
                <button
                  className="workspace-action-button"
                  onClick={onOpenPlansTable}
                  title="Open planning table"
                  aria-label="Open planning table"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    table_view
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {currentView === 'files' ? (
        <>
          <div className="workspace-section-label">Files</div>
          <div className={`workspace-file-tree ${isDragOverRoot ? 'drag-over-root' : ''}`}>
            <FileTree
              items={fileTree}
              currentFilePath={currentFilePath}
              onFileSelect={handleFileSelect}
              level={0}
              onNewFile={handleNewFileInFolder}
              onNewFolder={handleNewFolderInFolder}
              onRefreshFileTree={onRefreshFileTree}
              onViewHistory={onViewHistory}
              selectedFolder={selectedFolder}
              onFolderSelect={handleSelectedFolderChange}
            />
            {isDragOverRoot && (
              <div className="root-drop-indicator">
                Drop here to move to workspace root
              </div>
            )}
          </div>
        </>
      ) : (
        <PlansPanel
          currentFilePath={currentFilePath}
          onPlanSelect={onFileSelect}
        />
      )}

      <InputModal
        isOpen={isFileModalOpen}
        title={targetFolder ? `New File in ${targetFolder.split('/').pop()}` : "New File"}
        placeholder="Enter file name (e.g., document.md)"
        defaultValue=""
        onConfirm={handleCreateFile}
        onCancel={() => {
          setIsFileModalOpen(false);
          setTargetFolder(null);
        }}
      />

      <InputModal
        isOpen={isFolderModalOpen}
        title={targetFolder ? `New Folder in ${targetFolder.split('/').pop()}` : "New Folder"}
        placeholder="Enter folder name"
        defaultValue=""
        onConfirm={handleCreateFolder}
        onCancel={() => {
          setIsFolderModalOpen(false);
          setTargetFolder(null);
        }}
      />
    </div>
  );
}
