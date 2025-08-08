import React, { useState } from 'react';
import { GeneralPreferences } from './GeneralPreferences';
import { ClaudePreferences } from './ClaudePreferences';
import './PreferencesDialog.css';

interface PreferencesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = 'general' | 'claude';

export function PreferencesDialog({ isOpen, onClose }: PreferencesDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');

  if (!isOpen) return null;

  const handleClose = () => {
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  };

  return (
    <div className="preferences-overlay" onClick={handleClose} onKeyDown={handleKeyDown}>
      <div className="preferences-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="preferences-header">
          <h2>Preferences</h2>
          <button className="preferences-close" onClick={handleClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="preferences-content">
          <div className="preferences-sidebar">
            <button
              className={`preferences-tab ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6.5 1.5L6.5 4.5C6.5 5.05228 6.05228 5.5 5.5 5.5L2.5 5.5C1.94772 5.5 1.5 5.05228 1.5 4.5L1.5 1.5C1.5 0.947715 1.94772 0.5 2.5 0.5L5.5 0.5C6.05228 0.5 6.5 0.947715 6.5 1.5Z" stroke="currentColor"/>
                <path d="M14.5 1.5L14.5 4.5C14.5 5.05228 14.0523 5.5 13.5 5.5L10.5 5.5C9.94772 5.5 9.5 5.05228 9.5 4.5L9.5 1.5C9.5 0.947715 9.94772 0.5 10.5 0.5L13.5 0.5C14.0523 0.5 14.5 0.947715 14.5 1.5Z" stroke="currentColor"/>
                <path d="M6.5 9.5L6.5 12.5C6.5 13.0523 6.05228 13.5 5.5 13.5L2.5 13.5C1.94772 13.5 1.5 13.0523 1.5 12.5L1.5 9.5C1.5 8.94772 1.94772 8.5 2.5 8.5L5.5 8.5C6.05228 8.5 6.5 8.94772 6.5 9.5Z" stroke="currentColor"/>
                <path d="M14.5 9.5L14.5 12.5C14.5 13.0523 14.0523 13.5 13.5 13.5L10.5 13.5C9.94772 13.5 9.5 13.0523 9.5 12.5L9.5 9.5C9.5 8.94772 9.94772 8.5 10.5 8.5L13.5 8.5C14.0523 8.5 14.5 8.94772 14.5 9.5Z" stroke="currentColor"/>
              </svg>
              General
            </button>

            <button
              className={`preferences-tab ${activeTab === 'claude' ? 'active' : ''}`}
              onClick={() => setActiveTab('claude')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 1L9 5L13 6L9 7L8 11L7 7L3 6L7 5L8 1Z" fill="currentColor"/>
                <path d="M3 2L3.5 3.5L5 4L3.5 4.5L3 6L2.5 4.5L1 4L2.5 3.5L3 2Z" fill="currentColor" opacity="0.5"/>
                <path d="M13 10L13.5 11.5L15 12L13.5 12.5L13 14L12.5 12.5L11 12L12.5 11.5L13 10Z" fill="currentColor" opacity="0.5"/>
              </svg>
              Claude AI
            </button>
          </div>

          <div className="preferences-panel">
            {activeTab === 'general' && <GeneralPreferences />}
            {activeTab === 'claude' && <ClaudePreferences />}
          </div>
        </div>
      </div>
    </div>
  );
}