import React, { useState, useEffect, useRef } from 'react';
import type { ChatAttachment } from '@nimbalyst/runtime';
import { getFileIcon } from '@nimbalyst/runtime';
import './AttachmentPreview.css';

interface ProcessingAttachmentPreviewProps {
  filename: string;
}

/**
 * Shows a loading indicator for an attachment that is being processed (e.g., compressed).
 */
export function ProcessingAttachmentPreview({ filename }: ProcessingAttachmentPreviewProps) {
  return (
    <div className="attachment-preview attachment-preview-processing">
      <div className="attachment-preview-thumbnail">
        <div className="attachment-preview-spinner" />
      </div>
      <div className="attachment-preview-info">
        <div className="attachment-preview-filename" title={filename}>
          {filename}
        </div>
        <div className="attachment-preview-size attachment-preview-processing-text">
          Processing...
        </div>
      </div>
    </div>
  );
}

interface AttachmentPreviewProps {
  attachment: ChatAttachment;
  onRemove: (attachmentId: string) => void;
  onConvertToText?: (attachment: ChatAttachment) => void;
}

export function AttachmentPreview({ attachment, onRemove, onConvertToText }: AttachmentPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

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

  // Handle click outside to close context menu
  useEffect(() => {
    if (!showContextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setShowContextMenu(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowContextMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showContextMenu]);

  const handleThumbnailClick = () => {
    if (attachment.type === 'image') {
      setIsExpanded(true);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    // Only show context menu for document attachments (text files)
    if (attachment.type !== 'document' || !onConvertToText) return;

    e.preventDefault();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  const handleConvertToText = () => {
    setShowContextMenu(false);
    if (onConvertToText) {
      onConvertToText(attachment);
    }
  };

  return (
    <>
      <div className="attachment-preview" onContextMenu={handleContextMenu}>
        <div
          className="attachment-preview-thumbnail"
          onClick={handleThumbnailClick}
          style={{ cursor: attachment.type === 'image' ? 'pointer' : attachment.type === 'document' ? 'context-menu' : 'default' }}
          title={attachment.type === 'image' ? 'Click to enlarge' : attachment.type === 'document' ? 'Right-click for options' : undefined}
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

      {/* Context menu for text attachments */}
      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="attachment-context-menu"
          style={{
            position: 'fixed',
            left: contextMenuPosition.x,
            top: contextMenuPosition.y,
            zIndex: 10000
          }}
        >
          <button
            className="attachment-context-menu-item"
            onClick={handleConvertToText}
          >
            Insert as text
          </button>
        </div>
      )}
    </>
  );
}
