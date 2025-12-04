import { useMemo } from 'react';
import type { Tab } from './useTabs';

export interface DocumentContext {
  filePath: string;
  fileType: string;
  content: string;
  cursorPosition: undefined;
  selection: undefined;
  getLatestContent: (() => string) | undefined;
  mockupSelection?: {
    selector: string;
    outerHTML: string;
    tagName: string;
  };
  mockupDrawing?: string; // Data URL of drawing annotations
  mockupAnnotationTimestamp?: number | null; // Timestamp when annotations were created
}

interface UseDocumentContextProps {
  activeTab: Tab | null;
  getContentRef: React.MutableRefObject<(() => string) | null>;
}

/**
 * Detect file type from file path for AI context
 */
function detectFileType(filePath: string): string {
  if (!filePath) return 'unknown';

  const lowerPath = filePath.toLowerCase();

  // Check for compound extensions first (more specific)
  if (lowerPath.endsWith('.mockup.html')) return 'mockup';

  // Check single extensions
  const lastDot = lowerPath.lastIndexOf('.');
  if (lastDot === -1) return 'unknown';

  const ext = lowerPath.substring(lastDot);

  switch (ext) {
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.json':
      return 'json';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.js':
    case '.jsx':
    case '.ts':
    case '.tsx':
      return 'javascript';
    case '.html':
      return 'html';
    case '.css':
    case '.scss':
      return 'css';
    case '.py':
      return 'python';
    default:
      return 'code';
  }
}

/**
 * Custom hook for building document context object
 *
 * Consolidates the logic for creating document context that's used by:
 * - AIChat component
 * - AgenticPanel component
 * - AgentCommandPalette component
 *
 * Returns a memoized document context object based on the active tab
 */
export function useDocumentContext({ activeTab, getContentRef }: UseDocumentContextProps): DocumentContext {
  return useMemo(() => {
    if (!activeTab) {
      return {
        filePath: '',
        fileType: 'unknown',
        content: '',
        cursorPosition: undefined,
        selection: undefined,
        getLatestContent: undefined
      };
    }

    const fileType = detectFileType(activeTab.filePath || '');

    // Get mockup selection, drawing, and annotation timestamp if file is a mockup
    const mockupSelection = fileType === 'mockup'
      ? (window as any).__mockupSelectedElement
      : undefined;

    const mockupDrawing = fileType === 'mockup'
      ? (window as any).__mockupDrawing
      : undefined;

    const mockupAnnotationTimestamp = fileType === 'mockup'
      ? (window as any).__mockupAnnotationTimestamp
      : undefined;

    return {
      filePath: activeTab.filePath || '',
      fileType,
      content: getContentRef.current ? getContentRef.current() : '',
      cursorPosition: undefined, // TODO: Get from Lexical editor
      selection: undefined, // TODO: Get selected text from Lexical
      getLatestContent: getContentRef.current || undefined,
      mockupSelection,
      mockupDrawing,
      mockupAnnotationTimestamp
    };
  }, [activeTab, activeTab?.filePath, getContentRef.current]);
}
