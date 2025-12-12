/**
 * Custom Editor Types
 *
 * Defines the interface that all custom editors must implement
 * to integrate with the TabEditor system.
 */

import type { ConfigTheme } from 'rexical';

/**
 * Props that all custom editors receive from TabEditor
 */
export interface CustomEditorProps {
  // File identification
  filePath: string;
  fileName: string;

  // Initial content
  initialContent: string;

  // Editor state
  theme: ConfigTheme;
  isActive: boolean;

  // Workspace context
  workspaceId?: string;

  // Callbacks
  onContentChange?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;

  // Content access (for saving and AI integration)
  onGetContentReady?: (getContentFunction: () => string) => void;

  // Document actions
  onViewHistory?: () => void;
  onRenameDocument?: () => void;

  /**
   * Called when the file content changes externally (e.g., AI edited the file).
   * Custom editors should implement this to reload their content from the new value.
   */
  onReloadContent?: (callback: (newContent: string) => void) => void;
}

/**
 * Return type for custom editor components
 * Each custom editor is a React component that receives CustomEditorProps
 */
export type CustomEditorComponent = React.FC<CustomEditorProps>;

/**
 * Custom editor registration entry
 */
export interface CustomEditorRegistration {
  // File extensions this editor handles (e.g., ['.mockup.html'])
  extensions: string[];

  // The React component to render
  component: CustomEditorComponent;

  // Optional: Display name for debugging
  name?: string;

  // Optional: Whether this editor supports AI editing via EditorRegistry
  supportsAI?: boolean;
}
