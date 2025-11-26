import { useMemo } from 'react';
import type { Tab } from './useTabs';

export interface DocumentContext {
  filePath: string;
  fileType: string;
  content: string;
  cursorPosition: undefined;
  selection: undefined;
  getLatestContent: (() => string) | undefined;
  wireframeSelection?: {
    selector: string;
    outerHTML: string;
    tagName: string;
  };
  wireframeDrawing?: string; // Data URL of drawing annotations
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
  if (lowerPath.endsWith('.wireframe.html')) return 'wireframe';

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

    // Get wireframe selection and drawing if file is a wireframe
    const wireframeSelection = fileType === 'wireframe'
      ? (window as any).__wireframeSelectedElement
      : undefined;

    const wireframeDrawing = fileType === 'wireframe'
      ? (window as any).__wireframeDrawing
      : undefined;

    return {
      filePath: activeTab.filePath || '',
      fileType,
      content: getContentRef.current ? getContentRef.current() : '',
      cursorPosition: undefined, // TODO: Get from Lexical editor
      selection: undefined, // TODO: Get selected text from Lexical
      getLatestContent: getContentRef.current || undefined,
      wireframeSelection,
      wireframeDrawing
    };
  }, [activeTab, activeTab?.filePath, getContentRef.current]);
}
