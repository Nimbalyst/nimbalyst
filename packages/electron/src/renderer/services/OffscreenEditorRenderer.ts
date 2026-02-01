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
   * Capture screenshot from an editor (visible or offscreen).
   * First checks if a visible editor has the file open, otherwise uses offscreen.
   * Handles iframe-based editors (mockups) specially.
   * Returns base64-encoded PNG data (without data URL prefix).
   */
  public async captureScreenshot(filePath: string, selector?: string): Promise<string> {
    // First, check if a visible editor has this file open
    // Extensions expose their editor APIs on window for this purpose
    if (filePath.endsWith('.excalidraw')) {
      const getAPI = (window as any).__excalidraw_getEditorAPI;
      if (getAPI && getAPI(filePath)) {
        console.log('[OffscreenEditorRenderer] Visible Excalidraw editor found, capturing from visible DOM');
        return this.captureVisibleExcalidraw(filePath, selector);
      }
    }

    // Check for visible mockup editor by looking for editor in DOM
    if (filePath.endsWith('.mockup.html')) {
      const visibleMockup = this.findVisibleMockupEditor(filePath);
      if (visibleMockup) {
        console.log('[OffscreenEditorRenderer] Visible mockup editor found, capturing from visible DOM');
        return this.captureVisibleMockup(visibleMockup, selector);
      }
    }

    // Fall back to offscreen editor
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

        // Validate canvas before converting to data URL
        if (!canvas || canvas.width === 0 || canvas.height === 0) {
          throw new Error('html2canvas produced an empty canvas for offscreen mockup iframe');
        }

        console.log('[OffscreenEditorRenderer] Mockup iframe canvas dimensions:', canvas.width, 'x', canvas.height);

        const dataUrl = canvas.toDataURL('image/png');
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

        // Validate that we got actual base64 data
        if (!base64Data || base64Data.length === 0) {
          throw new Error('toDataURL produced empty base64 data for offscreen mockup iframe');
        }

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

      // Validate canvas before converting to data URL
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error('html2canvas produced an empty canvas for offscreen editor');
      }

      console.log('[OffscreenEditorRenderer] Offscreen canvas dimensions:', canvas.width, 'x', canvas.height);

      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

      // Validate that we got actual base64 data
      if (!base64Data || base64Data.length === 0) {
        throw new Error('toDataURL produced empty base64 data for offscreen editor');
      }

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
   * Capture screenshot from a visible Excalidraw editor.
   * Finds the editor's DOM element and captures it using html2canvas.
   */
  private async captureVisibleExcalidraw(filePath: string, selector?: string): Promise<string> {
    // Find the Excalidraw editor container in the visible DOM
    // The editor uses class "excalidraw-editor" as its wrapper
    const editors = document.querySelectorAll('.excalidraw-editor');

    if (editors.length === 0) {
      throw new Error('No visible Excalidraw editor found in DOM');
    }

    // Use the first one for now (in practice there should only be one visible)
    // In the future we could match by filePath if needed
    const editorElement = (selector
      ? editors[0].querySelector(selector)
      : editors[0]) as HTMLElement;

    if (!editorElement) {
      throw new Error(`Element not found: ${selector || 'excalidraw-editor'}`);
    }

    // Import html2canvas and capture
    const html2canvas = (await import('html2canvas')).default;

    const canvas = await html2canvas(editorElement, {
      logging: false,
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      scale: 2, // Higher resolution for quality
    });

    // Validate canvas before converting to data URL
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('html2canvas produced an empty canvas');
    }

    console.log('[OffscreenEditorRenderer] Canvas dimensions:', canvas.width, 'x', canvas.height);

    const dataUrl = canvas.toDataURL('image/png');
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

    // Validate that we got actual base64 data
    if (!base64Data || base64Data.length === 0) {
      throw new Error('toDataURL produced empty base64 data');
    }

    console.log('[OffscreenEditorRenderer] Visible editor screenshot captured:', base64Data.length, 'chars base64');
    return base64Data;
  }

  /**
   * Find a visible mockup editor by checking data attributes on tab panels.
   */
  private findVisibleMockupEditor(filePath: string): HTMLElement | null {
    // Mockup editors are rendered in tab panels with the mockup-preview-container class
    const containers = document.querySelectorAll('.mockup-preview-container');

    for (const container of containers) {
      // Check if this container is for the right file
      // The parent tab panel should have data attributes indicating the file path
      const tabPanel = container.closest('[role="tabpanel"]');
      if (tabPanel) {
        // Tab panels may have data-testid or other attributes with file info
        // For now, just return the first visible one if we find any
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return container as HTMLElement;
        }
      }
    }

    return null;
  }

  /**
   * Capture screenshot from a visible mockup editor.
   */
  private async captureVisibleMockup(container: HTMLElement, selector?: string): Promise<string> {
    // Find the iframe inside the mockup container
    const iframe = container.querySelector('iframe');

    if (iframe) {
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

      // Validate canvas before converting to data URL
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error('html2canvas produced an empty canvas for visible mockup iframe');
      }

      console.log('[OffscreenEditorRenderer] Visible mockup iframe canvas dimensions:', canvas.width, 'x', canvas.height);

      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

      // Validate that we got actual base64 data
      if (!base64Data || base64Data.length === 0) {
        throw new Error('toDataURL produced empty base64 data for visible mockup iframe');
      }

      console.log('[OffscreenEditorRenderer] Visible mockup screenshot captured:', base64Data.length, 'chars base64');
      return base64Data;
    }

    // Fall back to capturing the container itself
    const html2canvas = (await import('html2canvas')).default;
    const targetElement = selector ? container.querySelector(selector) as HTMLElement : container;

    if (!targetElement) {
      throw new Error(`Element not found: ${selector || 'container'}`);
    }

    const canvas = await html2canvas(targetElement, {
      logging: false,
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
    });

    // Validate canvas before converting to data URL
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('html2canvas produced an empty canvas for visible mockup container');
    }

    console.log('[OffscreenEditorRenderer] Visible mockup container canvas dimensions:', canvas.width, 'x', canvas.height);

    const dataUrl = canvas.toDataURL('image/png');
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

    // Validate that we got actual base64 data
    if (!base64Data || base64Data.length === 0) {
      throw new Error('toDataURL produced empty base64 data for visible mockup container');
    }

    console.log('[OffscreenEditorRenderer] Visible mockup container screenshot captured:', base64Data.length, 'chars base64');
    return base64Data;
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
