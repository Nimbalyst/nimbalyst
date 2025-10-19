import React from 'react';
import type { ChatAttachment } from '@nimbalyst/runtime';
import { AttachmentPreview } from './AttachmentPreview';
import './AttachmentPreview.css';

interface AttachmentPreviewListProps {
  attachments: ChatAttachment[];
  onRemove: (attachmentId: string) => void;
}

export function AttachmentPreviewList({ attachments, onRemove }: AttachmentPreviewListProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="attachment-preview-list">
      {attachments.map(attachment => (
        <AttachmentPreview
          key={attachment.id}
          attachment={attachment}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
