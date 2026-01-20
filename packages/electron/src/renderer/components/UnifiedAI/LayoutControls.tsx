/**
 * LayoutControls - Toggle buttons for session editor layout modes
 *
 * Provides three buttons to control the split view:
 * - Maximize editor (hide transcript)
 * - Split view (both visible)
 * - Maximize transcript (hide editor)
 */

import React from 'react';
import type { SessionLayoutMode } from '../../store';
import './LayoutControls.css';

// Custom SVG icons for layout modes
// Each shows a panel with a divider line indicating where the split is

/** Editor maximized - divider near bottom */
const EditorMaxIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <line x1="3" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/** Split view - divider in middle */
const SplitViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/** Transcript maximized - divider near top */
const TranscriptMaxIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <line x1="3" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

interface LayoutControlsProps {
  mode: SessionLayoutMode;
  hasTabs: boolean;
  onModeChange: (mode: SessionLayoutMode) => void;
}

export function LayoutControls({ mode, hasTabs, onModeChange }: LayoutControlsProps) {
  return (
    <div className="layout-controls">
      <button
        className={`layout-control-btn ${mode === 'editor' ? 'active' : ''}`}
        onClick={() => onModeChange('editor')}
        title="Maximize editor"
        disabled={!hasTabs}
        data-testid="layout-maximize-editor"
      >
        <EditorMaxIcon />
      </button>
      <button
        className={`layout-control-btn ${mode === 'split' ? 'active' : ''}`}
        onClick={() => onModeChange('split')}
        title="Split view"
        disabled={!hasTabs}
        data-testid="layout-split-view"
      >
        <SplitViewIcon />
      </button>
      <button
        className={`layout-control-btn ${mode === 'transcript' ? 'active' : ''}`}
        onClick={() => onModeChange('transcript')}
        title="Maximize transcript"
        data-testid="layout-maximize-transcript"
      >
        <TranscriptMaxIcon />
      </button>
    </div>
  );
}

export default LayoutControls;
