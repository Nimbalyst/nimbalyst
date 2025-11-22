/**
 * Monaco Editor configuration for Electron
 *
 * Configures Monaco to use local workers instead of CDN
 * This must be called before any Monaco Editor component is rendered
 */

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Import Monaco CSS explicitly to ensure it's bundled locally
// This prevents 403 errors when dev server tries to serve CSS from wrong paths
import 'monaco-editor/min/vs/editor/editor.main.css';

// Import workers as URLs - Vite will handle bundling with ?worker suffix
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

/**
 * Initialize Monaco Editor for Electron environment
 * Configures local workers and sets up the Monaco environment
 */
export function initMonacoEditor(): void {
  console.log('[Monaco] Initializing Monaco Editor for Electron');

  // Configure Monaco to use the local npm package
  loader.config({ monaco });

  // Set up the worker environment using Vite's worker imports
  (self as any).MonacoEnvironment = {
    getWorker(_: any, label: string) {
      console.log('[Monaco] Creating worker for label:', label);

      switch (label) {
        case 'json':
          return new JsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker();
        case 'typescript':
        case 'javascript':
          return new TsWorker();
        default:
          return new EditorWorker();
      }
    }
  };

  console.log('[Monaco] Configuration complete');
}
