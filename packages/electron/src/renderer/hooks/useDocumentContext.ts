import { useMemo } from 'react';
import type { Tab } from './useTabs';

export interface DocumentContext {
  filePath: string;
  fileType: string;
  content: string;
  cursorPosition: undefined;
  selection: undefined;
  getLatestContent: (() => string) | undefined;
}

interface UseDocumentContextProps {
  activeTab: Tab | null;
  getContentRef: React.MutableRefObject<(() => string) | null>;
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
        fileType: 'markdown',
        content: '',
        cursorPosition: undefined,
        selection: undefined,
        getLatestContent: undefined
      };
    }

    return {
      filePath: activeTab.filePath || '',
      fileType: 'markdown',
      content: getContentRef.current ? getContentRef.current() : '',
      cursorPosition: undefined, // TODO: Get from Lexical editor
      selection: undefined, // TODO: Get selected text from Lexical
      getLatestContent: getContentRef.current || undefined
    };
  }, [activeTab, activeTab?.filePath, getContentRef.current]);
}
