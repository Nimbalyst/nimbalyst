/**
 * DatamodelLM Editor
 *
 * The main editor component that integrates with Nimbalyst's custom editor system.
 * This component receives file content and provides the visual data modeling interface.
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

/**
 * Props received from Nimbalyst's custom editor system
 */
interface CustomEditorProps {
  filePath: string;
  fileName: string;
  initialContent: string;
  theme: 'light' | 'dark' | 'crystal-dark';
  isActive: boolean;
  workspaceId?: string;
  onContentChange?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  onGetContentReady?: (getContentFn: () => string) => void;
  onReloadContent?: (callback: (newContent: string) => void) => void;
  onViewHistory?: () => void;
  onRenameDocument?: () => void;
}

export function DatamodelLMEditor({
  filePath,
  fileName,
  initialContent,
  theme,
  isActive,
  onContentChange,
  onDirtyChange,
  onGetContentReady,
  onReloadContent,
}: CustomEditorProps) {
  // Create a store instance for this editor
  const storeRef = useRef<DataModelStoreApi | null>(null);
  const canvasRef = useRef<DataModelCanvasRef>(null);

  // Initialize store on mount
  if (!storeRef.current) {
    storeRef.current = createDataModelStore();
  }

  const store = storeRef.current;

  // Parse initial content and load into store
  useEffect(() => {
    if (initialContent) {
      try {
        const data = parsePrismaSchema(initialContent);
        store.getState().loadFromFile(data);
      } catch (error) {
        console.error('[DatamodelLM] Failed to parse Prisma schema:', error);
        store.getState().loadFromFile(createEmptyDataModel());
      }
    } else {
      // New file - create empty data model
      store.getState().loadFromFile(createEmptyDataModel());
    }
  }, [initialContent, store]);

  // Set up callbacks for dirty tracking
  useEffect(() => {
    store.getState().setCallbacks({
      onDirtyChange: (isDirty) => {
        onDirtyChange?.(isDirty);
        if (isDirty) {
          onContentChange?.();
        }
      },
    });
  }, [store, onDirtyChange, onContentChange]);

  // Register getContent function for saving
  const getContent = useCallback(() => {
    const data = store.getState().toFileData();
    return serializeToPrismaSchema(data);
  }, [store]);

  useEffect(() => {
    onGetContentReady?.(getContent);
  }, [getContent, onGetContentReady]);

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

  // Handle external content changes (e.g., AI edited the file)
  const handleReloadContent = useCallback((newContent: string) => {
    console.log('[DatamodelLM] Reloading content from external change');
    try {
      const data = parsePrismaSchema(newContent);
      store.getState().loadFromFile(data);
      // Mark as clean since we just loaded fresh content
      store.getState().markClean();
    } catch (error) {
      console.error('[DatamodelLM] Failed to parse reloaded content:', error);
    }
  }, [store]);

  // Register the reload callback with TabEditor
  useEffect(() => {
    onReloadContent?.(handleReloadContent);
  }, [onReloadContent, handleReloadContent]);

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

  return (
    <div className="datamodel-editor" data-theme={theme}>
      <DataModelToolbar store={store} onScreenshot={handleScreenshot} />
      <ReactFlowProvider>
        <DataModelCanvas ref={canvasRef} store={store} theme={theme} />
      </ReactFlowProvider>
    </div>
  );
}
