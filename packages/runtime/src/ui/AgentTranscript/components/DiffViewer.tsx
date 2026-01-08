import React from 'react';
import './DiffViewer.css';
import { stripCommonContext } from '../utils/stripCommonContext';

interface DiffViewerProps {
  edit: any;
  filePath?: string; // File path from session context
  maxHeight?: string;
  /** Optional: Open a file in the editor (makes file path clickable) */
  onOpenFile?: (filePath: string) => void;
  /** Absolute file path for opening (may differ from display filePath) */
  absoluteFilePath?: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ edit, filePath: contextFilePath, maxHeight = '20rem', onOpenFile, absoluteFilePath }) => {
  // Extract the relevant diff information from the edit object
  const replacements = edit.replacements || [];
  // Use file path from props (session context) or fallback to edit fields
  const filePath = contextFilePath || edit.filePath || edit.file_path || edit.targetFilePath || 'Unknown file';

  // Helper to render clickable file header
  const renderFileHeader = (displayPath: string) => {
    const pathToOpen = absoluteFilePath || edit.filePath || edit.file_path || edit.targetFilePath;
    const isClickable = onOpenFile && pathToOpen;

    const handleClick = (e: React.MouseEvent) => {
      if (isClickable) {
        e.preventDefault();
        onOpenFile(pathToOpen);
      }
    };

    if (isClickable) {
      return (
        <div className="diff-file-header">
          <button
            className="diff-file-header-link"
            onClick={handleClick}
            title={`Open ${pathToOpen}`}
          >
            {displayPath}
          </button>
        </div>
      );
    }
    return <div className="diff-file-header">{displayPath}</div>;
  };

  // Handle single edit with old_string/new_string (Claude Code Edit tool format)
  if (!replacements.length && (edit.old_string || edit.new_string)) {
    const oldTextRaw = edit.old_string || edit.oldText || '';
    const newTextRaw = edit.new_string || edit.newText || '';

    // Strip common prefix and suffix to show only what changed
    const { oldText, newText } = stripCommonContext(oldTextRaw, newTextRaw);

    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    return (
      <div className="diff-viewer" style={{ maxHeight }}>
        {renderFileHeader(filePath)}
        <div className="diff-content">
          {/* Show removed lines */}
          {oldLines.length > 0 && oldLines.some((line: string) => line.trim()) && (
            <>
              {oldLines.map((line: string, i: number) => (
                <div key={`old-${i}`} className="diff-line removed">
                  <span className="diff-line-marker">-</span>
                  <span className="diff-line-content">{line || ' '}</span>
                </div>
              ))}
            </>
          )}

          {/* Show added lines */}
          {newLines.length > 0 && newLines.some((line: string) => line.trim()) && (
            <>
              {newLines.map((line: string, i: number) => (
                <div key={`new-${i}`} className="diff-line added">
                  <span className="diff-line-marker">+</span>
                  <span className="diff-line-content">{line || ' '}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  // If we have replacements array, show each replacement as a separate diff
  if (replacements.length > 0) {
    return (
      <>
        {replacements.map((replacement: any, idx: number) => {
          const oldTextRaw = replacement.oldText || replacement.old_text || '';
          const newTextRaw = replacement.newText || replacement.new_text || '';

          // Strip common prefix and suffix to show only what changed
          const { oldText, newText } = stripCommonContext(oldTextRaw, newTextRaw);

          const oldLines = oldText.split('\n');
          const newLines = newText.split('\n');

          return (
            <div key={idx} className="diff-viewer" style={{ maxHeight, marginBottom: idx < replacements.length - 1 ? '0.5rem' : '0' }}>
              {renderFileHeader(`${filePath}${replacements.length > 1 ? ` (${idx + 1}/${replacements.length})` : ''}`)}
              <div className="diff-content">
                {/* Show removed lines */}
                {oldLines.length > 0 && oldLines.some((line: string) => line.trim()) && (
                  <>
                    {oldLines.map((line: string, i: number) => (
                      <div key={`old-${i}`} className="diff-line removed">
                        <span className="diff-line-marker">-</span>
                        <span className="diff-line-content">{line || ' '}</span>
                      </div>
                    ))}
                  </>
                )}

                {/* Show added lines */}
                {newLines.length > 0 && newLines.some((line: string) => line.trim()) && (
                  <>
                    {newLines.map((line: string, i: number) => (
                      <div key={`new-${i}`} className="diff-line added">
                        <span className="diff-line-marker">+</span>
                        <span className="diff-line-content">{line || ' '}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </>
    );
  }

  // If we only have content (insertion), show it as added lines
  if (edit.content) {
    const lines = edit.content.split('\n');
    return (
      <div className="diff-viewer" style={{ maxHeight }}>
        {renderFileHeader(filePath)}
        <div className="diff-content">
          {lines.map((line: string, i: number) => (
            <div key={`add-${i}`} className="diff-line added">
              <span className="diff-line-marker">+</span>
              <span className="diff-line-content">{line || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Fallback: show edit details in a simple format
  return (
    <div className="diff-viewer" style={{ maxHeight }}>
      {renderFileHeader(filePath)}
      <div className="diff-content">
        {edit.operation && (
          <div className="diff-line info">
            <span className="diff-line-marker">•</span>
            <span className="diff-line-content">Operation: {edit.operation}</span>
          </div>
        )}
        {edit.instruction && (
          <div className="diff-line info">
            <span className="diff-line-marker">•</span>
            <span className="diff-line-content">{edit.instruction}</span>
          </div>
        )}
      </div>
    </div>
  );
};
