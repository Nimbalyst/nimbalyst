/**
 * Gallery Component
 *
 * Displays a scrollable list of image generations grouped by prompt.
 */

import { useState } from 'react';
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
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ` at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
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
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: isDark ? '#808080' : '#6b7280',
          textAlign: 'center',
          padding: 40,
        }}
      >
        <div style={{ fontSize: 64, marginBottom: 16, opacity: 0.3 }}>&#127912;</div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: isDark ? '#b3b3b3' : '#374151',
            marginBottom: 8,
          }}
        >
          No images yet
        </div>
        <div style={{ fontSize: 13, maxWidth: 300, lineHeight: 1.5 }}>
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
          background: isDark ? 'rgba(0, 0, 0, 0.95)' : 'rgba(0, 0, 0, 0.9)',
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
            background: 'rgba(0, 0, 0, 0.5)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                color: '#ffffff',
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
                color: 'rgba(255, 255, 255, 0.6)',
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
                background: 'rgba(255, 255, 255, 0.15)',
                border: 'none',
                borderRadius: 5,
                color: '#ffffff',
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
                background: 'rgba(255, 255, 255, 0.15)',
                border: 'none',
                borderRadius: 5,
                color: '#ffffff',
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
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Navigation hint */}
        <div
          style={{
            padding: '8px 16px',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.4)',
            fontSize: 11,
          }}
        >
          Click anywhere outside the image to close
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        flex: 1,
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
              background: isDark ? '#1a1a1a' : '#f3f4f6',
              borderRadius: 8,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div
                  style={{
                    flex: 1,
                    fontSize: 13,
                    color: isDark ? '#ffffff' : '#111827',
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
                    border: `1px solid ${isDark ? '#4a4a4a' : '#e5e7eb'}`,
                    borderRadius: 5,
                    color: isDark ? '#b3b3b3' : '#6b7280',
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
                  color: isDark ? '#808080' : '#9ca3af',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    padding: '3px 8px',
                    background: isDark ? 'rgba(96, 165, 250, 0.2)' : 'rgba(59, 130, 246, 0.1)',
                    color: isDark ? '#60a5fa' : '#3b82f6',
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
                    background: isDark ? '#1a1a1a' : '#e5e7eb',
                    borderRadius: 8,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    border: '2px solid transparent',
                    transition: 'border-color 0.15s ease',
                  }}
                  onClick={() => setExpandedImage({ image: result, generation })}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = isDark ? '#4a4a4a' : '#d1d5db';
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
                  <div
                    className="hidden"
                    style={{
                      display: 'none',
                      width: '100%',
                      height: '100%',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: `linear-gradient(135deg, ${isDark ? '#1a1a1a' : '#e5e7eb'} 0%, ${isDark ? '#2a3540' : '#d1d5db'} 100%)`,
                    }}
                  >
                    <div style={{ textAlign: 'center', color: isDark ? '#808080' : '#9ca3af' }}>
                      <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.5 }}>&#128247;</div>
                      <div style={{ fontSize: 11 }}>{result.file}</div>
                    </div>
                  </div>

                  {/* Hover overlay with actions */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      padding: 10,
                      background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.8))',
                      opacity: 0,
                      transition: 'opacity 0.15s ease',
                    }}
                    className="image-overlay"
                  >
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        title="Download"
                        style={{
                          width: 28,
                          height: 28,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(255, 255, 255, 0.15)',
                          border: 'none',
                          borderRadius: 5,
                          color: '#ffffff',
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        &#8595;
                      </button>
                      <button
                        title="Copy to clipboard"
                        style={{
                          width: 28,
                          height: 28,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(255, 255, 255, 0.15)',
                          border: 'none',
                          borderRadius: 5,
                          color: '#ffffff',
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        &#128203;
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              // Placeholder for pending generation
              <div
                style={{
                  position: 'relative',
                  aspectRatio: '1',
                  background: isDark ? '#1a1a1a' : '#e5e7eb',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div style={{ textAlign: 'center', color: isDark ? '#808080' : '#9ca3af' }}>
                  <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.5 }}>&#8987;</div>
                  <div style={{ fontSize: 11 }}>Pending</div>
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
