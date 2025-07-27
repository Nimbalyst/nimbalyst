/**
 * Configuration interface for the Stravu Editor component.
 * This replaces the reactive settings system with static configuration props.
 */

export type Theme = 'light' | 'dark' | 'auto';

export interface EditorConfig {
  // Core editor behavior
  isRichText?: boolean;
  emptyEditor?: boolean;

  // Features
  isAutocomplete?: boolean;
  hasLinkAttributes?: boolean;
  isCodeHighlighted?: boolean;
  showTableOfContents?: boolean;

  // Limits and validation
  isMaxLength?: boolean;
  isCharLimit?: boolean;
  isCharLimitUtf8?: boolean;

  // Collaboration
  isCollab?: boolean;

  // Context menu and selection
  shouldUseLexicalContextMenu?: boolean;
  selectionAlwaysOnDisplay?: boolean;

  // Markdown behavior
  shouldPreserveNewLinesInMarkdown?: boolean;
  shouldAllowHighlightingWithBrackets?: boolean;

  // Table features
  tableCellBackgroundColor?: boolean;
  tableCellMerge?: boolean;
  tableHorizontalScroll?: boolean;

  // Development and debugging (should be false in production)
  measureTypingPerf?: boolean;
  showTreeView?: boolean;
  showNestedEditorTreeView?: boolean;

  // Advanced
  disableBeforeInput?: boolean;
  listStrictIndent?: boolean;

  // Markdown-only mode - hides non-markdown native features
  markdownOnly?: boolean;

  // Theme configuration
  theme?: Theme; // Override theme: 'light' | 'dark' | 'auto' (default: 'auto')

  // Content callbacks
  onContentChange?: (content: string) => void;
  onGetContent?: (getContentFn: () => string) => void;
  onEditorReady?: (editor: any) => void;
  initialContent?: string; // Pre-loaded content to set in editor
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  isRichText: true,
  emptyEditor: false,
  isAutocomplete: false,
  hasLinkAttributes: false,
  isCodeHighlighted: true,
  showTableOfContents: false,
  isMaxLength: false,
  isCharLimit: false,
  isCharLimitUtf8: false,
  isCollab: false,
  shouldUseLexicalContextMenu: false,
  selectionAlwaysOnDisplay: false,
  shouldPreserveNewLinesInMarkdown: true,
  shouldAllowHighlightingWithBrackets: false,
  tableCellBackgroundColor: true,
  tableCellMerge: false,
  tableHorizontalScroll: true,
  measureTypingPerf: false,
  showTreeView: false,
  showNestedEditorTreeView: false,
  disableBeforeInput: false,
  listStrictIndent: false,
  markdownOnly: true,
  theme: 'auto',
};
