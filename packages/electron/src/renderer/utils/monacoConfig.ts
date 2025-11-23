/**
 * Monaco Editor configuration for Electron
 *
 * Configures Monaco to use local resources instead of CDN
 * The vite-plugin-monaco-editor handles worker bundling
 * This file configures @monaco-editor/react to use the local monaco instance
 */

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

/**
 * Initialize Monaco Editor for Electron environment
 * Configures @monaco-editor/react to use the local npm package
 */
export function initMonacoEditor(): void {
  console.log('[Monaco] Initializing Monaco Editor for Electron');

  // Configure @monaco-editor/react to use the local npm package instead of CDN
  // The vite-plugin-monaco-editor handles worker and CSS bundling
  loader.config({ monaco });

  console.log('[Monaco] Configuration complete');
}
