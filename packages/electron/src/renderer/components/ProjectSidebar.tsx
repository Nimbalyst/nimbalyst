import React, { useState } from 'react';
import { FileTree } from './FileTree';
import { InputModal } from './InputModal';
import '../ProjectSidebar.css';

interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

interface ProjectSidebarProps {
  projectName: string;
  projectPath: string;
  fileTree: FileTreeItem[];
  currentFilePath: string | null;
  onFileSelect: (filePath: string) => void;
  onCloseProject: () => void;
  onOpenQuickSearch?: () => void;
  onRefreshFileTree?: () => void;
}

export function ProjectSidebar({
  projectName,
  projectPath,
  fileTree,
  currentFilePath,
  onFileSelect,
  onCloseProject,
  onOpenQuickSearch,
  onRefreshFileTree
}: ProjectSidebarProps) {
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);
  const [draggedItem, setDraggedItem] = useState<any | null>(null);

  const handleNewFile = () => {
    // If a file is currently selected, use its parent directory
    // Otherwise use the project root
    if (currentFilePath) {
      const parentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
      setTargetFolder(parentDir);
    }
    setIsFileModalOpen(true);
  };

  const handleNewFolder = () => {
    // If a file is currently selected, use its parent directory
    // Otherwise use the project root
    if (currentFilePath) {
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
      const basePath = targetFolder || projectPath;
      const filePath = `${basePath}/${fullFileName}`;
      const content = `# ${fullFileName.replace('.md', '')}\n\n`;

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
      const basePath = targetFolder || projectPath;
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

  // Root folder drag and drop handlers
  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

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
        const result = await (window as any).electronAPI.copyFile(sourcePath, projectPath);
        if (!result.success) {
          console.error('Failed to copy to root:', result.error);
        } else if (onRefreshFileTree) {
          onRefreshFileTree();
        }
      } else {
        const result = await (window as any).electronAPI.moveFile(sourcePath, projectPath);
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

  return (
    <div className="project-sidebar"
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="project-sidebar-header">
        <h3 className="project-name">{projectName}</h3>
        <div className="project-sidebar-actions">
          <button
            className="project-action-button"
            onClick={handleNewFile}
            title="New file"
            aria-label="New file"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
              edit_square
            </span>
          </button>
          <button
            className="project-action-button"
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
              className="project-action-button"
              onClick={onOpenQuickSearch}
              title="Search files (⌘K)"
              aria-label="Search files"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                search
              </span>
            </button>
          )}
        </div>
      </div>

      <div className={`project-file-tree ${isDragOverRoot ? 'drag-over-root' : ''}`}>

        <FileTree
          items={fileTree}
          currentFilePath={currentFilePath}
          onFileSelect={onFileSelect}
          level={0}
          onNewFile={handleNewFileInFolder}
          onNewFolder={handleNewFolderInFolder}
          onRefreshFileTree={onRefreshFileTree}
        />
          {isDragOverRoot && (
              <div className="root-drop-indicator">
                  Drop here to move to project root
              </div>
          )}
      </div>

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
