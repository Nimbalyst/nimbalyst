/**
 * PDF Viewer Editor
 *
 * Read-only viewer for PDF files.
 * Uses the EditorHost API for host communication.
 *
 * Note: PDFs are binary and read-only, so this viewer:
 * - Loads content via electronAPI.readFileContent (binary mode)
 * - Never marks as dirty
 * - Doesn't implement save functionality
 */

import { useState, useEffect, useCallback } from 'react';
import { usePDFDocument } from './hooks/usePDFDocument';
import { PDFScrollView } from './components/PDFScrollView';
import { Toolbar } from './components/Toolbar';

// Get React from host (needed for TypeScript)
const React = (window as any).__nimbalyst_extensions.react;

// Import EditorHostProps type from runtime
// Note: Extensions access runtime types via the host's exposed modules
interface EditorHost {
  readonly filePath: string;
  readonly fileName: string;
  readonly theme: 'light' | 'dark' | 'crystal-dark';
  readonly isActive: boolean;
  readonly workspaceId?: string;
  loadContent(): Promise<string>;
  loadBinaryContent(): Promise<ArrayBuffer>;
  onFileChanged(callback: (newContent: string) => void): () => void;
  setDirty(isDirty: boolean): void;
  saveContent(content: string | ArrayBuffer): Promise<void>;
  onSaveRequested(callback: () => void): () => void;
  openHistory(): void;
}

interface EditorHostProps {
  host: EditorHost;
}

export function PDFViewerEditor({ host }: EditorHostProps) {
  const { filePath, theme, isActive } = host;

  // Use the EditorHost's loadBinaryContent for cross-platform compatibility
  const { document, totalPages, loading, error } = usePDFDocument(
    host.loadBinaryContent.bind(host),
    filePath
  );
  const [scale, setScale] = useState(1.0);
  const [fitToWidth, setFitToWidth] = useState(true); // Start with fit-to-width enabled

  // PDFs are read-only - mark as never dirty
  useEffect(() => {
    host.setDirty(false);
  }, [host]);

  // Handle scale changes from user zoom actions
  const handleScaleChange = useCallback((newScale: number) => {
    setFitToWidth(false); // Disable fit-to-width when user manually zooms
    setScale(newScale);
  }, []);

  // Handle fit-to-width scale updates (from resize observer)
  const handleFitWidthScaleChange = useCallback((newScale: number) => {
    setScale(newScale);
  }, []);

  // Toggle fit-to-width mode
  const handleFitToWidthToggle = useCallback(() => {
    setFitToWidth((prev) => !prev);
    if (!fitToWidth) {
      // When enabling, the PDFScrollView will calculate the appropriate scale
    }
  }, [fitToWidth]);

  // Handle keyboard shortcuts for zoom
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setFitToWidth(false);
          const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
          const nextLevel = ZOOM_LEVELS.find((level) => level > scale);
          if (nextLevel) setScale(nextLevel);
        } else if (e.key === '-') {
          e.preventDefault();
          setFitToWidth(false);
          const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
          const prevLevel = [...ZOOM_LEVELS].reverse().find((level) => level < scale);
          if (prevLevel) setScale(prevLevel);
        } else if (e.key === '0') {
          e.preventDefault();
          setFitToWidth(true); // Cmd+0 enables fit-to-width
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
        fitToWidth={fitToWidth}
        onScaleChange={handleScaleChange}
        onFitToWidthToggle={handleFitToWidthToggle}
      />
      <PDFScrollView
        document={document}
        totalPages={totalPages}
        scale={scale}
        fitToWidth={fitToWidth}
        theme={theme}
        onFitWidthScaleChange={handleFitWidthScaleChange}
      />
    </div>
  );
}
