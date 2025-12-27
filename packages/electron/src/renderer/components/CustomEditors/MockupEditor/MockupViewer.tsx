/**
 * MockupViewer - Custom editor for .mockup.html files
 *
 * Uses the EditorHost API via useEditorHost hook for all host communication:
 * - Content loading and state management
 * - File change notifications with echo detection
 * - Save handling
 * - Source mode via host.toggleSourceMode() (TabEditor renders Monaco)
 * - Diff mode via host.onDiffRequested() + host.reportDiffResult()
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { EditorHostProps } from '@nimbalyst/runtime';
import { useEditorHost } from '@nimbalyst/runtime';
import { logger } from '../../../utils/logger';
import { captureMockupComposite } from './screenshotUtils';
import { renderMockupHtml } from './mockupDomUtils';
import { MockupDiffViewer } from './MockupDiffViewer';
import {
  FloatingEditorActions,
  FloatingEditorButton,
} from '../../FloatingEditorActions';

export const MockupViewer: React.FC<EditorHostProps> = ({ host }) => {
  const { filePath, fileName, theme, isActive } = host;

  // Refs for clearAllAnnotations (defined early so hook can reference)
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const drawingPathsRef = useRef<Array<{ points: { x: number; y: number }[]; color: string }>>([]);

  // UI state that clearAllAnnotations modifies
  const [drawingDataUrl, setDrawingDataUrl] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<{
    selector: string;
    outerHTML: string;
    tagName: string;
  } | null>(null);
  const [annotationTimestamp, setAnnotationTimestamp] = useState<number | null>(null);

  // Clear all annotations - defined before useEditorHost so it can be passed to onExternalChange
  const clearAllAnnotations = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    drawingPathsRef.current = [];
    setDrawingDataUrl(null);
    setSelectedElement(null);
    setAnnotationTimestamp(null);

    const iframeDoc = iframeRef.current?.contentDocument;
    if (iframeDoc) {
      iframeDoc.querySelectorAll('.nimbalyst-selected').forEach((el) => {
        el.classList.remove('nimbalyst-selected');
      });
    }
  }, []);

  // Use the EditorHost hook for content management
  // This handles: content loading, file change subscriptions, save handling, dirty state
  const editorHostOptions = useMemo(() => ({
    logPrefix: '[MockupViewer]',
    onExternalChange: () => {
      // Clear annotations when content changes externally
      clearAllAnnotations();
    },
  }), [clearAllAnnotations]);

  const {
    content,
    setContent,
    isLoading,
    error,
  } = useEditorHost(host, editorHostOptions);

  // Diff mode state (not handled by useEditorHost - it's a mockup-specific feature)
  const [diffData, setDiffData] = useState<{
    originalContent: string;
    modifiedContent: string;
    tagId: string;
    sessionId: string;
  } | null>(null);
  const [diffAction, setDiffAction] = useState<'idle' | 'accept' | 'reject'>('idle');

  // Additional UI state
  const [isCapturing, setIsCapturing] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawingColor, setDrawingColor] = useState('#FF0000');
  const [scrollOffset, setScrollOffset] = useState({ x: 0, y: 0 });

  // Subscribe to diff requests (not handled by useEditorHost)
  useEffect(() => {
    if (!host.onDiffRequested) return;

    return host.onDiffRequested((config) => {
      logger.ui.info('[MockupViewer] Diff requested:', {
        tagId: config.tagId,
        sessionId: config.sessionId,
      });
      setDiffData(config);
    });
  }, [host]);

  // Clear annotations when filePath changes
  useEffect(() => {
    clearAllAnnotations();
  }, [filePath, clearAllAnnotations]);

  // Handle diff accept
  const handleDiffAccept = useCallback(async () => {
    if (!diffData || !host.reportDiffResult) return;

    setDiffAction('accept');
    try {
      host.reportDiffResult({
        content: diffData.modifiedContent,
        action: 'accept',
      });

      // Update content through the hook's setContent
      setContent(diffData.modifiedContent);
      setDiffData(null);
      logger.ui.info('[MockupViewer] Diff accepted');
    } catch (err) {
      logger.ui.error('[MockupViewer] Error accepting diff:', err);
    } finally {
      setDiffAction('idle');
    }
  }, [diffData, host, setContent]);

  // Handle diff reject
  const handleDiffReject = useCallback(async () => {
    if (!diffData || !host.reportDiffResult) return;

    setDiffAction('reject');
    try {
      host.reportDiffResult({
        content: diffData.originalContent,
        action: 'reject',
      });

      // Update content through the hook's setContent
      setContent(diffData.originalContent);
      setDiffData(null);
      logger.ui.info('[MockupViewer] Diff rejected');
    } catch (err) {
      logger.ui.error('[MockupViewer] Error rejecting diff:', err);
    } finally {
      setDiffAction('idle');
    }
  }, [diffData, host, setContent]);

  // Generate CSS selector for element
  const generateSelector = useCallback((element: Element): string => {
    if (element.id) {
      return `#${element.id}`;
    }

    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter((c) => c);
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

    const tagName = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (e) => e.tagName === element.tagName
      );
      const index = siblings.indexOf(element);
      if (index >= 0) {
        const parentSelector = parent.tagName.toLowerCase();
        return `${parentSelector} > ${tagName}:nth-child(${index + 1})`;
      }
    }

    return tagName;
  }, []);

  // Handle element click in preview
  const handleElementClick = useCallback(
    (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (target.tagName === 'BODY' || target.tagName === 'HTML') return;

      event.preventDefault();
      event.stopPropagation();

      const selector = generateSelector(target);
      const outerHTML = target.outerHTML;
      const tagName = target.tagName.toLowerCase();

      setSelectedElement({ selector, outerHTML, tagName });
      setAnnotationTimestamp(Date.now());

      const iframeDoc = iframeRef.current?.contentDocument;
      if (iframeDoc) {
        iframeDoc.querySelectorAll('.nimbalyst-selected').forEach((el) => {
          el.classList.remove('nimbalyst-selected');
        });
        target.classList.add('nimbalyst-selected');
      }
    },
    [generateSelector]
  );

  // Deselect element
  const handleDeselectElement = useCallback(() => {
    setSelectedElement(null);

    const iframeDoc = iframeRef.current?.contentDocument;
    if (iframeDoc) {
      iframeDoc.querySelectorAll('.nimbalyst-selected').forEach((el) => {
        el.classList.remove('nimbalyst-selected');
      });
    }
  }, []);

  // Update iframe when content changes
  useEffect(() => {
    if (iframeRef.current && content) {
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
        },
      });
    }

    return () => {
      const iframeDoc = iframeRef.current?.contentDocument;
      if (iframeDoc) {
        iframeDoc.removeEventListener('click', handleElementClick as any);
      }
    };
  }, [content, handleElementClick]);

  // Expose file path to window for AI context
  useEffect(() => {
    if (isActive) {
      (window as any).__mockupFilePath = filePath;
      const hasAnnotations = !!(drawingDataUrl || selectedElement);
      const event = new CustomEvent('mockup-annotation-changed', {
        detail: {
          filePath,
          annotationTimestamp,
          hasAnnotations,
          hasDrawing: !!drawingDataUrl,
          hasSelection: !!selectedElement,
        },
      });
      window.dispatchEvent(event);
    } else {
      delete (window as any).__mockupFilePath;
      const event = new CustomEvent('mockup-annotation-changed', {
        detail: {
          filePath: '',
          annotationTimestamp: null,
          hasAnnotations: false,
          hasDrawing: false,
          hasSelection: false,
        },
      });
      window.dispatchEvent(event);
    }

    return () => {
      delete (window as any).__mockupFilePath;
    };
  }, [filePath, isActive, annotationTimestamp, drawingDataUrl, selectedElement]);

  // Expose selected element and drawing for AI context
  useEffect(() => {
    (window as any).__mockupSelectedElement = selectedElement;
    return () => {
      delete (window as any).__mockupSelectedElement;
    };
  }, [selectedElement]);

  useEffect(() => {
    (window as any).__mockupDrawing = drawingDataUrl;
    return () => {
      delete (window as any).__mockupDrawing;
    };
  }, [drawingDataUrl]);

  useEffect(() => {
    (window as any).__mockupAnnotationTimestamp = annotationTimestamp;
    return () => {
      delete (window as any).__mockupAnnotationTimestamp;
    };
  }, [annotationTimestamp]);

  // Dispatch annotation change events
  useEffect(() => {
    const hasAnnotations = !!(drawingDataUrl || selectedElement);
    const event = new CustomEvent('mockup-annotation-changed', {
      detail: {
        filePath,
        annotationTimestamp,
        hasAnnotations,
        hasDrawing: !!drawingDataUrl,
        hasSelection: !!selectedElement,
      },
    });
    window.dispatchEvent(event);
  }, [filePath, annotationTimestamp, drawingDataUrl, selectedElement]);

  // Redraw canvas
  const redrawCanvas = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawingPathsRef.current.forEach((path) => {
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
      }
    }
  }, []);

  // Toggle drawing mode
  const handleToggleDrawing = useCallback(() => {
    setIsDrawingMode((prev) => !prev);
    if (isDrawingMode) {
      const canvas = drawingCanvasRef.current;
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        setDrawingDataUrl(dataUrl);
      }
    }
  }, [isDrawingMode]);

  // Drawing event handlers
  const handleDrawingMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawingMode) return;

      const canvas = drawingCanvasRef.current;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollOffset.x;
      const y = e.clientY - rect.top + scrollOffset.y;

      isDrawingRef.current = true;
      lastPointRef.current = { x, y };
      setAnnotationTimestamp(Date.now());

      drawingPathsRef.current.push({
        points: [{ x, y }],
        color: drawingColor,
      });
    },
    [isDrawingMode, scrollOffset, drawingColor]
  );

  const handleDrawingMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawingMode || !isDrawingRef.current) return;

      const canvas = drawingCanvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollOffset.x;
      const y = e.clientY - rect.top + scrollOffset.y;

      if (lastPointRef.current && drawingPathsRef.current.length > 0) {
        const currentPath = drawingPathsRef.current[drawingPathsRef.current.length - 1];
        currentPath.points.push({ x, y });

        ctx.strokeStyle = drawingColor;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(
          lastPointRef.current.x - scrollOffset.x,
          lastPointRef.current.y - scrollOffset.y
        );
        ctx.lineTo(x - scrollOffset.x, y - scrollOffset.y);
        ctx.stroke();
      }

      lastPointRef.current = { x, y };
    },
    [isDrawingMode, drawingColor, scrollOffset]
  );

  const handleDrawingMouseUp = useCallback(() => {
    isDrawingRef.current = false;
    lastPointRef.current = null;

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

  // Setup canvas size
  useEffect(() => {
    const iframe = iframeRef.current;
    const canvas = drawingCanvasRef.current;

    if (!iframe || !canvas) {
      return;
    }

    const updateCanvasSize = () => {
      const width = iframe.offsetWidth;
      const height = iframe.offsetHeight;

      if (width > 0 && height > 0) {
        canvas.width = width;
        canvas.height = height;
        redrawCanvas();
      }
    };

    updateCanvasSize();

    let drawModeTimeoutId: ReturnType<typeof setTimeout> | null = null;
    if (isDrawingMode) {
      drawModeTimeoutId = setTimeout(updateCanvasSize, 100);
    }

    const iframeDoc = iframe.contentDocument;
    const handleScroll = () => {
      if (iframeDoc) {
        const scrollX =
          iframeDoc.documentElement.scrollLeft || iframeDoc.body.scrollLeft;
        const scrollY =
          iframeDoc.documentElement.scrollTop || iframeDoc.body.scrollTop;
        setScrollOffset({ x: scrollX, y: scrollY });
      }
    };

    if (iframeDoc) {
      iframeDoc.addEventListener('scroll', handleScroll);
    }

    window.addEventListener('resize', updateCanvasSize);

    return () => {
      if (drawModeTimeoutId) {
        clearTimeout(drawModeTimeoutId);
      }
      if (iframeDoc) {
        iframeDoc.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [isDrawingMode, redrawCanvas]);

  // Redraw when scroll changes
  useEffect(() => {
    redrawCanvas();
  }, [scrollOffset, redrawCanvas]);

  // Handle MCP screenshot requests
  useEffect(() => {
    const handleCaptureRequest = async (data: { requestId: string; filePath: string }) => {
      if (data.filePath !== filePath) return;

      logger.ui.info('[MockupViewer] Received MCP screenshot request');

      try {
        if (!iframeRef.current) {
          throw new Error('Iframe not ready');
        }

        const paths = drawingPathsRef.current.length > 0 ? drawingPathsRef.current : undefined;
        const base64Data = await captureMockupComposite(iframeRef.current, null, paths);

        await window.electronAPI.invoke('mockup:screenshot-result', {
          requestId: data.requestId,
          success: true,
          imageBase64: base64Data,
          mimeType: 'image/png',
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await window.electronAPI.invoke('mockup:screenshot-result', {
          requestId: data.requestId,
          success: false,
          error: errorMessage,
        });
      }
    };

    const cleanup = window.electronAPI.on('mockup:capture-screenshot', handleCaptureRequest);
    return cleanup;
  }, [filePath]);

  // Screenshot capture
  const handleCaptureScreenshot = useCallback(async () => {
    if (!iframeRef.current) {
      alert('Screenshot failed: iframe not ready');
      return;
    }

    setIsCapturing(true);

    try {
      const iframe = iframeRef.current;
      const iframeWindow = iframe.contentWindow;
      const iframeDoc = iframe.contentDocument || iframeWindow?.document;

      if (!iframeDoc || !iframeDoc.body) {
        throw new Error('Cannot access iframe document');
      }

      if (iframeDoc.readyState !== 'complete') {
        await new Promise((resolve) => {
          iframeWindow?.addEventListener('load', resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      }

      const html2canvas = (await import('html2canvas')).default;
      const targetElement = iframeDoc.body;
      const elemWidth = targetElement.scrollWidth || targetElement.offsetWidth || iframe.offsetWidth;
      const elemHeight = targetElement.scrollHeight || targetElement.offsetHeight || iframe.offsetHeight;

      if (elemWidth === 0 || elemHeight === 0) {
        throw new Error('Target element has zero dimensions');
      }

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

      canvas.toBlob(async (blob) => {
        if (!blob) {
          throw new Error('Failed to create image blob');
        }

        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
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
          `;
          document.body.appendChild(notification);
          setTimeout(() => notification.remove(), 3000);
        } catch {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          a.href = url;
          a.download = `${fileName.replace('.mockup.html', '')}-screenshot-${timestamp}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      }, 'image/png');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert('Failed to capture screenshot: ' + errorMessage);
    } finally {
      setIsCapturing(false);
    }
  }, [fileName]);

  // Render loading state
  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-secondary)',
        }}
      >
        Loading mockup...
      </div>
    );
  }

  // Render error state
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
        <p style={{ color: 'var(--text-secondary)' }}>{error.message}</p>
        <p style={{ fontSize: '14px', color: 'var(--text-tertiary)', marginTop: '12px' }}>
          File: {fileName}
        </p>
      </div>
    );
  }

  // Render diff mode
  if (diffData) {
    return (
      <MockupDiffViewer
        originalHtml={diffData.originalContent}
        updatedHtml={diffData.modifiedContent}
        fileName={fileName}
        onAccept={handleDiffAccept}
        onReject={handleDiffReject}
        isAccepting={diffAction === 'accept'}
        isRejecting={diffAction === 'reject'}
      />
    );
  }

  // Render preview mode
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--surface-primary)',
        position: 'relative',
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
          {selectedElement && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 8px',
                backgroundColor: 'rgba(0, 122, 255, 0.1)',
                borderRadius: '4px',
                border: '1px solid rgba(0, 122, 255, 0.3)',
              }}
            >
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
            Mockup Preview
          </span>
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
        </div>
      </div>

      {/* Content Area */}
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
        {/* Drawing Canvas Overlay */}
        <canvas
          ref={drawingCanvasRef}
          onMouseDown={handleDrawingMouseDown}
          onMouseMove={handleDrawingMouseMove}
          onMouseUp={handleDrawingMouseUp}
          onMouseLeave={handleDrawingMouseLeave}
          onWheel={(e) => {
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

        {/* Floating action buttons */}
        {host.supportsSourceMode && (
          <FloatingEditorActions>
            <FloatingEditorButton
              icon="code"
              label="View Source"
              onClick={() => host.toggleSourceMode?.()}
            />
          </FloatingEditorActions>
        )}
      </div>
    </div>
  );
};
