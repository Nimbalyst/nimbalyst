import React, { useState } from 'react';
import './ImageDiffViewer.css';

interface ImageDiffViewerProps {
  oldImagePath: string;
  newImagePath: string;
  filePath: string;
}

type ViewMode = 'side-by-side' | 'swipe' | 'onion-skin';

export function ImageDiffViewer({
  oldImagePath,
  newImagePath,
  filePath
}: ImageDiffViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [swipePosition, setSwipePosition] = useState(50);
  const [opacity, setOpacity] = useState(50);

  return (
    <div className="image-diff-viewer">
      <div className="image-diff-controls">
        <div className="image-diff-mode-toggle">
          <button
            className={`image-diff-mode-button ${viewMode === 'side-by-side' ? 'active' : ''}`}
            onClick={() => setViewMode('side-by-side')}
          >
            Side by Side
          </button>
          <button
            className={`image-diff-mode-button ${viewMode === 'swipe' ? 'active' : ''}`}
            onClick={() => setViewMode('swipe')}
          >
            Swipe
          </button>
          <button
            className={`image-diff-mode-button ${viewMode === 'onion-skin' ? 'active' : ''}`}
            onClick={() => setViewMode('onion-skin')}
          >
            Overlay
          </button>
        </div>

        {viewMode === 'swipe' && (
          <div className="image-diff-slider-container">
            <label>Position</label>
            <input
              type="range"
              min="0"
              max="100"
              value={swipePosition}
              onChange={(e) => setSwipePosition(Number(e.target.value))}
              className="image-diff-slider"
            />
          </div>
        )}

        {viewMode === 'onion-skin' && (
          <div className="image-diff-slider-container">
            <label>Opacity</label>
            <input
              type="range"
              min="0"
              max="100"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="image-diff-slider"
            />
          </div>
        )}
      </div>

      <div className="image-diff-content">
        {viewMode === 'side-by-side' && (
          <div className="image-diff-side-by-side">
            <div className="image-diff-panel">
              <div className="image-diff-label">Old Version</div>
              <div className="image-diff-container">
                <img src={`file://${oldImagePath}`} alt="Old version" />
              </div>
            </div>
            <div className="image-diff-panel">
              <div className="image-diff-label">New Version</div>
              <div className="image-diff-container">
                <img src={`file://${newImagePath}`} alt="New version" />
              </div>
            </div>
          </div>
        )}

        {viewMode === 'swipe' && (
          <div className="image-diff-swipe">
            <div className="image-diff-swipe-container">
              <img
                src={`file://${newImagePath}`}
                alt="New version"
                className="image-diff-swipe-new"
              />
              <div
                className="image-diff-swipe-old-wrapper"
                style={{ clipPath: `inset(0 ${100 - swipePosition}% 0 0)` }}
              >
                <img
                  src={`file://${oldImagePath}`}
                  alt="Old version"
                  className="image-diff-swipe-old"
                />
              </div>
              <div
                className="image-diff-swipe-divider"
                style={{ left: `${swipePosition}%` }}
              />
            </div>
          </div>
        )}

        {viewMode === 'onion-skin' && (
          <div className="image-diff-overlay">
            <div className="image-diff-overlay-container">
              <img
                src={`file://${newImagePath}`}
                alt="New version"
                className="image-diff-overlay-new"
              />
              <img
                src={`file://${oldImagePath}`}
                alt="Old version"
                className="image-diff-overlay-old"
                style={{ opacity: opacity / 100 }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
