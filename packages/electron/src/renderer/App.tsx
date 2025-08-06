console.log('[RENDERER] App.tsx loading at', new Date().toISOString());

import React, { useEffect, useState, useCallback, useRef } from 'react';

console.log('[RENDERER] About to import StravuEditor at', new Date().toISOString());
import { StravuEditor, TOGGLE_SEARCH_COMMAND } from 'stravu-editor';
import type { LexicalCommand } from 'stravu-editor';
console.log('[RENDERER] StravuEditor imported at', new Date().toISOString());

// Electron API interface
interface ElectronAPI {
  onFileNew: (callback: () => void) => () => void;
  onFileOpen: (callback: () => void) => () => void;
  onFileSave: (callback: () => void) => () => void;
  onFileSaveAs: (callback: () => void) => () => void;
  onFileOpenedFromOS: (callback: (data: { filePath: string; content: string }) => void) => () => void;
  onNewUntitledDocument: (callback: (data: { untitledName: string }) => void) => () => void;
  onToggleSearch: (callback: () => void) => () => void;
  onToggleSearchReplace: (callback: () => void) => () => void;
  onFileDeleted: (callback: (data: { filePath: string }) => void) => () => void;
  openFile: () => Promise<{ filePath: string; content: string } | null>;
  saveFile: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  saveFileAs: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  setDocumentEdited: (edited: boolean) => void;
  setTitle: (title: string) => void;
  setCurrentFile: (filePath: string | null) => void;
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
  const contentVersionRef = useRef<number>(0);
  const isInitializedRef = useRef<boolean>(false);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Log mount/unmount
  useEffect(() => {
    console.log('[RENDERER] App component mounted at', new Date().toISOString());
    return () => {
      console.log('[RENDERER] App component unmounting at', new Date().toISOString());
    };
  }, []);

  // Handle new file
  const handleNew = useCallback(() => {
    contentVersionRef.current += 1;
    isInitializedRef.current = false;
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
        contentVersionRef.current += 1;
        isInitializedRef.current = false;
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
        // Update initial content ref to the saved content
        if (getContentRef.current) {
          initialContentRef.current = getContentRef.current();
        }
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
        // Update initial content ref to the saved content
        if (getContentRef.current) {
          initialContentRef.current = getContentRef.current();
        }
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

  // Autosave functionality
  useEffect(() => {
    // Clear any existing interval
    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current);
      autoSaveIntervalRef.current = null;
    }

    // Set up autosave if we have a file path and the document is dirty
    if (currentFilePath && isDirty && getContentRef.current) {
      console.log('Starting autosave interval');
      autoSaveIntervalRef.current = setInterval(async () => {
        if (isDirty && currentFilePath && getContentRef.current && window.electronAPI) {
          console.log('[AUTOSAVE] Autosaving...', {
            isDirty,
            currentFilePath,
            hasGetContent: !!getContentRef.current
          });
          try {
            const content = getContentRef.current();
            console.log('[AUTOSAVE] Content length:', content.length);
            const result = await window.electronAPI.saveFile(content);
            console.log('[AUTOSAVE] Save result:', result);
            if (result) {
              setIsDirty(false);
              initialContentRef.current = content;
              console.log('[AUTOSAVE] Autosaved successfully');
            } else {
              console.log('[AUTOSAVE] Save returned null');
            }
          } catch (error) {
            console.error('[AUTOSAVE] Autosave failed:', error);
          }
        } else {
          console.log('[AUTOSAVE] Skipping autosave:', {
            isDirty,
            currentFilePath,
            hasGetContent: !!getContentRef.current,
            hasElectronAPI: !!window.electronAPI
          });
        }
      }, 2000); // Autosave every 2 seconds
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
        autoSaveIntervalRef.current = null;
      }
    };
  }, [currentFilePath, isDirty]);

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
      contentVersionRef.current += 1;
      isInitializedRef.current = false;
      setContent(data.content);
      setCurrentFilePath(data.filePath);
      setCurrentFileName(data.filePath.split('/').pop() || data.filePath);
      setIsDirty(false);
      initialContentRef.current = data.content;
    }));
    cleanupFns.push(window.electronAPI.onNewUntitledDocument((data) => {
      console.log('[RENDERER] Received new-untitled-document event:', data.untitledName);
      setContent('');
      setCurrentFilePath(null);
      setCurrentFileName(data.untitledName);
      setIsDirty(true); // New documents start as dirty
      initialContentRef.current = '';
      // Update the window title immediately
      if (window.electronAPI) {
        window.electronAPI.setTitle(`${data.untitledName} • - Stravu Editor`);
        window.electronAPI.setDocumentEdited(true);
      }
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
    cleanupFns.push(window.electronAPI.onFileDeleted((data) => {
      console.log('File deleted:', data.filePath);
      if (currentFilePath === data.filePath) {
        // Current file was deleted, mark as dirty and clear the file path
        setCurrentFilePath(null);
        setIsDirty(true);
        // Optionally show a notification to the user
        alert('The file has been deleted from disk.');
      }
    }));

    // Clean up listeners when dependencies change
    return () => {
      console.log('Cleaning up IPC listeners');
      cleanupFns.forEach(cleanup => cleanup());
    };
  }, [handleNew, handleOpen, handleSave, handleSaveAs, currentFilePath]);

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
            console.log('Content changed:', newContent.length, 'initialized:', isInitializedRef.current);
            
            // Mark as initialized after first content change
            if (!isInitializedRef.current) {
              isInitializedRef.current = true;
              // Update initial content reference on first change
              if (getContentRef.current) {
                initialContentRef.current = getContentRef.current();
                console.log('Set initial content on first change');
              }
              return;
            }
            
            // Check if content actually changed from initial
            if (getContentRef.current) {
              const currentContent = getContentRef.current();
              const hasChanged = currentContent !== initialContentRef.current;
              if (hasChanged !== isDirty) {
                console.log('Dirty state changed to:', hasChanged);
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
          markdownOnly: true,
        }}
      />
    </div>
  );
}
