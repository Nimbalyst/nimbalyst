import React, { useState, useCallback } from 'react';
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
}

export function ProjectSidebar({
  projectName,
  fileTree,
  currentFilePath,
  onFileSelect,
  onCloseProject
}: ProjectSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filterFileTree = useCallback((items: FileTreeItem[]): FileTreeItem[] => {
    if (!searchQuery) return items;
    
    const query = searchQuery.toLowerCase();
    const filtered: FileTreeItem[] = [];
    
    for (const item of items) {
      if (item.type === 'file' && item.name.toLowerCase().includes(query)) {
        filtered.push(item);
      } else if (item.type === 'directory' && item.children) {
        const filteredChildren = filterFileTree(item.children);
        if (filteredChildren.length > 0) {
          filtered.push({
            ...item,
            children: filteredChildren
          });
        }
      }
    }
    
    return filtered;
  }, [searchQuery]);

  const filteredTree = filterFileTree(fileTree);

  return (
    <div className="project-sidebar">
      <div className="project-sidebar-header">
        <h3 className="project-name">{projectName}</h3>
        <button
          className="close-project-btn"
          onClick={onCloseProject}
          title="Close Project"
        >
          ×
        </button>
      </div>
      
      <div className="project-search">
        <input
          type="text"
          placeholder="Search files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="project-search-input"
        />
      </div>
      
      <div className="project-file-tree">
        <FileTree
          items={filteredTree}
          currentFilePath={currentFilePath}
          onFileSelect={onFileSelect}
          level={0}
        />
      </div>
    </div>
  );
}