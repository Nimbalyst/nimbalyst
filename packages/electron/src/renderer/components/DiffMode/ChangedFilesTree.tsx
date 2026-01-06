import React, { useMemo } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { ChangedFile } from './DiffModeView';
import './ChangedFilesTree.css';

interface ChangedFilesTreeProps {
  files: ChangedFile[];
  onToggleStaged: (filePath: string) => void;
  onSelectFile: (filePath: string) => void;
}

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  status?: 'added' | 'modified' | 'deleted';
  staged?: boolean;
  children?: FileTreeNode[];
}

function buildFileTree(files: ChangedFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const map = new Map<string, FileTreeNode>();

  for (const file of files) {
    const parts = file.path.split('/');
    let currentPath = '';
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;

      let node = map.get(currentPath);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          ...(isFile ? { status: file.status, staged: file.staged } : {}),
          children: isFile ? undefined : [],
        };
        map.set(currentPath, node);
        currentLevel.push(node);
      }

      if (!isFile && node.children) {
        currentLevel = node.children;
      }
    }
  }

  return root;
}

function getStatusBadge(status: 'added' | 'modified' | 'deleted'): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    default:
      return 'M';
  }
}

function flattenTree(nodes: FileTreeNode[], depth = 0): Array<FileTreeNode & { depth: number }> {
  const result: Array<FileTreeNode & { depth: number }> = [];

  for (const node of nodes) {
    result.push({ ...node, depth });
    if (node.children) {
      result.push(...flattenTree(node.children, depth + 1));
    }
  }

  return result;
}

export function ChangedFilesTree({ files, onToggleStaged, onSelectFile }: ChangedFilesTreeProps) {
  const treeData = useMemo(() => buildFileTree(files), [files]);
  const flattenedTree = useMemo(() => flattenTree(treeData), [treeData]);

  // Create a Map for fast lookup of file staged status
  const stagedStatusMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const file of files) {
      map.set(file.path, file.staged ?? false);
    }
    return map;
  }, [files]);

  if (files.length === 0) {
    return (
      <div className="changed-files-tree changed-files-tree--empty">
        <p>No changes</p>
      </div>
    );
  }

  return (
    <div className="changed-files-tree">
      {flattenedTree.map(node => {
        // Verify checkbox state matches source data for files
        const expectedStaged = node.type === 'file' ? stagedStatusMap.get(node.path) ?? false : false;
        const actualStaged = node.staged ?? false;

        // Log warning if state is out of sync
        if (node.type === 'file' && expectedStaged !== actualStaged) {
          console.warn('Checkbox state out of sync', {
            path: node.path,
            expected: expectedStaged,
            actual: actualStaged,
          });
        }

        return (
          <div
            key={node.path}
            className={`changed-files-tree-item changed-files-tree-item--${node.type}`}
            style={{ paddingLeft: 12 + node.depth * 16 }}
          >
            {node.type === 'file' ? (
              <>
                <label className="changed-files-tree-checkbox">
                  <input
                    type="checkbox"
                    checked={expectedStaged}
                    onChange={() => onToggleStaged(node.path)}
                  />
                  <span className="changed-files-tree-checkbox-mark">
                    {expectedStaged && <MaterialSymbol icon="check" size={12} />}
                  </span>
                </label>
                <button
                  type="button"
                  className="changed-files-tree-file"
                  onClick={() => onSelectFile(node.path)}
                  title={node.path}
                >
                  <span className={`changed-files-tree-status changed-files-tree-status--${node.status}`}>
                    {node.status && getStatusBadge(node.status)}
                  </span>
                  <span className="changed-files-tree-name">{node.name}</span>
                </button>
              </>
            ) : (
              <>
                <MaterialSymbol icon="folder" size={14} />
                <span className="changed-files-tree-folder-name">{node.name}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ChangedFilesTree;
