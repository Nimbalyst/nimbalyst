import React, { useMemo } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { ChangedFile } from './DiffModeView';

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
  displayPath?: string; // Flattened display path for single-child chains
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

  // Flatten single-child directory chains
  function flattenNode(node: FileTreeNode): FileTreeNode {
    if (node.type === 'file' || !node.children || node.children.length !== 1) {
      // If it's a file or has 0 or 2+ children, just recursively flatten children
      if (node.children) {
        node.children = node.children.map(flattenNode);
      }
      return node;
    }

    // Single child - check if we can flatten
    const child = node.children[0];

    if (child.type === 'file') {
      // Don't flatten if the single child is a file - keep the directory separate
      node.children = node.children.map(flattenNode);
      return node;
    }

    // Flatten the chain: combine directory names
    const flattenedPath = `${node.name}/${child.name}`;
    const flattened: FileTreeNode = {
      ...child,
      name: child.name,
      displayPath: flattenedPath,
      children: child.children,
    };

    // Continue flattening down the chain
    return flattenNode(flattened);
  }

  return root.map(flattenNode);
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
      <div className="changed-files-tree changed-files-tree--empty flex flex-col py-4 px-3 text-xs text-center text-[var(--nim-text-faint)]">
        <p>No changes</p>
      </div>
    );
  }

  return (
    <div className="changed-files-tree flex flex-col py-1 max-h-[200px] overflow-y-auto">
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
            className={`changed-files-tree-item changed-files-tree-item--${node.type} flex items-center gap-1.5 h-7 pr-3 ${node.type === 'directory' ? 'text-xs text-[var(--nim-text-muted)]' : ''}`}
            style={{ paddingLeft: 12 + node.depth * 16 }}
          >
            {node.type === 'file' ? (
              <>
                <label className="changed-files-tree-checkbox flex items-center justify-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={expectedStaged}
                    onChange={() => onToggleStaged(node.path)}
                    className="peer absolute opacity-0 w-0 h-0"
                  />
                  <span className="changed-files-tree-checkbox-mark flex items-center justify-center w-4 h-4 bg-[var(--nim-bg)] border border-[var(--nim-border-secondary)] rounded-[3px] text-[var(--nim-accent-contrast)] transition-[background-color,border-color] duration-150 peer-checked:bg-[var(--nim-primary)] peer-checked:border-[var(--nim-primary)] peer-focus:shadow-[0_0_0_2px_var(--nim-accent-muted)]">
                    {expectedStaged && <MaterialSymbol icon="check" size={12} />}
                  </span>
                </label>
                <button
                  type="button"
                  className="changed-files-tree-file flex-1 flex items-center gap-1.5 min-w-0 py-1 px-1.5 bg-transparent border-none rounded text-[0.8125rem] text-left text-[var(--nim-text)] cursor-pointer transition-colors duration-150 hover:bg-[var(--nim-bg-hover)]"
                  onClick={() => onSelectFile(node.path)}
                  title={node.path}
                >
                  <span
                    className={`changed-files-tree-status changed-files-tree-status--${node.status} inline-flex items-center justify-center w-3.5 h-3.5 text-[0.625rem] font-semibold rounded-sm shrink-0 ${
                      node.status === 'added'
                        ? 'bg-[var(--nim-success-light)] text-[var(--nim-success)]'
                        : node.status === 'modified'
                          ? 'bg-[var(--nim-warning-light)] text-[var(--nim-warning)]'
                          : 'bg-[var(--nim-error-light)] text-[var(--nim-error)]'
                    }`}
                  >
                    {node.status && getStatusBadge(node.status)}
                  </span>
                  <span className="changed-files-tree-name overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
                </button>
              </>
            ) : (
              <>
                <MaterialSymbol icon="folder" size={14} />
                <span className="changed-files-tree-folder-name text-xs text-[var(--nim-text-muted)]">{node.displayPath || node.name}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ChangedFilesTree;
