import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

interface ResizablePanelProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  leftWidth: number;
  minWidth?: number;
  maxWidth?: number;
  onWidthChange: (width: number) => void;
  collapsed?: boolean;
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  leftPanel,
  rightPanel,
  leftWidth,
  minWidth = 180,
  maxWidth = 400,
  onWidthChange,
  collapsed = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [currentWidth, setCurrentWidth] = useState(leftWidth);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(leftWidth);

  // Update current width when prop changes
  useEffect(() => {
    setCurrentWidth(leftWidth);
  }, [leftWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = currentWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [currentWidth]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + deltaX));
      setCurrentWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Notify parent of the final width
      onWidthChange(currentWidth);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, currentWidth, minWidth, maxWidth, onWidthChange]);

  const displayWidth = collapsed ? 0 : currentWidth;

  return (
    <div className="resizable-panel-container flex flex-1 overflow-hidden h-full" ref={containerRef}>
      {!collapsed && (
        <>
          <div
            className="resizable-panel-left flex flex-col overflow-hidden bg-nim border-r border-nim"
            style={{ width: `${displayWidth}px`, flexShrink: 0 }}
          >
            {leftPanel}
          </div>
          <div
            className={`resizable-panel-divider relative w-0.5 cursor-ew-resize bg-nim-border shrink-0 transition-colors duration-150 hover:bg-nim-accent ${isDragging ? 'bg-nim-accent' : ''}`}
            onMouseDown={handleMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize session history panel"
            aria-valuenow={currentWidth}
            aria-valuemin={minWidth}
            aria-valuemax={maxWidth}
          >
            <div className="resizable-panel-divider-handle absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-10 bg-transparent pointer-events-none" />
          </div>
        </>
      )}
      <div className="resizable-panel-right flex-1 flex flex-col overflow-hidden bg-nim">
        {rightPanel}
      </div>
    </div>
  );
};
