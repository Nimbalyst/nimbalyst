/**
 * Electron implementation of ExtensionPlatformService.
 *
 * This implementation runs in the renderer process and uses IPC
 * to communicate with the main process for file operations.
 *
 * Module loading uses es-module-shims with import maps to resolve bare
 * specifiers (like 'react') to the host's bundled dependencies. This is
 * more robust than regex-based transformation of minified code.
 */

import type { ExtensionPlatformService, ExtensionModule } from '@nimbalyst/runtime';

// Import host dependencies that will be shared with extensions
// ONLY React and Lexical need to be shared (singleton requirements)
// Extensions should bundle their own utility libraries (zustand, html2canvas, etc.)
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';
import * as jsxDevRuntime from 'react/jsx-dev-runtime';

// PDF.js and virtua are shared for the pdf-viewer extension
import * as pdfjsLib from 'pdfjs-dist';
import * as virtua from 'virtua';

// Import Lexical packages for extensions that use Lexical nodes
import * as lexical from 'lexical';
import * as lexicalReact from '@lexical/react/LexicalComposerContext';
import * as lexicalReactEditable from '@lexical/react/useLexicalEditable';
import * as lexicalReactNodeSelection from '@lexical/react/useLexicalNodeSelection';
import * as lexicalUtils from '@lexical/utils';
import * as lexicalMarkdown from '@lexical/markdown';

// Import runtime UI components that extensions can use
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

// Import screenshot service and document path context from runtime
import { screenshotService, useDocumentPath } from '@nimbalyst/runtime';

// Import DataModel platform service for datamodellm extension
import { DataModelPlatformServiceImpl } from './DataModelPlatformServiceImpl';

// Declare importShim global from es-module-shims
declare global {
  function importShim(specifier: string): Promise<any>;
  namespace importShim {
    function addImportMap(map: { imports: Record<string, string> }): void;
  }
}

export class ExtensionPlatformServiceImpl implements ExtensionPlatformService {
  private static instance: ExtensionPlatformServiceImpl | null = null;
  private importMapInitialized = false;

  private constructor() {}

  public static getInstance(): ExtensionPlatformServiceImpl {
    if (!ExtensionPlatformServiceImpl.instance) {
      ExtensionPlatformServiceImpl.instance = new ExtensionPlatformServiceImpl();
    }
    return ExtensionPlatformServiceImpl.instance;
  }

  /**
   * Initialize the import map for extension loading.
   *
   * This creates blob URLs for each host dependency and registers them
   * in an import map so that extensions can use bare specifiers like
   * `import React from 'react'` without any build-time or runtime transformation.
   */
  private initializeImportMap(): void {
    if (this.importMapInitialized) return;

    // Create wrapper modules that re-export from window.__nimbalyst_extensions
    // We still use the window object as the source of truth, but now extensions
    // can import using standard ES module syntax
    this.exposeHostDependencies();

    const imports: Record<string, string> = {};

    // Helper to create a blob URL for a module that re-exports from window
    const createModuleUrl = (key: string, moduleExports: any): string => {
      // Generate export statements for all properties
      const exportNames = Object.keys(moduleExports).filter(
        (name) => name !== 'default' && name !== '__esModule'
      );

      const code = `
// Host dependency: ${key}
const __mod = window.__nimbalyst_extensions["${key}"];
export default __mod;
${exportNames.map((name) => `export const ${name} = __mod?.${name};`).join('\n')}
`;
      const blob = new Blob([code], { type: 'application/javascript' });
      return URL.createObjectURL(blob);
    };

    // Get the shimmed jsx-dev-runtime (created in exposeHostDependencies)
    const w = window as any;
    const deps = w.__nimbalyst_extensions;

    // Register all host dependencies
    imports['react'] = createModuleUrl('react', deps.react);
    imports['react-dom'] = createModuleUrl('react-dom', deps['react-dom']);
    imports['react-dom/client'] = createModuleUrl('react-dom/client', deps['react-dom/client']);
    imports['react/jsx-runtime'] = createModuleUrl('react/jsx-runtime', deps['react/jsx-runtime']);
    imports['react/jsx-dev-runtime'] = createModuleUrl('react/jsx-dev-runtime', deps['react/jsx-dev-runtime']);

    imports['lexical'] = createModuleUrl('lexical', deps.lexical);
    imports['@lexical/react/LexicalComposerContext'] = createModuleUrl(
      '@lexical/react/LexicalComposerContext',
      deps['@lexical/react/LexicalComposerContext']
    );
    imports['@lexical/react/useLexicalEditable'] = createModuleUrl(
      '@lexical/react/useLexicalEditable',
      deps['@lexical/react/useLexicalEditable']
    );
    imports['@lexical/react/useLexicalNodeSelection'] = createModuleUrl(
      '@lexical/react/useLexicalNodeSelection',
      deps['@lexical/react/useLexicalNodeSelection']
    );
    imports['@lexical/utils'] = createModuleUrl('@lexical/utils', deps['@lexical/utils']);
    imports['@lexical/markdown'] = createModuleUrl('@lexical/markdown', deps['@lexical/markdown']);

    imports['pdfjs-dist'] = createModuleUrl('pdfjs-dist', deps['pdfjs-dist']);
    imports['virtua'] = createModuleUrl('virtua', deps.virtua);

    imports['@nimbalyst/editor-context'] = createModuleUrl(
      '@nimbalyst/editor-context',
      deps['@nimbalyst/editor-context']
    );
    imports['@nimbalyst/runtime/ui/icons/MaterialSymbol'] = createModuleUrl(
      '@nimbalyst/runtime/ui/icons/MaterialSymbol',
      deps['@nimbalyst/runtime/ui/icons/MaterialSymbol']
    );
    imports['@nimbalyst/screenshot-service'] = createModuleUrl(
      '@nimbalyst/screenshot-service',
      deps['@nimbalyst/screenshot-service']
    );
    imports['@nimbalyst/datamodel-platform-service'] = createModuleUrl(
      '@nimbalyst/datamodel-platform-service',
      deps['@nimbalyst/datamodel-platform-service']
    );

    // Register the import map with es-module-shims
    importShim.addImportMap({ imports });

    console.log('[ExtensionPlatformService] Import map initialized with', Object.keys(imports).length, 'entries');
    this.importMapInitialized = true;
  }

  /**
   * Get the directory where user extensions are installed.
   */
  async getExtensionsDirectory(): Promise<string> {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      throw new Error('electronAPI not available');
    }

    return electronAPI.invoke('extensions:get-directory');
  }

  /**
   * Get all extension directories (user extensions + built-in extensions).
   */
  async getAllExtensionsDirectories(): Promise<string[]> {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      throw new Error('electronAPI not available');
    }

    return electronAPI.invoke('extensions:get-all-directories');
  }

  /**
   * List all subdirectories in a directory.
   */
  async listDirectories(dirPath: string): Promise<string[]> {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      throw new Error('electronAPI not available');
    }

    return electronAPI.invoke('extensions:list-directories', dirPath);
  }

  /**
   * Read a file as text.
   */
  async readFile(filePath: string): Promise<string> {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      throw new Error('electronAPI not available');
    }

    return electronAPI.invoke('extensions:read-file', filePath);
  }

  /**
   * Write content to a file.
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      throw new Error('electronAPI not available');
    }

    return electronAPI.invoke('extensions:write-file', filePath, content);
  }

  /**
   * Check if a file exists.
   */
  async fileExists(filePath: string): Promise<boolean> {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      return false;
    }

    return electronAPI.invoke('extensions:file-exists', filePath);
  }

  /**
   * Load a JavaScript module from the given path.
   *
   * Extensions are bundled as ES modules with externals for React, Lexical, etc.
   * We use es-module-shims with an import map to resolve bare specifiers.
   * This is more robust than regex-based transformation of minified code.
   */
  async loadModule(modulePath: string): Promise<ExtensionModule> {
    try {
      console.log('[ExtensionPlatformService] Loading module:', modulePath);

      // Initialize import map on first load
      this.initializeImportMap();

      // Read the module source
      const source = await this.readFile(modulePath);

      // Create blob URL - NO transformation needed!
      // The import map handles bare specifier resolution
      const blob = new Blob([source], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);

      try {
        // Use importShim which respects our import map
        const module = await importShim(blobUrl);

        // Normalize to ExtensionModule interface
        const extensionModule: ExtensionModule = {
          activate: module.activate || module.default?.activate,
          deactivate: module.deactivate || module.default?.deactivate,
          components: module.components || module.default?.components || {},
          aiTools: module.aiTools || module.default?.aiTools || [],
          nodes: module.nodes || module.default?.nodes || {},
          transformers: module.transformers || module.default?.transformers || {},
          hostComponents: module.hostComponents || module.default?.hostComponents || {},
          slashCommandHandlers: module.slashCommandHandlers || module.default?.slashCommandHandlers || {},
        };

        return extensionModule;
      } finally {
        // Clean up blob URL
        URL.revokeObjectURL(blobUrl);
      }
    } catch (error) {
      console.error('[ExtensionPlatformService] Failed to load module:', error);
      throw new Error(
        `Failed to load extension module from ${modulePath}: ${error}`
      );
    }
  }

  /**
   * Expose host dependencies on the window object for extensions to use.
   *
   * IMPORTANT: Only React and Lexical are shared (singleton requirements).
   * Extensions should bundle their own utility libraries (zustand, html2canvas, etc.)
   */
  private exposeHostDependencies(): void {
    const w = window as any;
    if (w.__nimbalyst_extensions) return;

    // Create a shimmed jsx-dev-runtime that works even in production builds
    // This handles the case where an extension was built in dev mode but the host is in prod mode
    // jsxDEV signature: (type, props, key, isStaticChildren, source, self)
    // jsx signature: (type, props, key)
    // The extra dev params (isStaticChildren, source, self) are only for dev warnings, safe to ignore
    const shimmedJsxDevRuntime = {
      ...jsxDevRuntime,
      // If jsxDEV is undefined (production build), shim it with jsx
      jsxDEV:
        jsxDevRuntime.jsxDEV ??
        ((
          type: any,
          props: any,
          key: any,
          _isStaticChildren?: boolean,
          _source?: any,
          _self?: any
        ) => {
          return jsxRuntime.jsx(type, props, key);
        }),
    };

    // Use the imported modules from the top of this file
    // IMPORTANT: Use namespace imports (* as) to prevent tree-shaking in production builds
    w.__nimbalyst_extensions = {
      // React core - multiple instances break hooks
      react: React,
      'react-dom': ReactDOM,
      'react-dom/client': ReactDOMClient,
      'react/jsx-runtime': jsxRuntime,
      'react/jsx-dev-runtime': shimmedJsxDevRuntime,
      // Lexical - extensions contribute nodes to host's editor
      lexical: lexical,
      '@lexical/react/LexicalComposerContext': lexicalReact,
      '@lexical/react/useLexicalEditable': lexicalReactEditable,
      '@lexical/react/useLexicalNodeSelection': lexicalReactNodeSelection,
      '@lexical/utils': lexicalUtils,
      '@lexical/markdown': lexicalMarkdown,
      // PDF.js and virtua for pdf-viewer extension
      // These are accessed directly from __nimbalyst_extensions rather than ES imports
      'pdfjs-dist': pdfjsLib,
      virtua: virtua,
      // Document path context for extensions
      '@nimbalyst/editor-context': { useDocumentPath },
      // Runtime UI components
      '@nimbalyst/runtime/ui/icons/MaterialSymbol': { MaterialSymbol },
      // Core services for extensions
      '@nimbalyst/screenshot-service': {
        screenshotService,
      },
      // Extension-specific services
      '@nimbalyst/datamodel-platform-service': {
        DataModelPlatformServiceImpl,
        getInstance: () => DataModelPlatformServiceImpl.getInstance(),
      },
    };

    console.log('[ExtensionPlatformService] Host dependencies exposed');
  }

  /**
   * Inject CSS styles into the document.
   */
  injectStyles(css: string): () => void {
    const style = document.createElement('style');
    style.setAttribute('data-extension-styles', 'true');
    style.textContent = css;
    document.head.appendChild(style);

    // Return a function to remove the styles
    return () => {
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    };
  }

  /**
   * Resolve a relative path from an extension's root.
   */
  resolvePath(extensionPath: string, relativePath: string): string {
    // Simple path resolution - this should work for both Unix and Windows
    // by letting the main process handle the actual path resolution
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      // Fallback: simple concatenation
      const separator = extensionPath.includes('\\') ? '\\' : '/';
      return `${extensionPath}${separator}${relativePath}`;
    }

    // Use IPC for proper path resolution
    // This is synchronous in the sense that we're building the path,
    // but we need to make it async for IPC
    // For now, use simple string concatenation which works for most cases
    const separator = extensionPath.includes('\\') ? '\\' : '/';
    return `${extensionPath}${separator}${relativePath}`;
  }

  /**
   * Get files matching a glob pattern in a directory.
   */
  async findFiles(dirPath: string, pattern: string): Promise<string[]> {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      return [];
    }

    return electronAPI.invoke('extensions:find-files', dirPath, pattern);
  }

  /**
   * Check if an extension should be visible based on its required release channel.
   * Extensions with requiredReleaseChannel: 'alpha' are only visible to alpha users.
   */
  async isExtensionVisibleForChannel(requiredChannel: string | undefined): Promise<boolean> {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) {
      // If we can't check, default to visible (fail open)
      return true;
    }

    return electronAPI.invoke('extensions:is-visible-for-channel', requiredChannel);
  }
}
