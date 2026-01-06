/**
 * Custom Editor Wrapper
 *
 * Provides runtime protection for custom editor components:
 * - Error boundary to catch render errors
 * - Render loop detection to prevent infinite re-renders
 * - Graceful error display with recovery options
 */

import React, { Component, useRef, useEffect, useState, useCallback } from 'react';
import type { EditorHost } from '@nimbalyst/runtime';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { CustomEditorComponent } from './types';
import './CustomEditorWrapper.css';

interface CustomEditorWrapperProps {
  component: CustomEditorComponent;
  host: EditorHost;
  extensionId?: string;
  componentName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

// Configuration for render loop detection
const MAX_RENDERS_PER_SECOND = 60;
const RENDER_WINDOW_MS = 1000;
const RENDER_LOOP_THRESHOLD = MAX_RENDERS_PER_SECOND * 2; // Give some buffer

/**
 * Error Boundary component that catches render errors
 */
class CustomEditorErrorBoundary extends Component<
  { children: React.ReactNode; extensionId?: string; componentName?: string; onReset: () => void },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; extensionId?: string; componentName?: string; onReset: () => void }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CustomEditorWrapper] Custom editor crashed:', {
      extensionId: this.props.extensionId,
      componentName: this.props.componentName,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    this.setState({ errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          extensionId={this.props.extensionId}
          componentName={this.props.componentName}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * Error fallback UI component
 */
const ErrorFallback: React.FC<{
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  extensionId?: string;
  componentName?: string;
  onRetry: () => void;
  isRenderLoop?: boolean;
}> = ({ error, errorInfo, extensionId, componentName, onRetry, isRenderLoop }) => {
  return (
    <div className="custom-editor-error">
      <div className="custom-editor-error-content">
        <div className="custom-editor-error-icon">
          <MaterialSymbol icon={isRenderLoop ? 'loop' : 'error'} size={48} />
        </div>
        <h2>{isRenderLoop ? 'Render Loop Detected' : 'Custom Editor Error'}</h2>
        {extensionId && (
          <p className="custom-editor-error-extension">
            Extension: <code>{extensionId}</code>
            {componentName && <> / Component: <code>{componentName}</code></>}
          </p>
        )}
        <p className="custom-editor-error-message">
          {isRenderLoop
            ? 'The custom editor is rendering too rapidly, which may indicate an infinite loop. This has been stopped to prevent freezing.'
            : error?.message || 'An unexpected error occurred while rendering the custom editor.'}
        </p>
        {error?.stack && !isRenderLoop && (
          <details className="custom-editor-error-details">
            <summary>Error Details</summary>
            <pre>{error.stack}</pre>
          </details>
        )}
        {isRenderLoop && (
          <div className="custom-editor-error-hint">
            <strong>Common causes:</strong>
            <ul>
              <li>State updates in useEffect without proper dependencies</li>
              <li>Callback props recreated on every render</li>
              <li>Object/array references changing on every render</li>
            </ul>
          </div>
        )}
        <div className="custom-editor-error-actions">
          <button className="custom-editor-error-retry" onClick={onRetry}>
            <MaterialSymbol icon="refresh" size={18} />
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Render loop detection hook
 */
function useRenderLoopDetection(
  extensionId?: string,
  componentName?: string
): { isLooping: boolean; resetLoopDetection: () => void } {
  const renderCountRef = useRef(0);
  const windowStartRef = useRef(Date.now());
  const [isLooping, setIsLooping] = useState(false);

  // Increment render count on each render
  useEffect(() => {
    const now = Date.now();

    // Reset window if it's been too long
    if (now - windowStartRef.current > RENDER_WINDOW_MS) {
      renderCountRef.current = 0;
      windowStartRef.current = now;
    }

    renderCountRef.current++;

    // Check for render loop
    if (renderCountRef.current > RENDER_LOOP_THRESHOLD) {
      console.error('[CustomEditorWrapper] Render loop detected:', {
        extensionId,
        componentName,
        renderCount: renderCountRef.current,
        windowMs: now - windowStartRef.current,
      });
      setIsLooping(true);
    }
  });

  const resetLoopDetection = useCallback(() => {
    renderCountRef.current = 0;
    windowStartRef.current = Date.now();
    setIsLooping(false);
  }, []);

  return { isLooping, resetLoopDetection };
}

/**
 * Custom Editor Wrapper Component
 *
 * Wraps custom editor components with:
 * - Error boundary for catching render errors
 * - Render loop detection to prevent freezing
 * - Graceful error display with recovery options
 *
 * Note: Not memoized to allow re-renders when host properties (like theme) change.
 */
export const CustomEditorWrapper: React.FC<CustomEditorWrapperProps> = ({
  component: CustomEditorComponent,
  host,
  extensionId,
  componentName,
}) => {
  const [resetKey, setResetKey] = useState(0);
  const { isLooping, resetLoopDetection } = useRenderLoopDetection(extensionId, componentName);

  const handleReset = useCallback(() => {
    resetLoopDetection();
    setResetKey((k) => k + 1);
  }, [resetLoopDetection]);

  if (isLooping) {
    return (
      <ErrorFallback
        error={null}
        errorInfo={null}
        extensionId={extensionId}
        componentName={componentName}
        onRetry={handleReset}
        isRenderLoop
      />
    );
  }

  return (
    <CustomEditorErrorBoundary
      key={resetKey}
      extensionId={extensionId}
      componentName={componentName}
      onReset={handleReset}
    >
      <CustomEditorComponent host={host} />
    </CustomEditorErrorBoundary>
  );
};
