import React, { useSyncExternalStore, useCallback } from 'react';

interface WireframeAnnotationIndicatorProps {
  /** Current document file path */
  currentFilePath?: string;
  /** Timestamp of the last user message in the session (or null if no messages) */
  lastUserMessageTimestamp: number | null;
}

// Store for wireframe annotation state
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
  window.addEventListener('wireframe-annotation-changed', handleEvent);

  return () => {
    listeners.delete(callback);
    window.removeEventListener('wireframe-annotation-changed', handleEvent);
  };
}

function getSnapshot(): number {
  return snapshotVersion;
}

/**
 * Indicator that shows when there are new wireframe annotations
 * that haven't been sent with a prompt yet.
 *
 * Shows "+ wireframe annotations" between attachments and the prompt box.
 */
export const WireframeAnnotationIndicator: React.FC<WireframeAnnotationIndicatorProps> = ({
  currentFilePath,
  lastUserMessageTimestamp
}) => {
  // Subscribe to annotation changes using React 18's useSyncExternalStore
  // This ensures the component re-renders when the external state changes
  useSyncExternalStore(subscribe, getSnapshot);

  // Read current state directly from window globals
  // This ensures we always have the latest values
  const wireframeFilePath = (window as any).__wireframeFilePath as string | undefined;
  const annotationTimestamp = (window as any).__wireframeAnnotationTimestamp as number | null;
  const hasDrawing = !!(window as any).__wireframeDrawing;
  const hasSelection = !!(window as any).__wireframeSelectedElement;
  const hasAnnotations = hasDrawing || hasSelection;

  // Determine if we should show the indicator
  const shouldShow = useCallback((): boolean => {
    // Must have a wireframe file path (indicates a wireframe is currently open/active)
    if (!wireframeFilePath) {
      return false;
    }

    // Must have annotations
    if (!hasAnnotations) {
      return false;
    }

    // Must have a timestamp
    if (!annotationTimestamp) {
      return false;
    }

    // If no user messages yet, show the indicator (new session)
    if (!lastUserMessageTimestamp) {
      return true;
    }

    // Show if annotations were made after the last prompt
    return annotationTimestamp > lastUserMessageTimestamp;
  }, [hasAnnotations, annotationTimestamp, wireframeFilePath, lastUserMessageTimestamp]);

  if (!shouldShow()) {
    return null;
  }

  return (
    <>
      <style>
        {`.wireframe-annotation-indicator[data-tooltip] {
          position: relative;
        }
        .wireframe-annotation-indicator[data-tooltip]:hover::after {
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
        className="wireframe-annotation-indicator"
        data-tooltip="Annotations drawn on your mockup will be included with your prompt"
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
        <span>+ wireframe annotations</span>
      </div>
    </>
  );
};
