import React, { useState, useRef, useEffect } from 'react';
import './NewFileDialog.css';

interface NewFileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentDirectory: string;
  projectPath: string;
  onCreateFile: (fileName: string) => void;
}

export const NewFileDialog: React.FC<NewFileDialogProps> = ({
  isOpen,
  onClose,
  currentDirectory,
  projectPath,
  onCreateFile,
}) => {
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setFileName('');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

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

    // Add .md extension if no extension provided
    let finalName = fileName.trim();
    if (!finalName.includes('.')) {
      finalName += '.md';
    }

    onCreateFile(finalName);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  // Get relative path for display
  const relativePath = currentDirectory.startsWith(projectPath) 
    ? currentDirectory.slice(projectPath.length + 1) || '/'
    : currentDirectory;

  return (
    <div className="new-file-dialog-overlay" onClick={onClose}>
      <div className="new-file-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>New File</h2>
        <div className="new-file-location">
          Location: <span className="path">{relativePath}</span>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={fileName}
            onChange={(e) => {
              setFileName(e.target.value);
              setError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder="Enter file name (e.g., document.md)"
            className="new-file-input"
          />
          {error && <div className="new-file-error">{error}</div>}
          <div className="new-file-buttons">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
};