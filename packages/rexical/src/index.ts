/**
 * Stravu Editor - Main library entry point
 * 
 * A rich text editor built with Meta's Lexical framework, featuring markdown support,
 * tables, and comprehensive editing capabilities.
 */

// Import main CSS styles
import './index.css';

// Main editor components
export { StravuEditor, type StravuEditorProps } from './StravuEditor';
export { default as Editor } from './Editor';

// Configuration
export { type EditorConfig, DEFAULT_EDITOR_CONFIG, type Theme as ConfigTheme } from './EditorConfig';

// Hooks
export { useFlashMessage } from './hooks/useFlashMessage';
export { useModal } from './hooks/useModal';

// Context providers - for advanced usage
export { ThemeProvider, useTheme, type Theme, type ThemeConfig } from './context/ThemeContext';
export { FlashMessageContext } from './context/FlashMessageContext';
export { SharedHistoryContext } from './context/SharedHistoryContext';
export { TableContext } from './plugins/TablePlugin';
export { ToolbarContext } from './context/ToolbarContext';

// Themes
export { default as PlaygroundEditorTheme } from './themes/PlaygroundEditorTheme';

// Node types - for advanced customization
export { default as EditorNodes } from './nodes/EditorNodes';

// Re-export key Lexical types that consumers might need
export type {
  LexicalEditor,
  EditorState,
  LexicalNode,
  ElementNode,
  TextNode,
} from 'lexical';

export type {
  InitialConfigType,
} from '@lexical/react/LexicalComposer';

// Export search/replace commands
export {
  TOGGLE_SEARCH_COMMAND,
  CLOSE_SEARCH_COMMAND,
  SEARCH_COMMAND,
  REPLACE_COMMAND,
  REPLACE_ALL_COMMAND,
  NEXT_MATCH_COMMAND,
  PREVIOUS_MATCH_COMMAND,
} from './plugins/SearchReplacePlugin';

// Plugin system exports
export type { PluginPackage } from './types/PluginTypes';
export { pluginRegistry } from './plugins/PluginRegistry';
export { PluginManager } from './plugins/PluginManager';

// Markdown utilities
export { 
  MarkdownStreamProcessor, 
  createHeadlessEditorFromEditor, 
  markdownToJSONSync,
  type InsertMode,
  MARKDOWN_TRANSFORMERS,
  getEditorTransformers
} from './markdown';

// Diff plugin and hook
export { DiffPlugin, useDiffCommands, APPLY_MARKDOWN_REPLACE_COMMAND } from './plugins/DiffPlugin';

// Diff utilities (now from local plugin)
export {
  applyMarkdownReplace,
  $approveDiffs,
  $rejectDiffs,
  $hasDiffNodes,
  APPROVE_DIFF_COMMAND,
  REJECT_DIFF_COMMAND,
  type TextReplacement
} from './plugins/DiffPlugin/core/exports';

// AI Chat integration
export { aiChatBridge } from './plugins/AIChatIntegrationPlugin';

// Anchor context for floating UI consumers
export { AnchorProvider, AnchorContext, useAnchorElem } from './context/AnchorContext';

// Typeahead components
export { TypeaheadMenuPlugin } from './plugins/TypeaheadPlugin/TypeaheadMenuPlugin';
