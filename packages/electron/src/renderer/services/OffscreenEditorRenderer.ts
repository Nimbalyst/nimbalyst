/**
 * Offscreen Editor Renderer
 *
 * Manages offscreen editor instances in the renderer process.
 * Creates hidden DOM containers and mounts React editors without visible UI.
 * Editors register their APIs in the same registry used by visible editors.
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EditorHost } from '@nimbalyst/runtime';
import { getExtensionLoader } from '@nimbalyst/runtime';

interface OffscreenEditorInstance {
  filePath: string;
  container: HTMLDivElement;
  root: Root;
  host: EditorHost;
}

class OffscreenEditorRendererImpl {
  private editors = new Map<string, OffscreenEditorInstance>();
  private hiddenContainer: HTMLDivElement | null = null;

  /**
   * Initialize the hidden container for offscreen editors.
   */
  public initialize(): void {
    if (this.hiddenContainer) return;

    // Create hidden container for all offscreen editors
    this.hiddenContainer = document.createElement('div');
    this.hiddenContainer.id = 'offscreen-editors';
    this.hiddenContainer.style.position = 'absolute';
    this.hiddenContainer.style.left = '-9999px';
    this.hiddenContainer.style.top = '-9999px';
    this.hiddenContainer.style.width = '1280px'; // Reasonable size for screenshots
    this.hiddenContainer.style.height = '800px';
    this.hiddenContainer.style.visibility = 'hidden';
    this.hiddenContainer.style.pointerEvents = 'none';

    document.body.appendChild(this.hiddenContainer);

    console.log('[OffscreenEditorRenderer] Initialized');
  }

  /**
   * Mount an editor offscreen for a file.
   */
  public async mountEditor(filePath: string, workspacePath: string): Promise<void> {
    console.log('[OffscreenEditorRenderer] Mounting editor for', filePath);

    if (!this.hiddenContainer) {
      this.initialize();
    }

    // Check if already mounted offscreen
    if (this.editors.has(filePath)) {
      console.log('[OffscreenEditorRenderer] Already mounted offscreen');
      return;
    }

    // Check if a visible editor already has this file open by checking the extension's registry
    // Extensions expose their editor API on window for this purpose
    // For Excalidraw: window.__excalidraw_getEditorAPI(filePath)
    if (filePath.endsWith('.excalidraw')) {
      const getAPI = (window as any).__excalidraw_getEditorAPI;
      if (getAPI && getAPI(filePath)) {
        console.log('[OffscreenEditorRenderer] Visible editor already open, skipping offscreen mount');
        return;
      }
    }

    // Find extension that handles this file
    const extensionLoader = getExtensionLoader();

    // Extract file extension (including multi-part extensions like .mockup.html)
    const fileName = filePath.split('/').pop() || filePath;
    const firstDotIndex = fileName.indexOf('.');
    const fileExtension = firstDotIndex >= 0 ? fileName.slice(firstDotIndex) : '';

    if (!fileExtension) {
      throw new Error(`File has no extension: ${filePath}`);
    }

    // Use the extension loader's built-in method to find the editor
    const editorInfo = extensionLoader.findEditorForExtension(fileExtension);

    if (!editorInfo) {
      throw new Error(`No custom editor registered for ${filePath} (extension: ${fileExtension})`);
    }

    // Create container for this editor
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    this.hiddenContainer!.appendChild(container);

    // Create EditorHost for offscreen editor
    const host = this.createEditorHost(filePath, workspacePath);

    // Create React root and mount editor
    const root = createRoot(container);

    const EditorComponent = editorInfo.component as React.ComponentType<{ host: EditorHost }>;
    root.render(
      React.createElement(EditorComponent, { host })
    );

    // Store instance
    this.editors.set(filePath, {
      filePath,
      container,
      root,
      host,
    });

    console.log('[OffscreenEditorRenderer] Editor mounted for', filePath);
  }

  /**
   * Unmount an offscreen editor.
   */
  public unmountEditor(filePath: string): void {
    console.log('[OffscreenEditorRenderer] Unmounting editor for', filePath);

    const instance = this.editors.get(filePath);
    if (!instance) {
      console.warn('[OffscreenEditorRenderer] No editor to unmount for', filePath);
      return;
    }

    // Unmount React
    instance.root.unmount();

    // Remove container
    if (instance.container.parentNode) {
      instance.container.parentNode.removeChild(instance.container);
    }

    this.editors.delete(filePath);

    console.log('[OffscreenEditorRenderer] Editor unmounted for', filePath);
  }

  /**
   * Create EditorHost implementation for offscreen editor.
   */
  private createEditorHost(filePath: string, workspacePath: string): EditorHost {
    const fileName = filePath.split('/').pop() || filePath;
    const electronAPI = (window as any).electronAPI;

    // File change subscribers
    const fileChangeCallbacks: Array<(content: string) => void> = [];
    const saveRequestCallbacks: Array<() => void> = [];
    const themeChangeCallbacks: Array<(theme: 'light' | 'dark' | 'crystal-dark') => void> = [];

    // Dirty state
    let isDirty = false;

    const host: EditorHost = {
      filePath,
      fileName,
      theme: 'light', // TODO: Get from app settings
      isActive: false, // Offscreen editors are never "active"

      async loadContent(): Promise<string> {
        const result = await electronAPI.readFileContent(filePath);
        if (!result || !result.success) {
          throw new Error(result?.error || 'Failed to load file');
        }
        return result.content || '';
      },

      async loadBinaryContent(): Promise<ArrayBuffer> {
        const result = await electronAPI.readFileContent(filePath, { binary: true });
        if (!result || !result.success) {
          throw new Error(result?.error || 'Failed to load file');
        }
        return result.content;
      },

      onFileChanged(callback: (newContent: string) => void): () => void {
        fileChangeCallbacks.push(callback);
        return () => {
          const index = fileChangeCallbacks.indexOf(callback);
          if (index >= 0) {
            fileChangeCallbacks.splice(index, 1);
          }
        };
      },

      setDirty(dirty: boolean): void {
        isDirty = dirty;
      },

      async saveContent(content: string | ArrayBuffer): Promise<void> {
        if (typeof content === 'string') {
          await electronAPI.saveFile(content, filePath);
        } else {
          throw new Error('Binary content saving not yet implemented for offscreen editors');
        }

        isDirty = false;
      },

      onSaveRequested(callback: () => void): () => void {
        saveRequestCallbacks.push(callback);
        return () => {
          const index = saveRequestCallbacks.indexOf(callback);
          if (index >= 0) {
            saveRequestCallbacks.splice(index, 1);
          }
        };
      },

      openHistory(): void {
        console.log('[OffscreenEditorRenderer] openHistory not implemented for offscreen editors');
      },

      onThemeChanged(callback: (theme: 'light' | 'dark' | 'crystal-dark') => void): () => void {
        themeChangeCallbacks.push(callback);
        return () => {
          const index = themeChangeCallbacks.indexOf(callback);
          if (index >= 0) {
            themeChangeCallbacks.splice(index, 1);
          }
        };
      },

      storage: {
        get<T>(key: string): T | undefined {
          // TODO: Implement extension storage
          return undefined;
        },
        async set<T>(key: string, value: T): Promise<void> {
          // TODO: Implement extension storage
        },
        async delete(key: string): Promise<void> {
          // TODO: Implement extension storage
        },
        getGlobal<T>(key: string): T | undefined {
          // TODO: Implement extension storage
          return undefined;
        },
        async setGlobal<T>(key: string, value: T): Promise<void> {
          // TODO: Implement extension storage
        },
        async deleteGlobal(key: string): Promise<void> {
          // TODO: Implement extension storage
        },
        async getSecret(key: string): Promise<string | undefined> {
          // TODO: Implement extension storage
          return undefined;
        },
        async setSecret(key: string, value: string): Promise<void> {
          // TODO: Implement extension storage
        },
        async deleteSecret(key: string): Promise<void> {
          // TODO: Implement extension storage
        },
      },

      registerMenuItems(): void {
        // No menu items for offscreen editors
      },
    };

    return host;
  }

  /**
   * Capture screenshot from an offscreen editor.
   * Handles iframe-based editors (mockups) specially.
   * Returns base64-encoded PNG data (without data URL prefix).
   */
  public async captureScreenshot(filePath: string, selector?: string): Promise<string> {
    const instance = this.editors.get(filePath);
    if (!instance) {
      throw new Error(`No offscreen editor mounted for ${filePath}`);
    }

    // Temporarily make visible for screenshot
    const wasHidden = this.hiddenContainer!.style.visibility === 'hidden';
    if (wasHidden) {
      this.hiddenContainer!.style.visibility = 'visible';
    }

    // Wait for iframe content to render (if mockup or other iframe-based editor)
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      // Check if this is a mockup editor with iframe content
      const iframe = instance.container.querySelector('iframe');

      if (iframe && filePath.endsWith('.mockup.html')) {
        console.log('[OffscreenEditorRenderer] Detected mockup iframe, using special capture');

        // Access iframe document directly (same as captureMockupComposite does)
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc || !iframeDoc.body) {
          throw new Error('Cannot access iframe document');
        }

        // Wait for iframe to be fully loaded
        if (iframeDoc.readyState !== 'complete') {
          await new Promise((resolve) => {
            iframe.contentWindow?.addEventListener('load', resolve, { once: true });
            setTimeout(resolve, 3000);
          });
        }

        // Import html2canvas and capture iframe body
        const html2canvas = (await import('html2canvas')).default;
        const targetElement = iframeDoc.body;
        const elemWidth = targetElement.scrollWidth || targetElement.offsetWidth || iframe.offsetWidth;
        const elemHeight = targetElement.scrollHeight || targetElement.offsetHeight || iframe.offsetHeight;

        const canvas = await html2canvas(targetElement, {
          backgroundColor: '#ffffff',
          scale: 2,
          logging: false,
          useCORS: false,
          allowTaint: true,
          foreignObjectRendering: true,
          imageTimeout: 0,
          width: elemWidth,
          height: elemHeight,
          windowWidth: elemWidth,
          windowHeight: elemHeight,
        });

        const dataUrl = canvas.toDataURL('image/png');
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

        console.log('[OffscreenEditorRenderer] Mockup screenshot captured:', base64Data.length, 'chars base64');
        return base64Data;
      }

      // For non-iframe editors, use html2canvas
      const html2canvas = (await import('html2canvas')).default;

      const targetElement = selector
        ? instance.container.querySelector(selector) as HTMLElement
        : instance.container;

      if (!targetElement) {
        throw new Error(`Element not found: ${selector || 'container'}`);
      }

      const canvas = await html2canvas(targetElement, {
        logging: false,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
      });

      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

      console.log('[OffscreenEditorRenderer] Screenshot captured:', base64Data.length, 'chars base64');
      return base64Data;
    } finally {
      // Hide again
      if (wasHidden) {
        this.hiddenContainer!.style.visibility = 'hidden';
      }
    }
  }

  /**
   * Cleanup on shutdown.
   */
  public cleanup(): void {
    console.log('[OffscreenEditorRenderer] Cleaning up');

    // Unmount all editors
    for (const filePath of Array.from(this.editors.keys())) {
      this.unmountEditor(filePath);
    }

    // Remove hidden container
    if (this.hiddenContainer && this.hiddenContainer.parentNode) {
      this.hiddenContainer.parentNode.removeChild(this.hiddenContainer);
      this.hiddenContainer = null;
    }
  }
}

// Singleton instance
export const offscreenEditorRenderer = new OffscreenEditorRendererImpl();
