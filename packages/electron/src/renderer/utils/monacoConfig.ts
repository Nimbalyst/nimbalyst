/**
 * Monaco Editor configuration for Electron
 *
 * Configures Monaco to use local resources instead of CDN
 * Uses Vite's native worker support for web workers
 */

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Import workers using Vite's ?worker syntax
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker.js?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';

/**
 * Initialize Monaco Editor for Electron environment
 * Configures @monaco-editor/react to use the local npm package
 */
export function initMonacoEditor(): void {
  console.log('[Monaco] Initializing Monaco Editor for Electron');

  // Configure Monaco environment with worker factory
  // This uses Vite's native worker support instead of a plugin
  self.MonacoEnvironment = {
    getWorker(_: unknown, label: string) {
      if (label === 'json') {
        return new jsonWorker();
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker();
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker();
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    }
  };

  // Configure @monaco-editor/react to use the local npm package instead of CDN
  loader.config({ monaco });

  console.log('[Monaco] Configuration complete');
}
