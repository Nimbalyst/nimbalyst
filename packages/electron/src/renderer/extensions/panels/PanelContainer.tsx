/**
 * Panel Container
 *
 * Renders an extension panel with its PanelHost.
 * Handles error boundaries and loading states.
 */

import React, { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { themeIdAtom, type ThemeId } from '@nimbalyst/runtime/store';
import { createExtensionStorage } from '@nimbalyst/runtime';
import { createPanelHost, type PanelHostOptions } from './PanelHostImpl';
import type { RegisteredPanel } from './PanelRegistry';
import { setExtensionPanelAIContextAtom } from '../../store/atoms/extensionPanels';
import './PanelContainer.css';

// ============================================================================
// Types
// ============================================================================

interface PanelContainerProps {
  panel: RegisteredPanel;
  workspacePath: string;
  onOpenFile: (path: string) => void;
  onOpenPanel: (panelId: string) => void;
  onClose: () => void;
}

// ============================================================================
// Error Boundary
// ============================================================================

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class PanelErrorBoundary extends React.Component<
  { panelId: string; children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { panelId: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[PanelContainer] Error in panel ${this.props.panelId}:`, error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="panel-error">
          <span className="material-symbols-outlined panel-error-icon">error</span>
          <div className="panel-error-title">Panel Error</div>
          <div className="panel-error-message">
            {this.state.error?.message || 'An unknown error occurred'}
          </div>
          <button
            className="panel-error-retry"
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// Panel Container Component
// ============================================================================

export function PanelContainer({
  panel,
  workspacePath,
  onOpenFile,
  onOpenPanel,
  onClose,
}: PanelContainerProps): JSX.Element {
  const themeId = useAtomValue(themeIdAtom);
  // Map ThemeId to panel theme type
  const theme = themeId as 'light' | 'dark' | 'crystal-dark';
  const [themeListeners] = useState(() => new Set<(theme: 'light' | 'dark' | 'crystal-dark') => void>());
  const setExtensionPanelAIContext = useSetAtom(setExtensionPanelAIContextAtom);

  // Notify theme listeners when theme changes
  useEffect(() => {
    for (const listener of themeListeners) {
      listener(theme);
    }
  }, [theme, themeListeners]);

  // Create stable theme subscription function
  const onThemeChange = useCallback((callback: (theme: 'light' | 'dark' | 'crystal-dark') => void) => {
    themeListeners.add(callback);
    return () => {
      themeListeners.delete(callback);
    };
  }, [themeListeners]);

  // Create extension storage (memoized by extensionId)
  const storage = useMemo(() => {
    return createExtensionStorage(panel.extensionId);
  }, [panel.extensionId]);

  // Create PanelHost
  const host = useMemo(() => {
    const options: PanelHostOptions = {
      panelId: panel.id,
      extensionId: panel.extensionId,
      theme,
      workspacePath,
      aiSupported: panel.aiSupported,
      storage,
      onOpenFile,
      onOpenPanel,
      onClose,
      onThemeChange,
    };

    return createPanelHost(options);
  }, [panel.id, panel.extensionId, panel.aiSupported, workspacePath, storage, onOpenFile, onOpenPanel, onClose, onThemeChange, theme]);

  // Subscribe to AI context changes and sync to atom
  useEffect(() => {
    if (!panel.aiSupported || !host.ai) {
      return;
    }

    // Set initial context
    const initialContext = host.ai.getContext();
    setExtensionPanelAIContext({
      panelId: panel.id,
      extensionId: panel.extensionId,
      panelTitle: panel.title,
      context: initialContext,
    });

    // Subscribe to updates
    const unsubscribe = host.ai.onContextChanged((context) => {
      setExtensionPanelAIContext({
        panelId: panel.id,
        extensionId: panel.extensionId,
        panelTitle: panel.title,
        context,
      });
    });

    // Clear context when unmounting
    return () => {
      unsubscribe();
      setExtensionPanelAIContext(null);
    };
  }, [host, panel.id, panel.extensionId, panel.title, panel.aiSupported, setExtensionPanelAIContext]);

  const PanelComponent = panel.component;

  return (
    <div className="panel-container" data-panel-id={panel.id} data-theme={theme}>
      <PanelErrorBoundary panelId={panel.id}>
        <PanelComponent host={host} />
      </PanelErrorBoundary>
    </div>
  );
}
