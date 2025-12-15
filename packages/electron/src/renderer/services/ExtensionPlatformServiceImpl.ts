/**
 * Electron implementation of ExtensionPlatformService.
 *
 * This implementation runs in the renderer process and uses IPC
 * to communicate with the main process for file operations.
 * Module loading uses dynamic import() with file:// URLs.
 */

import type { ExtensionPlatformService, ExtensionModule } from '@nimbalyst/runtime';

// Import host dependencies that will be shared with extensions
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as jsxRuntime from 'react/jsx-runtime';
import * as jsxDevRuntime from 'react/jsx-dev-runtime';
import * as zustand from 'zustand';
import html2canvas from 'html2canvas';

// Import Lexical packages for extensions that use Lexical nodes
import * as lexical from 'lexical';
import * as lexicalReact from '@lexical/react/LexicalComposerContext';
import * as lexicalReactEditable from '@lexical/react/useLexicalEditable';
import * as lexicalReactNodeSelection from '@lexical/react/useLexicalNodeSelection';
import * as lexicalUtils from '@lexical/utils';
import * as lexicalMarkdown from '@lexical/markdown';

// Import runtime UI components that extensions can use
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

// Import DataModel platform service for datamodellm extension
import { DataModelPlatformServiceImpl } from './DataModelPlatformServiceImpl';

export class ExtensionPlatformServiceImpl implements ExtensionPlatformService {
  private static instance: ExtensionPlatformServiceImpl | null = null;

  private constructor() {}

  public static getInstance(): ExtensionPlatformServiceImpl {
    if (!ExtensionPlatformServiceImpl.instance) {
      ExtensionPlatformServiceImpl.instance = new ExtensionPlatformServiceImpl();
    }
    return ExtensionPlatformServiceImpl.instance;
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
   * Extensions are bundled as ES modules with externals for React, Zustand, etc.
   * We load them by reading the JS content and creating a blob URL, after
   * transforming the external imports to use the host's dependencies.
   */
  async loadModule(modulePath: string): Promise<ExtensionModule> {
    try {
      console.log('[ExtensionPlatformService] Loading module:', modulePath);

      // Read the module source
      const source = await this.readFile(modulePath);
      console.log('[ExtensionPlatformService] Module source loaded, length:', source.length);

      // Ensure host dependencies are available globally
      this.exposeHostDependencies();

      // Transform the imports to use our provided modules
      const transformedSource = this.transformImports(source);

      // Create blob URL
      const blob = new Blob([transformedSource], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);

      try {
        // Dynamic import the blob URL
        console.log('[ExtensionPlatformService] Importing blob URL...');
        const module = await import(/* @vite-ignore */ blobUrl);
        console.log('[ExtensionPlatformService] Module loaded:', Object.keys(module));

        // Debug: Check for aiTools in module
        console.log('[ExtensionPlatformService] module.aiTools:', module.aiTools);
        console.log('[ExtensionPlatformService] module.default?.aiTools:', module.default?.aiTools);

        // Normalize to ExtensionModule interface
        const extensionModule: ExtensionModule = {
          activate: module.activate || module.default?.activate,
          deactivate: module.deactivate || module.default?.deactivate,
          components: module.components || module.default?.components || {},
          aiTools: module.aiTools || module.default?.aiTools || [],
          // Lexical integration
          nodes: module.nodes || module.default?.nodes || {},
          transformers: module.transformers || module.default?.transformers || {},
          hostComponents: module.hostComponents || module.default?.hostComponents || {},
          slashCommandHandlers: module.slashCommandHandlers || module.default?.slashCommandHandlers || {},
        };

        console.log('[ExtensionPlatformService] Extension module components:', Object.keys(extensionModule.components || {}));
        console.log('[ExtensionPlatformService] Extension module aiTools count:', extensionModule.aiTools?.length ?? 0);
        console.log('[ExtensionPlatformService] Extension module nodes:', Object.keys(extensionModule.nodes || {}));
        console.log('[ExtensionPlatformService] Extension module transformers:', Object.keys(extensionModule.transformers || {}));
        console.log('[ExtensionPlatformService] Extension module hostComponents:', Object.keys(extensionModule.hostComponents || {}));
        console.log('[ExtensionPlatformService] Extension module slashCommandHandlers:', Object.keys(extensionModule.slashCommandHandlers || {}));
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
   */
  private exposeHostDependencies(): void {
    const w = window as any;
    if (w.__nimbalyst_extensions) return;

    // Use the imported modules from the top of this file
    w.__nimbalyst_extensions = {
      react: React,
      'react-dom': ReactDOM,
      'react/jsx-runtime': jsxRuntime,
      'react/jsx-dev-runtime': jsxDevRuntime,
      zustand: zustand,
      html2canvas: html2canvas,
      // Lexical packages
      lexical: lexical,
      '@lexical/react/LexicalComposerContext': lexicalReact,
      '@lexical/react/useLexicalEditable': lexicalReactEditable,
      '@lexical/react/useLexicalNodeSelection': lexicalReactNodeSelection,
      '@lexical/utils': lexicalUtils,
      '@lexical/markdown': lexicalMarkdown,
      // Runtime UI components
      '@nimbalyst/runtime/ui/icons/MaterialSymbol': { MaterialSymbol },
      // Extension-specific services
      '@nimbalyst/datamodel-platform-service': {
        DataModelPlatformServiceImpl,
        getInstance: () => DataModelPlatformServiceImpl.getInstance(),
      },
    };

    console.log('[ExtensionPlatformService] Host dependencies exposed');
  }

  /**
   * Transform ES module imports to use the host's dependencies.
   * This is necessary because blob URLs can't resolve bare module imports.
   */
  private transformImports(source: string): string {
    // The extension is bundled with externals, so it has imports like:
    // import React, { useState, useEffect } from 'react'
    // import { create } from 'zustand'
    //
    // We transform these to use the globally exposed dependencies.

    let transformed = source;

    // Helper to convert "X as Y" to "X: Y" for destructuring
    // ES import syntax uses "as", but destructuring uses ":"
    // Note: JavaScript identifiers can include $ and _, so we use a broader pattern
    const convertAsToColon = (imports: string): string => {
      return imports.replace(/([\w$]+)\s+as\s+([\w$]+)/g, '$1: $2');
    };

    // Handle: import defaultExport, { named1, named2 as alias } from 'react'
    // This is the most complex pattern - default + named imports
    transformed = transformed.replace(
      /import\s+(\w+)\s*,\s*{([^}]+)}\s+from\s+['"]react['"]/g,
      (_match, defaultExport, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const ${defaultExport} = window.__nimbalyst_extensions.react; const {${converted}} = window.__nimbalyst_extensions.react`;
      }
    );

    // Handle: import defaultExport from 'react'
    transformed = transformed.replace(
      /import\s+(\w+)\s+from\s+['"]react['"]/g,
      'const $1 = window.__nimbalyst_extensions.react'
    );

    // Handle: import * as X from 'react'
    transformed = transformed.replace(
      /import\s+\*\s+as\s+(\w+)\s+from\s+['"]react['"]/g,
      'const $1 = window.__nimbalyst_extensions.react'
    );

    // Handle: import { X, Y as Z } from 'react'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]react['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions.react`;
      }
    );

    // Handle: import 'react-dom' (side-effect only)
    transformed = transformed.replace(
      /import\s+['"]react-dom['"]\s*;?/g,
      '/* react-dom side effect import removed */'
    );

    // Handle: import X from 'react-dom'
    transformed = transformed.replace(
      /import\s+(\w+)\s+from\s+['"]react-dom['"]/g,
      'const $1 = window.__nimbalyst_extensions["react-dom"]'
    );

    // Handle: import { X as Y } from 'react-dom'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]react-dom['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions["react-dom"]`;
      }
    );

    // Handle: import { X as Y } from 'react/jsx-runtime'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]react\/jsx-runtime['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions["react/jsx-runtime"]`;
      }
    );

    // Handle: import { X as Y } from 'react/jsx-dev-runtime'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]react\/jsx-dev-runtime['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions["react/jsx-dev-runtime"]`;
      }
    );

    // Handle: import X from 'zustand'
    transformed = transformed.replace(
      /import\s+(\w+)\s+from\s+['"]zustand['"]/g,
      'const $1 = window.__nimbalyst_extensions.zustand'
    );

    // Handle: import { X as Y } from 'zustand'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]zustand['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions.zustand`;
      }
    );

    // Handle: import html2canvas from 'html2canvas'
    transformed = transformed.replace(
      /import\s+(\w+)\s+from\s+['"]html2canvas['"]/g,
      'const $1 = window.__nimbalyst_extensions.html2canvas'
    );

    // Handle: import { X } from 'html2canvas'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]html2canvas['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions.html2canvas`;
      }
    );

    // Handle: import { X } from 'lexical'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]lexical['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions.lexical`;
      }
    );

    // Handle: import * as X from 'lexical'
    transformed = transformed.replace(
      /import\s+\*\s+as\s+(\w+)\s+from\s+['"]lexical['"]/g,
      'const $1 = window.__nimbalyst_extensions.lexical'
    );

    // Handle: import { X } from '@lexical/react/LexicalComposerContext'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]@lexical\/react\/LexicalComposerContext['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions["@lexical/react/LexicalComposerContext"]`;
      }
    );

    // Handle: import { X } from '@lexical/react/useLexicalEditable'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]@lexical\/react\/useLexicalEditable['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions["@lexical/react/useLexicalEditable"]`;
      }
    );

    // Handle: import { X } from '@lexical/react/useLexicalNodeSelection'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]@lexical\/react\/useLexicalNodeSelection['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions["@lexical/react/useLexicalNodeSelection"]`;
      }
    );

    // Handle: import { X } from '@lexical/utils'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]@lexical\/utils['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions["@lexical/utils"]`;
      }
    );

    // Handle: import { X } from '@lexical/markdown'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]@lexical\/markdown['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions["@lexical/markdown"]`;
      }
    );

    // Handle: import type { X } from 'lexical' - remove type-only imports
    transformed = transformed.replace(
      /import\s+type\s+{[^}]+}\s+from\s+['"]lexical['"]\s*;?/g,
      '/* type import removed */'
    );

    // Handle: import type { X } from '@lexical/*' - remove type-only imports
    transformed = transformed.replace(
      /import\s+type\s+{[^}]+}\s+from\s+['"]@lexical\/[^'"]+['"]\s*;?/g,
      '/* type import removed */'
    );

    // Handle: import { X } from '@nimbalyst/runtime/ui/icons/MaterialSymbol'
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"]@nimbalyst\/runtime\/ui\/icons\/MaterialSymbol['"]/g,
      (_match, namedImports) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions["@nimbalyst/runtime/ui/icons/MaterialSymbol"]`;
      }
    );

    // Generic handler for any @nimbalyst/runtime/* imports
    // This catches any other runtime imports we might add in the future
    transformed = transformed.replace(
      /import\s+{([^}]+)}\s+from\s+['"](@nimbalyst\/runtime[^'"]+)['"]/g,
      (_match, namedImports, modulePath) => {
        const converted = convertAsToColon(namedImports);
        return `const {${converted}} = window.__nimbalyst_extensions["${modulePath}"]`;
      }
    );

    return transformed;
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
}
