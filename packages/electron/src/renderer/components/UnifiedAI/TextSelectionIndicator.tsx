import React, { useSyncExternalStore, useCallback } from 'react';

interface TextSelectionIndicatorProps {
  /** Current document file path */
  currentFilePath?: string;
  /** Timestamp of the last user message in the session (or null if no messages) */
  lastUserMessageTimestamp: number | null;
}

// Store for text selection state
// This allows React to properly subscribe to changes
let listeners: Set<() => void> = new Set();
let snapshotVersion = 0;

function subscribe(callback: () => void): () => void {
  listeners.add(callback);

  // Also listen for the custom event
  const handleEvent = () => {
    snapshotVersion++;
    callback();
  };
  window.addEventListener('text-selection-changed', handleEvent);

  return () => {
    listeners.delete(callback);
    window.removeEventListener('text-selection-changed', handleEvent);
  };
}

function getSnapshot(): number {
  return snapshotVersion;
}

/**
 * Notify listeners that text selection has changed
 */
export function notifyTextSelectionChanged(): void {
  snapshotVersion++;
  listeners.forEach((listener) => listener());
  window.dispatchEvent(new CustomEvent('text-selection-changed'));
}

/**
 * Get current text selection from window globals
 */
export function getTextSelection(): { text: string; filePath: string; timestamp: number } | null {
  const text = (window as any).__textSelectionText as string | undefined;
  const filePath = (window as any).__textSelectionFilePath as string | undefined;
  const timestamp = (window as any).__textSelectionTimestamp as number | undefined;

  if (!text || !filePath || !timestamp) {
    return null;
  }

  return { text, filePath, timestamp };
}

/**
 * Set text selection in window globals
 */
export function setTextSelection(text: string, filePath: string): void {
  (window as any).__textSelectionText = text;
  (window as any).__textSelectionFilePath = filePath;
  (window as any).__textSelectionTimestamp = Date.now();
  notifyTextSelectionChanged();
}

/**
 * Clear text selection from window globals
 */
export function clearTextSelection(): void {
  (window as any).__textSelectionText = undefined;
  (window as any).__textSelectionFilePath = undefined;
  (window as any).__textSelectionTimestamp = undefined;
  notifyTextSelectionChanged();
}

/**
 * Indicator that shows when there is selected text in the editor
 * that will be included with the next AI prompt.
 *
 * Shows "+ selection" between attachments and the prompt box.
 */
export const TextSelectionIndicator: React.FC<TextSelectionIndicatorProps> = ({
  currentFilePath,
  lastUserMessageTimestamp
}) => {
  // Subscribe to selection changes using React 18's useSyncExternalStore
  // This ensures the component re-renders when the external state changes
  useSyncExternalStore(subscribe, getSnapshot);

  // Read current state directly from window globals
  // This ensures we always have the latest values
  const selectionText = (window as any).__textSelectionText as string | undefined;
  const selectionFilePath = (window as any).__textSelectionFilePath as string | undefined;
  const selectionTimestamp = (window as any).__textSelectionTimestamp as number | undefined;

  // Determine if we should show the indicator
  const shouldShow = useCallback((): boolean => {
    // Must have selected text
    if (!selectionText || selectionText.trim().length === 0) {
      return false;
    }

    // Must have a file path
    if (!selectionFilePath) {
      return false;
    }

    // Selection must be from the current file
    if (currentFilePath && selectionFilePath !== currentFilePath) {
      return false;
    }

    // Must have a timestamp
    if (!selectionTimestamp) {
      return false;
    }

    // If no user messages yet, show the indicator (new session)
    if (!lastUserMessageTimestamp) {
      return true;
    }

    // Show if selection was made after the last prompt
    return selectionTimestamp > lastUserMessageTimestamp;
  }, [selectionText, selectionFilePath, selectionTimestamp, currentFilePath, lastUserMessageTimestamp]);

  if (!shouldShow()) {
    return null;
  }

  // Create preview text (truncated if too long)
  const previewText = selectionText && selectionText.length > 50
    ? selectionText.slice(0, 50) + '...'
    : selectionText;

  return (
    <>
      <style>
        {`.text-selection-indicator[data-tooltip] {
          position: relative;
        }
        .text-selection-indicator[data-tooltip]:hover::after {
          content: attr(data-tooltip);
          position: absolute;
          bottom: 100%;
          left: 0;
          background: var(--surface-tertiary);
          color: var(--text-secondary);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          white-space: normal;
          max-width: 250px;
          z-index: 1000;
          pointer-events: none;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }`}
      </style>
      <div
        className="text-selection-indicator"
        data-tooltip={`Selected text will be included: "${previewText}"`}
        style={{
          padding: '4px 8px',
          marginBottom: '4px',
          fontSize: '12px',
          color: 'var(--info-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <span>+ selection</span>
      </div>
    </>
  );
};
