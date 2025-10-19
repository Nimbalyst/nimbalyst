import React from 'react';
import type { ChatAttachment } from '@nimbalyst/runtime';
import './AttachmentPreview.css';

interface AttachmentPreviewProps {
  attachment: ChatAttachment;
  onRemove: (attachmentId: string) => void;
}

export function AttachmentPreview({ attachment, onRemove }: AttachmentPreviewProps) {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (type: 'image' | 'pdf' | 'document'): string => {
    switch (type) {
      case 'image':
        return 'image';
      case 'pdf':
        return 'picture_as_pdf';
      case 'document':
        return 'description';
      default:
        return 'insert_drive_file';
    }
  };

  return (
    <div className="attachment-preview">
      <div className="attachment-preview-thumbnail">
        {attachment.type === 'image' && attachment.thumbnail ? (
          <img
            src={attachment.thumbnail}
            alt={attachment.filename}
            className="attachment-preview-image"
          />
        ) : (
          <span className="material-icons attachment-preview-icon">
            {getFileIcon(attachment.type)}
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
  );
}
