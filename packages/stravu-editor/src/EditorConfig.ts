/**
 * Configuration interface for the Stravu Editor component.
 * This replaces the reactive settings system with static configuration props.
 */

export type Theme = 'light' | 'dark' | 'auto';


/**
 * Removed features that are either incomplete, or not appropriate for an editor targeting markdown compatibility
 *
 * - isAutocomplete: Not implemented as pluggable
 * - isMaxLength: Can be external
 * - isCharLimit: Can be external
 * - isCharLimitUtf8: Can be external
 *
 * - isCollab: Not supported yet in Stravu Editor (See Lexical Playground)
 *
 * - shouldUseLexicalContextMenu: Not implemented as pluggable (or that useful)
 *
 * - shouldAllowHighlightingWithBrackets: Just highlights content in brackets (e.g. [text]), not sure. Uses SpecialTextPlugin
 *
 *
 * Non markdown-safe table features
 * - tableCellBackgroundColor?: boolean;
 * - tableCellMerge?: boolean;
 *
 * Less sure about this one
 * - tableHorizontalScroll?: boolean;
 *
 *
 *
 *   // Not sure about these
 *   measureTypingPerf?: boolean;
 *   showNestedEditorTreeView?: boolean;
 */

export interface EditorConfig {

  // Core editor behavior
  isRichText?: boolean;

  // TODO: Do we need this? Think we either accept content or blank
  emptyEditor?: boolean;

  /** Open links in a new tab with rel="noopener noreferrer" */
  hasLinkAttributes?: boolean;

  /** Code highlighting enabled for blocks */
  isCodeHighlighted?: boolean;

  /** show selection even if editor is not focused */
  selectionAlwaysOnDisplay?: boolean;


  /** Should we always enable this? Seems appropriate */
  shouldPreserveNewLinesInMarkdown?: boolean;




  /** Show the hierarchical node tree view for debugging */
  showTreeView?: boolean;


  // Is this only for testing?
  disableBeforeInput?: boolean;


  /** Strict or relaxed indentation for lists */
  listStrictIndent?: boolean;

  // This goes away after we're done whittling down the config right?
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
  hasLinkAttributes: false,
  isCodeHighlighted: true,
  selectionAlwaysOnDisplay: false,
  shouldPreserveNewLinesInMarkdown: true,
  showTreeView: false,
  disableBeforeInput: false,
  listStrictIndent: false,
  markdownOnly: true,
  theme: 'auto',
};
