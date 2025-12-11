/**
 * DatamodelLM Editor
 *
 * The main editor component that integrates with Nimbalyst's custom editor system.
 * This component receives file content and provides the visual data modeling interface.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { DataModelCanvas } from './DataModelCanvas';
import { DataModelToolbar } from './DataModelToolbar';
import { createDataModelStore, type DataModelStoreApi } from '../store';
import { parseDataModelFile, serializeDataModelFile, createEmptyDataModel } from '../types';

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
}: CustomEditorProps) {
  // Create a store instance for this editor
  const storeRef = useRef<DataModelStoreApi | null>(null);

  // Initialize store on mount
  if (!storeRef.current) {
    storeRef.current = createDataModelStore();
  }

  const store = storeRef.current;

  // Parse initial content and load into store
  useEffect(() => {
    if (initialContent) {
      try {
        const data = parseDataModelFile(initialContent);
        store.getState().loadFromFile(data);
      } catch (error) {
        console.error('[DatamodelLM] Failed to parse initial content:', error);
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
    return serializeDataModelFile(data);
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

  return (
    <div className="datamodel-editor" data-theme={theme}>
      <DataModelToolbar store={store} />
      <ReactFlowProvider>
        <DataModelCanvas store={store} theme={theme} />
      </ReactFlowProvider>
    </div>
  );
}
