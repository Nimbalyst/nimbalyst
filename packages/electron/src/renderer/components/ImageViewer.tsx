/**
 * ImageViewer - Simple image display component for standalone image files
 *
 * Displays image files (PNG, JPG, GIF, SVG, etc.) in the editor area.
 * Does not use Lexical - this is for viewing image files directly.
 */

import React, { useEffect, useState } from 'react';

interface ImageViewerProps {
  filePath: string;
  fileName: string;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ filePath, fileName }) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const loadImage = async () => {
      try {
        // Convert file path to file:// URL for display
        const fileUrl = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
        setImageSrc(fileUrl);
        setError(null);
      } catch (err) {
        setError('Failed to load image');
        console.error('Error loading image:', err);
      }
    };

    loadImage();
  }, [filePath]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  };

  const handleImageError = () => {
    setError('Failed to load image');
  };

  if (error) {
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
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📷</div>
          <div>{error}</div>
          <div style={{ fontSize: '12px', marginTop: '8px', opacity: 0.7 }}>{fileName}</div>
        </div>
      </div>
    );
  }

  if (!imageSrc) {
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
        Loading...
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
        backgroundColor: 'var(--surface-primary)',
      }}
    >
      {/* Info bar */}
      {dimensions && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: 'var(--surface-secondary)',
            borderBottom: '1px solid var(--border-primary)',
            color: 'var(--text-secondary)',
            fontSize: '12px',
            display: 'flex',
            gap: '16px',
          }}
        >
          <span>{fileName}</span>
          <span>
            {dimensions.width} × {dimensions.height}
          </span>
        </div>
      )}

      {/* Image container */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
        }}
      >
        <img
          src={imageSrc}
          alt={fileName}
          onLoad={handleImageLoad}
          onError={handleImageError}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
          }}
        />
      </div>
    </div>
  );
};
