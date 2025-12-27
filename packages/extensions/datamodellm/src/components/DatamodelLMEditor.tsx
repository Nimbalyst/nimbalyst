/**
 * DatamodelLM Editor
 *
 * The main editor component that integrates with Nimbalyst's custom editor system.
 * This component receives file content and provides the visual data modeling interface.
 *
 * Content Ownership Pattern:
 * - This editor OWNS its content state
 * - TabEditor only notifies us of file changes via onReloadContent
 * - We track lastKnownDiskContentRef to ignore echoes from our own saves
 * - We decide whether to reload based on comparing incoming content vs disk state
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

  // Track what we believe is on disk to ignore echoes from our own saves
  const lastKnownDiskContentRef = useRef<string>(initialContent);

  // Track if we've done initial load
  const hasLoadedInitialContentRef = useRef(false);

  // Initialize store on mount
  if (!storeRef.current) {
    storeRef.current = createDataModelStore();
  }

  const store = storeRef.current;

  // Parse initial content and load into store - ONLY ON FIRST MOUNT
  useEffect(() => {
    // Only load once - subsequent updates come through onReloadContent
    if (hasLoadedInitialContentRef.current) {
      console.log('[DatamodelLM] Skipping initial load - already loaded');
      return;
    }
    hasLoadedInitialContentRef.current = true;
    console.log('[DatamodelLM] Initial load from initialContent, length:', initialContent?.length);

    if (initialContent) {
      try {
        const data = parsePrismaSchema(initialContent);
        store.getState().loadFromFile(data);
        lastKnownDiskContentRef.current = initialContent;
      } catch (error) {
        console.error('[DatamodelLM] Failed to parse Prisma schema:', error);
        store.getState().loadFromFile(createEmptyDataModel());
      }
    } else {
      // New file - create empty data model
      store.getState().loadFromFile(createEmptyDataModel());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]); // Only depend on store, not initialContent

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
  // When TabEditor calls getContent for saving, we update our disk state tracking
  const getContent = useCallback(() => {
    const data = store.getState().toFileData();
    const content = serializeToPrismaSchema(data);
    // Update our disk state so we can ignore the file watcher echo
    lastKnownDiskContentRef.current = content;
    return content;
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
  // Compare against lastKnownDiskContentRef to ignore echoes from our own saves
  const handleReloadContent = useCallback((newContent: string) => {
    // Check if this is just an echo of our own save
    if (newContent === lastKnownDiskContentRef.current) {
      console.log('[DatamodelLM] File change notification ignored - matches our last known disk state');
      return;
    }

    console.log('[DatamodelLM] External file change detected, reloading');
    console.log('[DatamodelLM] lastKnownDiskContent length:', lastKnownDiskContentRef.current.length);
    console.log('[DatamodelLM] newContent length:', newContent.length);

    // Debug: Show first difference
    if (lastKnownDiskContentRef.current.length === newContent.length) {
      for (let i = 0; i < newContent.length; i++) {
        if (newContent[i] !== lastKnownDiskContentRef.current[i]) {
          console.log('[DatamodelLM] First diff at index:', i);
          console.log('[DatamodelLM] Expected char:', JSON.stringify(lastKnownDiskContentRef.current.substring(i, i+20)));
          console.log('[DatamodelLM] Got char:', JSON.stringify(newContent.substring(i, i+20)));
          break;
        }
      }
    }

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
