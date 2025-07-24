/**
 * Stravu Editor - Main library entry point
 * 
 * A rich text editor built with Meta's Lexical framework, featuring markdown support,
 * tables, and comprehensive editing capabilities.
 */

// Import main CSS styles
import './index.css';

// Main editor components
export { StravuEditor, type StravuEditorProps } from './App';
export { default as Editor } from './Editor';

// Configuration
export { type EditorConfig, DEFAULT_EDITOR_CONFIG, type Theme as ConfigTheme } from './EditorConfig';

// File services
export { type FileService } from './FileService';

// Hooks
export { useFileOperations } from './hooks/useFileOperations';
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
