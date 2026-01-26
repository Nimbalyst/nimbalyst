/**
 * Gallery Component
 *
 * Displays a scrollable list of image generations grouped by prompt.
 */

import React, { useState, useEffect } from 'react';
import type { Generation, GeneratedImage } from '../types';
import { STYLE_PRESETS } from '../types';

interface GalleryProps {
  generations: Generation[];
  imagesBasePath: string;
  onEditPrompt: (generation: Generation) => void;
  theme: 'light' | 'dark';
}

interface ExpandedImage {
  image: GeneratedImage;
  generation: Generation;
}

export function Gallery({ generations, imagesBasePath, onEditPrompt, theme }: GalleryProps) {
  const isDark = theme === 'dark';
  const [expandedImage, setExpandedImage] = useState<ExpandedImage | null>(null);

  // Handle Escape key to close lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && expandedImage) {
        setExpandedImage(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expandedImage]);

  // Get style label from preset
  const getStyleLabel = (styleId: string): string => {
    const preset = STYLE_PRESETS.find((p) => p.id === styleId);
    return preset?.label || styleId;
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `Today at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } else {
      return (
        date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ` at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      );
    }
  };

  // Get dimensions string
  const getDimensions = (generation: Generation): string => {
    if (generation.results.length > 0) {
      const first = generation.results[0];
      return `${first.width} x ${first.height}`;
    }
    // Default based on aspect ratio
    const aspectMap: Record<string, string> = {
      '1:1': '1024 x 1024',
      '16:9': '1920 x 1080',
      '9:16': '1080 x 1920',
      '4:3': '1024 x 768',
      '3:4': '768 x 1024',
    };
    return aspectMap[generation.aspectRatio] || '1024 x 1024';
  };

  if (generations.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-nim-muted text-center p-10">
        <div className="text-[64px] mb-4 opacity-30">&#127912;</div>
        <div className="text-base font-medium text-nim mb-2">
          No images yet
        </div>
        <div className="text-[13px] max-w-[300px] leading-normal">
          Enter a prompt below to generate your first image
        </div>
      </div>
    );
  }

  // Lightbox component for expanded image view
  const Lightbox = () => {
    if (!expandedImage) return null;

    const { image, generation } = expandedImage;

    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'var(--surface-secondary)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1000,
        }}
        onClick={() => setExpandedImage(null)}
      >
        {/* Header bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: 'var(--surface-tertiary)',
            borderBottom: '1px solid var(--border-primary)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-primary)',
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {generation.prompt}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                marginTop: 4,
              }}
            >
              {image.width} x {image.height} &middot; {getStyleLabel(generation.style)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginLeft: 16 }}>
            <button
              onClick={() => {
                // Download image
                const link = document.createElement('a');
                link.href = `file://${imagesBasePath}/${image.file}`;
                link.download = image.file;
                link.click();
              }}
              style={{
                padding: '6px 12px',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border-primary)',
                borderRadius: 5,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>&#8595;</span> Download
            </button>
            <button
              onClick={() => setExpandedImage(null)}
              style={{
                padding: '6px 12px',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border-primary)',
                borderRadius: 5,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Image container */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            overflow: 'hidden',
          }}
        >
          <img
            src={`file://${imagesBasePath}/${image.file}`}
            alt={generation.prompt}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 8,
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Navigation hint */}
        <div
          style={{
            padding: '8px 16px',
            textAlign: 'center',
            color: 'var(--text-tertiary)',
            fontSize: 11,
          }}
        >
          Press Escape or click outside to close
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: 20,
        position: 'relative',
      }}
    >
      <Lightbox />
      {generations.map((generation) => (
        <div key={generation.id} style={{ marginBottom: 32 }}>
          {/* Generation header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              marginBottom: 16,
              padding: '12px 16px',
              background: 'var(--nim-bg-secondary)',
              borderRadius: 8,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div
                  style={{
                    flex: 1,
                    fontSize: 13,
                    color: 'var(--nim-text)',
                    lineHeight: 1.5,
                  }}
                >
                  {generation.prompt}
                </div>
                <button
                  onClick={() => onEditPrompt(generation)}
                  style={{
                    padding: '6px 10px',
                    background: 'transparent',
                    border: '1px solid var(--nim-border)',
                    borderRadius: 5,
                    color: 'var(--nim-text-muted)',
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  <span>&#9998;</span>
                  Edit & Retry
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 8,
                  fontSize: 11,
                  color: 'var(--nim-text-faint)',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    padding: '3px 8px',
                    background: isDark ? 'rgba(96, 165, 250, 0.2)' : 'rgba(59, 130, 246, 0.1)',
                    color: 'var(--nim-link)',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {getStyleLabel(generation.style)}
                </span>
                <span>{getDimensions(generation)}</span>
                <span>{formatTimestamp(generation.timestamp)}</span>
              </div>
            </div>
          </div>

          {/* Generated images grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 16,
            }}
          >
            {generation.results.length > 0 ? (
              generation.results.map((result, index) => (
                <div
                  key={`${generation.id}-${index}`}
                  style={{
                    position: 'relative',
                    aspectRatio: '1',
                    background: 'var(--nim-bg-secondary)',
                    borderRadius: 8,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    border: '2px solid transparent',
                    transition: 'border-color 0.15s ease',
                  }}
                  onClick={() => setExpandedImage({ image: result, generation })}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--nim-border)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'transparent';
                  }}
                >
                  {/* Image or placeholder */}
                  <img
                    src={`file://${imagesBasePath}/${result.file}`}
                    alt={`Generated image ${index + 1}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                    onError={(e) => {
                      // Replace with placeholder on error
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  <div className="hidden w-full h-full items-center justify-center bg-nim-tertiary">
                    <div className="text-center text-nim-muted">
                      <div className="text-[40px] mb-2 opacity-50">&#128247;</div>
                      <div className="text-[11px]">{result.file}</div>
                    </div>
                  </div>

                  {/* Hover overlay with actions */}
                  <div
                    className="image-overlay absolute bottom-0 left-0 right-0 p-2.5 bg-gradient-to-t from-black/80 to-transparent opacity-0 transition-opacity duration-150"
                  >
                    <div className="flex gap-1.5 justify-end">
                      <button
                        title="Download"
                        className="w-7 h-7 flex items-center justify-center bg-white/15 border-none rounded text-white cursor-pointer text-[13px]"
                      >
                        &#8595;
                      </button>
                      <button
                        title="Copy to clipboard"
                        className="w-7 h-7 flex items-center justify-center bg-white/15 border-none rounded text-white cursor-pointer text-[13px]"
                      >
                        &#128203;
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              // Placeholder for pending generation
              <div className="relative aspect-square bg-nim-secondary rounded-lg flex items-center justify-center">
                <div className="text-center text-nim-muted">
                  <div className="text-[40px] mb-2 opacity-50">&#8987;</div>
                  <div className="text-[11px]">Pending</div>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* CSS for hover effects */}
      <style>{`
        .image-overlay:hover,
        div:hover > .image-overlay {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}
