import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderMockupHtml } from './mockupDomUtils';
import './MockupDiffViewer.css';

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
    <div className="mockup-diff-viewer">
      <div className="mockup-diff-content" role="region" aria-label={isNewFile ? 'New mockup preview' : 'Mockup diff preview'}>
        {isNewFile ? (
          // New file: simple preview without slider
          <div className="mockup-diff-new-file-wrapper">
            <div className="mockup-diff-new-file-stage">
              <iframe
                ref={afterFrameRef}
                title="New mockup preview"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>
        ) : (
          // Modified file: show slider diff view
          <div className="mockup-diff-slider-wrapper">
            <div
              className={`mockup-diff-slider-stage ${isDragging ? 'dragging' : ''}`}
              ref={sliderStageRef}
            >
              <iframe
                ref={afterFrameRef}
                title="Updated mockup preview"
                sandbox="allow-scripts allow-same-origin"
              />
              <div
                className="mockup-diff-slider-before"
                style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
              >
                <iframe
                  ref={beforeFrameRef}
                  title="Original mockup preview"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
              <div
                className="mockup-diff-slider-handle"
                style={{ left: `${sliderPosition}%` }}
                role="slider"
                aria-valuenow={sliderPosition}
                aria-valuemin={0}
                aria-valuemax={100}
                onPointerDown={handleSliderPointerDown}
              >
                <div className="mockup-diff-slider-handle-bar" />
              </div>
              <div className="mockup-diff-slider-label before">Before</div>
              <div className="mockup-diff-slider-label after">After</div>
              <div className="mockup-diff-slider-hint">Drag anywhere to compare</div>
              <div
                className="mockup-diff-slider-overlay"
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
