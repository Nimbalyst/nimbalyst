import { useState, useEffect } from 'react';
import { usePDFDocument } from './hooks/usePDFDocument';
import { PDFScrollView } from './components/PDFScrollView';
import { Toolbar } from './components/Toolbar';

// Get React from host (needed for TypeScript)
const React = (window as any).__nimbalyst_extensions.react;

export interface CustomEditorComponentProps {
  filePath: string;
  fileName: string;
  initialContent: string;
  theme: 'light' | 'dark' | 'crystal-dark';
  isActive: boolean;
  workspaceId?: string;
  onContentChange?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  onGetContentReady?: (getContentFn: () => string) => void;
  onViewHistory?: () => void;
  onRenameDocument?: () => void;
}

export function PDFViewerEditor(props: CustomEditorComponentProps) {
  const {
    filePath,
    theme,
    isActive,
    onGetContentReady,
    onDirtyChange,
  } = props;

  const { document, totalPages, loading, error } = usePDFDocument(filePath);
  const [scale, setScale] = useState(1.0);

  // PDFs are read-only, so content never changes
  useEffect(() => {
    if (onGetContentReady) {
      onGetContentReady(() => ''); // No content to save
    }
    if (onDirtyChange) {
      onDirtyChange(false); // Never dirty
    }
  }, [onGetContentReady, onDirtyChange]);

  // Handle keyboard shortcuts for zoom
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
          const nextLevel = ZOOM_LEVELS.find((level) => level > scale);
          if (nextLevel) setScale(nextLevel);
        } else if (e.key === '-') {
          e.preventDefault();
          const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
          const prevLevel = [...ZOOM_LEVELS].reverse().find((level) => level < scale);
          if (prevLevel) setScale(prevLevel);
        } else if (e.key === '0') {
          e.preventDefault();
          setScale(1.0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, scale]);

  if (loading) {
    return (
      <div className={`pdf-viewer-editor pdf-viewer-loading theme-${theme}`}>
        <div className="pdf-loading-message">Loading PDF...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`pdf-viewer-editor pdf-viewer-error theme-${theme}`}>
        <div className="pdf-error-message">
          <h3>Error loading PDF</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`pdf-viewer-editor theme-${theme}`}>
      <Toolbar
        totalPages={totalPages}
        scale={scale}
        onScaleChange={setScale}
      />
      <PDFScrollView
        document={document}
        totalPages={totalPages}
        scale={scale}
        theme={theme}
      />
    </div>
  );
}
