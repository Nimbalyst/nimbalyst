import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { ChangedFile } from './DiffModeView';

interface DiffFileTabsProps {
  files: ChangedFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
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

function getStatusClasses(status: 'added' | 'modified' | 'deleted'): string {
  switch (status) {
    case 'added':
      return 'bg-[var(--nim-success-light)] text-[var(--nim-success)]';
    case 'deleted':
      return 'bg-[var(--nim-error-light)] text-[var(--nim-error)]';
    default:
      return 'bg-[var(--nim-warning-light)] text-[var(--nim-warning)]';
  }
}

export function DiffFileTabs({ files, selectedFile, onSelectFile, onCloseFile }: DiffFileTabsProps) {
  return (
    <div className="diff-file-tabs flex flex-row bg-[var(--nim-bg-secondary)] border-b border-[var(--nim-border)] overflow-hidden min-h-9">
      <div className="diff-file-tabs-scroll flex flex-row overflow-x-auto overflow-y-hidden scrollbar-none">
        {files.map(file => {
          const isActive = selectedFile === file.path;
          return (
            <button
              key={file.path}
              type="button"
              className={`diff-file-tab group flex items-center gap-1.5 px-3 h-9 bg-transparent border-none border-r border-r-[var(--nim-border)] text-[0.8125rem] cursor-pointer whitespace-nowrap transition-colors duration-150 ${
                isActive
                  ? 'is-active bg-[var(--nim-bg)] text-[var(--nim-text)]'
                  : 'text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'
              }`}
              onClick={() => onSelectFile(file.path)}
              title={file.path}
            >
              <span
                className={`diff-file-tab-status inline-flex items-center justify-center w-4 h-4 text-[0.6875rem] font-semibold rounded-[3px] ${getStatusClasses(file.status)}`}
              >
                {getStatusBadge(file.status)}
              </span>
              <span className="diff-file-tab-name max-w-[200px] overflow-hidden text-ellipsis">
                {getFileName(file.path)}
              </span>
              <button
                type="button"
                className="diff-file-tab-close flex items-center justify-center w-[18px] h-[18px] p-0 bg-transparent border-none rounded-[3px] text-[var(--nim-text-faint)] cursor-pointer opacity-0 group-hover:opacity-100 hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)] transition-opacity duration-150"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseFile(file.path);
                }}
                title="Close"
              >
                <MaterialSymbol icon="close" size={14} />
              </button>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default DiffFileTabs;
