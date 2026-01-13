import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { ChangedFile } from './DiffModeView';
import './DiffFileTabs.css';

interface DiffFileTabsProps {
  files: ChangedFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

function getFileIcon(status: 'added' | 'modified' | 'deleted'): string {
  switch (status) {
    case 'added':
      return 'add_circle';
    case 'deleted':
      return 'remove_circle';
    default:
      return 'edit';
  }
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

export function DiffFileTabs({ files, selectedFile, onSelectFile, onCloseFile }: DiffFileTabsProps) {
  return (
    <div className="diff-file-tabs">
      <div className="diff-file-tabs-scroll">
        {files.map(file => (
          <button
            key={file.path}
            type="button"
            className={`diff-file-tab ${selectedFile === file.path ? 'is-active' : ''}`}
            onClick={() => onSelectFile(file.path)}
            title={file.path}
          >
            <span className={`diff-file-tab-status diff-file-tab-status--${file.status}`}>
              {getStatusBadge(file.status)}
            </span>
            <span className="diff-file-tab-name">{getFileName(file.path)}</span>
            <button
              type="button"
              className="diff-file-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseFile(file.path);
              }}
              title="Close"
            >
              <MaterialSymbol icon="close" size={14} />
            </button>
          </button>
        ))}
      </div>
    </div>
  );
}

export default DiffFileTabs;
