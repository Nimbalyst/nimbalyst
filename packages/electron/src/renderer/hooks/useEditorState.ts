/**
 * useEditorState - React hook bridge to EditorStateManager
 */

import { useState, useEffect } from 'react';
import { editorStateManager } from '../services/EditorStateManager';

export function useEditorState() {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const unsubscribe = editorStateManager.subscribe(() => {
      forceUpdate({});
    });
    return unsubscribe;
  }, []);

  return editorStateManager;
}