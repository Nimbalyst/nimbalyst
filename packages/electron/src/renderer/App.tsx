console.log('[RENDERER] App.tsx loading at', new Date().toISOString());

import React, { useEffect, useState, useCallback, useRef } from 'react';

console.log('[RENDERER] About to import StravuEditor at', new Date().toISOString());
import { StravuEditor, TOGGLE_SEARCH_COMMAND } from 'stravu-editor';
import type { LexicalCommand } from 'stravu-editor';
import 'stravu-editor/styles';
console.log('[RENDERER] StravuEditor imported at', new Date().toISOString());

// Electron API interface
interface ElectronAPI {
  onFileNew: (callback: () => void) => () => void;
  onFileOpen: (callback: () => void) => () => void;
  onFileSave: (callback: () => void) => () => void;
  onFileSaveAs: (callback: () => void) => () => void;
  onFileOpenedFromOS: (callback: (data: { filePath: string; content: string }) => void) => () => void;
  onToggleSearch: (callback: () => void) => () => void;
  onToggleSearchReplace: (callback: () => void) => () => void;
  openFile: () => Promise<{ filePath: string; content: string } | null>;
  saveFile: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  saveFileAs: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  setDocumentEdited: (edited: boolean) => void;
  setTitle: (title: string) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}


export default function App() {
  console.log('[RENDERER] App component rendering at', new Date().toISOString());
  const [content, setContent] = useState('');
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const getContentRef = useRef<(() => string) | null>(null);
  const initialContentRef = useRef<string>('');
  const editorRef = useRef<any>(null);
  const searchCommandRef = useRef<LexicalCommand<undefined> | null>(null);

  // Log mount/unmount
  useEffect(() => {
    console.log('[RENDERER] App component mounted at', new Date().toISOString());
    return () => {
      console.log('[RENDERER] App component unmounting at', new Date().toISOString());
    };
  }, []);

  // Handle new file
  const handleNew = useCallback(() => {
    setContent('');
    setCurrentFilePath(null);
    setCurrentFileName(null);
    setIsDirty(false);
    initialContentRef.current = '';
  }, []);

  // Handle open file
  const handleOpen = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      const result = await window.electronAPI.openFile();
      if (result) {
        setContent(result.content);
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        setIsDirty(false);
        initialContentRef.current = result.content;
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }, []);

  // Handle save as
  const handleSaveAs = useCallback(async () => {
    console.log('handleSaveAs called');
    if (!window.electronAPI || !getContentRef.current) return;

    const content = getContentRef.current();

    try {
      console.log('Calling electronAPI.saveFileAs');
      const result = await window.electronAPI.saveFileAs(content);
      console.log('Save as result:', result);
      if (result) {
        console.log('Setting current file path to:', result.filePath);
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        setIsDirty(false);
        initialContentRef.current = content;
      }
    } catch (error) {
      console.error('Failed to save file as:', error);
    }
  }, []);

  // Handle save
  const handleSave = useCallback(async () => {
    console.log('handleSave called, currentFilePath:', currentFilePath);
    if (!window.electronAPI || !getContentRef.current) return;

    const content = getContentRef.current();
    console.log('Saving content:', { contentLength: content.length, hasFilePath: !!currentFilePath, currentFilePath });

    if (!currentFilePath) {
      console.log('No file path, triggering save as');
      // No file loaded, for Cmd+S we should trigger save as
      // This matches typical editor behavior
      await handleSaveAs();
      return;
    }

    try {
      console.log('Calling electronAPI.saveFile');
      const result = await window.electronAPI.saveFile(content);
      console.log('Save result:', result);
      if (result) {
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        setIsDirty(false);
        initialContentRef.current = content;
        console.log('File saved successfully');
      } else {
        console.log('Save returned null - no current file in main process');
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [currentFilePath, handleSaveAs]);

  // Update window title and dirty state
  useEffect(() => {
    if (!window.electronAPI) return;

    const title = currentFileName
      ? `${currentFileName}${isDirty ? ' •' : ''} - Stravu Editor`
      : 'Stravu Editor';

    window.electronAPI.setTitle(title);
    window.electronAPI.setDocumentEdited(isDirty);
  }, [currentFileName, isDirty]);

  // Set up IPC listeners
  useEffect(() => {
    if (!window.electronAPI) return;

    console.log('Setting up IPC listeners, currentFilePath:', currentFilePath);

    // Set up listeners and store cleanup functions
    const cleanupFns: Array<() => void> = [];

    cleanupFns.push(window.electronAPI.onFileNew(handleNew));
    cleanupFns.push(window.electronAPI.onFileOpen(handleOpen));
    cleanupFns.push(window.electronAPI.onFileSave(handleSave));
    cleanupFns.push(window.electronAPI.onFileSaveAs(handleSaveAs));
    cleanupFns.push(window.electronAPI.onFileOpenedFromOS((data) => {
      console.log('File opened from OS:', data.filePath);
      setContent(data.content);
      setCurrentFilePath(data.filePath);
      setCurrentFileName(data.filePath.split('/').pop() || data.filePath);
      setIsDirty(false);
      initialContentRef.current = data.content;
    }));
    cleanupFns.push(window.electronAPI.onToggleSearch(() => {
      console.log('Toggle search command received');
      if (editorRef.current && searchCommandRef.current) {
        editorRef.current.dispatchCommand(searchCommandRef.current, undefined);
      }
    }));
    cleanupFns.push(window.electronAPI.onToggleSearchReplace(() => {
      console.log('Toggle search replace command received');
      if (editorRef.current && searchCommandRef.current) {
        editorRef.current.dispatchCommand(searchCommandRef.current, undefined);
      }
    }));

    // Clean up listeners when dependencies change
    return () => {
      console.log('Cleaning up IPC listeners');
      cleanupFns.forEach(cleanup => cleanup());
    };
  }, [handleNew, handleOpen, handleSave, handleSaveAs]);

  console.log('Rendering App with config:', {
    contentLength: content.length,
    currentFileName
  });

  console.log('[RENDERER] About to render StravuEditor at', new Date().toISOString());

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <StravuEditor
        config={{
          initialContent: content,
          onContentChange: (newContent) => {
            console.log('Content changed:', newContent.length);
            // Check if content actually changed from initial
            if (getContentRef.current) {
              const currentContent = getContentRef.current();
              const hasChanged = currentContent !== initialContentRef.current;
              if (hasChanged !== isDirty) {
                setIsDirty(hasChanged);
              }
            }
          },
          onGetContent: (getContentFn) => {
            console.log('[RENDERER] Received getContent function at', new Date().toISOString());
            getContentRef.current = getContentFn;
          },
          onEditorReady: (editor) => {
            console.log('[RENDERER] Editor ready at', new Date().toISOString());
            editorRef.current = editor;
            searchCommandRef.current = TOGGLE_SEARCH_COMMAND;
          },
          isRichText: true,
          showTreeView: false,
        }}
      />
    </div>
  );
}
