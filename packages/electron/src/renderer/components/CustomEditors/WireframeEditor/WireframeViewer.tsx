/**
 * WireframeViewer - Custom editor for .wireframe.html files
 *
 * Renders HTML wireframes in an isolated iframe with theme support
 * and configuration from .nimbalyst/wireframe-lm/
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { CustomEditorProps } from '../types';
import { MonacoCodeEditor } from '../../MonacoCodeEditor';
import { logger } from '../../../utils/logger';

type ViewMode = 'preview' | 'source';

export const WireframeViewer: React.FC<CustomEditorProps> = ({
  filePath,
  fileName,
  initialContent,
  theme,
  isActive,
  workspaceId,
  onContentChange,
  onDirtyChange,
  onGetContentReady,
}) => {
  const [content, setContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [isCapturing, setIsCapturing] = useState(false);
  const [selectedElement, setSelectedElement] = useState<{
    selector: string;
    outerHTML: string;
    tagName: string;
  } | null>(null);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawingColor, setDrawingColor] = useState('#FF0000'); // Red by default
  const [drawingDataUrl, setDrawingDataUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const getMonacoContentRef = useRef<(() => string) | null>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Capture screenshot of the wireframe (based on WireframeLM implementation)
  const handleCaptureScreenshot = useCallback(async () => {
    if (!iframeRef.current) {
      logger.ui.error('[WireframeViewer] No iframe reference available');
      alert('Screenshot failed: iframe not ready');
      return;
    }

    setIsCapturing(true);

    try {
      const iframe = iframeRef.current;
      const iframeWindow = iframe.contentWindow;
      const iframeDoc = iframe.contentDocument || iframeWindow?.document;

      if (!iframeDoc || !iframeDoc.body) {
        throw new Error('Cannot access iframe document - it may be cross-origin or not loaded');
      }

      // Wait for iframe to be fully loaded
      if (iframeDoc.readyState !== 'complete') {
        logger.ui.info('[WireframeViewer] Waiting for iframe to load...');
        await new Promise((resolve) => {
          iframeWindow?.addEventListener('load', resolve, { once: true });
          // Timeout after 5 seconds
          setTimeout(resolve, 5000);
        });
      }

      // Ensure the iframe has rendered dimensions
      const iframeWidth = iframe.offsetWidth;
      const iframeHeight = iframe.offsetHeight;

      if (iframeWidth === 0 || iframeHeight === 0) {
        throw new Error(`Iframe has zero dimensions: ${iframeWidth}x${iframeHeight}`);
      }

      logger.ui.info('[WireframeViewer] Starting screenshot capture', {
        iframeWidth,
        iframeHeight,
        readyState: iframeDoc.readyState,
      });

      // Dynamically import html2canvas for code splitting
      const html2canvas = (await import('html2canvas')).default;

      // Use body element directly - this is more reliable for iframes
      const targetElement = iframeDoc.body;

      // Check element dimensions
      const elemWidth = targetElement.scrollWidth || targetElement.offsetWidth || iframeWidth;
      const elemHeight = targetElement.scrollHeight || targetElement.offsetHeight || iframeHeight;

      logger.ui.info('[WireframeViewer] Capturing element:', {
        tagName: targetElement.tagName,
        hasStyles: iframeDoc.styleSheets.length,
        scrollWidth: targetElement.scrollWidth,
        scrollHeight: targetElement.scrollHeight,
        offsetWidth: targetElement.offsetWidth,
        offsetHeight: targetElement.offsetHeight,
        computedWidth: elemWidth,
        computedHeight: elemHeight,
      });

      if (elemWidth === 0 || elemHeight === 0) {
        throw new Error(`Target element has zero dimensions: ${elemWidth}x${elemHeight}. The iframe content may not be rendered yet.`);
      }

      // Capture with configuration optimized for iframe rendering
      const canvas = await html2canvas(targetElement, {
        backgroundColor: '#ffffff',
        scale: 2, // High quality 2x resolution
        logging: true, // Enable logging to see what html2canvas is doing
        useCORS: false, // Disable for local content
        allowTaint: true, // Allow tainted canvas (for local files)
        foreignObjectRendering: true, // Use foreignObject for better rendering
        imageTimeout: 0, // No timeout for local images
        width: elemWidth,
        height: elemHeight,
        windowWidth: elemWidth,
        windowHeight: elemHeight,
      });

      logger.ui.info('[WireframeViewer] Canvas created:', {
        width: canvas.width,
        height: canvas.height,
      });

      // Convert to blob
      canvas.toBlob(async (blob) => {
        if (!blob) {
          throw new Error('Failed to create image blob from canvas');
        }

        logger.ui.info('[WireframeViewer] Blob created, size:', blob.size);

        // Try to write to clipboard first (like WireframeLM)
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          logger.ui.info('[WireframeViewer] Screenshot copied to clipboard');
          // Show success feedback - use a more subtle notification
          const notification = document.createElement('div');
          notification.textContent = 'Screenshot copied to clipboard';
          notification.style.cssText = `
            position: fixed;
            top: 60px;
            right: 20px;
            background: var(--surface-secondary);
            border: 1px solid var(--border-primary);
            color: var(--text-primary);
            padding: 12px 20px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 10000;
            font-size: 14px;
            animation: slideIn 0.3s ease-out;
          `;
          document.body.appendChild(notification);
          setTimeout(() => {
            notification.remove();
          }, 3000);
        } catch (clipboardErr) {
          // Fallback to download if clipboard fails
          logger.ui.warn('[WireframeViewer] Clipboard failed, downloading instead:', clipboardErr);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          a.href = url;
          a.download = `${fileName.replace('.wireframe.html', '')}-screenshot-${timestamp}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          logger.ui.info('[WireframeViewer] Screenshot downloaded');
        }
      }, 'image/png');
    } catch (err) {
      logger.ui.error('[WireframeViewer] Failed to capture screenshot:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert('Failed to capture screenshot: ' + errorMessage);
    } finally {
      setIsCapturing(false);
    }
  }, [fileName]);

  // Handle content changes from Monaco editor
  const handleMonacoContentChange = useCallback(() => {
    if (getMonacoContentRef.current) {
      const newContent = getMonacoContentRef.current();
      setContent(newContent);
      if (onContentChange) {
        onContentChange();
      }
    }
  }, [onContentChange]);

  // Expose get content function to parent
  useEffect(() => {
    if (onGetContentReady) {
      onGetContentReady(() => {
        // If in source mode, get content from Monaco
        if (viewMode === 'source' && getMonacoContentRef.current) {
          return getMonacoContentRef.current();
        }
        // Otherwise return the current content state
        return content;
      });
    }
  }, [content, viewMode, onGetContentReady]);

  // Load wireframe HTML content
  useEffect(() => {
    const loadContent = async () => {
      try {
        // Content is already provided as initialContent
        // In the future, we might inject theme CSS here
        setContent(initialContent);
        setError(null);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.ui.error('[WireframeViewer] Failed to load content:', errorMsg);
        setError(errorMsg);
      }
    };

    loadContent();
  }, [filePath, initialContent]);

  // Generate a CSS selector for an element
  const generateSelector = useCallback((element: Element): string => {
    // If element has an ID, use that
    if (element.id) {
      return `#${element.id}`;
    }

    // If element has unique class combination, use that
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        const classSelector = '.' + classes.join('.');
        const parent = element.parentElement;
        if (parent) {
          const siblings = Array.from(parent.querySelectorAll(classSelector));
          if (siblings.length === 1) {
            return classSelector;
          }
        }
      }
    }

    // Fall back to tag name with nth-child
    const tagName = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(e => e.tagName === element.tagName);
      const index = siblings.indexOf(element);
      if (index >= 0) {
        const parentSelector = parent.tagName.toLowerCase();
        return `${parentSelector} > ${tagName}:nth-child(${index + 1})`;
      }
    }

    return tagName;
  }, []);

  // Handle element selection in preview mode
  const handleElementClick = useCallback((event: MouseEvent) => {
    // Only handle in preview mode
    if (viewMode !== 'preview') return;

    const target = event.target as HTMLElement;

    // Don't select the body or html elements
    if (target.tagName === 'BODY' || target.tagName === 'HTML') return;

    event.preventDefault();
    event.stopPropagation();

    const selector = generateSelector(target);
    const outerHTML = target.outerHTML;
    const tagName = target.tagName.toLowerCase();

    logger.ui.info('[WireframeViewer] Element selected:', {
      selector,
      tagName,
      htmlLength: outerHTML.length,
    });

    setSelectedElement({
      selector,
      outerHTML,
      tagName,
    });

    // Add visual highlight to selected element
    const iframeDoc = iframeRef.current?.contentDocument;
    if (iframeDoc) {
      // Remove previous highlights
      iframeDoc.querySelectorAll('.nimbalyst-selected').forEach(el => {
        el.classList.remove('nimbalyst-selected');
      });

      // Add highlight to new element
      target.classList.add('nimbalyst-selected');
    }
  }, [viewMode, generateSelector]);

  // Deselect element
  const handleDeselectElement = useCallback(() => {
    setSelectedElement(null);

    // Remove visual highlight
    const iframeDoc = iframeRef.current?.contentDocument;
    if (iframeDoc) {
      iframeDoc.querySelectorAll('.nimbalyst-selected').forEach(el => {
        el.classList.remove('nimbalyst-selected');
      });
    }

    logger.ui.info('[WireframeViewer] Element deselected');
  }, []);

  // Update iframe when content changes or when switching back to preview mode
  useEffect(() => {
    if (viewMode === 'preview' && iframeRef.current && content) {
      try {
        const iframeDoc = iframeRef.current.contentDocument;
        if (iframeDoc) {
          iframeDoc.open();
          iframeDoc.write(content);
          iframeDoc.close();

          // Inject highlight styles
          const style = iframeDoc.createElement('style');
          style.textContent = `
            .nimbalyst-selected {
              outline: 2px solid #007AFF !important;
              outline-offset: 2px !important;
              box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.2) !important;
            }
          `;
          iframeDoc.head.appendChild(style);

          // Add click listener for element selection
          iframeDoc.addEventListener('click', handleElementClick as any);
        }
      } catch (err) {
        logger.ui.error('[WireframeViewer] Failed to update iframe:', err);
      }
    }

    // Cleanup function to remove click listener
    return () => {
      const iframeDoc = iframeRef.current?.contentDocument;
      if (iframeDoc) {
        iframeDoc.removeEventListener('click', handleElementClick as any);
      }
    };
  }, [content, viewMode, handleElementClick]);

  // When switching from source to preview, sync content from Monaco
  useEffect(() => {
    if (viewMode === 'preview' && getMonacoContentRef.current) {
      const monacoContent = getMonacoContentRef.current();
      if (monacoContent !== content) {
        setContent(monacoContent);
      }
    }
  }, [viewMode]);

  // Expose selected element to window for AI context
  useEffect(() => {
    (window as any).__wireframeSelectedElement = selectedElement;

    return () => {
      delete (window as any).__wireframeSelectedElement;
    };
  }, [selectedElement]);

  // Expose drawing to window for AI context
  useEffect(() => {
    (window as any).__wireframeDrawing = drawingDataUrl;

    return () => {
      delete (window as any).__wireframeDrawing;
    };
  }, [drawingDataUrl]);

  // Clear drawing
  const handleClearDrawing = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setDrawingDataUrl(null);
        logger.ui.info('[WireframeViewer] Drawing cleared');
      }
    }
  }, []);

  // Toggle drawing mode
  const handleToggleDrawing = useCallback(() => {
    setIsDrawingMode(prev => !prev);
    if (isDrawingMode) {
      // Exiting drawing mode - save the drawing
      const canvas = drawingCanvasRef.current;
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        setDrawingDataUrl(dataUrl);
        logger.ui.info('[WireframeViewer] Drawing saved for AI context');
      }
    }
  }, [isDrawingMode]);

  // Drawing event handlers
  const handleDrawingMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode) return;

    const canvas = drawingCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    isDrawingRef.current = true;
    lastPointRef.current = { x, y };
  }, [isDrawingMode]);

  const handleDrawingMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || !isDrawingRef.current) return;

    const canvas = drawingCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (lastPointRef.current) {
      // Draw line from last point to current point
      ctx.strokeStyle = drawingColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    lastPointRef.current = { x, y };
  }, [isDrawingMode, drawingColor]);

  const handleDrawingMouseUp = useCallback(() => {
    isDrawingRef.current = false;
    lastPointRef.current = null;

    // Save drawing to data URL
    const canvas = drawingCanvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      setDrawingDataUrl(dataUrl);
    }
  }, []);

  const handleDrawingMouseLeave = useCallback(() => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
  }, []);

  // Setup drawing canvas when iframe loads or resizes
  useEffect(() => {
    const iframe = iframeRef.current;
    const canvas = drawingCanvasRef.current;

    if (viewMode === 'preview' && iframe && canvas) {
      // Match canvas size to iframe
      const updateCanvasSize = () => {
        canvas.width = iframe.offsetWidth;
        canvas.height = iframe.offsetHeight;
      };

      updateCanvasSize();

      // Update on window resize
      window.addEventListener('resize', updateCanvasSize);
      return () => window.removeEventListener('resize', updateCanvasSize);
    }
  }, [viewMode]);

  // Capture composite screenshot (wireframe + drawing) and send to AI chat
  const handleSendToAI = useCallback(async () => {
    if (!iframeRef.current) {
      logger.ui.error('[WireframeViewer] No iframe reference for composite screenshot');
      alert('Failed to capture: iframe not ready');
      return;
    }

    try {
      const iframe = iframeRef.current;
      const iframeWindow = iframe.contentWindow;
      const iframeDoc = iframe.contentDocument || iframeWindow?.document;

      if (!iframeDoc || !iframeDoc.body) {
        throw new Error('Cannot access iframe document');
      }

      // Wait for iframe to be fully loaded
      if (iframeDoc.readyState !== 'complete') {
        await new Promise((resolve) => {
          iframeWindow?.addEventListener('load', resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      }

      const iframeWidth = iframe.offsetWidth;
      const iframeHeight = iframe.offsetHeight;

      if (iframeWidth === 0 || iframeHeight === 0) {
        throw new Error(`Iframe has zero dimensions: ${iframeWidth}x${iframeHeight}`);
      }

      logger.ui.info('[WireframeViewer] Creating composite screenshot for AI');

      // Import html2canvas
      const html2canvas = (await import('html2canvas')).default;

      // Capture the wireframe iframe content
      const targetElement = iframeDoc.body;
      const elemWidth = targetElement.scrollWidth || targetElement.offsetWidth || iframeWidth;
      const elemHeight = targetElement.scrollHeight || targetElement.offsetHeight || iframeHeight;

      if (elemWidth === 0 || elemHeight === 0) {
        throw new Error(`Target element has zero dimensions: ${elemWidth}x${elemHeight}`);
      }

      const wireframeCanvas = await html2canvas(targetElement, {
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

      // Create a new canvas to composite wireframe + drawing
      const compositeCanvas = document.createElement('canvas');
      compositeCanvas.width = wireframeCanvas.width;
      compositeCanvas.height = wireframeCanvas.height;
      const ctx = compositeCanvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      // Draw wireframe
      ctx.drawImage(wireframeCanvas, 0, 0);

      // Draw the drawing overlay if it exists
      const drawingCanvas = drawingCanvasRef.current;
      if (drawingCanvas && drawingDataUrl) {
        // Scale the drawing to match the wireframe canvas size
        const scaleX = wireframeCanvas.width / drawingCanvas.width;
        const scaleY = wireframeCanvas.height / drawingCanvas.height;
        ctx.scale(scaleX, scaleY);
        ctx.drawImage(drawingCanvas, 0, 0);
      }

      // Convert to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        compositeCanvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        }, 'image/png');
      });

      // Create file from blob
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const file = new File([blob], `wireframe-${timestamp}.png`, { type: 'image/png' });

      logger.ui.info('[WireframeViewer] Composite screenshot created, adding to AI chat');

      // Add to AI chat as attachment
      // This will be handled by the parent component via window event
      const event = new CustomEvent('wireframe-screenshot-ready', {
        detail: { file }
      });
      window.dispatchEvent(event);

      // Show success notification
      const notification = document.createElement('div');
      notification.textContent = 'Screenshot added to AI chat';
      notification.style.cssText = `
        position: fixed;
        top: 60px;
        right: 20px;
        background: var(--surface-secondary);
        border: 1px solid var(--border-primary);
        color: var(--text-primary);
        padding: 12px 20px;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        font-size: 14px;
      `;
      document.body.appendChild(notification);
      setTimeout(() => {
        notification.remove();
      }, 3000);
    } catch (err) {
      logger.ui.error('[WireframeViewer] Failed to create composite screenshot:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert('Failed to capture screenshot: ' + errorMessage);
    }
  }, [drawingDataUrl]);

  // Handle file watching - reload if file changes externally
  useEffect(() => {
    const handleFileChanged = async (data: { path: string }) => {
      if (data.path === filePath) {
        logger.ui.info('[WireframeViewer] File changed on disk, reloading:', filePath);
        try {
          const result = await window.electronAPI.readFileContent(filePath);
          if (result?.content) {
            setContent(result.content);
            setIsDirty(false);
            if (onDirtyChange) {
              onDirtyChange(false);
            }
          }
        } catch (err) {
          logger.ui.error('[WireframeViewer] Failed to reload file:', err);
        }
      }
    };

    if (window.electronAPI.onFileChangedOnDisk) {
      const cleanup = window.electronAPI.onFileChangedOnDisk(handleFileChanged);
      return cleanup;
    }
  }, [filePath, onDirtyChange]);

  if (error) {
    return (
      <div
        style={{
          padding: '20px',
          color: 'var(--text-primary)',
          backgroundColor: 'var(--surface-primary)',
        }}
      >
        <h3 style={{ color: 'var(--text-primary)' }}>Error Loading Wireframe</h3>
        <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
        <p style={{ fontSize: '14px', color: 'var(--text-tertiary)', marginTop: '12px' }}>
          File: {fileName}
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--surface-primary)',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-primary)',
          backgroundColor: 'var(--surface-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            {fileName}
          </span>
          {isDirty && (
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
              ● Modified
            </span>
          )}
          {selectedElement && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 8px',
              backgroundColor: 'rgba(0, 122, 255, 0.1)',
              borderRadius: '4px',
              border: '1px solid rgba(0, 122, 255, 0.3)',
            }}>
              <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                Selected: {selectedElement.tagName}
              </span>
              <button
                onClick={handleDeselectElement}
                style={{
                  padding: '2px 6px',
                  fontSize: '11px',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
                title="Deselect element"
              >
                Clear
              </button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
            {viewMode === 'preview' ? 'Wireframe Preview' : 'HTML Source'}
          </span>
          {viewMode === 'preview' && (
            <>
              <button
                onClick={handleToggleDrawing}
                style={{
                  padding: '4px 12px',
                  fontSize: '12px',
                  backgroundColor: isDrawingMode ? 'var(--primary-color)' : 'var(--surface-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '4px',
                  color: isDrawingMode ? 'white' : 'var(--text-primary)',
                  cursor: 'pointer',
                  fontWeight: isDrawingMode ? 'bold' : 'normal',
                }}
                title={isDrawingMode ? 'Exit drawing mode' : 'Draw annotations for AI'}
              >
                {isDrawingMode ? 'Done Drawing' : 'Draw'}
              </button>
              {isDrawingMode && (
                <>
                  <input
                    type="color"
                    value={drawingColor}
                    onChange={(e) => setDrawingColor(e.target.value)}
                    style={{
                      width: '32px',
                      height: '24px',
                      border: '1px solid var(--border-primary)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                    title="Choose drawing color"
                  />
                  <button
                    onClick={handleClearDrawing}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      backgroundColor: 'var(--surface-primary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: '4px',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                    title="Clear all drawings"
                  >
                    Clear
                  </button>
                </>
              )}
              <button
                onClick={handleSendToAI}
                style={{
                  padding: '4px 12px',
                  fontSize: '12px',
                  backgroundColor: 'var(--primary-color)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '4px',
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
                title="Send screenshot with annotations to AI chat"
              >
                Send to AI
              </button>
              <button
                onClick={handleCaptureScreenshot}
                disabled={isCapturing}
                style={{
                  padding: '4px 12px',
                  fontSize: '12px',
                  backgroundColor: 'var(--surface-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  cursor: isCapturing ? 'wait' : 'pointer',
                  opacity: isCapturing ? 0.6 : 1,
                }}
                title="Capture screenshot of wireframe"
              >
                {isCapturing ? 'Capturing...' : 'Screenshot'}
              </button>
            </>
          )}
          <button
            onClick={() => setViewMode(viewMode === 'preview' ? 'source' : 'preview')}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              backgroundColor: 'var(--surface-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
            title={viewMode === 'preview' ? 'View HTML Source' : 'View Preview'}
          >
            {viewMode === 'preview' ? 'View Source' : 'View Preview'}
          </button>
        </div>
      </div>

      {/* Content Area */}
      {viewMode === 'preview' ? (
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            backgroundColor: '#ffffff',
            position: 'relative',
          }}
        >
          <iframe
            ref={iframeRef}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
            sandbox="allow-scripts allow-same-origin"
            title={`Wireframe: ${fileName}`}
          />
          {/* Drawing Canvas Overlay */}
          <canvas
            ref={drawingCanvasRef}
            onMouseDown={handleDrawingMouseDown}
            onMouseMove={handleDrawingMouseMove}
            onMouseUp={handleDrawingMouseUp}
            onMouseLeave={handleDrawingMouseLeave}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: isDrawingMode ? 'auto' : 'none',
              cursor: isDrawingMode ? 'crosshair' : 'default',
              zIndex: isDrawingMode ? 1000 : 10,
            }}
          />
          {isDrawingMode && (
            <div
              style={{
                position: 'absolute',
                bottom: '16px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'var(--surface-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                padding: '8px 16px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                zIndex: 1001,
                fontSize: '12px',
                color: 'var(--text-primary)',
              }}
            >
              Drawing mode active - Circle elements, draw arrows, or annotate for AI
            </div>
          )}
        </div>
      ) : (
        <MonacoCodeEditor
          key={filePath}
          filePath={filePath}
          fileName={fileName}
          initialContent={content}
          theme={theme}
          onContentChange={handleMonacoContentChange}
          onGetContent={(getContentFn) => {
            getMonacoContentRef.current = getContentFn;
          }}
          onEditorReady={() => {
            // Monaco editor ready
          }}
        />
      )}
    </div>
  );
};
