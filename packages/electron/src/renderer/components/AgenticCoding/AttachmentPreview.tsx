import React, { useState, useEffect } from 'react';
import type { ChatAttachment } from '@nimbalyst/runtime';
import { getFileIcon } from '@nimbalyst/runtime';
import './AttachmentPreview.css';

interface AttachmentPreviewProps {
  attachment: ChatAttachment;
  onRemove: (attachmentId: string) => void;
}

export function AttachmentPreview({ attachment, onRemove }: AttachmentPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Handle Escape key to close expanded image
  useEffect(() => {
    if (!isExpanded) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExpanded(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  const handleThumbnailClick = () => {
    if (attachment.type === 'image') {
      setIsExpanded(true);
    }
  };

  return (
    <>
      <div className="attachment-preview">
        <div
          className="attachment-preview-thumbnail"
          onClick={handleThumbnailClick}
          style={{ cursor: attachment.type === 'image' ? 'pointer' : 'default' }}
          title={attachment.type === 'image' ? 'Click to enlarge' : undefined}
        >
          {attachment.type === 'image' ? (
            <img
              src={`file://${attachment.filepath}`}
              alt={attachment.filename}
              className="attachment-preview-image"
            />
          ) : (
            <span className="attachment-preview-icon">
              {getFileIcon(attachment.filename, 18)}
            </span>
          )}
        </div>

      <div className="attachment-preview-info">
        <div className="attachment-preview-filename" title={attachment.filename}>
          {attachment.filename}
        </div>
        <div className="attachment-preview-size">
          {formatFileSize(attachment.size)}
        </div>
      </div>

      <button
        className="attachment-preview-remove"
        onClick={() => onRemove(attachment.id)}
        title="Remove attachment"
        aria-label="Remove attachment"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>

      {/* Expanded image modal */}
      {isExpanded && attachment.type === 'image' && (
        <div
          className="attachment-preview-modal-overlay"
          onClick={() => setIsExpanded(false)}
        >
          <div
            className="attachment-preview-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="attachment-preview-modal-close"
              onClick={() => setIsExpanded(false)}
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <img
              src={`file://${attachment.filepath}`}
              alt={attachment.filename}
              className="attachment-preview-modal-image"
            />
            <div className="attachment-preview-modal-caption">
              {attachment.filename}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
