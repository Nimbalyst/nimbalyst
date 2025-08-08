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
  
  const handleNewFile = () => {
    setIsFileModalOpen(true);
  };
  
  const handleNewFolder = () => {
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

  return (
    <div className="project-sidebar">
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
              note_add
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

      <div className="project-file-tree">
        <FileTree
          items={fileTree}
          currentFilePath={currentFilePath}
          onFileSelect={onFileSelect}
          level={0}
          onNewFile={handleNewFileInFolder}
          onNewFolder={handleNewFolderInFolder}
          onRefreshFileTree={onRefreshFileTree}
        />
      </div>
      
      <InputModal
        isOpen={isFileModalOpen}
        title="New File"
        placeholder="Enter file name (e.g., document.md)"
        defaultValue=""
        onConfirm={handleCreateFile}
        onCancel={() => setIsFileModalOpen(false)}
      />
      
      <InputModal
        isOpen={isFolderModalOpen}
        title="New Folder"
        placeholder="Enter folder name"
        defaultValue=""
        onConfirm={handleCreateFolder}
        onCancel={() => setIsFolderModalOpen(false)}
      />
    </div>
  );
}
