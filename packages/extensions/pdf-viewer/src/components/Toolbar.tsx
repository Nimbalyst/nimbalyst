interface ToolbarProps {
  totalPages: number;
  scale: number;
  fitToWidth: boolean;
  onScaleChange: (scale: number) => void;
  onFitToWidthToggle: () => void;
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export function Toolbar({ totalPages, scale, fitToWidth, onScaleChange, onFitToWidthToggle }: ToolbarProps) {
  const currentZoomPercent = Math.round(scale * 100);

  const handleZoomIn = () => {
    const nextLevel = ZOOM_LEVELS.find((level) => level > scale);
    if (nextLevel) {
      onScaleChange(nextLevel);
    }
  };

  const handleZoomOut = () => {
    const prevLevel = [...ZOOM_LEVELS].reverse().find((level) => level < scale);
    if (prevLevel) {
      onScaleChange(prevLevel);
    }
  };

  const handleZoomReset = () => {
    onScaleChange(1.0);
  };

  return (
    <div className="pdf-toolbar">
      <div className="pdf-toolbar-content">
        <div className="pdf-info">
          <span>{totalPages} pages</span>
        </div>

        <div className="pdf-zoom-controls">
          <button
            className={`pdf-toolbar-button pdf-fit-button ${fitToWidth ? 'active' : ''}`}
            onClick={onFitToWidthToggle}
            title="Fit to Width"
          >
            Fit
          </button>

          <button
            className="pdf-toolbar-button"
            onClick={handleZoomOut}
            disabled={scale <= ZOOM_LEVELS[0]}
            title="Zoom Out (Cmd+-)"
          >
            -
          </button>

          <span className="pdf-zoom-level" onClick={handleZoomReset} title="Click to reset zoom">
            {currentZoomPercent}%
          </span>

          <button
            className="pdf-toolbar-button"
            onClick={handleZoomIn}
            disabled={scale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            title="Zoom In (Cmd++)"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
