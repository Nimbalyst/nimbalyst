/**
 * Offscreen Editor Renderer
 *
 * Manages offscreen editor instances in the renderer process.
 * Creates hidden DOM containers and mounts React editors without visible UI.
 * Editors register their APIs in the same registry used by visible editors.
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EditorHost, DrawingPath } from '@nimbalyst/runtime';
import { getExtensionLoader } from '@nimbalyst/runtime';
// Note: Window globals for mockup annotations are declared in @nimbalyst/runtime

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
    const themeChangeCallbacks: Array<(theme: string) => void> = [];

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

      onThemeChanged(callback: (theme: string) => void): () => void {
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
        return this.captureVisibleMockup(visibleMockup, filePath, selector);
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

        // Validate canvas before converting
        if (!canvas || canvas.width === 0 || canvas.height === 0) {
          throw new Error('html2canvas produced an empty canvas for offscreen mockup iframe');
        }

        return this.canvasToBase64(canvas, 'offscreen mockup iframe');
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

      // Validate canvas before converting
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error('html2canvas produced an empty canvas for offscreen editor');
      }

      return this.canvasToBase64(canvas, 'offscreen editor');
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

    // Validate canvas before converting
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('html2canvas produced an empty canvas for Excalidraw editor');
    }

    return this.canvasToBase64(canvas, 'Excalidraw editor');
  }

  /**
   * Convert a canvas to base64 PNG data, with validation.
   * @param canvas - The canvas to convert
   * @param context - Description of the context for error messages
   * @returns Base64-encoded PNG data (without data URL prefix)
   */
  private canvasToBase64(canvas: HTMLCanvasElement, context: string): string {
    const dataUrl = canvas.toDataURL('image/png');
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

    if (!base64Data || base64Data.length === 0) {
      throw new Error(`toDataURL produced empty base64 data for ${context}`);
    }

    return base64Data;
  }

  /**
   * Find a visible mockup editor by looking for the tab with this file path.
   */
  private findVisibleMockupEditor(filePath: string): HTMLElement | null {
    // Check if there's a visible tab editor for this file
    const editorWrapper = document.querySelector(`[data-file-path="${filePath}"]`) as HTMLElement | null;
    if (!editorWrapper) {
      return null;
    }

    // Check if it has an iframe (MockupEditor renders mockups in an iframe)
    const iframe = editorWrapper.querySelector('iframe');
    if (!iframe) {
      return null;
    }

    // Check bounding rect to ensure it's visible
    const rect = editorWrapper.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    // Find the content area that contains both iframe and canvas
    const contentArea = iframe.closest('.flex-1.overflow-hidden') as HTMLElement | null;
    if (contentArea) {
      const contentRect = contentArea.getBoundingClientRect();
      if (contentRect.width > 0 && contentRect.height > 0) {
        return contentArea;
      }
    }

    // Fall back to the wrapper itself
    return editorWrapper;
  }

  /**
   * Capture screenshot from a visible mockup editor.
   * Includes any drawing annotations that have been made on the mockup.
   */
  private async captureVisibleMockup(container: HTMLElement, filePath: string, selector?: string): Promise<string> {
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

      const mockupCanvas = await html2canvas(targetElement, {
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

      // Validate canvas before compositing
      if (!mockupCanvas || mockupCanvas.width === 0 || mockupCanvas.height === 0) {
        throw new Error('html2canvas produced an empty canvas for visible mockup iframe');
      }

      // Check for drawing annotations from MockupEditor
      // First try the per-file annotations map (persists when tab is inactive)
      // Then fall back to legacy globals (only set when tab is active)
      const fileAnnotations = window.__mockupAnnotations?.get(filePath);

      // Prefer per-file annotations, fall back to legacy globals
      const drawingPaths: DrawingPath[] | undefined = fileAnnotations?.drawingPaths ?? window.__mockupDrawingPaths;

      // Determine which canvas to convert to base64
      let finalCanvas: HTMLCanvasElement = mockupCanvas;

      // If there are drawing annotations, composite them onto the mockup
      if (drawingPaths && drawingPaths.length > 0) {
        // Calculate scale factor (html2canvas uses scale: 2)
        const scale = mockupCanvas.width / elemWidth;

        // Validate scale is a finite positive number
        if (!Number.isFinite(scale) || scale <= 0) {
          throw new Error(`Invalid scale factor: ${scale} (canvas width: ${mockupCanvas.width}, element width: ${elemWidth})`);
        }

        // Create a composite canvas
        const compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = mockupCanvas.width;
        compositeCanvas.height = mockupCanvas.height;
        const ctx = compositeCanvas.getContext('2d');

        if (!ctx) {
          throw new Error('Failed to get composite canvas context');
        }

        // Draw the mockup first
        ctx.drawImage(mockupCanvas, 0, 0);

        // Draw the annotation paths
        drawingPaths.forEach(path => {
          if (path.points.length < 2) return;
          if (!path.color || typeof path.color !== 'string') return;

          ctx.strokeStyle = path.color;
          ctx.lineWidth = 3 * scale;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          ctx.beginPath();
          const firstPoint = path.points[0];
          ctx.moveTo(firstPoint.x * scale, firstPoint.y * scale);

          for (let i = 1; i < path.points.length; i++) {
            const point = path.points[i];
            ctx.lineTo(point.x * scale, point.y * scale);
          }
          ctx.stroke();
        });

        finalCanvas = compositeCanvas;
      }

      // Convert final canvas to base64 (single return path)
      return this.canvasToBase64(finalCanvas, drawingPaths ? 'composited mockup' : 'mockup iframe');
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

    // Validate canvas before converting
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('html2canvas produced an empty canvas for visible mockup container');
    }

    return this.canvasToBase64(canvas, 'visible mockup container');
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
