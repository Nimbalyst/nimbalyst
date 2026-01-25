import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderMockupHtml } from './mockupDomUtils';

interface MockupDiffViewerProps {
  originalHtml: string;
  updatedHtml: string;
  fileName: string;
}

/**
 * MockupDiffViewer - Visual diff comparison for mockup files
 *
 * This component provides the slider-based visual diff UI for comparing
 * original vs modified mockups. Accept/reject actions are handled by
 * the unified diff header (UnifiedDiffHeader) in TabEditor.
 */
export const MockupDiffViewer: React.FC<MockupDiffViewerProps> = ({
  originalHtml,
  updatedHtml,
  fileName,
}) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const beforeFrameRef = useRef<HTMLIFrameElement>(null);
  const afterFrameRef = useRef<HTMLIFrameElement>(null);
  const sliderStageRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  // Detect if this is a new file (no original content to diff against)
  const isNewFile = useMemo(() => !originalHtml || originalHtml.trim() === '', [originalHtml]);

  const loadBefore = useCallback(() => {
    if (!isNewFile) {
      renderMockupHtml(beforeFrameRef.current, originalHtml);
    }
  }, [originalHtml, isNewFile]);

  const loadAfter = useCallback(() => {
    renderMockupHtml(afterFrameRef.current, updatedHtml);
  }, [updatedHtml]);

  useEffect(() => {
    loadBefore();
  }, [loadBefore]);

  const updateSliderFromPointer = useCallback((clientX: number) => {
    const stage = sliderStageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const relative = ((clientX - rect.left) / rect.width) * 100;
    setSliderPosition(Math.max(0, Math.min(100, relative)));
  }, []);

  useEffect(() => {
    loadAfter();
  }, [loadAfter]);

  useEffect(() => {
    const handlePointerUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingRef.current) return;
      updateSliderFromPointer(event.clientX);
    };

    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointermove', handlePointerMove);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [updateSliderFromPointer]);

  const handleSliderPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    isDraggingRef.current = true;
    setIsDragging(true);
    updateSliderFromPointer(event.clientX);
  }, [updateSliderFromPointer]);

  return (
    <div className="mockup-diff-viewer flex flex-col h-full bg-[var(--nim-bg)]">
      <div
        className="mockup-diff-content flex-1 flex flex-col overflow-hidden bg-[#111]"
        role="region"
        aria-label={isNewFile ? 'New mockup preview' : 'Mockup diff preview'}
      >
        {isNewFile ? (
          // New file: simple preview without slider
          <div className="mockup-diff-new-file-wrapper flex-1 flex flex-col p-4">
            <div className="mockup-diff-new-file-stage relative flex-1 rounded-lg overflow-hidden bg-black [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:border-none [&>iframe]:w-full [&>iframe]:h-full">
              <iframe
                ref={afterFrameRef}
                title="New mockup preview"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>
        ) : (
          // Modified file: show slider diff view
          <div className="mockup-diff-slider-wrapper flex-1 flex flex-col p-4 gap-3">
            <div
              className={`mockup-diff-slider-stage relative flex-1 rounded-lg overflow-hidden bg-black cursor-ew-resize [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:border-none [&>iframe]:w-full [&>iframe]:h-full ${isDragging ? 'dragging cursor-grabbing' : ''}`}
              ref={sliderStageRef}
            >
              <iframe
                ref={afterFrameRef}
                title="Updated mockup preview"
                sandbox="allow-scripts allow-same-origin"
              />
              <div
                className="mockup-diff-slider-before absolute inset-0 w-full h-full overflow-hidden border-r border-white/50 pointer-events-none [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:w-full [&>iframe]:h-full"
                style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
              >
                <iframe
                  ref={beforeFrameRef}
                  title="Original mockup preview"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
              <div
                className="mockup-diff-slider-handle absolute top-0 bottom-0 w-0.5 bg-white/80 border border-gray-500/75 pointer-events-auto cursor-ew-resize z-[6]"
                style={{ left: `${sliderPosition}%` }}
                role="slider"
                aria-valuenow={sliderPosition}
                aria-valuemin={0}
                aria-valuemax={100}
                onPointerDown={handleSliderPointerDown}
              >
                <div className="mockup-diff-slider-handle-bar absolute top-1/2 -left-2.5 w-5 h-10 bg-white/90 rounded-full border-2 border-gray-500/75 -translate-y-1/2" />
              </div>
              <div className="mockup-diff-slider-label before absolute top-3 left-4 py-1 px-2.5 text-[11px] uppercase tracking-wide rounded-full bg-black/55 text-white z-[6]">Before</div>
              <div className="mockup-diff-slider-label after absolute top-3 right-4 py-1 px-2.5 text-[11px] uppercase tracking-wide rounded-full bg-black/55 text-white z-[6]">After</div>
              <div className="mockup-diff-slider-hint absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs py-1 px-2.5 rounded-full pointer-events-none z-[6]">Drag anywhere to compare</div>
              <div
                className="mockup-diff-slider-overlay absolute inset-0 z-[5] cursor-ew-resize"
                onPointerDown={handleSliderPointerDown}
                aria-hidden="true"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
