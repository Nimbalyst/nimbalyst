/**
 * useDocumentModel - React hook for connecting a component to a DocumentModel.
 *
 * Acquires a DocumentModel from the registry synchronously on first render.
 * Releases on unmount or when filePath changes.
 */

import { useEffect, useRef } from 'react';
import { DocumentModelRegistry } from './DocumentModelRegistry';
import type { DocumentModelOptions } from './DocumentModel';
import type { DocumentModel } from './DocumentModel';
import type { DocumentModelEditorHandle } from './types';

interface UseDocumentModelResult {
  model: DocumentModel;
  handle: DocumentModelEditorHandle;
}

/**
 * Connect a component to a DocumentModel via the registry.
 *
 * The model is acquired synchronously on first render so that it's
 * available immediately (not deferred to a useEffect).
 * Released on unmount or when filePath changes.
 */
export function useDocumentModel(
  filePath: string,
  options?: DocumentModelOptions,
): UseDocumentModelResult {
  // Acquire synchronously so the handle is available on first render.
  // The ref persists across re-renders; we only re-acquire if filePath changes.
  const resultRef = useRef<{
    filePath: string;
    model: DocumentModel;
    handle: DocumentModelEditorHandle;
  } | null>(null);

  // If filePath changed, release the old one and acquire a new one synchronously
  if (!resultRef.current || resultRef.current.filePath !== filePath) {
    // Release previous if it exists
    if (resultRef.current) {
      DocumentModelRegistry.release(resultRef.current.filePath, resultRef.current.handle);
    }
    const { model, handle } = DocumentModelRegistry.getOrCreate(filePath, options);
    resultRef.current = { filePath, model, handle };
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (resultRef.current) {
        DocumentModelRegistry.release(resultRef.current.filePath, resultRef.current.handle);
        resultRef.current = null;
      }
    };
  }, [filePath]);

  return {
    model: resultRef.current.model,
    handle: resultRef.current.handle,
  };
}
