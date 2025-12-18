/**
 * MockupViewer - Custom editor for .mockup.html files
 *
 * Renders HTML mockups in an isolated iframe with theme support
 * and configuration from .nimbalyst/mockup-lm/
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { CustomEditorProps } from '../types';
import { MonacoCodeEditor } from '../../MonacoCodeEditor';
import { logger } from '../../../utils/logger';
import { captureMockupComposite } from './screenshotUtils';
import { renderMockupHtml } from './mockupDomUtils';

type ViewMode = 'preview' | 'source';

export const MockupViewer: React.FC<CustomEditorProps> = ({
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
  const [scrollOffset, setScrollOffset] = useState({ x: 0, y: 0 });
  const [annotationTimestamp, setAnnotationTimestamp] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const getMonacoContentRef = useRef<(() => string) | null>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const drawingPathsRef = useRef<Array<{ points: { x: number; y: number }[]; color: string }>>([]);

  // Capture screenshot of the mockup (based on MockupLM implementation)
  const handleCaptureScreenshot = useCallback(async () => {
    if (!iframeRef.current) {
      logger.ui.error('[MockupViewer] No iframe reference available');
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
        logger.ui.info('[MockupViewer] Waiting for iframe to load...');
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

      logger.ui.info('[MockupViewer] Starting screenshot capture', {
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

      logger.ui.info('[MockupViewer] Capturing element:', {
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

      logger.ui.info('[MockupViewer] Canvas created:', {
        width: canvas.width,
        height: canvas.height,
      });

      // Convert to blob
      canvas.toBlob(async (blob) => {
        if (!blob) {
          throw new Error('Failed to create image blob from canvas');
        }

        logger.ui.info('[MockupViewer] Blob created, size:', blob.size);

        // Try to write to clipboard first (like MockupLM)
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          logger.ui.info('[MockupViewer] Screenshot copied to clipboard');
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
          logger.ui.warn('[MockupViewer] Clipboard failed, downloading instead:', clipboardErr);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          a.href = url;
          a.download = `${fileName.replace('.mockup.html', '')}-screenshot-${timestamp}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          logger.ui.info('[MockupViewer] Screenshot downloaded');
        }
      }, 'image/png');
    } catch (err) {
      logger.ui.error('[MockupViewer] Failed to capture screenshot:', err);
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

  // Load mockup HTML content
  useEffect(() => {
    const loadContent = async () => {
      try {
        // Content is already provided as initialContent
        // In the future, we might inject theme CSS here
        setContent(initialContent);
        setError(null);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.ui.error('[MockupViewer] Failed to load content:', errorMsg);
        setError(errorMsg);
      }
    };

    loadContent();

    // Clear annotations when mockup content is updated
    // (but only when initialContent changes, not on first load)
  }, [filePath, initialContent]);

  // Clear annotations when filePath changes (switching to different mockup)
  useEffect(() => {
    // Clear drawing canvas
    const canvas = drawingCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    // Clear states
    setDrawingDataUrl(null);
    setSelectedElement(null);
    setAnnotationTimestamp(null);
  }, [filePath]);

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

    logger.ui.info('[MockupViewer] Element selected:', {
      selector,
      tagName,
      htmlLength: outerHTML.length,
    });

    setSelectedElement({
      selector,
      outerHTML,
      tagName,
    });

    // Update annotation timestamp when selecting an element
    setAnnotationTimestamp(Date.now());

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

    logger.ui.info('[MockupViewer] Element deselected');
  }, []);

  // Update iframe when content changes or when switching back to preview mode
  useEffect(() => {
    if (viewMode === 'preview' && iframeRef.current && content) {
      renderMockupHtml(iframeRef.current, content, {
        onAfterRender: (iframeDoc) => {
          const style = iframeDoc.createElement('style');
          style.textContent = `
            .nimbalyst-selected {
              outline: 2px solid #007AFF !important;
              outline-offset: 2px !important;
              box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.2) !important;
            }
          `;
          iframeDoc.head.appendChild(style);
          iframeDoc.addEventListener('click', handleElementClick as any);
        }
      });
    }

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

  // Expose file path to window for AI context (only when active)
  useEffect(() => {
    if (isActive) {
      (window as any).__mockupFilePath = filePath;
      // Dispatch event to notify indicator with current annotation state
      const hasAnnotations = !!(drawingDataUrl || selectedElement);
      const event = new CustomEvent('mockup-annotation-changed', {
        detail: {
          filePath,
          annotationTimestamp,
          hasAnnotations,
          hasDrawing: !!drawingDataUrl,
          hasSelection: !!selectedElement
        }
      });
      window.dispatchEvent(event);
    } else {
      // Clear when not active so indicator hides when switching tabs
      delete (window as any).__mockupFilePath;
      // Dispatch event to notify indicator
      const event = new CustomEvent('mockup-annotation-changed', {
        detail: {
          filePath: '',
          annotationTimestamp: null,
          hasAnnotations: false,
          hasDrawing: false,
          hasSelection: false
        }
      });
      window.dispatchEvent(event);
    }

    return () => {
      delete (window as any).__mockupFilePath;
    };
  }, [filePath, isActive, annotationTimestamp, drawingDataUrl, selectedElement]);

  // Expose selected element to window for AI context
  useEffect(() => {
    (window as any).__mockupSelectedElement = selectedElement;

    return () => {
      delete (window as any).__mockupSelectedElement;
    };
  }, [selectedElement]);

  // Expose drawing to window for AI context
  useEffect(() => {
    (window as any).__mockupDrawing = drawingDataUrl;

    return () => {
      delete (window as any).__mockupDrawing;
    };
  }, [drawingDataUrl]);

  // Expose annotation timestamp to window for AI context
  useEffect(() => {
    (window as any).__mockupAnnotationTimestamp = annotationTimestamp;

    return () => {
      delete (window as any).__mockupAnnotationTimestamp;
    };
  }, [annotationTimestamp]);

  // Dispatch custom event when annotations change (for AI chat indicator)
  useEffect(() => {
    const hasAnnotations = !!(drawingDataUrl || selectedElement);
    const event = new CustomEvent('mockup-annotation-changed', {
      detail: {
        filePath,
        annotationTimestamp,
        hasAnnotations,
        hasDrawing: !!drawingDataUrl,
        hasSelection: !!selectedElement
      }
    });
    window.dispatchEvent(event);
  }, [filePath, annotationTimestamp, drawingDataUrl, selectedElement]);

  // Clear all annotations (drawing, selection, timestamp)
  const clearAllAnnotations = useCallback(() => {
    // Clear drawing canvas
    const canvas = drawingCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    // Clear states
    setDrawingDataUrl(null);
    setSelectedElement(null);
    setAnnotationTimestamp(null);

    // Remove visual highlight in iframe
    const iframeDoc = iframeRef.current?.contentDocument;
    if (iframeDoc) {
      iframeDoc.querySelectorAll('.nimbalyst-selected').forEach(el => {
        el.classList.remove('nimbalyst-selected');
      });
    }

    logger.ui.info('[MockupViewer] All annotations cleared');
  }, []);

  // Redraw all paths with current scroll offset
  const redrawCanvas = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Redraw all paths offset by scroll position
    drawingPathsRef.current.forEach(path => {
      if (path.points.length < 2) return;

      ctx.strokeStyle = path.color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      const firstPoint = path.points[0];
      ctx.moveTo(firstPoint.x - scrollOffset.x, firstPoint.y - scrollOffset.y);

      for (let i = 1; i < path.points.length; i++) {
        const point = path.points[i];
        ctx.lineTo(point.x - scrollOffset.x, point.y - scrollOffset.y);
      }
      ctx.stroke();
    });
  }, [scrollOffset]);

  // Clear drawing
  const handleClearDrawing = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawingPathsRef.current = [];
        setDrawingDataUrl(null);
        logger.ui.info('[MockupViewer] Drawing cleared');
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
        logger.ui.info('[MockupViewer] Drawing saved for AI context');
      }
    }
  }, [isDrawingMode]);

  // Drawing event handlers
  const handleDrawingMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode) return;

    const canvas = drawingCanvasRef.current;
    if (!canvas) {
      logger.ui.warn('[MockupViewer] No canvas ref on mouse down');
      return;
    }

    // Check if canvas has valid dimensions
    if (canvas.width === 0 || canvas.height === 0) {
      logger.ui.warn('[MockupViewer] Canvas has zero dimensions, cannot draw');
      return;
    }

    const rect = canvas.getBoundingClientRect();
    // Store absolute coordinates (viewport coords + scroll offset)
    const x = e.clientX - rect.left + scrollOffset.x;
    const y = e.clientY - rect.top + scrollOffset.y;

    isDrawingRef.current = true;
    lastPointRef.current = { x, y };

    // Update annotation timestamp when drawing starts
    setAnnotationTimestamp(Date.now());


    // Start a new path
    drawingPathsRef.current.push({
      points: [{ x, y }],
      color: drawingColor
    });

    logger.ui.info('[MockupViewer] Drawing started at:', { x, y });
  }, [isDrawingMode, scrollOffset, drawingColor]);

  const handleDrawingMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || !isDrawingRef.current) return;

    const canvas = drawingCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    // Store absolute coordinates (viewport coords + scroll offset)
    const x = e.clientX - rect.left + scrollOffset.x;
    const y = e.clientY - rect.top + scrollOffset.y;

    if (lastPointRef.current && drawingPathsRef.current.length > 0) {
      // Add point to current path
      const currentPath = drawingPathsRef.current[drawingPathsRef.current.length - 1];
      currentPath.points.push({ x, y });

      // Draw line from last point to current point (viewport coordinates)
      ctx.strokeStyle = drawingColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x - scrollOffset.x, lastPointRef.current.y - scrollOffset.y);
      ctx.lineTo(x - scrollOffset.x, y - scrollOffset.y);
      ctx.stroke();
    }

    lastPointRef.current = { x, y };
  }, [isDrawingMode, drawingColor, scrollOffset]);

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

  // Setup drawing canvas when iframe loads or resizes - match viewport size only
  useEffect(() => {
    const iframe = iframeRef.current;
    const canvas = drawingCanvasRef.current;

    if (viewMode === 'preview' && iframe && canvas) {
      // Match canvas size to iframe viewport (not scrollable content)
      const updateCanvasSize = () => {
        const width = iframe.offsetWidth;
        const height = iframe.offsetHeight;

        // Only update if dimensions are valid
        if (width > 0 && height > 0) {
          canvas.width = width;
          canvas.height = height;
          logger.ui.info('[MockupViewer] Canvas sized to viewport:', { width, height });
          redrawCanvas(); // Redraw after resize
        } else {
          logger.ui.warn('[MockupViewer] Iframe has zero dimensions, deferring canvas setup');
        }
      };

      // Initial size
      updateCanvasSize();

      // Also update when drawing mode is toggled (with a small delay to ensure iframe is ready)
      // This fixes the issue where canvas has zero dimensions when first entering draw mode
      let drawModeTimeoutId: ReturnType<typeof setTimeout> | null = null;
      if (isDrawingMode) {
        drawModeTimeoutId = setTimeout(updateCanvasSize, 100);
      }

      // Track iframe scroll and update scroll offset
      const iframeDoc = iframe.contentDocument;
      const handleScroll = () => {
        if (iframeDoc) {
          const scrollX = iframeDoc.documentElement.scrollLeft || iframeDoc.body.scrollLeft;
          const scrollY = iframeDoc.documentElement.scrollTop || iframeDoc.body.scrollTop;
          setScrollOffset({ x: scrollX, y: scrollY });
        }
      };

      if (iframeDoc) {
        iframeDoc.addEventListener('scroll', handleScroll);
      }

      // Update on window resize
      window.addEventListener('resize', updateCanvasSize);

      // Cleanup all listeners
      return () => {
        if (drawModeTimeoutId) {
          clearTimeout(drawModeTimeoutId);
        }
        if (iframeDoc) {
          iframeDoc.removeEventListener('scroll', handleScroll);
        }
        window.removeEventListener('resize', updateCanvasSize);
      };
    }
  }, [viewMode, isDrawingMode, redrawCanvas]);

  // Redraw canvas when scroll offset changes
  useEffect(() => {
    redrawCanvas();
  }, [scrollOffset, redrawCanvas]);

  // Handle screenshot capture requests from MCP server (via main process)
  useEffect(() => {
    const handleCaptureRequest = async (data: { requestId: string; filePath: string }) => {
      // Only respond if this viewer has the requested file open
      if (data.filePath !== filePath) {
        return; // Not our file, ignore
      }

      logger.ui.info('[MockupViewer] Received MCP screenshot request for:', filePath);

      try {
        if (!iframeRef.current) {
          throw new Error('Iframe not ready');
        }

        // Use shared utility to capture screenshot with drawing paths (absolute coordinates)
        const paths = drawingPathsRef.current.length > 0 ? drawingPathsRef.current : undefined;
        const base64Data = await captureMockupComposite(iframeRef.current, null, paths);

        logger.ui.info('[MockupViewer] MCP screenshot captured successfully');

        // Send result back to main process
        await window.electronAPI.invoke('mockup:screenshot-result', {
          requestId: data.requestId,
          success: true,
          imageBase64: base64Data,
          mimeType: 'image/png'
        });
      } catch (err) {
        logger.ui.error('[MockupViewer] MCP screenshot capture failed:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);

        // Send error result back to main process
        await window.electronAPI.invoke('mockup:screenshot-result', {
          requestId: data.requestId,
          success: false,
          error: errorMessage
        });
      }
    };

    // Listen for capture requests from main process
    const cleanup = window.electronAPI.on('mockup:capture-screenshot', handleCaptureRequest);
    return cleanup;
  }, [filePath, drawingDataUrl]);

  // Handle file watching - reload if file changes externally
  useEffect(() => {
    const handleFileChanged = async (data: { path: string }) => {
      if (data.path === filePath) {
        logger.ui.info('[MockupViewer] File changed on disk, reloading:', filePath);
        try {
          const result = await window.electronAPI.readFileContent(filePath);
          if (result?.content) {
            setContent(result.content);
            setIsDirty(false);
            if (onDirtyChange) {
              onDirtyChange(false);
            }
            // Clear annotations when mockup content is updated from disk
            clearAllAnnotations();
          }
        } catch (err) {
          logger.ui.error('[MockupViewer] Failed to reload file:', err);
        }
      }
    };

    if (window.electronAPI.onFileChangedOnDisk) {
      const cleanup = window.electronAPI.onFileChangedOnDisk(handleFileChanged);
      return cleanup;
    }
  }, [filePath, onDirtyChange, clearAllAnnotations]);

  if (error) {
    return (
      <div
        style={{
          padding: '20px',
          color: 'var(--text-primary)',
          backgroundColor: 'var(--surface-primary)',
        }}
      >
        <h3 style={{ color: 'var(--text-primary)' }}>Error Loading Mockup</h3>
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
            {viewMode === 'preview' ? 'Mockup Preview' : 'HTML Source'}
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
                title="Capture screenshot of mockup"
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
            title={`Mockup: ${fileName}`}
          />
          {/* Drawing Canvas Overlay - matches iframe viewport exactly */}
          <canvas
            ref={drawingCanvasRef}
            onMouseDown={handleDrawingMouseDown}
            onMouseMove={handleDrawingMouseMove}
            onMouseUp={handleDrawingMouseUp}
            onMouseLeave={handleDrawingMouseLeave}
            onWheel={(e) => {
              // Pass wheel events through to iframe for scrolling
              if (isDrawingMode && iframeRef.current?.contentDocument) {
                const iframeDoc = iframeRef.current.contentDocument;
                iframeDoc.documentElement.scrollTop += e.deltaY;
                iframeDoc.documentElement.scrollLeft += e.deltaX;
              }
            }}
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
