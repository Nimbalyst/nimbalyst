/**
 * DatamodelLM Editor
 *
 * The main editor component that integrates with Nimbalyst's custom editor system.
 * Uses the EditorHost API for all host communication.
 *
 * Content Ownership Pattern:
 * - This editor OWNS its content state
 * - Host notifies us of file changes via onFileChanged
 * - We track lastKnownDiskContentRef to ignore echoes from our own saves
 * - Host triggers saves via onSaveRequested, we respond by calling saveContent
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { DataModelCanvas, type DataModelCanvasRef } from './DataModelCanvas';
import { DataModelToolbar } from './DataModelToolbar';
import { createDataModelStore, type DataModelStoreApi } from '../store';
import { createEmptyDataModel } from '../types';
import { parsePrismaSchema, serializeToPrismaSchema } from '../prismaParser';
import { registerEditorStore, unregisterEditorStore } from '../aiTools';
import { captureDataModelCanvas, copyScreenshotToClipboard } from '../utils/screenshotUtils';
import type { EditorHostProps } from '@nimbalyst/runtime';

export function DatamodelLMEditor({ host }: EditorHostProps) {
  // Extract frequently used values from host
  const { filePath, theme } = host;

  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);

  // Create a store instance for this editor
  const storeRef = useRef<DataModelStoreApi | null>(null);
  const canvasRef = useRef<DataModelCanvasRef>(null);

  // Track what we believe is on disk to ignore echoes from our own saves
  const lastKnownDiskContentRef = useRef<string>('');

  // Initialize store on mount
  if (!storeRef.current) {
    storeRef.current = createDataModelStore();
  }

  const store = storeRef.current;

  // Ref to track if initial load has completed (prevents infinite loop)
  const hasLoadedRef = useRef(false);

  // Load content on mount (only once)
  useEffect(() => {
    // Skip if already loaded
    if (hasLoadedRef.current) return;

    let mounted = true;

    host.loadContent()
      .then((content) => {
        if (!mounted) return;

        hasLoadedRef.current = true;

        if (content) {
          try {
            const data = parsePrismaSchema(content);
            store.getState().loadFromFile(data);
            lastKnownDiskContentRef.current = content;
          } catch (error) {
            console.error('[DatamodelLM] Failed to parse Prisma schema:', error);
            store.getState().loadFromFile(createEmptyDataModel());
          }
        } else {
          // New file - create empty data model
          store.getState().loadFromFile(createEmptyDataModel());
        }
        setIsLoading(false);
      })
      .catch((error) => {
        if (mounted) {
          hasLoadedRef.current = true;
          console.error('[DatamodelLM] Failed to load content:', error);
          setLoadError(error);
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [host, store]);

  // Mark initial load as complete after a short delay
  // This allows React Flow's fitView to finish before we start tracking dirty state
  useEffect(() => {
    if (isLoading) return;

    // Give React Flow time to complete fitView, then start tracking dirty changes
    const timer = setTimeout(() => {
      store.getState().markInitialLoadComplete();
    }, 100);

    return () => clearTimeout(timer);
  }, [isLoading, store]);

  // Set up callbacks for dirty tracking (only once on mount)
  useEffect(() => {
    store.getState().setCallbacks({
      onDirtyChange: (isDirty) => {
        host.setDirty(isDirty);
      },
    });
    // Intentionally only run once - host.setDirty is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Subscribe to file change notifications (only depends on host for subscription)
  useEffect(() => {
    return host.onFileChanged((newContent) => {
      // Check if this is just an echo of our own save
      if (newContent === lastKnownDiskContentRef.current) {
        console.log('[DatamodelLM] File change notification ignored - matches our last known disk state');
        return;
      }

      console.log('[DatamodelLM] External file change detected, reloading');

      try {
        const data = parsePrismaSchema(newContent);
        store.getState().loadFromFile(data);
        // Mark as clean since we just loaded fresh content
        store.getState().markClean();
        // Update our disk state
        lastKnownDiskContentRef.current = newContent;
      } catch (error) {
        console.error('[DatamodelLM] Failed to parse reloaded content:', error);
      }
    });
  }, [host]); // Only depend on host - store is accessed via closure

  // Subscribe to save requests from host
  useEffect(() => {
    return host.onSaveRequested(async () => {
      try {
        const data = store.getState().toFileData();
        const content = serializeToPrismaSchema(data);
        // Update disk state BEFORE saving to prevent echo
        lastKnownDiskContentRef.current = content;
        await host.saveContent(content);
        store.getState().markClean();
        console.log('[DatamodelLM] Saved');
      } catch (error) {
        console.error('[DatamodelLM] Save failed:', error);
      }
    });
  }, [host]); // Only depend on host - store is accessed via closure

  // Subscribe to store changes and force re-render
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      forceUpdate((n) => n + 1);
    });
    return unsubscribe;
  }, [store]);

  // Register store for AI tool access
  useEffect(() => {
    registerEditorStore(filePath, store);
    return () => {
      unregisterEditorStore(filePath);
    };
  }, [filePath, store]);

  // Handle screenshot capture
  const handleScreenshot = useCallback(async () => {
    const canvasElement = canvasRef.current?.getCanvasElement();
    if (!canvasElement) {
      console.error('[DatamodelLM] Could not find canvas element for screenshot');
      return;
    }

    try {
      const base64Data = await captureDataModelCanvas(canvasElement);
      await copyScreenshotToClipboard(base64Data);
      console.log('[DatamodelLM] Screenshot copied to clipboard');
    } catch (error) {
      console.error('[DatamodelLM] Failed to capture screenshot:', error);
    }
  }, []);

  // Show loading state
  if (isLoading) {
    return (
      <div className="datamodel-editor" data-theme={theme}>
        <div style={{ padding: '20px', color: 'var(--text-secondary)' }}>Loading...</div>
      </div>
    );
  }

  // Show error state
  if (loadError) {
    return (
      <div className="datamodel-editor" data-theme={theme}>
        <div style={{ padding: '20px', color: 'var(--text-error)' }}>
          Failed to load: {loadError.message}
        </div>
      </div>
    );
  }

  return (
    <div className="datamodel-editor" data-theme={theme}>
      <DataModelToolbar store={store} onScreenshot={handleScreenshot} host={host} />
      <ReactFlowProvider>
        <DataModelCanvas ref={canvasRef} store={store} theme={theme} />
      </ReactFlowProvider>
    </div>
  );
}
