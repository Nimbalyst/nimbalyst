import React from 'react';
import { FileTree } from './FileTree';
import '../ProjectSidebar.css';

interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

interface ProjectSidebarProps {
  projectName: string;
  fileTree: FileTreeItem[];
  currentFilePath: string | null;
  onFileSelect: (filePath: string) => void;
  onCloseProject: () => void;
  onOpenQuickSearch?: () => void;
}

export function ProjectSidebar({
  projectName,
  fileTree,
  currentFilePath,
  onFileSelect,
  onCloseProject,
  onOpenQuickSearch
}: ProjectSidebarProps) {

  return (
    <div className="project-sidebar">
      <div className="project-sidebar-header">
        <h3 className="project-name">{projectName}</h3>
        {onOpenQuickSearch && (
          <button
            className="project-search-button"
            onClick={onOpenQuickSearch}
            title="Search files (⌘K)"
            aria-label="Search files"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" fill="currentColor"/>
            </svg>
          </button>
        )}
      </div>

      <div className="project-file-tree">
        <FileTree
          items={fileTree}
          currentFilePath={currentFilePath}
          onFileSelect={onFileSelect}
          level={0}
        />
      </div>
    </div>
  );
}
