/**
 * Custom Editor Types
 *
 * All custom editors now use the EditorHost API from @nimbalyst/runtime.
 * This file re-exports the necessary types for backward compatibility.
 */

import type { ComponentType } from 'react';
import type { EditorHostProps } from '@nimbalyst/runtime';

// Re-export for use in custom editors
export type { EditorHostProps };

/**
 * Custom editor component type - accepts EditorHostProps
 */
export type CustomEditorComponent = ComponentType<EditorHostProps>;

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

  // Optional: Whether this editor supports source mode (viewing/editing raw content in Monaco)
  supportsSourceMode?: boolean;

  // Optional: Extension ID for error attribution (added automatically for extension-provided editors)
  extensionId?: string;

  // Optional: Component name for error attribution
  componentName?: string;
}
