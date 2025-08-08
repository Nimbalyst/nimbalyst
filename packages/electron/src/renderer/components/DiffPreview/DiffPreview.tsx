import React, { useMemo } from 'react';
import { diffLines, diffWords, Change } from 'diff';
import './DiffPreview.css';

interface DiffPreviewProps {
  original: string;
  modified: string;
  onAccept: () => void;
  onReject: () => void;
  title?: string;
}

export function DiffPreview({ original, modified, onAccept, onReject, title }: DiffPreviewProps) {
  const changes = useMemo(() => {
    // Use line diff for longer content, word diff for shorter
    if (original.length > 500 || modified.length > 500) {
      return diffLines(original, modified);
    } else {
      return diffWords(original, modified);
    }
  }, [original, modified]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    
    changes.forEach(change => {
      if (change.added) {
        added += change.value.length;
      } else if (change.removed) {
        removed += change.value.length;
      }
    });
    
    return { added, removed };
  }, [changes]);

  return (
    <div className="diff-preview">
      <div className="diff-header">
        <h3>{title || 'Proposed Changes'}</h3>
        <div className="diff-stats">
          <span className="diff-stat-added">+{stats.added}</span>
          <span className="diff-stat-removed">-{stats.removed}</span>
        </div>
      </div>
      
      <div className="diff-content">
        {changes.map((change: Change, index: number) => {
          if (change.added) {
            return (
              <span key={index} className="diff-added">
                {change.value}
              </span>
            );
          } else if (change.removed) {
            return (
              <span key={index} className="diff-removed">
                {change.value}
              </span>
            );
          } else {
            return (
              <span key={index} className="diff-unchanged">
                {change.value}
              </span>
            );
          }
        })}
      </div>
      
      <div className="diff-actions">
        <button className="diff-action-accept" onClick={onAccept}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Accept Changes
        </button>
        <button className="diff-action-reject" onClick={onReject}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Reject
        </button>
      </div>
    </div>
  );
}