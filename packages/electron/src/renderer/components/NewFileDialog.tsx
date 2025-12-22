import React, { useState, useRef, useEffect, useMemo } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { NewFileType, ExtensionFileType } from './NewFileMenu';
import './NewFileDialog.css';

interface FileTypeOption {
  id: NewFileType;
  label: string;
  icon: string;
  extension: string;
  defaultContent?: string;
}

interface NewFileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentDirectory: string;
  workspacePath: string;
  onCreateFile: (fileName: string, fileType: NewFileType) => void;
  /** Extension-contributed file types */
  extensionFileTypes?: ExtensionFileType[];
  /** File tree for folder selection */
  fileTree?: Array<{ name: string; path: string; type: 'file' | 'directory'; children?: any[] }>;
  /** Callback when directory changes */
  onDirectoryChange?: (directory: string) => void;
}

export const NewFileDialog: React.FC<NewFileDialogProps> = ({
  isOpen,
  onClose,
  currentDirectory,
  workspacePath,
  onCreateFile,
  extensionFileTypes = [],
  fileTree = [],
  onDirectoryChange,
}) => {
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [selectedFileType, setSelectedFileType] = useState<NewFileType>('markdown');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderPickerRef = useRef<HTMLDivElement>(null);

  // Build file type options
  const fileTypeOptions = useMemo<FileTypeOption[]>(() => {
    const options: FileTypeOption[] = [
      { id: 'markdown', label: 'Markdown', icon: 'description', extension: '.md' },
      { id: 'mockup', label: 'Mockup', icon: 'web', extension: '.mockup.html' },
    ];

    // Add extension-contributed types
    extensionFileTypes.forEach((extType) => {
      options.push({
        id: `ext:${extType.extension}`,
        label: extType.displayName,
        icon: extType.icon,
        extension: extType.extension,
        defaultContent: extType.defaultContent,
      });
    });

    // Add "Other" option for any file type
    options.push({ id: 'any', label: 'Other', icon: 'note_add', extension: '' });

    return options;
  }, [extensionFileTypes]);

  // Get the currently selected file type option
  const currentFileType = useMemo(() => {
    return fileTypeOptions.find((opt) => opt.id === selectedFileType) || fileTypeOptions[0];
  }, [fileTypeOptions, selectedFileType]);

  // Compute the extension suffix to display
  const extensionSuffix = useMemo(() => {
    if (selectedFileType === 'any') {
      return ''; // User provides their own extension
    }
    // Check if the user already typed the extension
    const ext = currentFileType.extension;
    if (ext && !fileName.endsWith(ext)) {
      return ext;
    }
    return '';
  }, [selectedFileType, currentFileType, fileName]);

  useEffect(() => {
    if (isOpen) {
      setFileName('');
      setError('');
      setSelectedFileType('markdown');
      setShowFolderPicker(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close folder picker when clicking outside
  useEffect(() => {
    if (!showFolderPicker) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(event.target as Node)) {
        setShowFolderPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFolderPicker]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!fileName.trim()) {
      setError('Please enter a file name');
      return;
    }

    // Check for invalid characters
    if (fileName.includes('/') || fileName.includes('\\')) {
      setError('File name cannot contain / or \\');
      return;
    }

    onCreateFile(fileName.trim(), selectedFileType);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showFolderPicker) {
        setShowFolderPicker(false);
      } else {
        onClose();
      }
    }
  };

  const handleFolderSelect = (folderPath: string) => {
    onDirectoryChange?.(folderPath);
    setShowFolderPicker(false);
  };

  // Recursively render folder tree for folder picker
  const renderFolderTree = (items: typeof fileTree, level = 0) => {
    const folders = items.filter((item) => item.type === 'directory');
    if (folders.length === 0) return null;

    return (
      <ul className="new-file-folder-list" style={{ paddingLeft: level > 0 ? 16 : 0 }}>
        {folders.map((folder) => (
          <li key={folder.path}>
            <div
              className={`new-file-folder-item ${folder.path === currentDirectory ? 'selected' : ''}`}
              onClick={() => handleFolderSelect(folder.path)}
            >
              <MaterialSymbol icon="folder" size={16} />
              <span>{folder.name}</span>
            </div>
            {folder.children && renderFolderTree(folder.children, level + 1)}
          </li>
        ))}
      </ul>
    );
  };

  if (!isOpen) return null;

  // Get relative path for display
  const relativePath = currentDirectory.startsWith(workspacePath)
    ? currentDirectory.slice(workspacePath.length + 1) || '/'
    : currentDirectory;

  const workspaceName = workspacePath.split('/').pop() || 'workspace';

  return (
    <div className="new-file-dialog-overlay" onClick={onClose}>
      <div className="new-file-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>New File</h2>

        {/* File Type Selector */}
        <div className="new-file-field">
          <label>Type</label>
          <select
            value={selectedFileType}
            onChange={(e) => {
              setSelectedFileType(e.target.value as NewFileType);
              setError('');
            }}
            className="new-file-select"
          >
            {fileTypeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Location Selector */}
        <div className="new-file-field">
          <label>Location</label>
          <div className="new-file-location-picker" ref={folderPickerRef}>
            <button
              type="button"
              className="new-file-location-button"
              onClick={() => setShowFolderPicker(!showFolderPicker)}
            >
              <MaterialSymbol icon="folder" size={16} />
              <span className="path">{relativePath}</span>
              <MaterialSymbol icon="expand_more" size={16} />
            </button>
            {showFolderPicker && fileTree.length > 0 && (
              <div className="new-file-folder-picker">
                <div
                  className={`new-file-folder-item ${currentDirectory === workspacePath ? 'selected' : ''}`}
                  onClick={() => handleFolderSelect(workspacePath)}
                >
                  <MaterialSymbol icon="folder" size={16} />
                  <span>{workspaceName} (root)</span>
                </div>
                {renderFolderTree(fileTree)}
              </div>
            )}
          </div>
        </div>

        {/* File Name Input */}
        <form onSubmit={handleSubmit}>
          <div className="new-file-field">
            <label>Name</label>
            <div className="new-file-input-wrapper">
              <input
                ref={inputRef}
                type="text"
                value={fileName}
                onChange={(e) => {
                  setFileName(e.target.value);
                  setError('');
                }}
                onKeyDown={handleKeyDown}
                placeholder={selectedFileType === 'any' ? 'document.txt' : 'document'}
                className="new-file-input"
              />
              {extensionSuffix && <span className="new-file-extension">{extensionSuffix}</span>}
            </div>
          </div>
          {error && <div className="new-file-error">{error}</div>}
          <div className="new-file-buttons">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
};
